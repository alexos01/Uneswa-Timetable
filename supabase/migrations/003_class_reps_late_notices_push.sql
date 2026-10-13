-- 003_class_reps_late_notices_push.sql
-- Class reps, "running late" notices, course announcements and push notification
-- subscriptions. Requires 001_campuses_and_roles.sql and 002_announcements_and_notices.sql.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

begin;

-- 1. Class rep role ---------------------------------------------------------------
-- A class rep signs in like a lecturer and is assigned module codes the same way
-- (lecturer_modules). They can move those sessions, post class notices for them,
-- and post announcements to the courses those modules belong to.
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('super_admin', 'campus_admin', 'lecturer', 'class_rep'));

create or replace function public.teaches(c text, module_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lecturer_modules lm
    join public.staff s on s.user_id = lm.user_id and s.role in ('lecturer', 'class_rep')
    where lm.user_id = auth.uid() and lm.campus_id = c and lm.code = module_code);
$$;

-- True when the caller is a class rep for a module on course `prog`.
create or replace function public.represents(c text, prog uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lecturer_modules lm
    join public.staff s on s.user_id = lm.user_id and s.role = 'class_rep'
    join public.modules m on m.campus_id = lm.campus_id and m.code = lm.code
    where lm.user_id = auth.uid() and lm.campus_id = c and m.programme_id = prog);
$$;

create or replace function public.grant_staff_role(p_email text, p_role text, p_campus text default null, p_name text default null)
returns public.staff
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid;
  v_row public.staff;
begin
  if p_role not in ('super_admin', 'campus_admin', 'lecturer', 'class_rep') then
    raise exception 'Unknown role %', p_role;
  end if;
  if p_role <> 'super_admin' and p_campus is null then
    raise exception 'Choose a campus for this role';
  end if;
  if p_role in ('lecturer', 'class_rep') then
    if not public.is_campus_admin(p_campus) then
      raise exception 'Only an admin of this campus can add lecturers and class reps' using errcode = '42501';
    end if;
  elsif not public.is_super_admin() then
    raise exception 'Only a super admin can add admins' using errcode = '42501';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No account uses %. Ask them to create one under Staff sign in first.', p_email;
  end if;
  if not public.is_super_admin()
     and exists (select 1 from public.staff where user_id = v_uid and role in ('super_admin', 'campus_admin')) then
    raise exception 'That account is an admin; only a super admin can change it' using errcode = '42501';
  end if;

  insert into public.staff (user_id, role, campus_id, display_name, email)
  values (v_uid, p_role, case when p_role = 'super_admin' then null else p_campus end,
          nullif(trim(p_name), ''), lower(trim(p_email)))
  on conflict (user_id) do update
    set role = excluded.role,
        campus_id = excluded.campus_id,
        display_name = coalesce(excluded.display_name, public.staff.display_name),
        email = excluded.email
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.grant_staff_role(text, text, text, text) from public, anon;
grant execute on function public.grant_staff_role(text, text, text, text) to authenticated;

create or replace function public.modules_lecturer_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_campus_admin(old.campus_id) then
    if new.code is distinct from old.code
       or new.campus_id is distinct from old.campus_id
       or new.programme_id is distinct from old.programme_id then
      raise exception 'Lecturers and class reps can change only the day, time and venue of a session' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop policy if exists "staff: remove" on public.staff;
create policy "staff: remove" on public.staff for delete
  using (public.is_super_admin() or (role in ('lecturer', 'class_rep') and public.is_campus_admin(campus_id)));

-- 2. "Running late" class notices --------------------------------------------------
alter table public.class_notices drop constraint if exists class_notices_kind_check;
alter table public.class_notices add constraint class_notices_kind_check
  check (kind in ('test', 'cancelled', 'moved', 'extra', 'note', 'late'));
alter table public.class_notices add column if not exists delay_minutes int;
alter table public.class_notices drop constraint if exists class_notices_delay_check;
alter table public.class_notices add constraint class_notices_delay_check
  check (delay_minutes is null or delay_minutes between 1 and 240);

-- 3. Course announcements -------------------------------------------------------------
-- programme_id set = only students on that course see it; year narrows it further.
alter table public.announcements add column if not exists programme_id uuid references public.programmes(id) on delete cascade;
alter table public.announcements add column if not exists year int;
alter table public.announcements drop constraint if exists announcements_year_check;
alter table public.announcements add constraint announcements_year_check check (year is null or year between 1 and 9);

drop policy if exists "announcements: class rep writes" on public.announcements;
create policy "announcements: class rep writes" on public.announcements for all
  using (created_by = auth.uid() and campus_id is not null and programme_id is not null and public.represents(campus_id, programme_id))
  with check (created_by = auth.uid() and campus_id is not null and programme_id is not null and public.represents(campus_id, programme_id));

-- 4. Push notification subscriptions ---------------------------------------------------
-- One row per browser that turned on alerts. Students have no login, so rows are
-- written only through the two functions below, keyed by the push endpoint (a
-- secret URL only that browser knows). Nobody can read the table through the API;
-- the send-push Edge Function reads it with the service role.
create table if not exists public.push_subscriptions (
  endpoint       text primary key check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh         text not null,
  auth           text not null,
  campus_id      text not null references public.campuses(id) on delete cascade,
  student_id     text,
  module_ids     uuid[] not null default '{}',
  codes          text[] not null default '{}',
  minutes_before int not null default 10 check (minutes_before between 1 and 120),
  reminders      boolean not null default true,
  updated_at     timestamptz not null default now()
);
create index if not exists push_subscriptions_campus_idx on public.push_subscriptions (campus_id);
create index if not exists push_subscriptions_codes_idx on public.push_subscriptions using gin (codes);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_campus text, p_student text,
  p_module_ids uuid[], p_minutes_before int default 10, p_reminders boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(cardinality(p_module_ids), 0) > 300 then
    raise exception 'Too many modules';
  end if;
  insert into public.push_subscriptions (endpoint, p256dh, auth, campus_id, student_id, module_ids, codes, minutes_before, reminders, updated_at)
  values (p_endpoint, p_p256dh, p_auth, p_campus, nullif(trim(p_student), ''), coalesce(p_module_ids, '{}'),
          coalesce((select array_agg(distinct m.code) from public.modules m where m.id = any(p_module_ids) and m.campus_id = p_campus), '{}'),
          coalesce(p_minutes_before, 10), coalesce(p_reminders, true), now())
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, campus_id = excluded.campus_id,
        student_id = excluded.student_id, module_ids = excluded.module_ids, codes = excluded.codes,
        minutes_before = excluded.minutes_before, reminders = excluded.reminders, updated_at = now();
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.save_push_subscription(text, text, text, text, text, uuid[], int, boolean) from public;
revoke all on function public.delete_push_subscription(text) from public;
grant execute on function public.save_push_subscription(text, text, text, text, text, uuid[], int, boolean) to anon, authenticated;
grant execute on function public.delete_push_subscription(text) to anon, authenticated;

-- 5. Schema version, so the app can tell which features this database has -------------
create or replace function public.app_schema_version() returns int
language sql immutable as $$ select 3 $$;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
