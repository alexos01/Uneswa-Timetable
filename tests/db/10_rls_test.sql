-- Assertions for migrations 001 + 002. Runs as the superuser and switches role per check.
\set ON_ERROR_STOP on

create function public.t_run(stmt text) returns text language plpgsql as $$
declare n int;
begin
  execute stmt; get diagnostics n = row_count; return 'rows:' || n;
exception when others then return 'error:' || sqlstate;
end $$;
grant execute on function public.t_run(text) to anon, authenticated;

create function public.t_as(who uuid) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', false);
    perform set_config('request.jwt.claims', '', false);
  else
    perform set_config('role', 'authenticated', false);
    perform set_config('request.jwt.claims', json_build_object('sub', who)::text, false);
  end if;
end $$;

create function public.t_expect(label text, who uuid, stmt text, expected text) returns void language plpgsql as $$
declare got text;
begin
  perform public.t_as(who);
  got := public.t_run(stmt);
  reset role; perform set_config('request.jwt.claims', '', false);
  if got is distinct from expected then
    raise exception 'FAIL % : expected %, got %', label, expected, got;
  end if;
  raise notice 'ok  %', label;
end $$;

-- Accounts created after the migration (the existing admin became super admin).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'kwa.admin@uneswa.test'),
  ('00000000-0000-0000-0000-00000000000c', 'luy.admin@uneswa.test'),
  ('00000000-0000-0000-0000-00000000000d', 'lecturer@uneswa.test'),
  ('00000000-0000-0000-0000-00000000000e', 'nobody@uneswa.test');

\set super  '''00000000-0000-0000-0000-00000000000a'''
\set kadmin '''00000000-0000-0000-0000-00000000000b'''
\set ladmin '''00000000-0000-0000-0000-00000000000c'''
\set lect   '''00000000-0000-0000-0000-00000000000d'''
\set nobody '''00000000-0000-0000-0000-00000000000e'''

do $$ begin
  if (select count(*) from public.modules where campus_id <> 'kwaluseni') > 0 then raise exception 'FAIL existing rows not on kwaluseni'; end if;
  if (select semester_version from public.campus_settings where campus_id = 'kwaluseni') <> 3 then raise exception 'FAIL semester not copied'; end if;
  if (select count(*) from public.campus_settings) <> 3 then raise exception 'FAIL campus_settings rows'; end if;
  if (select role from public.staff where email = 'admin@uneswa.test') <> 'super_admin' then raise exception 'FAIL existing admin not super admin'; end if;
  if (select count(*) from pg_publication_tables where pubname='supabase_realtime' and tablename in ('announcements','class_notices','campus_settings')) <> 3 then raise exception 'FAIL realtime publication'; end if;
  raise notice 'ok  migration data';
end $$;

-- Granting roles through the RPC
select public.t_expect('super grants kwaluseni admin', :super,  $q$select public.grant_staff_role('kwa.admin@uneswa.test','campus_admin','kwaluseni')$q$, 'rows:1');
select public.t_expect('super grants luyengo admin',   :super,  $q$select public.grant_staff_role('luy.admin@uneswa.test','campus_admin','luyengo')$q$, 'rows:1');
select public.t_expect('campus admin cannot create admins', :kadmin, $q$select public.grant_staff_role('nobody@uneswa.test','campus_admin','kwaluseni')$q$, 'error:42501');
select public.t_expect('luyengo admin cannot add kwaluseni lecturer', :ladmin, $q$select public.grant_staff_role('lecturer@uneswa.test','lecturer','kwaluseni')$q$, 'error:42501');
select public.t_expect('kwaluseni admin adds lecturer', :kadmin, $q$select public.grant_staff_role('lecturer@uneswa.test','lecturer','kwaluseni','Dr Test')$q$, 'rows:1');
select public.t_expect('campus admin cannot demote another admin', :kadmin, $q$select public.grant_staff_role('luy.admin@uneswa.test','lecturer','kwaluseni')$q$, 'error:42501');
select public.t_expect('unknown email is rejected', :kadmin, $q$select public.grant_staff_role('ghost@uneswa.test','lecturer','kwaluseni')$q$, 'error:P0001');
select public.t_expect('anon cannot call grant_staff_role', null, $q$select public.grant_staff_role('nobody@uneswa.test','lecturer','kwaluseni')$q$, 'error:42501');
select public.t_expect('kwaluseni admin assigns CSC111', :kadmin, $q$insert into public.lecturer_modules values ('00000000-0000-0000-0000-00000000000d','kwaluseni','CSC111')$q$, 'rows:1');
select public.t_expect('luyengo admin cannot assign on kwaluseni', :ladmin, $q$insert into public.lecturer_modules values ('00000000-0000-0000-0000-00000000000d','kwaluseni','MAT111')$q$, 'error:42501');

