-- CBAS Drivers — start the database over (ONLY for a brand-new project with no real data).
-- Use this if schema.sql stopped partway, e.g. "42P07: relation profiles already exists".
-- It removes the app's tables and functions; it does not delete logins (Authentication → Users).
-- After running this, run schema.sql again, then make yourself a manager (see README).

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_section_done(uuid, boolean, timestamptz) cascade;
drop function if exists public.set_section_done(uuid, boolean) cascade;
drop function if exists public.set_subdivision_scanned(uuid, boolean, timestamptz) cascade;
drop function if exists public.is_admin() cascade;
drop table if exists
  public.section_events, public.section_pins, public.route_plans, public.sections,
  public.subdivisions, public.uploads, public.driver_deadlines, public.quarter_presets,
  public.quarters, public.app_settings, public.profiles
  cascade;
