# UNESWA Timetable

Personal class and exam timetable for University of Eswatini students. Pick your campus, faculty, course and year, tick your modules, and the weekly timetable builds itself. It exports to PDF and reminds you before class.

- **Web:** https://alexos01.github.io/Uneswa-Timetable/ (GitHub Pages, served straight from `main`)
- **Android / iOS:** the same code inside a [Capacitor](https://capacitorjs.com) shell, with reminders that fire when the app is closed
- **Backend:** Supabase (Postgres, Auth, Realtime)
- **System design:** [`docs/system-design.html`](docs/system-design.html)

This is a student-built app, not an official university service.

## Repository layout

```
index.html               app shell, shared by web and native
css/app.css
js/
  main.js                start-up: capability check, load, realtime, first render
  config.js              Supabase URL + anon key, default campus, footer contact links
  db.js                  every Supabase read/write, campus scoping, staff roles
  platform.js            web vs native: notifications, PDF share, back button, status bar
  reminders.js cache.js  reminder scheduling, offline snapshot
  lib/                   pure logic (search, reminders, notices), unit tested
  views/                 student, announcements, staff sign-in, admin tabs, lecturer portal
vendor/                  pinned browser builds of supabase-js, jsPDF, autotable, @capacitor/core
supabase/migrations/     SQL to run once in the Supabase SQL editor
android/  ios/           native projects
assets/                  icon and splash sources (SVG); PNGs rendered from them
tests/unit  tests/ui  tests/db
```

There is no bundler. The browser loads `js/main.js` as an ES module, and GitHub Pages serves the repo as it is. `npm run build` only copies these files into `www/` for Capacitor.

## Local development

Needs Node 22+.

```sh
npm ci
npm run serve            # http://localhost:5173
```

The dev server talks to the live Supabase project in `js/config.js`. When you're trying out write flows, prefer the UI tests, which use an in-memory fake.

### Tests

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | Pure logic: search scoping, reminder planning, notices | Node |
| `npm run test:ui` | The real app in Chromium against an in-memory Supabase fake: sign-in, module picking, search, PDF export, offline start, campuses, staff roles, lecturer edits, announcements | Chromium or Chrome (set `CHROMIUM_PATH` if it isn't in `/usr/bin`) |
| `npm run test:db` | Applies the migrations twice to a throwaway Postgres and checks 40 row-level-security rules | Docker |

CI runs all three on every push (`.github/workflows/mobile.yml`).

## Mobile apps

```sh
npm run sync             # copy web files to www/ and into android/ + ios/
npx cap open android     # Android Studio (JDK 21, Android SDK 36)
npx cap open ios         # Xcode, macOS only
```

Every push to `main` builds an **Android debug APK**: open the workflow run under *Actions* and download `uneswa-timetable-debug-apk`. CI also compiles the iOS app for the simulator, unsigned.

After editing `assets/*.svg`, run `node scripts/render-icons.mjs`, then `npx capacitor-assets generate --android --ios`.

### Releasing to the stores

- **Google Play:** a Play Console account (one-off US$25), an upload keystore kept out of the repo, `./gradlew bundleRelease`, a privacy policy and the data-safety form. The app stores a student number and name.
- **App Store:** an Apple Developer Program membership (US$99 a year), a Mac or a cloud macOS runner with signing certificates, and TestFlight for testers.
- The app id `io.github.alexos01.uneswatimetable` can't change after the first store release.

## Database

The live project was created by hand, so it has no migration history. The files in `supabase/migrations/` bring it up to date. They are idempotent, so running one twice is harmless.

1. **Before you start:** open *Authentication → Users*. Every account listed there becomes a **super admin** in step 2, so delete test accounts first.
2. Run `001_campuses_and_roles.sql` in *SQL Editor → New query*.
3. Run `002_announcements_and_notices.sql`.
4. Reload the app. Campuses, the Staff tab, lecturers and announcements switch on by themselves.

Until the migrations run, the app works as it did before: one campus (Kwaluseni), and any login counts as admin.

### Roles

| Role | Can do |
| --- | --- |
| Student (no login) | Register by student number, pick modules, read everything |
| Lecturer | Move sessions and post test/cancellation notices for their assigned modules |
| Campus admin | Everything on their own campus: timetables, imports, students, semester reset, announcements, lecturers |
| Super admin | Every campus, all-campus announcements, creating admins |

To add staff, the person first opens **Staff → Create a staff account**. An admin then adds their email under **Staff → Staff & lecturers** and, for a lecturer, assigns module codes.

### Known limitation

Students have no password, so anyone can read or edit a student record if they know the student number. Fixing that means real student sign-in, such as a magic link to the university email.

## Configuration

`js/config.js` holds the Supabase URL and anon key (public by design, with access enforced by RLS), the default campus, and the footer's contact details. A LinkedIn or Facebook link only appears once its URL is filled in.

## Contact

Questions or a wrong class time: Lwandile Dlamini, dlaminilwandile2005@gmail.com
