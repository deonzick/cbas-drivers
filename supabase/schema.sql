-- CBAS Drivers — database setup.
-- Paste this whole file into Supabase → SQL Editor → New query → Run. Safe to run once on a new project.

create extension if not exists pgcrypto;

-- People who can sign in. One row per Supabase auth user.
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  username text unique,
  role text not null default 'driver' check (role in ('driver','admin')),
  drives boolean not null default true, -- managers who also drive keep this on
  driver_key text,                 -- matches the "Driver" column in assignment PDFs (e.g. "Nate")
  active boolean not null default true,
  home jsonb,                      -- {label, address, lat, lng}
  work jsonb,
  default_start text not null default 'home' check (default_start in ('home','work','current','custom')),
  start_place jsonb,               -- used when default_start = 'custom'
  created_at timestamptz not null default now()
);

-- Quarterly cycles ("3Q26"). Only one is active at a time.
create table public.quarters (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  is_active boolean not null default false,
  closed_at timestamptz,
  summary jsonb,                   -- per-driver totals saved when a quarter is closed
  purged_at timestamptz,           -- set if an archived quarter's detail was deleted for good
  start_date date,                 -- first day of the drive window
  due_date date,                   -- default due date for every driver this quarter
  created_at timestamptz not null default now()
);
create unique index one_active_quarter on public.quarters (is_active) where is_active;

-- Saved quarter calendar, e.g. 1Q27 runs Jan 1 – Mar 15. Used to prefill dates when a quarter starts.
create table public.quarter_presets (
  label text primary key check (label ~ '^[1-4]Q[0-9]{2}$'),
  start_date date,
  due_date date
);

-- Optional per-driver due date that overrides the quarter's.
create table public.driver_deadlines (
  quarter_id uuid not null references public.quarters on delete cascade,
  driver_id uuid not null references public.profiles on delete cascade,
  due_date date not null,
  primary key (quarter_id, driver_id)
);

-- Each uploaded assignment file (PDF/XLSX) for one driver in one quarter.
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  quarter_id uuid not null references public.quarters on delete cascade,
  driver_id uuid not null references public.profiles on delete cascade,
  file_name text not null,
  storage_path text,
  subdivision_count int not null default 0,
  section_count int not null default 0,
  uploaded_by uuid references public.profiles,
  uploaded_at timestamptz not null default now()
);

create table public.subdivisions (
  id uuid primary key default gen_random_uuid(),
  quarter_id uuid not null references public.quarters on delete cascade,
  driver_id uuid not null references public.profiles on delete cascade,
  upload_id uuid references public.uploads on delete cascade,
  county text, city text, market text, submarket text,
  name text not null,
  lat double precision, lng double precision,
  sort int not null default 0,
  scanned_at timestamptz,          -- driver confirmed the plat was scanned into TurboScan
  scanned_by uuid references public.profiles,
  created_at timestamptz not null default now()
);
create index on public.subdivisions (driver_id, quarter_id);

create table public.sections (
  id uuid primary key default gen_random_uuid(),
  subdivision_id uuid not null references public.subdivisions on delete cascade,
  label text not null,
  kinds text[] not null default '{active}',   -- any of new / active / btr
  lat double precision, lng double precision,  -- optional, for later
  sort int not null default 0,
  completed_at timestamptz,
  completed_by uuid references public.profiles
);
create index on public.sections (subdivision_id);

-- Every check and uncheck, with the time it happened on the driver's phone.
create table public.section_events (
  id bigint generated always as identity primary key,
  section_id uuid not null references public.sections on delete cascade,
  driver_id uuid references public.profiles on delete set null,
  done boolean not null,
  happened_at timestamptz not null,
  synced_at timestamptz not null default now()
);
create index on public.section_events (section_id);

-- Optional section coordinates, kept across quarters and applied whenever a matching
-- subdivision + section is imported. Keys are normalised (upper case, no spaces, "P8S9A" form).
create table public.section_pins (
  subdivision_key text not null,
  section_key text not null,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now(),
  primary key (subdivision_key, section_key)
);

-- A driver's saved route plan (one per driver).
create table public.route_plans (
  driver_id uuid primary key references public.profiles on delete cascade,
  quarter_id uuid references public.quarters on delete cascade,
  plan jsonb not null,
  updated_at timestamptz not null default now()
);

create table public.app_settings (
  id int primary key default 1 check (id = 1),
  minutes_per_section numeric not null default 5,
  minutes_per_stop numeric not null default 3
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ---------- helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active);
$$;

