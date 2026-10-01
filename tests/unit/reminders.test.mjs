import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReminders, nextWeeklyFire, noticeReminders, planReminders, reminderId } from '../../js/lib/reminders.js';

const sessions = [
  { id:'1', code:'CSC111', day:'Monday', start_time:'08:00', end_time:'08:50', venue:'SC.LEC.TH.I' },
  { id:'2', code:'CSC111', day:'Monday', start_time:'08:00', end_time:'08:50', venue:'SC.LEC.TH.I' }, // duplicate row
  { id:'3', code:'MAT111', day:'Wednesday', start_time:'07:00', end_time:'07:50' },
];

test('weekly reminders use Capacitor weekdays and skip duplicate rows', ()=>{
  const r = weeklyReminders(sessions, 15);
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].weekday, r[0].hour, r[0].minute], [2, 7, 45]); // Monday = 2
  assert.equal(r[0].title, 'CSC111 starts in 15 min');
  assert.equal(r[0].body, 'SC.LEC.TH.I · 08:00–08:50');
  assert.equal(r[1].body, 'Venue TBC · 07:00–07:50');
});

test('a lead time past midnight moves to the previous day', ()=>{
  const [r] = weeklyReminders([{ id:'x', code:'EARLY', day:'Monday', start_time:'00:30' }], 60);
  assert.deepEqual([r.weekday, r.hour, r.minute], [1, 23, 30]); // Sunday 23:30
});

test('next weekly fire rolls over to next week once passed', ()=>{
  const [r] = weeklyReminders([sessions[0]], 15);
  const mondayNine = new Date(2026, 9, 5, 9, 0);   // Mon 5 Oct 2026 09:00
  assert.equal(nextWeeklyFire(r, mondayNine).toDateString(), new Date(2026, 9, 12).toDateString());
  const sunday = new Date(2026, 9, 4, 12, 0);
  assert.equal(nextWeeklyFire(r, sunday).getTime(), new Date(2026, 9, 5, 7, 45).getTime());
});

test('notices remind the evening before and before the start; cancellations only the evening before', ()=>{
  const now = new Date(2026, 9, 1, 12, 0);
  const r = noticeReminders([
    { id:'t', code:'CSC111', kind:'test', title:'Test 1', notice_date:'2026-10-06', start_time:'10:00', venue:'MPH' },
    { id:'c', code:'MAT111', kind:'cancelled', notice_date:'2026-10-07', start_time:'09:00' },
    { id:'old', code:'MAT111', kind:'test', notice_date:'2026-09-20', start_time:'09:00' },
  ], 30, now);
  assert.deepEqual(r.map(x=>x.title), [
    'Tomorrow · CSC111 Test: Test 1', 'CSC111 Test: Test 1 in 30 min', 'Tomorrow · MAT111 Cancelled',
  ]);
  assert.equal(r[0].at.getTime(), new Date(2026, 9, 5, 18, 0).getTime());
  assert.equal(r[1].at.getTime(), new Date(2026, 9, 6, 9, 30).getTime());
});

test('plan is capped and soonest first', ()=>{
  const many = Array.from({ length:80 }, (_, i)=>({ id:String(i), code:`M${100+i}`, day:'Friday', start_time:`${String(7 + i%10).padStart(2,'0')}:00` }));
  const plan = planReminders({ sessions: many, minutesBefore: 10, now: new Date(2026, 9, 1, 12, 0), limit: 60 });
  assert.equal(plan.length, 60);
  for(let i=1;i<plan.length;i++) assert.ok(plan[i].next >= plan[i-1].next);
});

test('ids are stable and positive', ()=>{
  assert.equal(reminderId('class|CSC111|Monday|08:00'), reminderId('class|CSC111|Monday|08:00'));
  assert.ok(reminderId('a') > 0 && reminderId('a') < 2**31);
});
