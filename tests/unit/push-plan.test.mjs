import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localClock, dueReminders, noticeMessage, noticeTargets, announcementTargets, announcementMessage } from '../../supabase/functions/_shared/push-plan.js';

// Monday 19 Oct 2026, 08:00 in Eswatini (UTC+2).
const at = (hhmm)=>new Date(`2026-10-19T${hhmm}:00+02:00`);
const modules = [
  { id:'m1', code:'CSC111', day:'Monday', start_time:'08:10', end_time:'09:00', venue:'SC.LEC.TH.I' },
  { id:'m2', code:'CSC111', day:'Monday', start_time:'08:10', end_time:'09:00', venue:'SC.LEC.TH.I' }, // duplicate row
  { id:'m3', code:'MAT111', day:'Tuesday', start_time:'08:10' },
];
const sub = { endpoint:'https://push/1', campus_id:'kwaluseni', module_ids:['m1','m2','m3'], codes:['CSC111','MAT111'], minutes_before:10, reminders:true };

test('the campus clock is Eswatini time whatever the server zone', ()=>{
  assert.deepEqual(localClock(new Date('2026-10-19T06:00:00Z')), { isoDate:'2026-10-19', day:'Monday', minutes:480 });
  assert.deepEqual(localClock(new Date('2026-10-18T23:30:00Z')), { isoDate:'2026-10-19', day:'Monday', minutes:90 });
});

test('a class reminder is due exactly the lead time before, once per session', ()=>{
  const due = dueReminders({ subs:[sub], modules, notices:[], now: at('08:00') });
  assert.equal(due.length, 1);
  assert.deepEqual(due[0].message, { title:'CSC111 starts in 10 min', body:'SC.LEC.TH.I · 08:10–09:00', tag:'class-m1-2026-10-19' });
  assert.equal(dueReminders({ subs:[sub], modules, notices:[], now: at('08:01') }).length, 0);
});

test('cancelled classes are skipped, late ones move, moved ones change venue', ()=>{
  const n = (kind, extra={})=>({ id:kind, code:'CSC111', kind, notice_date:'2026-10-19', start_time:'08:10', ...extra });
  assert.equal(dueReminders({ subs:[sub], modules, notices:[n('cancelled')], now: at('08:00') }).length, 0);
  const late = dueReminders({ subs:[sub], modules, notices:[n('late', { delay_minutes:15 })], now: at('08:15') });
  assert.equal(late[0].message.title, 'CSC111 starts in 10 min (running 15 min late)');
  assert.equal(dueReminders({ subs:[sub], modules, notices:[n('late', { delay_minutes:15 })], now: at('08:00') }).length, 0);
  const moved = dueReminders({ subs:[sub], modules, notices:[n('moved', { venue:'G.011' })], now: at('08:00') });
  assert.match(moved[0].message.body, /^G\.011/);
});

test('tests and extra classes on the day get their own reminder', ()=>{
  const notices = [{ id:'t1', code:'MAT111', kind:'test', title:'Test 1', notice_date:'2026-10-19', start_time:'14:00', venue:'MPH' }];
  const due = dueReminders({ subs:[sub], modules, notices, now: at('13:50') });
  assert.deepEqual(due.map(d=>d.message), [{ title:'MAT111 Test: Test 1 in 10 min', body:'MPH', tag:'notice-t1-start' }]);
});

test('reminders off means no class reminders', ()=>{
  assert.equal(dueReminders({ subs:[{ ...sub, reminders:false }], modules, notices:[], now: at('08:00') }).length, 0);
});

test('notice messages and who gets them', ()=>{
  const late = { id:'n1', campus_id:'kwaluseni', code:'CSC111', kind:'late', notice_date:'2026-10-19', start_time:'08:10', delay_minutes:10, venue:'G.005' };
  assert.deepEqual(noticeMessage(late, '2026-10-19'), { title:'CSC111 today 08:10: running 10 min late', body:'G.005', tag:'notice-n1' });
  assert.equal(noticeMessage({ ...late, kind:'test', title:'Quiz', notice_date:'2026-10-22' }, '2026-10-19').title, 'CSC111 Test: Quiz');
  const subs = [sub, { ...sub, endpoint:'b', codes:['ACF111'] }, { ...sub, endpoint:'c', campus_id:'luyengo' }];
  assert.deepEqual(noticeTargets(late, subs).map(s=>s.endpoint), ['https://push/1']);
});

test('announcements reach the campus, everyone, or one course and year', ()=>{
  const subs = [
    { endpoint:'a', campus_id:'kwaluseni', codes:['CSC111'] },
    { endpoint:'b', campus_id:'kwaluseni', codes:['CSC211'] },
    { endpoint:'c', campus_id:'luyengo', codes:['AGR111'] },
  ];
  assert.deepEqual(announcementTargets({ campus_id:null }, subs).map(s=>s.endpoint), ['a','b','c']);
  assert.deepEqual(announcementTargets({ campus_id:'kwaluseni' }, subs).map(s=>s.endpoint), ['a','b']);
  assert.deepEqual(announcementTargets({ campus_id:'kwaluseni', programme_id:'p', year:2 }, subs, ['CSC111','CSC211']).map(s=>s.endpoint), ['b']);
  assert.equal(announcementMessage({ id:'x', title:'T', body:'a\n\nb' }).body, 'a b');
});
