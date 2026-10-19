-- 004_notice_courses_timetable_pdf_student_passwords.sql
-- Class notices for one course, and student passwords.
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

-- Schema version, so the app can tell which features this database has.
create or replace function public.app_schema_version() returns int
language sql immutable as $$ select 4 $$;
grant execute on function public.app_schema_version() to anon, authenticated;

commit;
