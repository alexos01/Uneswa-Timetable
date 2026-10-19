-- Connects the database to the send-push Edge Function. Run once in the SQL editor
-- AFTER deploying the function (see README.md in this folder). Safe to run again.
--
-- The webhook secret is read from Supabase Vault and never written in this file,
-- which is public. Store it once, with the same value as the function's
-- PUSH_WEBHOOK_SECRET secret, in its own SQL editor query (not saved anywhere):
--   select vault.create_secret('<the PUSH_WEBHOOK_SECRET value>', 'push_webhook_secret');
-- To change it later, see "Changing the webhook secret" in README.md.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.call_send_push(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_webhook_secret';
  if secret is null then
    raise warning 'send-push not called: no push_webhook_secret in Vault';
    return; -- a missing secret must never stop a notice or announcement being saved
  end if;
  perform net.http_post(
    url     := 'https://scmedarqqmpuhgdksthl.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
    body    := payload);
end;
$$;
revoke all on function public.call_send_push(jsonb) from public, anon, authenticated;

-- A new class notice or announcement: alert the students it concerns.
create or replace function public.push_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.call_send_push(jsonb_build_object('type', 'INSERT', 'table', tg_table_name, 'record', to_jsonb(new)));
  return new;
end;
$$;
drop trigger if exists class_notices_push on public.class_notices;
create trigger class_notices_push after insert on public.class_notices
  for each row execute function public.push_on_insert();
drop trigger if exists announcements_push on public.announcements;
create trigger announcements_push after insert on public.announcements
  for each row execute function public.push_on_insert();

-- Every minute: class reminders due now.
select cron.unschedule('send-push-reminders') where exists (select 1 from cron.job where jobname = 'send-push-reminders');
select cron.schedule('send-push-reminders', '* * * * *', $$ select public.call_send_push('{"type":"tick"}'::jsonb) $$);
