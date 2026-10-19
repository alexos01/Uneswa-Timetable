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

4. Store the same webhook secret in Supabase Vault. In **SQL Editor → New query**, run this once, then close the query without saving it:

   ```sql
   select vault.create_secret('<the PUSH_WEBHOOK_SECRET value>', 'push_webhook_secret');
   ```

   Never write the secret into `setup.sql` or any other file in this repo: the repo is public.

5. Run [`setup.sql`](setup.sql) as it is in **SQL Editor → New query**. It reads the secret from Vault, and adds the triggers on `class_notices` and `announcements`, plus a `pg_cron` job that calls the function every minute.

6. Check it works: in a desktop Chrome window, sign in as a student, tick a module, and turn on **Reminders**. Then, as a lecturer, post a **Running late** notice for that module. A notification should appear even with the tab closed. **Edge Functions → send-push → Logs** shows each call and how many messages were sent.

On an iPhone, push only works after the site is added to the Home Screen (Share → Add to Home Screen) and opened from there (iOS 16.4 or later).

## Changing the webhook secret

Do this if the secret is ever seen by someone who shouldn't have it, for example because it was committed. Anyone who has it can make the function send notifications to every subscribed student. The two steps should be done close together; in between, pushes are refused.

1. Set a new secret on the function. The value is generated and used without being printed:

   ```sh
   NEW_SECRET=$(openssl rand -hex 32)
   supabase secrets set PUSH_WEBHOOK_SECRET="$NEW_SECRET" --project-ref scmedarqqmpuhgdksthl
   echo "$NEW_SECRET" | xclip -selection clipboard   # or pbcopy on a Mac; copy it for step 2
   ```

2. In **SQL Editor → New query**, paste it into this and run it, then close the query without saving:

   ```sql
   select vault.update_secret(id, '<new secret>') from vault.secrets where name = 'push_webhook_secret';
   ```

   If `setup.sql` was last run with the secret written inside it, run the current `setup.sql` again afterwards (step 5 above), and create the Vault entry with `vault.create_secret` instead of updating it.

3. Check **Edge Functions → send-push → Logs**: calls should get 200, not 401.

## Turning it off

```sql
select cron.unschedule('send-push-reminders');
drop trigger if exists class_notices_push on public.class_notices;
drop trigger if exists announcements_push on public.announcements;
```

Set `PUSH_PUBLIC_KEY` back to `""` so browsers stop subscribing.
look here@ lwandile
