import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcomingNotices, describeNotice, localIsoDate } from '../../js/lib/notices.js';

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
  assert.equal(d.when, '2026-10-20 10:00');
});

test('local ISO date is zero padded', ()=>{
  assert.equal(localIsoDate(new Date(2026, 0, 5)), '2026-01-05');
});
