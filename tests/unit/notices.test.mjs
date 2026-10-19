import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coursesForCode, noticesFor, upcomingNotices, describeNotice, formatDay, localIsoDate, noticeSummary, changeFor, unseenChanges, changeAlert } from '../../js/lib/notices.js';

const notices = [
  { code:'CSC111', kind:'test', notice_date:'2026-10-20', start_time:'10:00' },
  { code:'CSC111', kind:'cancelled', notice_date:'2026-09-01' },
  { code:'MAT111', kind:'note', notice_date:'2026-10-02' },
  { code:'CSC211', kind:'moved', notice_date:'2026-10-05', venue:'G.010' },
];

test('only the student\'s codes, from today, soonest first', ()=>{
  const r = upcomingNotices(notices, ['CSC111','CSC211'], '2026-10-01');
  assert.deepEqual(r.map(n=>n.notice_date), ['2026-10-05','2026-10-20']);
});

test('describes a notice with a sensible default title', ()=>{
  const d = describeNotice(notices[0]);
  assert.equal(d.heading, 'CSC111 · Test');
  assert.equal(d.when, 'Tue 20 Oct, 10:00');
});

test('days read as local calendar dates, in one short format', ()=>{
  assert.equal(formatDay('2026-12-05'), 'Sat 5 Dec');
  assert.equal(formatDay('2026-01-01'), 'Thu 1 Jan');
  assert.equal(formatDay(''), '');
});

test('local ISO date is zero padded', ()=>{
  assert.equal(localIsoDate(new Date(2026, 0, 5)), '2026-01-05');
});

test('running late reads naturally with and without a delay', ()=>{
  assert.equal(describeNotice({ code:'CSC111', kind:'late', notice_date:'2026-10-20', delay_minutes:15 }).heading, 'CSC111 · Running 15 min late');
  assert.equal(describeNotice({ code:'CSC111', kind:'late', notice_date:'2026-10-20', title:'Lab overran' }).heading, 'CSC111 · Running late: Lab overran');
  assert.equal(noticeSummary({ kind:'moved', venue:'G.011' }), 'Moved to G.011');
  assert.equal(noticeSummary({ kind:'cancelled' }), 'Class cancelled');
});

test('a same-day change matches its class, the newest one wins', ()=>{
  const list = [
    { code:'CSC111', kind:'late', notice_date:'2026-10-20', start_time:'08:00', delay_minutes:10, created_at:'2026-10-20T05:00:00Z' },
    { code:'CSC111', kind:'cancelled', notice_date:'2026-10-20', start_time:'08:00', created_at:'2026-10-20T06:00:00Z' },
    { code:'CSC111', kind:'late', notice_date:'2026-10-20', start_time:'14:00', delay_minutes:5 },
    { code:'CSC111', kind:'test', notice_date:'2026-10-20' },
  ];
  assert.equal(changeFor(list, 'CSC111', '2026-10-20', '08:00').kind, 'cancelled');
  assert.equal(changeFor(list, 'CSC111', '2026-10-20', '14:00').delay_minutes, 5);
  assert.equal(changeFor(list, 'CSC111', '2026-10-21', '08:00'), null);
  assert.equal(changeFor(list, 'MAT111', '2026-10-20', '08:00'), null);
});

test('only unseen same-day changes for my modules raise an alert', ()=>{
  const list = [
    { id:'a', code:'CSC111', kind:'late', notice_date:'2026-10-20', start_time:'08:00', delay_minutes:10 },
    { id:'b', code:'CSC111', kind:'test', notice_date:'2026-10-20' },
    { id:'c', code:'MAT111', kind:'cancelled', notice_date:'2026-10-20' },
    { id:'d', code:'CSC111', kind:'cancelled', notice_date:'2026-10-19' },
    { id:'e', code:'CSC111', kind:'moved', notice_date:'2026-10-21', venue:'G.011' },
  ];
  assert.deepEqual(unseenChanges(list, ['CSC111'], ['e'], '2026-10-20').map(n=>n.id), ['a']);
});

test('alert text says what changed', ()=>{
  assert.deepEqual(changeAlert({ code:'CSC111', kind:'late', notice_date:'2026-10-20', start_time:'08:00', delay_minutes:10, venue:'G.005' }, '2026-10-20'),
    { title:'CSC111 today 08:00: running 10 min late', body:'G.005' });
  assert.equal(changeAlert({ code:'MAT111', kind:'cancelled', notice_date:'2026-10-21', venue:'MPH' }, '2026-10-20').title, 'MAT111 2026-10-21: cancelled');
  assert.equal(changeAlert({ code:'MAT111', kind:'moved', notice_date:'2026-10-20', venue:'G.011' }, '2026-10-20').title, 'MAT111 today: moved to G.011');
});

test('a notice for one course applies only to students taking the module on that course', ()=>{
  const bsc = [{ id:'a', code:'MAT111', programme_id:'bsc' }, { id:'b', code:'CSC111', programme_id:'bsc' }];
  const bed = [{ id:'c', code:'MAT111', programme_id:'bed' }];
  const notices = [
    { id:'n1', code:'MAT111', programme_id:'bsc' },
    { id:'n2', code:'MAT111', programme_id:null },
    { id:'n3', code:'CSC111' },
    { id:'n4', code:'ACF111' },
  ];
  assert.deepEqual(noticesFor(notices, bsc).map(n=>n.id), ['n1','n2','n3']);
  assert.deepEqual(noticesFor(notices, bed).map(n=>n.id), ['n2']);
  assert.deepEqual(noticesFor(notices, []), []);
});

test('the courses offered for a notice are the ones the module runs on', ()=>{
  const modules = [{ code:'MAT111', programme_id:'bsc' }, { code:'MAT111', programme_id:'bsc' }, { code:'MAT111', programme_id:'bed' }, { code:'CSC111', programme_id:'bsc' }, { code:'MAT111', programme_id:null }];
  assert.deepEqual(coursesForCode(modules, 'MAT111'), ['bsc','bed']);
  assert.deepEqual(coursesForCode(modules, 'XYZ999'), []);
});
