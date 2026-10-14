# CBAS Drivers

A phone app for CBAS quarterly field drives. Drivers sign in with a username and password their manager gives them, see only their own subdivisions and their own completion, check off sections (even with no signal), mark finished subdivisions as scanned into TurboScan, and plan each day's route. Managers have their own logins: they upload each driver's drive sheet (the PDF printed from the assignments spreadsheet), set quarter dates, follow progress, and clear everything at quarter end. The app never sends drivers reminders or notifications.

It runs on Vercel and installs to iPhone and Android home screens like a normal app (a Progressive Web App). App Store / Google Play listings are optional and covered at the end.

## What it does

**Drivers**
- Sign in once with "Keep me signed in on this phone". No email needed; managers create and reset logins.
- Their own completion only: driven, scanned and complete counts, plus a countdown to their due date ("23 days left"). **A subdivision is complete when it's both driven (every section checked) and scanned into TurboScan.** Their list filters to To drive / To scan / Complete.
- My list: subdivisions grouped by CBAS sub-market. Sections read as **Ph8 Sec 9A** / **Sec 4A**, with New and BTR marked. A subdivision is complete only when every section is checked. Sections can be unchecked; every check and uncheck is time-stamped.
- **Scanned into TurboScan:** once a subdivision is complete, a box appears to confirm its plat was scanned. It's per subdivision, not per section, and is cleared automatically if a section is later unchecked.
- **No signal?** The list opens from the phone's last copy and check-offs are saved on the phone, then sync with the time they were tapped once signal returns. A strip at the top shows how many are waiting.
- Plan today: pick today's subdivisions, start from their default start (Home unless they choose Work, current location or another address on the Me tab; changeable per day), and an optional finish. Stops are put in the quickest order using Google's live drive times plus 5 minutes per section. No time limit; plan again the next day.
- Google Maps hands-off: Navigate per stop, or a few stops at a time.
- Me: save Home and Work, choose a default start, sign out.

