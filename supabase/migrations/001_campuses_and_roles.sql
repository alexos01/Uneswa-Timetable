-- 001_campuses_and_roles.sql
-- Multi-campus support and staff roles (super admin, campus admin, lecturer).
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again: every statement is idempotent.
--
-- BEFORE RUNNING: open Authentication -> Users. Every account listed there becomes
-- a super admin (step 6). Delete any test accounts first.
--
-- Existing rows are assigned to Kwaluseni, the only campus loaded today.

begin;

-- 1. Campuses -----------------------------------------------------------------
create table if not exists public.campuses (
  id   text primary key,
  name text not null,
  sort int  not null default 0
);
insert into public.campuses (id, name, sort) values
  ('kwaluseni', 'Kwaluseni', 1),
  ('luyengo',   'Luyengo',   2),
  ('mbabane',   'Mbabane',   3)
on conflict (id) do nothing;

-- 2. Campus on every timetable table ------------------------------------------------
alter table public.faculties  add column if not exists campus_id text not null default 'kwaluseni' references public.campuses(id);
alter table public.programmes add column if not exists campus_id text not null default 'kwaluseni' references public.campuses(id);
alter table public.modules    add column if not exists campus_id text not null default 'kwaluseni' references public.campuses(id);
alter table public.exams      add column if not exists campus_id text not null default 'kwaluseni' references public.campuses(id);
alter table public.students   add column if not exists campus_id text not null default 'kwaluseni' references public.campuses(id);

create index if not exists faculties_campus_idx  on public.faculties (campus_id);
create index if not exists programmes_campus_idx on public.programmes (campus_id);
create index if not exists modules_campus_idx    on public.modules (campus_id, code);
create index if not exists exams_campus_idx      on public.exams (campus_id, code);
create index if not exists students_campus_idx   on public.students (campus_id);

-- 3. Per-campus semester settings (replaces the single settings row) -------------
create table if not exists public.campus_settings (
  campus_id        text primary key references public.campuses(id) on delete cascade,
  semester         text not null default 'Not set yet',
  semester_version int  not null default 1,
  updated_at       timestamptz not null default now()
);
insert into public.campus_settings (campus_id, semester, semester_version, updated_at)
  select 'kwaluseni', coalesce(s.semester, 'Not set yet'), coalesce(s.semester_version, 1), coalesce(s.updated_at, now())
  from public.settings s where s.id = 1
on conflict (campus_id) do nothing;
insert into public.campus_settings (campus_id)
  select id from public.campuses
on conflict (campus_id) do nothing;

-- 4. Staff and lecturer assignments -----------------------------------------------
create table if not exists public.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  role         text not null check (role in ('super_admin', 'campus_admin', 'lecturer')),
  campus_id    text references public.campuses(id),
  display_name text,
  email        text,
  created_at   timestamptz not null default now(),
  constraint staff_campus_required check (role = 'super_admin' or campus_id is not null)
);

create table if not exists public.lecturer_modules (
  user_id   uuid not null references public.staff(user_id) on delete cascade,
  campus_id text not null references public.campuses(id),
  code      text not null,
  primary key (user_id, campus_id, code)
);

-- 5. Role helpers used by the policies ----------------------------------------------
create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and role = 'super_admin');
$$;