-- Drivers check sections off through this function only, so they can't change anything else.
-- p_at is when the driver tapped it (check-offs made offline sync later with their real time).
-- If two changes to one section arrive out of order, the one that happened last wins.
create or replace function public.set_section_done(p_section uuid, p_done boolean, p_at timestamptz default now())
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := least(coalesce(p_at, now()), now()); v_last timestamptz;
begin
  if v_at < now() - interval '45 days' then v_at := now(); end if;
  if not exists (
    select 1 from public.sections s join public.subdivisions d on d.id = s.subdivision_id
    join public.quarters q on q.id = d.quarter_id
    where s.id = p_section and q.is_active and (d.driver_id = auth.uid() or public.is_admin())
  ) then raise exception 'Not your section, or the quarter is closed'; end if;
  insert into public.section_events (section_id, driver_id, done, happened_at) values (p_section, auth.uid(), p_done, v_at);
  select max(happened_at) into v_last from public.section_events where section_id = p_section;
  if v_last > v_at then
    return (select completed_at from public.sections where id = p_section);  -- a newer change already applied
  end if;
  update public.sections
     set completed_at = case when p_done then v_at else null end,
         completed_by = case when p_done then auth.uid() else null end
   where id = p_section;
  -- A subdivision that's no longer complete can't stay marked as scanned.
  if not p_done then
    update public.subdivisions set scanned_at = null, scanned_by = null
     where id = (select subdivision_id from public.sections where id = p_section);
  end if;
  return case when p_done then v_at else null end;
end $$;

-- "Scanned into TurboScan" — only for subdivisions whose sections are all checked (driven).
-- A subdivision is COMPLETE when it is both driven and scanned.
create or replace function public.set_subdivision_scanned(p_subdivision uuid, p_done boolean, p_at timestamptz default now())
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_at timestamptz := least(coalesce(p_at, now()), now());
begin
  if v_at < now() - interval '45 days' then v_at := now(); end if;
  if not exists (
    select 1 from public.subdivisions d join public.quarters q on q.id = d.quarter_id
    where d.id = p_subdivision and q.is_active and (d.driver_id = auth.uid() or public.is_admin())
  ) then raise exception 'Not your subdivision, or the quarter is closed'; end if;
  if p_done and (
    not exists (select 1 from public.sections where subdivision_id = p_subdivision)
    or exists (select 1 from public.sections where subdivision_id = p_subdivision and completed_at is null)
  ) then raise exception 'Finish every section before marking it scanned'; end if;
  update public.subdivisions
     set scanned_at = case when p_done then v_at else null end,
         scanned_by = case when p_done then auth.uid() else null end
   where id = p_subdivision;
  return case when p_done then v_at else null end;
end $$;
revoke execute on function public.set_subdivision_scanned(uuid, boolean, timestamptz) from anon;
revoke execute on function public.set_section_done(uuid, boolean, timestamptz) from anon;

-- New sign-ups get a profile row automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.raw_user_meta_data->>'username')
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only signed-in users may call the check-off functions; nobody calls the sign-up trigger directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.set_section_done(uuid, boolean, timestamptz) from public, anon;
revoke execute on function public.set_subdivision_scanned(uuid, boolean, timestamptz) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.set_section_done(uuid, boolean, timestamptz) to authenticated;
grant execute on function public.set_subdivision_scanned(uuid, boolean, timestamptz) to authenticated;

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.quarters enable row level security;
alter table public.uploads enable row level security;
alter table public.subdivisions enable row level security;
alter table public.sections enable row level security;
alter table public.route_plans enable row level security;
alter table public.app_settings enable row level security;
alter table public.driver_deadlines enable row level security;
alter table public.quarter_presets enable row level security;
alter table public.section_events enable row level security;
alter table public.section_pins enable row level security;

create policy "read own profile or admin" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Drivers may only change their saved places; names, logins and roles are managed by managers (server side).
revoke update on public.profiles from authenticated;
grant update (home, work, default_start, start_place) on public.profiles to authenticated;

create policy "read quarters" on public.quarters for select using (auth.uid() is not null);
create policy "read settings" on public.app_settings for select using (auth.uid() is not null);
create policy "read own uploads" on public.uploads for select using (driver_id = auth.uid() or public.is_admin());
create policy "read own subdivisions" on public.subdivisions for select using (driver_id = auth.uid() or public.is_admin());
create policy "read own sections" on public.sections for select using (
  exists (select 1 from public.subdivisions d where d.id = subdivision_id and (d.driver_id = auth.uid() or public.is_admin())));
create policy "own plan" on public.route_plans for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy "admin reads plans" on public.route_plans for select using (public.is_admin());
create policy "read own deadline" on public.driver_deadlines for select using (driver_id = auth.uid() or public.is_admin());
create policy "admin reads events" on public.section_events for select using (public.is_admin());
create policy "admin reads pins" on public.section_pins for select using (public.is_admin());
create policy "admin reads presets" on public.quarter_presets for select using (public.is_admin());

-- Writes to quarters, uploads, subdivisions, sections and settings go through the app's
-- server routes (service role), which check that the caller is an admin.

-- Private storage for the uploaded PDFs.
insert into storage.buckets (id, name, public) values ('assignment-files', 'assignment-files', false)
  on conflict (id) do nothing;

-- ---------- first admin ----------
-- After you create your own login (Supabase → Authentication → Add user), run:
--   insert into public.profiles (id, full_name, role)
--   select id, 'Your Name', 'admin' from auth.users where email = 'you@example.com'
--   on conflict (id) do update set role = 'admin', full_name = excluded.full_name;
