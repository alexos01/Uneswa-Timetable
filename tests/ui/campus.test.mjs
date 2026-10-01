import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { campusSeed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

test('student picks a campus and only sees that campus\'s courses', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  assert.match(await page.textContent('#semesterLabel'), /Kwaluseni campus/);
  await page.fill('#gateId', '202100555');
  await page.fill('#gateName', 'Luyengo Student');
  await page.selectOption('#gateCampus', 'luyengo');
  await page.click('#gateGo');
  await page.waitForSelector('#facSel');
  assert.match(await page.textContent('#semesterLabel'), /Luyengo campus · Semester 1 Luyengo/);
  const facs = await page.locator('#facSel option').allTextContents();
  assert.deepEqual(facs, ['Choose a faculty…', 'Faculty of Agriculture']);
  const db = await tables(page);
  assert.equal(db.students.find(s=>s.id==='202100555').campus_id, 'luyengo');
  assert.deepEqual(errors, []);
});

test('announcements tab shows campus and all-campus posts, pinned first, expired hidden', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await page.click('#tab-announcements');
  const titles = await page.locator('.announcement h3').allTextContents();
  assert.deepEqual(titles, ['Exam timetable is out', 'Welcome back']);
  assert.equal(await page.locator('#tab-announcements .tabcount').textContent(), '2');
  assert.deepEqual(errors, []);
});

test('student sees a lecturer\'s test notice for their module', async ()=>{
  const seed = campusSeed();
  seed.tables.students.push({ id:'202100777', name:'Has Modules', campus_id:'kwaluseni', module_ids:['k1'], semester_version:1, history:[] });
  const { page, errors } = await openApp(browser, server.url, seed, { localStorage:{ uneswa_last_student:'202100777' } });
  await page.waitForSelector('.noticerow');
  const txt = await page.textContent('.noticerow');
  assert.match(txt, /Test.*CSC111 · Test 1/);
  assert.equal(await page.locator('.noticerow').count(), 1, 'notices for other modules are not shown');
  assert.deepEqual(errors, []);
});

test('footer shows the contact email', async ()=>{
  const { page } = await openApp(browser, server.url, campusSeed());
  assert.match(await page.textContent('#footer'), /dlaminilwandile2005@gmail\.com/);
});