**Managers** (`/admin`)
- Dashboard: team totals for driven and scanned, how many drivers are complete, then one dropdown per driver. Each shows separate Driven and Scanned bars, and a subdivision table filterable by Not driven / Driven, not scanned / Complete, with the date each was driven and scanned, recent check-offs, due date and drive sheet. A driver shows **Complete** when every subdivision is driven and scanned. No pace or location tracking.
- Reassign: in a driver's dropdown, Reassign moves a subdivision (with its check-offs and scan) to another driver.
- Quarter calendar: save start and due dates for 1Q–4Q of any year once; each quarter fills its dates from the calendar when it starts. A driver can still be given their own due date.
- Add a subdivision: for the rare one-or-two additions mid-drive, add it to a driver directly (or remove one). Subdivisions are never split: the app refuses one that's already assigned this quarter.
- Upload drive sheets: drop one PDF per driver (or the Excel file). Preview first, then save. Re-uploading a corrected sheet keeps check-offs already made.
- Logins: managers and drivers are separate accounts. Managers land on the manager dashboard and never see the driver screens; a manager who also drives gets a second, driver login. Managers create usernames, reset passwords and turn accounts off; drivers can't change their own password.
- Optional section pins: upload `Subdivision, Section, Latitude, Longitude` any time; they're remembered across quarters and give each pinned section its own Go button.
- End of quarter: **Close** the quarter. It becomes a read-only archive: drivers stop seeing it and nothing can be changed, but managers can open it under **Archive**, see who drove and scanned what, and download the CSV any time. (Optional: delete an old quarter's detail for good from the archive page.)

## Drive sheet format

Header row with these columns (any order, extra columns ignored):

`County · City · CBAS_Mkt · CBAS_SubMkt · Subdivision · New Section(s) · Active Section(s) · BTR Section(s) · Latitude · Longitude · Driver`

Messy section cells (`, 1,2,3 4`, `P8S9A, P8S9B`, wrapped onto several lines) are handled. A section listed in two columns becomes one section tagged with both.

---

# Putting it online

You'll create four free accounts. Google needs a card on file for billing (it includes monthly free usage). Total time: about 45 minutes.

## Step 1 — Supabase (database and logins)
For about 20 drivers and 700–800 subdivisions a quarter, the free plan holds years of data. Note that free projects pause after a week with no activity; during drive season that won't happen, but if the app sits idle between quarters you'll need to press **Restore** in Supabase (or use the Pro plan to avoid pausing).

1. Go to **supabase.com** → Start your project → sign in with GitHub → **New project**. Name it `cbas-driver-routes`, pick a strong database password, region **East US (or Central US)**.
2. Left menu **SQL Editor** → **New query** → open `supabase/schema.sql` from this folder, copy everything, paste, **Run**. You should see "Success. No rows returned". Run it only once. If you get "42P07 … already exists", run `supabase/reset.sql` in a new query, then `schema.sql` again.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up" (only managers create logins). Save.
4. **Authentication → Users → Add user → Create new user**: your email + a password, tick **Auto Confirm User**.
5. Back in **SQL Editor**, run (with your email):
   ```sql
   insert into public.profiles (id, full_name, role)
   select id, 'Dee', 'admin' from auth.users where email = 'you@example.com'
   on conflict (id) do update set role = 'admin', full_name = excluded.full_name;
   ```
6. **Project Settings → API** (or "API Keys"): keep this tab open. You'll copy the **Project URL**, the **anon / publishable** key and the **service_role / secret** key in Step 4.

## Step 2 — Google Maps (routes, drive times, address search)
1. **console.cloud.google.com** → create a project `CBAS Driver Routes` → **Billing**: link a billing account.
2. **APIs & Services → Library**: enable **Maps JavaScript API**, **Routes API**, **Geocoding API**.
3. **APIs & Services → Credentials → Create credentials → API key**, twice:
   - **Browser key** → Edit → Application restrictions: **Websites** → add `https://*.vercel.app/*` for now (tighten to your exact address later) → API restrictions: **Maps JavaScript API** → Save.
   - **Server key** → Application restrictions: **None** → API restrictions: **Routes API** and **Geocoding API** → Save. Treat it like a password.
4. Optional: set a budget alert under **Billing → Budgets & alerts**. Each "Build today's route" is one Routes request (billed at the "Compute Routes Pro" rate because it reorders stops) and each address search is one Geocoding request.

You can skip Google at first: the app still works with estimated drive times and a sketch map.

## Step 3 — GitHub (where Vercel reads the code)
1. Create an account at **github.com**, then install **GitHub Desktop** (desktop.github.com) and sign in.
2. Unzip `cbas-driver-routes.zip`.
3. GitHub Desktop → **File → Add local repository** → choose the `cbas-driver-routes` folder → it offers to "create a repository" → **Create**.
4. **Publish repository** → keep **Private** ticked → Publish.

(If you'd rather not install anything, ask Claude to push it to a GitHub repo for you once GitHub is connected.)

## Step 4 — Vercel (hosting)
1. **vercel.com** → Sign up with GitHub → **Add New… → Project** → **Import** `cbas-driver-routes`.
2. Framework preset shows **Next.js**. Leave build settings alone.
3. Open **Environment Variables** and add:
   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role / secret key |
   | `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google **browser** key |
   | `GOOGLE_MAPS_SERVER_KEY` | Google **server** key |
   | `NEXT_PUBLIC_GOOGLE_MAP_ID` | `DEMO_MAP_ID` |
   | `NEXT_PUBLIC_APP_NAME` | `CBAS Drivers` (change any time to rename the app) |
4. **Deploy**. In about two minutes you get an address like `https://cbas-driver-routes.vercel.app`.
5. Optional: **Settings → Domains** to use your own (e.g. `drive.cbasadvisory.com`); add it to the Google browser key's websites too.

### How updates reach the app
- **Data is live.** Check-offs, scans, uploads and reassignments save to Supabase the moment they happen (or as soon as a phone gets signal). The manager dashboard shows them when you open it or tap Refresh; nothing needs redeploying.
- **App changes deploy on push.** When you get a new version of this folder: replace the files, then GitHub Desktop → **Commit to main** → **Push origin**. Vercel rebuilds automatically (about 1–2 minutes) and the new version is live at the same address. Installed phones pick it up the next time the app is opened.
- **Database changes** (rare) come with a note to run a SQL snippet in Supabase. For this version, run the whole `supabase/schema.sql` on a fresh project.

## Step 5 — First run
1. Open your Vercel address on a computer and sign in with your email and password. Your account is a manager login.
2. **Overview → Quarter calendar**: enter the start and due dates for each quarter of the year, then start the current quarter (its dates fill in).
3. **Drivers**: add each driver (Access: Driver) and any other managers (Access: Manager). "Name in drive sheets" must match the PDF's Driver column (e.g. `Nate`). Copy the username and password shown and send them to the driver.
4. **Upload drive sheets**: drop the PDFs, check the preview, save.

## Step 6 — Getting it on drivers' phones
Send drivers the Vercel address. They open it once and add it to the home screen; from then on it opens like any app, full screen, signed in, and works offline.
- **iPhone:** open the link in **Safari** (not Chrome) → **Share** button → **Add to Home Screen** → Add.
- **Android:** open the link in **Chrome** → tap **Install** on the banner (or ⋮ → **Install app**).
The app also shows these instructions on the sign-in screen until it's installed.

## Each quarter
1. **Overview → Close [quarter]** and type the label to confirm. It moves to **Archive**, read-only.
2. Start the next quarter (dates fill in from the quarter calendar) and upload the new sheets.

---

## Optional: Google Play and App Store

The home-screen app above covers daily use with no store accounts. If you want the app listed in a store:

**Google Play (easier).** Go to **pwabuilder.com**, enter your Vercel address, choose **Android → Generate package**. PWABuilder wraps the site as a Trusted Web Activity and gives you an upload bundle plus a signing key and an `assetlinks.json` file. Put `assetlinks.json` in this project at `public/.well-known/assetlinks.json` and redeploy (this hides the browser bar). Then upload the bundle in a **Google Play Console** developer account; you can publish to an internal-testing track that only your drivers can see.

**Apple App Store (more work).** Apple needs the app wrapped natively (PWABuilder's iOS package or Capacitor), a Mac with Xcode, and a paid Apple Developer account. Apple reviews it; plain website wrappers can be rejected under guideline 4.2 (minimum functionality), so the offline mode and location features help. For a team-only app, ask for **Unlisted App Distribution** after review: it's on the App Store but only reachable by direct link.

## Running it on your own computer (optional)
Requires Node.js 18.18+.
```
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```

## Project map
- `app/` screens: `/login`, `/` (my list), `/plan` (plan today), `/me`, `/admin`, `/admin/upload`, `/admin/drivers`
- `app/api/` server routes: file parsing/import, section pins, driver logins, quarter actions, route planning, address search
- `lib/parse/` PDF and Excel importer · `lib/route.ts` route ordering · `lib/offline.ts` offline check-off queue
- `supabase/schema.sql` tables, access rules, and the check-off function
- `public/sw.js` offline support · `public/manifest.webmanifest` home-screen app settings
