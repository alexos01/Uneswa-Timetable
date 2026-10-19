# Change the push webhook secret

**Do this first.** On 19 Oct 2026, commit `842dbc9` put the real `send-push` webhook secret into `supabase/functions/send-push/setup.sql`. The repo is public, so anyone can find it, including in the git history. With it they can make `send-push` send notifications to every student who turned on reminders.

The repo no longer holds the secret: `setup.sql` now reads it from Supabase Vault. The old secret still works until you change it in Supabase, which is what this guide does. It takes about ten minutes.

You need: the Supabase dashboard for the project, a terminal with Node and `openssl`, and this repo pulled to the latest `main`.

## 1. Sign the CLI in to the project

```sh
npx supabase@latest login
npx supabase@latest link --project-ref scmedarqqmpuhgdksthl
```

`login` opens the browser. `link` asks for the database password; it's under **Project Settings → Database** if nobody has it.

## 2. Set a new secret on the function

```sh
NEW_SECRET=$(openssl rand -hex 32)
npx supabase@latest secrets set PUSH_WEBHOOK_SECRET="$NEW_SECRET" --project-ref scmedarqqmpuhgdksthl
echo "$NEW_SECRET"
```

Copy the value the last line prints. Don't paste it into a file, a commit, WhatsApp or anywhere else. From now until step 3 is done, pushes are refused, so go straight on.

## 3. Put the same secret in Vault

In the dashboard, open **SQL Editor → New query**, paste this with your value in place of `<new secret>`, and click **Run**:

```sql
select vault.create_secret('<new secret>', 'push_webhook_secret');
```

If it says the name already exists, run this instead:

```sql
select vault.update_secret(id, '<new secret>') from vault.secrets where name = 'push_webhook_secret';
```

Close the query tab **without saving it**, so the secret isn't kept in the saved queries.

## 4. Run the new setup.sql

Open a new query, paste the whole of [`supabase/functions/send-push/setup.sql`](../supabase/functions/send-push/setup.sql) from `main` as it is (there's nothing to fill in), and click **Run**. This replaces the database function that still has the old secret written inside it.

## 5. Check it works

1. In the terminal, clear the value: `unset NEW_SECRET`.
2. In desktop Chrome, open the site, sign in as a student, tick a module and turn on **Reminders**. Close the tab.
3. On another device, sign in as a lecturer and post **Running late** for that module.
4. A notification should arrive. In the dashboard, **Edge Functions → send-push → Logs** should show the call with status **200**. A **401** means the secret in step 2 and step 3 differ: repeat step 3 with the value from step 2.

## When you're done

Tell Olwethu, and tick the first item in [`TODO.md`](TODO.md). If the secret is ever exposed again, repeat steps 1 to 3 and 5; step 4 is only needed this once. The same steps are in the function's [README](../supabase/functions/send-push/README.md) under "Changing the webhook secret".