create or replace function public.is_campus_admin(c text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (select 1 from public.staff where user_id = auth.uid() and role = 'campus_admin' and campus_id = c);
$$;

create or replace function public.teaches(c text, module_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.lecturer_modules lm
    join public.staff s on s.user_id = lm.user_id and s.role = 'lecturer'
    where lm.user_id = auth.uid() and lm.campus_id = c and lm.code = module_code);
$$;

-- Grants a role to an existing account by email. Campus admins may add lecturers to
-- their own campus; only super admins may create admins.
create or replace function public.grant_staff_role(p_email text, p_role text, p_campus text default null, p_name text default null)
returns public.staff
language plpgsql security definer set search_path = public, auth as $$
declare
  v_uid uuid;
  v_row public.staff;
begin
  if p_role not in ('super_admin', 'campus_admin', 'lecturer') then
    raise exception 'Unknown role %', p_role;
  end if;
  if p_role <> 'super_admin' and p_campus is null then
    raise exception 'Choose a campus for this role';
  end if;
  if p_role = 'lecturer' then
    if not public.is_campus_admin(p_campus) then
      raise exception 'Only an admin of this campus can add lecturers' using errcode = '42501';
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

-- Lecturers may move their own sessions (day, time, venue) but not re-label them.
create or replace function public.modules_lecturer_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_campus_admin(old.campus_id) then
    if new.code is distinct from old.code
       or new.campus_id is distinct from old.campus_id
       or new.programme_id is distinct from old.programme_id then
      raise exception 'Lecturers can change only the day, time and venue of a session' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists modules_lecturer_guard on public.modules;
create trigger modules_lecturer_guard before update on public.modules
  for each row execute function public.modules_lecturer_guard();

-- 6. Existing accounts become super admins -------------------------------------------
insert into public.staff (user_id, role, email)
  select id, 'super_admin', email from auth.users
on conflict (user_id) do nothing;

-- 7. Row-level security ------------------------------------------------------------
-- The original policy names were never committed, so drop whatever exists on these
-- tables and recreate the full set.
do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('campuses', 'faculties', 'programmes', 'modules', 'exams', 'settings',
                        'campus_settings', 'students', 'staff', 'lecturer_modules')
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

alter table public.campuses         enable row level security;
alter table public.faculties        enable row level security;
alter table public.programmes       enable row level security;
alter table public.modules          enable row level security;
alter table public.exams            enable row level security;
alter table public.settings         enable row level security;
alter table public.campus_settings  enable row level security;
alter table public.students         enable row level security;
alter table public.staff            enable row level security;
alter table public.lecturer_modules enable row level security;

-- Everyone can read the timetable.
create policy "campuses: read"        on public.campuses        for select using (true);
create policy "faculties: read"       on public.faculties       for select using (true);
create policy "programmes: read"      on public.programmes      for select using (true);
create policy "modules: read"         on public.modules         for select using (true);
create policy "exams: read"           on public.exams           for select using (true);
create policy "settings: read"        on public.settings        for select using (true);
create policy "campus_settings: read" on public.campus_settings for select using (true);

create policy "campuses: super admin writes" on public.campuses for all
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy "faculties: campus admin writes" on public.faculties for all
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));
create policy "programmes: campus admin writes" on public.programmes for all
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));
create policy "exams: campus admin writes" on public.exams for all
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));

create policy "modules: campus admin inserts" on public.modules for insert
  with check (public.is_campus_admin(campus_id));
create policy "modules: campus admin deletes" on public.modules for delete
  using (public.is_campus_admin(campus_id));
create policy "modules: admin or lecturer updates" on public.modules for update
  using (public.is_campus_admin(campus_id) or public.teaches(campus_id, code))
  with check (public.is_campus_admin(campus_id) or public.teaches(campus_id, code));

create policy "settings: super admin updates" on public.settings for update
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy "campus_settings: campus admin writes" on public.campus_settings for all
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));

-- Students have no login: anyone may register and edit a record by student number,
-- as before. Only admins may delete records.
create policy "students: read"   on public.students for select using (true);
create policy "students: insert" on public.students for insert with check (true);
create policy "students: update" on public.students for update using (true) with check (true);
create policy "students: campus admin deletes" on public.students for delete
  using (public.is_campus_admin(campus_id));

-- Staff rows are written only through grant_staff_role().
create policy "staff: read own or as admin" on public.staff for select
  using (user_id = auth.uid() or public.is_super_admin() or (campus_id is not null and public.is_campus_admin(campus_id)));
create policy "staff: remove" on public.staff for delete
  using (public.is_super_admin() or (role = 'lecturer' and public.is_campus_admin(campus_id)));

create policy "lecturer_modules: read own or as admin" on public.lecturer_modules for select
  using (user_id = auth.uid() or public.is_campus_admin(campus_id));
create policy "lecturer_modules: campus admin writes" on public.lecturer_modules for all
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));

-- 8. Privileges and realtime for the new tables ----------------------------------------
grant select on public.campuses, public.campus_settings to anon, authenticated;
grant insert, update, delete on public.campuses, public.campus_settings to authenticated;
grant select, delete on public.staff to authenticated;
grant select, insert, update, delete on public.lecturer_modules to authenticated;

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['campus_settings', 'staff', 'lecturer_modules'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

commit;
