-- Assertions for migration 004: notices for one course, the official timetable PDF,
-- student passwords. Runs after 20_v3_test.sql and reuses its t_expect() helper.
\set ON_ERROR_STOP on

\set kadmin '''00000000-0000-0000-0000-00000000000b'''
\set ladmin '''00000000-0000-0000-0000-00000000000c'''
\set lect   '''00000000-0000-0000-0000-00000000000d'''
\set bsc    '''00000000-0000-0000-0000-0000000000a1'''
\set bcom   '''00000000-0000-0000-0000-0000000000a2'''

select public.t_expect('schema version is 4', null, $q$select 1 where public.app_schema_version() = 4$q$, 'rows:1');

-- 1. Notices for one course. CSC111 runs on B.Sc. only; ACF111 on BCom only.
select public.t_expect('lecturer posts a CSC111 test for B.Sc.', :lect, format($q$insert into public.class_notices (campus_id, code, kind, notice_date, venue, programme_id) values ('kwaluseni','CSC111','test','2026-10-23','MPH',%s)$q$, quote_literal(:bsc)), 'rows:1');
select public.t_expect('not for a course the module does not run on', :lect, format($q$insert into public.class_notices (campus_id, code, kind, notice_date, programme_id) values ('kwaluseni','CSC111','test','2026-10-23',%s)$q$, quote_literal(:bcom)), 'error:42501');
select public.t_expect('admin is held to the same rule', :kadmin, format($q$insert into public.class_notices (campus_id, code, kind, notice_date, programme_id) values ('kwaluseni','CSC111','test','2026-10-23',%s)$q$, quote_literal(:bcom)), 'error:42501');
select public.t_expect('admin posts an ACF111 notice for BCom', :kadmin, format($q$insert into public.class_notices (campus_id, code, kind, notice_date, programme_id) values ('kwaluseni','ACF111','note','2026-10-23',%s)$q$, quote_literal(:bcom)), 'rows:1');
select public.t_expect('a notice without a course still works', :lect, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','CSC111','test','2026-10-24')$q$, 'rows:1');
select public.t_expect('lecturer cannot move a notice to another course', :lect, format($q$update public.class_notices set programme_id=%s where notice_date='2026-10-24'$q$, quote_literal(:bcom)), 'error:42501');
select public.t_expect('anyone reads the course on a notice', null, format($q$select * from public.class_notices where programme_id=%s$q$, quote_literal(:bsc)), 'rows:1');

-- 2. The official timetable PDF
do $$ begin
  if not (select public from storage.buckets where id = 'timetables') then raise exception 'FAIL timetables bucket is public'; end if;
  raise notice 'ok  timetables bucket is public';
end $$;
select public.t_expect('kwaluseni admin uploads to the kwaluseni folder', :kadmin, $q$insert into storage.objects (bucket_id, name) values ('timetables','kwaluseni/1-official.pdf')$q$, 'rows:1');
select public.t_expect('luyengo admin cannot upload to kwaluseni', :ladmin, $q$insert into storage.objects (bucket_id, name) values ('timetables','kwaluseni/2.pdf')$q$, 'error:42501');
select public.t_expect('lecturer cannot upload', :lect, $q$insert into storage.objects (bucket_id, name) values ('timetables','kwaluseni/3.pdf')$q$, 'error:42501');
select public.t_expect('anon cannot upload', null, $q$insert into storage.objects (bucket_id, name) values ('timetables','kwaluseni/4.pdf')$q$, 'error:42501');
select public.t_expect('nobody uploads outside a campus folder', :kadmin, $q$insert into storage.objects (bucket_id, name) values ('timetables','loose.pdf')$q$, 'error:42501');
select public.t_expect('kwaluseni admin points the campus at it', :kadmin, $q$update public.campus_settings set timetable_pdf_path='kwaluseni/1-official.pdf', timetable_pdf_name='official.pdf', timetable_pdf_at=now() where campus_id='kwaluseni'$q$, 'rows:1');
select public.t_expect('anyone reads where the PDF is', null, $q$select * from public.campus_settings where timetable_pdf_path is not null$q$, 'rows:1');
select public.t_expect('luyengo admin cannot delete kwaluseni files', :ladmin, $q$delete from storage.objects where name='kwaluseni/1-official.pdf'$q$, 'rows:0');
select public.t_expect('kwaluseni admin deletes the old file', :kadmin, $q$delete from storage.objects where name='kwaluseni/1-official.pdf'$q$, 'rows:1');

-- 3. Student passwords
insert into public.students (id, name, campus_id, module_ids) values ('202100900', 'Before Passwords', 'kwaluseni', '{}');

select public.t_expect('a new number has status new', null, $q$select 1 where public.student_account_status('202300001') = 'new'$q$, 'rows:1');
select public.t_expect('an old record has no password yet', null, $q$select 1 where public.student_account_status('202100900') = 'no_password'$q$, 'rows:1');
select public.t_expect('passwords must be 6 characters or more', null, $q$select 1 where public.student_sign_in('202300001', '12345') ->> 'error' = 'short_password'$q$, 'rows:1');
select public.t_expect('nonsense student numbers are refused', null, $q$select 1 where public.student_sign_in('x; drop', 'secret1') ->> 'error' = 'bad_id'$q$, 'rows:1');

create table public.t_tokens (who text primary key, token text);
grant all on public.t_tokens to anon, authenticated;
select public.t_expect('a new student signs up with a password', null, $q$insert into public.t_tokens select 'new', public.student_sign_in('202300001', 'secret1', 'New Student', 'luyengo') ->> 'token'$q$, 'rows:1');
do $$ begin
  if (select token from public.t_tokens where who = 'new') !~ '^[0-9a-f]{64}$' then raise exception 'FAIL sign-up returns a token'; end if;
  if (select campus_id from public.students where id = '202300001') <> 'luyengo' then raise exception 'FAIL new record on the chosen campus'; end if;
  if exists (select 1 from public.student_credentials where password_hash like '%secret1%') then raise exception 'FAIL password stored in clear'; end if;
  if exists (select 1 from public.student_sessions s join public.t_tokens t on s.token_hash = t.token) then raise exception 'FAIL token stored in clear'; end if;
  raise notice 'ok  sign-up returns a token; neither password nor token is stored in clear';
end $$;
select public.t_expect('the number now has a password', null, $q$select 1 where public.student_account_status('202300001') = 'password'$q$, 'rows:1');
select public.t_expect('the token reads the record', null, $q$select 1 where public.student_get((select token from public.t_tokens where who='new')) #>> '{student,name}' = 'New Student'$q$, 'rows:1');
select public.t_expect('a made-up token reads nothing', null, $q$select 1 where public.student_get(repeat('0', 64)) ->> 'error' = 'signed_out'$q$, 'rows:1');
select public.t_expect('the token saves module choices', null, format($q$select 1 where jsonb_array_length(public.student_save((select token from public.t_tokens where who='new'), %L::jsonb) #> '{student,module_ids}') = 1$q$,
  json_build_object('id','202300001','module_ids', json_build_array((select id from public.modules where code='CSC111' limit 1)))), 'rows:1');
select public.t_expect('a token cannot save someone else', null, $q$select 1 where public.student_save((select token from public.t_tokens where who='new'), '{"id":"202100900","module_ids":[]}') ->> 'error' = 'signed_out'$q$, 'rows:1');
select public.t_expect('a save that leaves out module_ids keeps them', null, $q$select 1 where public.student_save((select token from public.t_tokens where who='new'), '{"id":"202300001","name":"Renamed"}') #>> '{student,module_ids}' <> '[]'$q$, 'rows:1');

select public.t_expect('the right password signs in', null, $q$select 1 where public.student_sign_in('202300001', 'secret1') ? 'token'$q$, 'rows:1');
select public.t_expect('a wrong password is refused with attempts left', null, $q$select 1 where public.student_sign_in('202300001', 'guess01') ->> 'attempts_left' = '4'$q$, 'rows:1');
do $$ begin perform public.student_sign_in('202300001', 'guess0' || i) from generate_series(2, 4) i; end $$;
select public.t_expect('the fifth wrong password locks the number', null, $q$select 1 where public.student_sign_in('202300001', 'guess05') ->> 'error' = 'locked'$q$, 'rows:1');
select public.t_expect('while locked even the right password is refused', null, $q$select 1 where public.student_sign_in('202300001', 'secret1') ->> 'error' = 'locked'$q$, 'rows:1');
update public.student_credentials set locked_until = now() - interval '1 second' where student_id = '202300001';
select public.t_expect('after the lock the right password works', null, $q$select 1 where public.student_sign_in('202300001', 'secret1') ? 'token'$q$, 'rows:1');

select public.t_expect('the first password claims an old record', null, $q$insert into public.t_tokens select 'old', public.student_sign_in('202100900', 'mine123') ->> 'token'$q$, 'rows:1');
select public.t_expect('the claimed record keeps its name', null, $q$select 1 where public.student_get((select token from public.t_tokens where who='old')) #>> '{student,name}' = 'Before Passwords'$q$, 'rows:1');
select public.t_expect('nobody else can claim it after that', null, $q$select 1 where public.student_sign_in('202100900', 'theirs1') ->> 'error' = 'wrong_password'$q$, 'rows:1');

select public.t_expect('anon cannot read credentials', null, $q$select * from public.student_credentials$q$, 'error:42501');
select public.t_expect('anon cannot read sessions', null, $q$select * from public.student_sessions$q$, 'error:42501');
select public.t_expect('admins cannot read credentials either', :kadmin, $q$select * from public.student_credentials$q$, 'error:42501');
select public.t_expect('the token helper is not callable', null, $q$select public.student_token_owner('x')$q$, 'error:42501');

select public.t_expect('kwaluseni admin reads kwaluseni students', :kadmin, $q$select * from public.students where id = '202100900'$q$, 'rows:1');
select public.t_expect('kwaluseni admin cannot read luyengo students', :kadmin, $q$select * from public.students where id = '202300001'$q$, 'rows:0');
select public.t_expect('kwaluseni admin edits a kwaluseni student', :kadmin, $q$update public.students set name = 'Fixed' where id = '202100900'$q$, 'rows:1');
select public.t_expect('anon cannot reset a password', null, $q$select public.reset_student_password('202100900')$q$, 'error:42501');
select public.t_expect('luyengo admin cannot reset a kwaluseni student', :ladmin, $q$select public.reset_student_password('202100900')$q$, 'error:42501');
select public.t_expect('kwaluseni admin resets the password', :kadmin, $q$select public.reset_student_password('202100900')$q$, 'rows:1');
select public.t_expect('the reset signs the student out', null, $q$select 1 where public.student_get((select token from public.t_tokens where who='old')) ->> 'error' = 'signed_out'$q$, 'rows:1');
select public.t_expect('and lets them choose a new password', null, $q$select 1 where public.student_sign_in('202100900', 'newpass1') ? 'token'$q$, 'rows:1');

select public.t_expect('signing out ends the token', null, $q$select public.student_sign_out((select token from public.t_tokens where who='new'))$q$, 'rows:1');
select public.t_expect('a signed-out token reads nothing', null, $q$select 1 where public.student_get((select token from public.t_tokens where who='new')) ->> 'error' = 'signed_out'$q$, 'rows:1');