-- Anonymous students
select public.t_expect('anon reads modules', null, $q$select * from public.modules$q$, 'rows:2');
select public.t_expect('anon cannot insert modules', null, $q$insert into public.modules (code, campus_id) values ('X','kwaluseni')$q$, 'error:42501');
select public.t_expect('anon cannot update modules', null, $q$update public.modules set venue='x'$q$, 'rows:0');
select public.t_expect('anon registers a student', null, $q$insert into public.students (id, name, campus_id) values ('202200001','New','luyengo')$q$, 'rows:1');
select public.t_expect('anon updates a student', null, $q$update public.students set name='Renamed' where id='202200001'$q$, 'rows:1');
select public.t_expect('anon cannot delete students', null, $q$delete from public.students$q$, 'rows:0');
select public.t_expect('anon cannot read staff', null, $q$select * from public.staff$q$, 'rows:0');

-- Signed in, but no role
select public.t_expect('no-role user cannot add a faculty', :nobody, $q$insert into public.faculties (name) values ('X')$q$, 'error:42501');
select public.t_expect('no-role user cannot change settings', :nobody, $q$update public.campus_settings set semester='x'$q$, 'rows:0');

-- Campus admins
select public.t_expect('kwaluseni admin inserts a kwaluseni module', :kadmin, $q$insert into public.modules (code, day, campus_id) values ('CSC211','Friday','kwaluseni')$q$, 'rows:1');
select public.t_expect('kwaluseni admin cannot insert on luyengo', :kadmin, $q$insert into public.modules (code, campus_id) values ('AGR111','luyengo')$q$, 'error:42501');
select public.t_expect('luyengo admin cannot touch kwaluseni modules', :ladmin, $q$update public.modules set venue='x' where campus_id='kwaluseni'$q$, 'rows:0');
select public.t_expect('kwaluseni admin resets own semester', :kadmin, $q$update public.campus_settings set semester_version = semester_version + 1 where campus_id='kwaluseni'$q$, 'rows:1');
select public.t_expect('kwaluseni admin cannot reset luyengo', :kadmin, $q$update public.campus_settings set semester='x' where campus_id='luyengo'$q$, 'rows:0');
select public.t_expect('luyengo admin deletes own students only', :ladmin, $q$delete from public.students$q$, 'rows:1');
select public.t_expect('campus admin sees own campus staff', :kadmin, $q$select * from public.staff where campus_id='kwaluseni'$q$, 'rows:2');

-- Lecturers
select public.t_expect('lecturer moves own session', :lect, $q$update public.modules set venue='G.010', day='Thursday' where code='CSC111'$q$, 'rows:1');
select public.t_expect('lecturer cannot move other modules', :lect, $q$update public.modules set venue='G.010' where code='MAT111'$q$, 'rows:0');
select public.t_expect('lecturer cannot relabel a session', :lect, $q$update public.modules set code='MAT111' where code='CSC111'$q$, 'error:42501');
select public.t_expect('lecturer cannot insert sessions', :lect, $q$insert into public.modules (code, campus_id) values ('CSC111','kwaluseni')$q$, 'error:42501');
select public.t_expect('lecturer posts a test notice', :lect, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','CSC111','test','2026-10-20')$q$, 'rows:1');
select public.t_expect('lecturer cannot post for other modules', :lect, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','MAT111','test','2026-10-20')$q$, 'error:42501');
select public.t_expect('lecturer cannot post announcements', :lect, $q$insert into public.announcements (campus_id, title) values ('kwaluseni','Hi')$q$, 'error:42501');
select public.t_expect('lecturer sees only own staff row', :lect, $q$select * from public.staff$q$, 'rows:1');

-- Announcements
select public.t_expect('campus admin posts to own campus', :kadmin, $q$insert into public.announcements (campus_id, title, body) values ('kwaluseni','Exams','Timetable is out')$q$, 'rows:1');
select public.t_expect('campus admin cannot post to all campuses', :kadmin, $q$insert into public.announcements (campus_id, title) values (null,'All')$q$, 'error:42501');
select public.t_expect('super admin posts to all campuses', :super, $q$insert into public.announcements (campus_id, title) values (null,'All')$q$, 'rows:1');
select public.t_expect('anon reads announcements', null, $q$select * from public.announcements$q$, 'rows:2');
select public.t_expect('anon reads notices', null, $q$select * from public.class_notices$q$, 'rows:1');
