-- Assertions for migration 003: class reps, late notices, course announcements, push
-- subscriptions. Runs after 10_rls_test.sql and reuses its t_expect() helper.
\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000f', 'rep@uneswa.test');
insert into public.programmes (id, name, campus_id) values
  ('00000000-0000-0000-0000-0000000000a2', 'Bachelor of Commerce', 'kwaluseni');
insert into public.modules (code, day, start_time, campus_id, programme_id) values
  ('ACF111', 'Monday', '08:00', 'kwaluseni', '00000000-0000-0000-0000-0000000000a2');

\set kadmin '''00000000-0000-0000-0000-00000000000b'''
\set ladmin '''00000000-0000-0000-0000-00000000000c'''
\set lect   '''00000000-0000-0000-0000-00000000000d'''
\set rep    '''00000000-0000-0000-0000-00000000000f'''
\set bsc    '''00000000-0000-0000-0000-0000000000a1'''
\set bcom   '''00000000-0000-0000-0000-0000000000a2'''

select public.t_expect('schema version is 3 or later', null, $q$select 1 where public.app_schema_version() >= 3$q$, 'rows:1');

-- Granting the class rep role
select public.t_expect('luyengo admin cannot add a kwaluseni class rep', :ladmin, $q$select public.grant_staff_role('rep@uneswa.test','class_rep','kwaluseni')$q$, 'error:42501');
select public.t_expect('kwaluseni admin adds a class rep', :kadmin, $q$select public.grant_staff_role('rep@uneswa.test','class_rep','kwaluseni','Rep One')$q$, 'rows:1');
select public.t_expect('kwaluseni admin assigns CSC111 to the rep', :kadmin, $q$insert into public.lecturer_modules values ('00000000-0000-0000-0000-00000000000f','kwaluseni','CSC111')$q$, 'rows:1');

-- Class notices, including "running late"
select public.t_expect('rep posts a late notice', :rep, $q$insert into public.class_notices (campus_id, code, kind, notice_date, delay_minutes) values ('kwaluseni','CSC111','late','2026-10-20',15)$q$, 'rows:1');
select public.t_expect('rep cannot post for other modules', :rep, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','MAT111','late','2026-10-20')$q$, 'error:42501');
select public.t_expect('delay must be 1 to 240 minutes', :rep, $q$insert into public.class_notices (campus_id, code, kind, notice_date, delay_minutes) values ('kwaluseni','CSC111','late','2026-10-20',0)$q$, 'error:23514');
select public.t_expect('lecturer posts a late notice', :lect, $q$insert into public.class_notices (campus_id, code, kind, notice_date, delay_minutes) values ('kwaluseni','CSC111','late','2026-10-21',10)$q$, 'rows:1');
select public.t_expect('unknown kinds are still refused', :lect, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','CSC111','party','2026-10-21')$q$, 'error:23514');

-- Moving sessions
select public.t_expect('rep moves own session', :rep, $q$update public.modules set venue='G.011' where code='CSC111'$q$, 'rows:1');
select public.t_expect('rep cannot move other modules', :rep, $q$update public.modules set venue='G.011' where code='MAT111'$q$, 'rows:0');
select public.t_expect('rep cannot relabel a session', :rep, $q$update public.modules set code='XYZ111' where code='CSC111'$q$, 'error:42501');

-- Course announcements
select public.t_expect('rep posts to their course', :rep, format($q$insert into public.announcements (campus_id, programme_id, year, title) values ('kwaluseni', %s, 1, 'Class meeting')$q$, quote_literal(:bsc)), 'rows:1');
select public.t_expect('rep cannot post campus-wide', :rep, $q$insert into public.announcements (campus_id, title) values ('kwaluseni','Everyone')$q$, 'error:42501');
select public.t_expect('rep cannot post to another course', :rep, format($q$insert into public.announcements (campus_id, programme_id, title) values ('kwaluseni', %s, 'Not mine')$q$, quote_literal(:bcom)), 'error:42501');
select public.t_expect('lecturer cannot post course announcements', :lect, format($q$insert into public.announcements (campus_id, programme_id, title) values ('kwaluseni', %s, 'Hi')$q$, quote_literal(:bsc)), 'error:42501');
select public.t_expect('rep edits own announcement', :rep, $q$update public.announcements set body='Room G.011' where title='Class meeting'$q$, 'rows:1');
select public.t_expect('rep cannot edit admin announcements', :rep, $q$update public.announcements set body='x' where title='Exams'$q$, 'rows:0');
select public.t_expect('campus admin can still post course announcements', :kadmin, format($q$insert into public.announcements (campus_id, programme_id, title) values ('kwaluseni', %s, 'BCom only')$q$, quote_literal(:bcom)), 'rows:1');

-- Push subscriptions
select public.t_expect('anon saves a push subscription', null, $q$select public.save_push_subscription('https://push.example/abc','key','auth','kwaluseni','202100123',(select array_agg(id) from public.modules where code in ('CSC111','ACF111')),10,true)$q$, 'rows:1');
do $$ begin
  if (select codes from public.push_subscriptions where endpoint = 'https://push.example/abc') <> array['ACF111','CSC111'] then
    raise exception 'FAIL subscription codes derived from module ids';
  end if;
  raise notice 'ok  subscription codes derived from module ids';
end $$;
select public.t_expect('anon updates the same subscription', null, $q$select public.save_push_subscription('https://push.example/abc','key2','auth','kwaluseni','202100123','{}',15,false)$q$, 'rows:1');
select public.t_expect('only https endpoints', null, $q$select public.save_push_subscription('http://push.example/x','k','a','kwaluseni',null,'{}')$q$, 'error:23514');
select public.t_expect('anon cannot read subscriptions', null, $q$select * from public.push_subscriptions$q$, 'error:42501');
select public.t_expect('staff cannot read subscriptions', :kadmin, $q$select * from public.push_subscriptions$q$, 'error:42501');
select public.t_expect('anon deletes by endpoint', null, $q$select public.delete_push_subscription('https://push.example/abc')$q$, 'rows:1');
do $$ begin
  if exists (select 1 from public.push_subscriptions) then raise exception 'FAIL subscription not deleted'; end if;
  raise notice 'ok  subscription deleted';
end $$;

-- Removing a class rep
select public.t_expect('luyengo admin cannot remove the kwaluseni rep', :ladmin, $q$delete from public.staff where email='rep@uneswa.test'$q$, 'rows:0');
select public.t_expect('kwaluseni admin removes the rep', :kadmin, $q$delete from public.staff where email='rep@uneswa.test'$q$, 'rows:1');
select public.t_expect('a removed rep can no longer post', :rep, $q$insert into public.class_notices (campus_id, code, kind, notice_date) values ('kwaluseni','CSC111','note','2026-10-22')$q$, 'error:42501');
