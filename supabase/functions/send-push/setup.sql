-- Connects the database to the send-push Edge Function. Run once in the SQL editor
-- AFTER deploying the function (see README.md in this folder), with the two
-- placeholders replaced:
--   <PROJECT_REF>   the part before .supabase.co in your project URL
--   <PUSH_SECRET>   the same value you set as the PUSH_WEBHOOK_SECRET secret
-- Safe to run again.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create or replace function public.call_send_push(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '<PUSH_SECRET>'),
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
