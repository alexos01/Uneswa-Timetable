import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { campusSeed, v3Seed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

async function staffSignIn(page, email, password='secret'){
  await page.click('#tab-staff');
  await page.fill('#adminEmail', email);
  await page.fill('#adminPass', password);
  await page.click('#adminGoBtn');
  await page.waitForSelector('#signOutBtn');
}

test('class rep is only offered once migration 003 is run', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="staffmgmt"]');
  await page.waitForSelector('#grRole');
  assert.deepEqual(await page.locator('#grRole option').allTextContents(), ['Lecturer']);
  assert.deepEqual(errors, []);
});

test('campus admin makes someone a class rep and assigns a module', async ()=>{
  const { page, errors } = await openApp(browser, server.url, v3Seed());
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="staffmgmt"]');
  await page.waitForSelector('#grRole');
  assert.deepEqual(await page.locator('#grRole option').allTextContents(), ['Lecturer', 'Class rep']);
  await page.fill('#grEmail', 'new@test.local');
  await page.fill('#grName', 'Rep Newton');
  await page.selectOption('#grRole', 'class_rep');
  await page.click('#grBtn');
  await page.waitForSelector('[data-assigninput="u-new"]');
  assert.match(await page.textContent('.admintbl'), /Rep Newton\s*new@test.local\s*Class rep/);
  await page.fill('[data-assigninput="u-new"]', 'csc211');
  await page.click('[data-assign="u-new"]');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.lecturer_modules.some(r=>r.user_id==='u-new' && r.code==='CSC211'));
  assert.equal((await tables(page)).staff.find(s=>s.user_id==='u-new').role, 'class_rep');
  await page.waitForSelector('[data-unassign="u-new|CSC211"]'); // the list redraws after assigning
  assert.equal(await page.locator('[data-remove="u-new"]').count(), 1, 'a campus admin can remove a class rep');
  assert.deepEqual(errors, []);
});

function repSeed(){
  const s = v3Seed();
  s.tables.staff.push({ user_id:'u-rep', role:'class_rep', campus_id:'kwaluseni', email:'rep@test.local', display_name:'Class Rep' });
  s.tables.lecturer_modules.push({ user_id:'u-rep', campus_id:'kwaluseni', code:'CSC211' });
  s.users.push({ id:'u-rep', email:'rep@test.local', password:'secret' });
  return s;
}

test('the Lecturer and Class rep tabs appear only for those roles, and go on sign out', async ()=>{
  const { page, errors } = await openApp(browser, server.url, repSeed());
  const tabs = ()=>page.locator('#tabs button').allTextContents();
  assert.deepEqual(await tabs(), ['My Timetable', 'Announcements 2', 'Staff'], 'students see no staff role tabs');
  await staffSignIn(page, 'rep@test.local');
  await page.waitForSelector('#caCourse');
  assert.deepEqual(await tabs(), ['My Timetable', 'Announcements 2', 'Class rep', 'Staff']);
  assert.equal(await page.getAttribute('#tab-rep', 'class'), 'active', 'lands on the Class rep tab');
  await page.click('#signOutBtn');
  await page.waitForSelector('#adminEmail');
  assert.deepEqual(await tabs(), ['My Timetable', 'Announcements 2', 'Staff']);
  assert.equal(await page.getAttribute('#tab-staff', 'class'), 'active');
  await staffSignIn(page, 'lect@test.local');
  await page.waitForSelector('.sessedit');
  assert.deepEqual(await tabs(), ['My Timetable', 'Announcements 2', 'Lecturer', 'Staff']);
  assert.deepEqual(errors, []);
});

