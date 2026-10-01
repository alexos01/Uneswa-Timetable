# To do: Lwandile

The mobile app work is on `main`. The live site runs the new code in single-campus mode until step 1 is done. Background is in [`docs/system-design.html`](docs/system-design.html), and setup and release steps are in [`README.md`](README.md).

## 1. Run the database migrations

Nothing else in this list works until this is done.

- [ ] In the Supabase dashboard, open **Authentication → Users** and delete any test accounts. **Every account listed there becomes a super admin** when the migration runs.
- [ ] Open **SQL Editor → New query**, paste [`supabase/migrations/001_campuses_and_roles.sql`](supabase/migrations/001_campuses_and_roles.sql) and click **Run**.
- [ ] In a new query, run [`supabase/migrations/002_announcements_and_notices.sql`](supabase/migrations/002_announcements_and_notices.sql).
- [ ] Reload the site. The header should now say **Kwaluseni campus**, and the top tabs should be **My Timetable · Announcements · Staff**.

Both files are safe to run again if something goes wrong halfway.

## 2. Send the missing details

- [ ] Your **LinkedIn** and **Facebook** URLs for the footer. They go in `js/config.js` under `CONTACT`, and each link stays hidden while its URL is empty.
- [ ] Confirm the app ID **`io.github.alexos01.uneswatimetable`**. It deliberately avoids the university's domain because this isn't an official UNESWA app. It can't be changed after the first store release.
- [ ] Check the footer line: *"Student-built timetable app. Not an official University of Eswatini service; always check notices from your department."* Keep it or reword it (it lives in `js/views/footer.js`).

## 3. Test the Android app on a real phone

CI proves the app builds, but only a real device can show that notifications arrive.

- [ ] On GitHub, open **Actions → Tests and mobile builds**, pick the latest green run, and download **`uneswa-timetable-debug-apk`** from the bottom of the page.
- [ ] Install it on an Android phone. Allow "install unknown apps" for your file manager or browser.
- [ ] Sign in as a student, tick a few modules, turn on **Reminders**, and allow notifications.
- [ ] Set the reminder to 5 minutes before a class, close the app fully, and check that the notification arrives.
- [ ] Tap **Export PDF** and check that the share sheet opens with the timetable.
- [ ] Turn on airplane mode, reopen the app, and check that your saved timetable still shows.
- [ ] Press the Android back button from the Staff tab. It should go back to My Timetable instead of closing the app.

## 4. Set up campuses and staff (after step 1)

- [ ] Sign in under **Staff** with your existing admin login. You're now a super admin, and a campus switcher appears in the admin panel.
- [ ] For **Luyengo** and **Mbabane**: ask each campus admin to open **Staff → Create a staff account**, then add their email under **Staff & lecturers** with the role *Campus admin*.
- [ ] Upload the Luyengo and Mbabane timetables: switch campus, then use **Class timetable** or **AI Import**.
- [ ] Add lecturers the same way with the role *Lecturer*, then assign their module codes so they can post tests and move sessions.
- [ ] Post a first announcement to check that students see it under **Announcements**.

## 5. Decide

- [ ] **Student privacy.** Students sign in with a student number and no password, so anyone who knows a number can view or change that student's record. App-store privacy reviews will ask about this. Fixing it means real student sign-in, such as a magic link sent to the university email. Do we do that before a store release?
- [ ] **Store release.** Google Play needs a Play Console account (one-off US$25) and an upload keystore. The App Store needs an Apple Developer membership (US$99 a year) and a Mac or cloud macOS runner for signing. Both stores need a privacy policy. Which store first, and who owns the accounts?

## Questions

Ask Olwethu about anything in this list.
