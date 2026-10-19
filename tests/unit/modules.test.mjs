import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coursesOfStudent, searchModules } from '../../js/lib/modules.js';

const mods = [
  { id:'a', code:'CSC111', day:'Wednesday', start_time:'10:00', programme_id:'cs' },
  { id:'b', code:'CSC111', day:'Monday', start_time:'08:00', programme_id:'cs' },
  { id:'c', code:'CSC111', day:'Friday', start_time:'11:00', programme_id:'bcom' },
  { id:'d', code:'ACF111', day:'Monday', start_time:'08:00', programme_id:'bcom' },
];

test('search stays inside the chosen course by default', ()=>{
  const r = searchModules(mods, 'csc', { programmeId:'cs' });
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].sessions.map(s=>s.id), ['b','a'], 'sessions sorted by weekday');
});

test('electives mode lists the same code once per course, never merged', ()=>{
  const r = searchModules(mods, 'CSC111', { programmeId:'cs', allCourses:true });
  assert.deepEqual(r.map(g=>[g.programme_id, g.sessions.length]), [['bcom',1],['cs',2]]);
});

test('no course chosen searches everything loaded', ()=>{
  assert.equal(searchModules(mods, 'acf').length, 1);
  assert.deepEqual(searchModules(mods, '   '), []);
});

test('a student\'s course is the one most of their modules come from', ()=>{
  assert.deepEqual(coursesOfStudent(['a','b','c','d'], mods), ['bcom','cs'], 'bcom has two codes, cs one');
  assert.deepEqual(coursesOfStudent(['a','b'], mods), ['cs'], 'two sessions of one code count once');
  assert.deepEqual(coursesOfStudent([], mods), []);
  assert.deepEqual(coursesOfStudent(['gone'], mods), [], 'sessions deleted since are ignored');
});
