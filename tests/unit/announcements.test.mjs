import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleAnnouncements, repCourses } from '../../js/lib/announcements.js';

const list = [
  { id:'all' },
  { id:'cs', programme_id:'cs' },
  { id:'cs1', programme_id:'cs', year:1 },
  { id:'cs2', programme_id:'cs', year:2 },
  { id:'bcom', programme_id:'bcom' },
];

test('a student sees campus-wide posts and posts for their course and year', ()=>{
  const mine = [{ code:'CSC111', programme_id:'cs' }, { code:'MAT111', programme_id:'cs' }];
  assert.deepEqual(visibleAnnouncements(list, mine).map(a=>a.id), ['all','cs','cs1']);
});

test('with no student signed in, only campus-wide posts show', ()=>{
  assert.deepEqual(visibleAnnouncements(list, []).map(a=>a.id), ['all']);
  assert.deepEqual(visibleAnnouncements(list, null).map(a=>a.id), ['all']);
});

test('a rep\'s courses come from their module codes, with the years they cover', ()=>{
  const modules = [
    { code:'CSC111', programme_id:'cs' }, { code:'CSC111', programme_id:'bcom' },
    { code:'CSC211', programme_id:'cs' }, { code:'MAT111', programme_id:'cs' },
  ];
  assert.deepEqual(repCourses(modules, ['CSC111','CSC211']), [
    { programme_id:'cs', years:[1,2] }, { programme_id:'bcom', years:[1] },
  ]);
});