test('class rep signs in on their tab, posts a late notice and a class announcement', async ()=>{
  const { page, errors } = await openApp(browser, server.url, repSeed(), { fixedTime:'2026-10-20T06:30:00' });
  await staffSignIn(page, 'rep@test.local');
  await page.waitForSelector('#caCourse');
  assert.match(await page.textContent('.staffbar'), /Class rep · Kwaluseni/);
  assert.equal(await page.inputValue('#ntCode'), 'CSC211');
  assert.equal(await page.inputValue('#ntStart'), '09:00', 'Tuesday CSC211 session');
  await page.selectOption('#ntDelay', '10');
  await page.click('#ntPost');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.class_notices.some(n=>n.kind==='late' && n.code==='CSC211'));
  await page.waitForSelector('text=CSC211 · Running 10 min late'); // the page redraws after posting

  assert.deepEqual(await page.locator('#caCourse option').allTextContents(), ['B.Sc. Computer Science']);
  assert.equal(await page.inputValue('#caYear'), '2', 'the only year their modules cover');
  await page.fill('#caTitle', 'Group project groups');
  await page.fill('#caBody', 'Groups are on the notice board.');
  await page.click('#caPost');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.announcements.some(a=>a.title==='Group project groups'));
  const a = (await tables(page)).announcements.find(x=>x.title==='Group project groups');
  assert.deepEqual([a.campus_id, a.programme_id, a.year, a.created_by], ['kwaluseni', 'prog-bsc-cs', 2, 'u-rep']);
  await page.waitForSelector('text=Your announcements');
  assert.match(await page.textContent('#main'), /B\.Sc\. Computer Science · 2nd year/);

  await page.locator('.sessedit').first().locator('[data-f="venue"]').fill('G.099');
  await page.locator('.sessedit').first().locator('[data-save]').click();
  await page.waitForFunction(()=>window.__FAKE_TABLES__.modules.some(m=>m.code==='CSC211' && m.venue==='G.099'));
  assert.deepEqual(errors, []);
});

test('a lecturer signing in under Staff lands on the Lecturer tab', async ()=>{
  const { page, errors } = await openApp(browser, server.url, repSeed());
  await staffSignIn(page, 'lect@test.local');
  await page.waitForSelector('.sessedit');
  assert.equal(await page.getAttribute('#tab-lecturer', 'class'), 'active');
  await page.click('#tab-staff');
  assert.match(await page.textContent('#main'), /Your tools are under the Lecturer tab/);
  await page.click('#goHomeTab');
  await page.waitForSelector('.sessedit');
  assert.deepEqual(errors, []);
});

test('course announcements reach only students on that course and year', async ()=>{
  const seed = repSeed();
  seed.tables.announcements.push(
    { id:'c2', campus_id:'kwaluseni', programme_id:'prog-bsc-cs', year:2, title:'CS year 2 only', body:'', created_at:'2026-09-18T08:00:00Z' },
    { id:'c1', campus_id:'kwaluseni', programme_id:'prog-bsc-cs', year:1, title:'CS year 1 only', body:'', created_at:'2026-09-18T08:00:00Z' },
    { id:'cb', campus_id:'kwaluseni', programme_id:'prog-bcom', title:'BCom only', body:'', created_at:'2026-09-18T08:00:00Z' });
  seed.tables.students = [{ id:'202100300', name:'Second Year', campus_id:'kwaluseni', module_ids:['k3'], semester_version:1, history:[] }];
  const { page, errors } = await openApp(browser, server.url, seed, { localStorage:{ uneswa_last_student:'202100300' } });
  await page.click('#tab-announcements');
  const text = await page.textContent('.announcements');
  assert.match(text, /CS year 2 only/);
  assert.match(text, /Welcome back/);
  assert.doesNotMatch(text, /CS year 1 only|BCom only/);
  assert.match(await page.textContent('#tab-announcements'), /3/);
  assert.deepEqual(errors, []);
});

test('on a phone the tabs scroll instead of squashing', async ()=>{
  const { page, errors } = await openApp(browser, server.url, repSeed(), { viewport:{ width:375, height:740 } });
  const fits = await page.evaluate(()=>[...document.querySelectorAll('#tabs button')].every(b=>b.scrollWidth <= b.clientWidth + 1));
  assert.equal(fits, true, 'no tab label is cut off');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= 375), true, 'no sideways page scroll');
  assert.deepEqual(errors, []);
});
