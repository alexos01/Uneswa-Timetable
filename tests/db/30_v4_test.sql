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
