# To do: Lwandile

The mobile app work is on `main`. The live site runs the new code in single-campus mode until step 1 is done. Background is in [`docs/system-design.html`](system-design.html), and setup and release steps are in [`README.md`](../README.md).

## 1. Run the database migrations

Nothing else in this list works until this is done.

- [ ] In the Supabase dashboard, open **Authentication → Users** and delete any test accounts. **Every account listed there becomes a super admin** when the migration runs.
- [ ] Open **SQL Editor → New query**, paste [`supabase/migrations/001_campuses_and_roles.sql`](../supabase/migrations/001_campuses_and_roles.sql) and click **Run**.
- [ ] In a new query, run [`supabase/migrations/002_announcements_and_notices.sql`](../supabase/migrations/002_announcements_and_notices.sql).
- [ ] In a new query, run [`supabase/migrations/003_class_reps_late_notices_push.sql`](../supabase/migrations/003_class_reps_late_notices_push.sql).
- [ ] In a new query, run [`supabase/migrations/004_notice_courses_timetable_pdf_student_passwords.sql`](../supabase/migrations/004_notice_courses_timetable_pdf_student_passwords.sql).
- [ ] After 004, every student is asked to choose a password the next time they open the app, and a debug APK built before this change can no longer open student timetables. Install the latest one.
- [ ] Reload the site. The header should now say **Kwaluseni campus**, and the top tabs should be **My Timetable · Announcements · Staff**. The **Lecturer** and **Class rep** tabs only appear once a lecturer or class rep signs in under Staff.

All four files are safe to run again if something goes wrong halfway.

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

## 4. Test the web app offline

- [ ] On an Android phone, open the site in Chrome and tap **Install app** in the header (or Chrome's menu → **Install app**). On an iPhone, use Safari's Share → **Add to Home Screen**.
- [ ] Open it from the home screen, sign in as a student and tick a few modules.
- [ ] Turn on airplane mode and reopen it. The timetable should show, with **offline** in the header.
- [ ] Still offline, tick another module. The header should say **1 change waiting to sync**.
- [ ] Turn airplane mode off. You should see **You're back online. Your changes are synced.**, and the module should still be ticked after a reload.
- [ ] Reopen it on a weak signal. Your timetable should show straight away with **syncing…** in the header, and the header should drop it once the sync is done.

## 5. Set up campuses and staff (after step 1)

- [ ] Sign in under **Staff** with your existing admin login. You're now a super admin, and a campus switcher appears in the admin panel.
- [ ] For **Luyengo** and **Mbabane**: ask each campus admin to open **Staff → Create a staff account**, then add their email under **Staff & lecturers** with the role *Campus admin*.
- [ ] Upload the Luyengo and Mbabane timetables: switch campus, open **Class timetable**, click **Download CSV template**, fill it in Excel or Google Sheets, save as CSV and upload it. Use **AI Import** when all you have is the PDF.
- [ ] Add lecturers the same way with the role *Lecturer*, then assign their module codes so they can post tests, mark a class as running late and move sessions. They sign in under **Staff** and land on their **Lecturer** tab.
- [ ] As a lecturer, post a test for a module that runs on two courses (MAT111, say) and pick one under **Course**. Only students taking it on that course should see it; **All courses** reaches everyone on the module.
- [ ] Add class reps with the role *Class rep* and assign the modules for their class. They sign in under **Staff** and land on their **Class rep** tab, where they can do what a lecturer can for those modules, and post announcements to their class.
- [ ] Post a first announcement to check that students see it under **Announcements**.
- [ ] As a student, sign in with your student number. You're asked to choose a password, and after that the app opens without asking on that phone. Sign out and back in to check the password. Then, as a campus admin, click **Reset password** for that student under **Staff → Students**; the student is signed out and chooses a new password.
- [ ] Under **Staff → Settings → Official timetable PDF**, upload each campus's timetable PDF from the university. Students find it at the bottom of **My Timetable**, and it opens offline once the app has been opened online.

## 6. Turn on push notifications for the web app (after step 1)

Without this, browser reminders only arrive while the page is open. The phone app doesn't need it.

- [ ] Follow [`supabase/functions/send-push/README.md`](../supabase/functions/send-push/README.md): make the VAPID keys, put the public one in `js/config.js`, set the secrets, deploy the function, and run its `setup.sql`.
- [ ] Check it: as a student in desktop Chrome, turn on **Reminders** and close the tab. As a lecturer on another device, post **Running late** for one of that student's modules. A notification should arrive.

## 7. Decide

- [x] **Student privacy.** Decided and built: after migration 004 each student signs in with their student number and a password they choose, and only campus admins can read the students table. A forgotten password is reset by a campus admin under **Staff → Students**.
- [ ] **Store release.** Google Play needs a Play Console account (one-off US$25) and an upload keystore. The App Store needs an Apple Developer membership (US$99 a year) and a Mac or cloud macOS runner for signing. Both stores need a privacy policy. Which store first, and who owns the accounts?

## Questions

Ask Olwethu about anything in this list.
