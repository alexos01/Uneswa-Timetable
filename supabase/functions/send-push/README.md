# send-push

Sends Web Push notifications to students who turned on reminders in the browser:

- **when a class notice is posted** (running late, cancelled, moved, test, extra class, note) to everyone following that module on that campus
- **when an announcement is posted** to the campus, every campus, or one course and year
- **every minute**, the class reminders that are due (the student's lead time before each session, following any late, cancelled or moved notice for the day)

The Android and iPhone apps don't use this. They schedule reminders on the phone itself.

What gets sent, and to whom, is decided in [`../_shared/push-plan.js`](../_shared/push-plan.js), which `npm test` covers. `npm run test:functions` runs this function under Deno against a stand-in Supabase and push service.

## Turning it on

Needs migration `003_class_reps_late_notices_push.sql`, the [Supabase CLI](https://supabase.com/docs/guides/cli), and someone who can open the project dashboard.

1. Make a VAPID key pair (run this once and keep the output private):

   ```sh
   npx web-push generate-vapid-keys
   ```

2. Paste the **public** key into `js/config.js` as `PUSH_PUBLIC_KEY` and push to `main`.

3. Choose a long random value for the webhook secret, for example `openssl rand -hex 32`, then set the secrets and deploy:

   ```sh
   supabase login
   supabase link --project-ref <PROJECT_REF>
   supabase secrets set VAPID_PUBLIC_KEY=<public key> VAPID_PRIVATE_KEY=<private key> \
     VAPID_SUBJECT=mailto:<contact email> PUSH_WEBHOOK_SECRET=<random value>
   supabase functions deploy send-push --no-verify-jwt
   ```

   `--no-verify-jwt` is needed because the database calls the function with the webhook secret, not a user's login. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically.

4. Open [`setup.sql`](setup.sql), replace `<PROJECT_REF>` and `<PUSH_SECRET>`, and run it in **SQL Editor → New query**. This adds the triggers on `class_notices` and `announcements`, plus a `pg_cron` job that calls the function every minute.

5. Check it works: in a desktop Chrome window, sign in as a student, tick a module, and turn on **Reminders**. Then, as a lecturer, post a **Running late** notice for that module. A notification should appear even with the tab closed. **Edge Functions → send-push → Logs** shows each call and how many messages were sent.

On an iPhone, push only works after the site is added to the Home Screen (Share → Add to Home Screen) and opened from there (iOS 16.4 or later).

## Turning it off

```sql
select cron.unschedule('send-push-reminders');
drop trigger if exists class_notices_push on public.class_notices;
drop trigger if exists announcements_push on public.announcements;
```

Set `PUSH_PUBLIC_KEY` back to `""` so browsers stop subscribing.
look here@ lwandile
