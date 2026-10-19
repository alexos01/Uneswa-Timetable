# UNESWA Timetable

Personal class and exam timetable for University of Eswatini students. Pick your campus, faculty, course and year, tick your modules, and the weekly timetable builds itself. It exports to PDF and to your calendar, works offline, and reminds you before class and when a class is late, cancelled or moved.

- **Web:** https://alexos01.github.io/Uneswa-Timetable/ (GitHub Pages, served straight from `main`). It can be installed from the browser and opens with no connection; changes made offline sync when the connection returns.
- **Android / iOS:** the same code inside a [Capacitor](https://capacitorjs.com) shell, with reminders that fire when the app is closed
- **Backend:** Supabase (Postgres, Auth, Realtime, and an Edge Function for Web Push)
- **System design:** [`docs/system-design.html`](docs/system-design.html)

This is a student-built app, not an official university service.

## Repository layout

```
index.html               app shell, shared by web and native
sw.js                    service worker (web only): offline app files, install, push messages
css/app.css
js/
  main.js                start-up: capability check, load, realtime, reconnect, first render
  config.js              Supabase URL + anon key, push key, default campus, footer contact links
  db.js                  every Supabase read/write, campus scoping, staff roles
  platform.js            web vs native: notifications, PDF/CSV share, back button, install
  reminders.js push.js   reminder scheduling, change alerts, Web Push subscription
  cache.js store.js      offline copy of the campus timetable (IndexedDB)
  sync.js                changes made offline, sent when back online
  student-token.js       the device's student sign-in token (never the password)
  timetable-pdf.js       the university's timetable PDF: upload, offline copy
  lib/                   pure logic (search, reminders, notices, CSV, announcements), unit tested
  views/                 student, announcements, sign-in, admin tabs, lecturer, class rep
vendor/                  pinned browser builds of supabase-js, jsPDF, autotable, @capacitor/core
supabase/migrations/     SQL to run once in the Supabase SQL editor
supabase/functions/      send-push Edge Function (Deno) and its setup
android/  ios/           native projects
assets/                  icon and splash sources (SVG); PNGs rendered from them
tests/unit  tests/ui  tests/db  tests/functions
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
| `npm test` | Pure logic: search scoping, reminder and push planning, notices, CSV reading, the calendar file, the service worker's file list | Node |
| `npm run test:ui` | The real app in Chromium against an in-memory Supabase fake: sign-in, module picking, search, PDF, CSV and calendar export, offline start and sync, the service worker, push subscription, campuses, staff roles, lecturer and class rep tabs, late notices, announcements, CSV upload | Chromium or Chrome (set `CHROMIUM_PATH` if it isn't in `/usr/bin`) |
| `npm run test:db` | Applies the migrations twice to a throwaway Postgres and checks the row-level security rules, Storage rules and student sign-in functions | Docker |
| `npm run test:functions` | Runs the send-push Edge Function under Deno against a stand-in Supabase and push service, and decrypts what it sends | Deno, openssl |

CI runs all four on every push (`.github/workflows/mobile.yml`).

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
4. Run `003_class_reps_late_notices_push.sql`.
5. Reload the app. Campuses, the Lecturer, Class rep and Staff tabs, announcements and "running late" notices switch on by themselves.

Until the migrations run, the app works as it did before: one campus (Kwaluseni), and any login counts as admin. Each feature checks for its migration first, so running them one at a time is fine.

### Push notifications (web)

The phone apps schedule reminders on the device. In a browser, reminders and late/cancelled/moved alerts arrive with the page closed only once Web Push is turned on: a VAPID key in `js/config.js`, the `send-push` Edge Function deployed, and `setup.sql` run. The steps are in [`supabase/functions/send-push/README.md`](supabase/functions/send-push/README.md). Until then, browser reminders arrive only while the page is open.

### Roles

| Role | Can do |
| --- | --- |
| Student | Sign in with student number and password (before migration 004: student number only), pick modules, read everything, download a course's timetable |
| Lecturer | Move sessions and post notices (running late, test, cancelled, moved…) for their assigned modules, for all their courses or one |
| Class rep | What a lecturer can do for their assigned modules, plus announcements to those modules' courses |
| Campus admin | Everything on their own campus: timetables, CSV and AI imports, the official timetable PDF, students and their passwords, semester reset, announcements, lecturers, class reps |
| Super admin | Every campus, all-campus announcements, creating admins |

To add staff, the person first opens **Staff → Create a staff account**. An admin then adds their email under **Staff → Staff & lecturers** and, for a lecturer or class rep, assigns module codes. Lecturers and class reps sign in under **Staff**, which then opens their own **Lecturer** or **Class rep** tab. Those tabs are hidden from everyone else.

### Uploading the official timetable

Under **Staff → Class timetable** (or **Exam timetable**), upload the timetable as a CSV file saved from Excel or Google Sheets. **Download CSV template** gives the columns: `Code, Day, Start, End, Venue, Course, Faculty` (`Date` instead of `Day` for exams). The app shows how many rows are ready and which lines it will skip before writing anything, and importing the same file twice adds nothing. When the university only publishes a PDF, use **AI Import**, which reads the PDF text and proposes rows to review.

Upload the PDF itself under **Staff → Settings → Official timetable PDF** as well. Students find it at the bottom of **My Timetable**, and it opens offline.

### Student passwords

After migration 004, a student signs in with their student number and a password they choose; the first password set on a number claims it, including records made before passwords. The device keeps a sign-in token, never the password, so the app opens straight away on that phone and still works offline. Five wrong passwords lock the number for 15 minutes. A campus admin resets a forgotten password under **Staff → Students**, and the student chooses a new one.

## Configuration

`js/config.js` holds the Supabase URL and anon key (public by design, with access enforced by RLS), the default campus, and the footer's contact details. A LinkedIn or Facebook link only appears once its URL is filled in.

## Contact

Questions or a wrong class time: Lwandile Dlamini, dlaminilwandile2005@gmail.com
