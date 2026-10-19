-- 004_notice_courses_timetable_pdf_student_passwords.sql
-- Class notices for one course, the official timetable PDF, and student passwords.
-- Requires 001, 002 and 003.
--
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to run again.

begin;

-- 1. Class notices for one course -------------------------------------------------
-- The same module can run on several courses with different venues (MAT111 for
-- B.Sc. and for B.Ed.), so a notice may name the course it is for. No course means
-- every course the module runs on, as before. The course must have a session of
-- that module on that campus.
alter table public.class_notices add column if not exists programme_id uuid references public.programmes(id) on delete cascade;

drop policy if exists "class_notices: admin or lecturer writes" on public.class_notices;
create policy "class_notices: admin or lecturer writes" on public.class_notices for all
  using (public.is_campus_admin(campus_id) or public.teaches(campus_id, code))
  with check (
    (public.is_campus_admin(campus_id) or public.teaches(campus_id, code))
    and (programme_id is null or exists (
      select 1 from public.modules m
      where m.campus_id = class_notices.campus_id and m.code = class_notices.code and m.programme_id = class_notices.programme_id)));

-- 2. The official timetable PDF ---------------------------------------------------
-- Campus admins upload the university's own timetable PDF; students find it at the
-- bottom of My Timetable. Files live in the public "timetables" Storage bucket under
-- <campus id>/, and campus_settings points at the current one.
alter table public.campus_settings add column if not exists timetable_pdf_path text;
alter table public.campus_settings add column if not exists timetable_pdf_name text;
alter table public.campus_settings add column if not exists timetable_pdf_at   timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('timetables', 'timetables', true, 20971520, array['application/pdf'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can download from a public bucket; only the campus's admins can change its folder.
drop policy if exists "timetables: campus admin reads"   on storage.objects;
drop policy if exists "timetables: campus admin uploads" on storage.objects;
drop policy if exists "timetables: campus admin updates" on storage.objects;
drop policy if exists "timetables: campus admin deletes" on storage.objects;
create policy "timetables: campus admin reads" on storage.objects for select to authenticated
  using (bucket_id = 'timetables' and public.is_campus_admin((storage.foldername(name))[1]));
create policy "timetables: campus admin uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'timetables' and public.is_campus_admin((storage.foldername(name))[1]));
create policy "timetables: campus admin updates" on storage.objects for update to authenticated
  using (bucket_id = 'timetables' and public.is_campus_admin((storage.foldername(name))[1]))
  with check (bucket_id = 'timetables' and public.is_campus_admin((storage.foldername(name))[1]));
create policy "timetables: campus admin deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'timetables' and public.is_campus_admin((storage.foldername(name))[1]));

-- 3. Student passwords --------------------------------------------------------------
-- Until now anyone could read or change any student's record by student number. From
-- here, students sign in with their student number and a password through the
-- functions below, and the students table is open only to campus admins.
--
-- * A student number with no password yet (every record made before this migration)
--   is claimed by whoever first sets one, as anyone could change it before.
-- * The password is stored as a bcrypt hash. Signing in returns a random token that
--   the device keeps; only its SHA-256 hash is stored. The device never keeps the password.
-- * Five wrong passwords lock the student number for 15 minutes.
-- * A forgotten password: a campus admin resets it (reset_student_password), which
--   signs the student out everywhere, and the student chooses a new one.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.student_credentials (
  student_id      text primary key references public.students(id) on delete cascade,
  password_hash   text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
create table if not exists public.student_sessions (
  token_hash   text primary key,
  student_id   text not null references public.students(id) on delete cascade,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists student_sessions_student_idx on public.student_sessions (student_id);
alter table public.student_credentials enable row level security;
alter table public.student_sessions    enable row level security;
revoke all on public.student_credentials, public.student_sessions from anon, authenticated;

drop policy if exists "students: read"   on public.students;
drop policy if exists "students: insert" on public.students;
drop policy if exists "students: update" on public.students;
drop policy if exists "students: campus admin reads"   on public.students;
drop policy if exists "students: campus admin updates" on public.students;
create policy "students: campus admin reads" on public.students for select
  using (public.is_campus_admin(campus_id));
create policy "students: campus admin updates" on public.students for update
  using (public.is_campus_admin(campus_id)) with check (public.is_campus_admin(campus_id));

-- The student a device token belongs to, or null. Internal: not callable through the API.
create or replace function public.student_token_owner(p_token text) returns text
language sql stable security definer set search_path = public, extensions as $$
  select student_id from public.student_sessions
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- 'new' (no record), 'no_password' (record, no password yet) or 'password'.
create or replace function public.student_account_status(p_id text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not exists (select 1 from public.students where id = trim(p_id)) then 'new'
    when exists (select 1 from public.student_credentials where student_id = trim(p_id)) then 'password'
    else 'no_password' end;
$$;

-- Signs a student in, or sets the first password for their number (creating the
-- record if there is none). Returns { token, student } or { error } where error is
-- bad_id, short_password, wrong_password (with attempts_left), locked (with until)
-- or try_again. Errors are returned rather than raised so the failed-attempt count
-- is kept.
create or replace function public.student_sign_in(p_id text, p_password text, p_name text default null, p_campus text default null)
returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  v_id  text := trim(coalesce(p_id, ''));
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  cred  public.student_credentials;
  n     int;
  token text;
begin
  if v_id !~ '^[0-9A-Za-z]{4,20}$' then return jsonb_build_object('error', 'bad_id'); end if;
  if char_length(coalesce(p_password, '')) < 6 or char_length(p_password) > 72 then
    return jsonb_build_object('error', 'short_password');
  end if;
  if char_length(coalesce(v_name, '')) > 100 then v_name := left(v_name, 100); end if;

  select * into cred from public.student_credentials where student_id = v_id for update;
  if found then
    if cred.locked_until is not null and cred.locked_until > now() then
      return jsonb_build_object('error', 'locked', 'until', cred.locked_until);
    end if;
    if extensions.crypt(p_password, cred.password_hash) <> cred.password_hash then
      if cred.failed_attempts + 1 >= 5 then
        update public.student_credentials set failed_attempts = 0, locked_until = now() + interval '15 minutes' where student_id = v_id;
        return jsonb_build_object('error', 'locked', 'until', now() + interval '15 minutes');
      end if;
      update public.student_credentials set failed_attempts = failed_attempts + 1, locked_until = null where student_id = v_id;
      return jsonb_build_object('error', 'wrong_password', 'attempts_left', 4 - cred.failed_attempts);
    end if;
    update public.student_credentials set failed_attempts = 0, locked_until = null where student_id = v_id;
  else
    insert into public.students (id, name, campus_id, module_ids, updated_at, history)
    values (v_id, v_name, coalesce(p_campus, 'kwaluseni'), '{}', now(), '[]')
    on conflict (id) do nothing;
    insert into public.student_credentials (student_id, password_hash)
    values (v_id, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
    on conflict (student_id) do nothing;
    get diagnostics n = row_count;
    if n = 0 then return jsonb_build_object('error', 'try_again'); end if; -- set at the same moment elsewhere
  end if;

  if v_name is not null then update public.students set name = v_name where id = v_id; end if;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.student_sessions (token_hash, student_id) values (encode(extensions.digest(token, 'sha256'), 'hex'), v_id);
  return jsonb_build_object('token', token, 'student', (select to_jsonb(s) from public.students s where s.id = v_id));
end;
$$;

-- The signed-in student's record: { student }, or { error: 'signed_out' } when the
-- token is no longer valid (signed out, or the password was reset).
create or replace function public.student_get(p_token text) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id text := public.student_token_owner(p_token);
begin
  if v_id is null then return jsonb_build_object('error', 'signed_out'); end if;
  update public.student_sessions set last_used_at = now()
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and last_used_at < now() - interval '1 hour';
  return jsonb_build_object('student', (select to_jsonb(s) from public.students s where s.id = v_id));
end;
$$;

-- Saves the signed-in student's own record. Only the fields a student changes are
-- taken from p_student; a field left out keeps its value.
create or replace function public.student_save(p_token text, p_student jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_id text := public.student_token_owner(p_token);
begin
  if v_id is null or v_id is distinct from p_student->>'id' then return jsonb_build_object('error', 'signed_out'); end if;
  if jsonb_typeof(p_student->'module_ids') = 'array' and jsonb_array_length(p_student->'module_ids') > 300 then
    raise exception 'Too many modules' using errcode = '22023';
  end if;
  if jsonb_typeof(p_student->'history') = 'array' and jsonb_array_length(p_student->'history') > 50 then
    raise exception 'History too long' using errcode = '22023';
  end if;
  update public.students set
    name             = case when p_student ? 'name' then left(nullif(trim(p_student->>'name'), ''), 100) else name end,
    campus_id        = coalesce(p_student->>'campus_id', campus_id),
    module_ids       = case when jsonb_typeof(p_student->'module_ids') = 'array'
                         then array(select jsonb_array_elements_text(p_student->'module_ids')::uuid) else module_ids end,
    semester_version = coalesce((p_student->>'semester_version')::int, semester_version),
    history          = case when jsonb_typeof(p_student->'history') = 'array' then p_student->'history' else history end,
    updated_at       = coalesce((p_student->>'updated_at')::timestamptz, now())
  where id = v_id;
  return jsonb_build_object('student', (select to_jsonb(s) from public.students s where s.id = v_id));
end;
$$;

create or replace function public.student_sign_out(p_token text) returns void
language sql volatile security definer set search_path = public, extensions as $$
  delete from public.student_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- A campus admin clears a student's password and signs them out everywhere; the
-- student chooses a new password at their next sign-in.
create or replace function public.reset_student_password(p_id text) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.students where id = p_id and public.is_campus_admin(campus_id)) then
    raise exception 'Only an admin of this student''s campus can reset their password' using errcode = '42501';
  end if;
  delete from public.student_credentials where student_id = p_id;
  delete from public.student_sessions where student_id = p_id;
end;
$$;

revoke all on function public.student_token_owner(text) from public, anon, authenticated;
revoke all on function public.student_account_status(text) from public;
revoke all on function public.student_sign_in(text, text, text, text) from public;
revoke all on function public.student_get(text) from public;
revoke all on function public.student_save(text, jsonb) from public;
revoke all on function public.student_sign_out(text) from public;
revoke all on function public.reset_student_password(text) from public, anon;
grant execute on function public.student_account_status(text) to anon, authenticated;
grant execute on function public.student_sign_in(text, text, text, text) to anon, authenticated;
grant execute on function public.student_get(text) to anon, authenticated;
grant execute on function public.student_save(text, jsonb) to anon, authenticated;
grant execute on function public.student_sign_out(text) to anon, authenticated;
grant execute on function public.reset_student_password(text) to authenticated;

-- Schema version, so the app can tell which features this database has.
create or replace function public.app_schema_version() returns int
language sql immutable as $$ select 4 $$;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
