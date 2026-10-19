import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { legacySeed, campusSeed } from './fixtures.mjs';

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

test('before the migration: Admin tab, any login is admin, notice about migrations', async ()=>{
  const { page, errors } = await openApp(browser, server.url, legacySeed());
  assert.deepEqual(await page.locator('#tabs button').allTextContents(), ['My Timetable', 'Admin']);
  await staffSignIn(page, 'admin@test.local');
  assert.match(await page.textContent('#main'), /switch on once/);
  assert.equal(await page.locator('[data-t="staffmgmt"]').count(), 0);
  await page.click('[data-t="modules"]');
  await page.fill('#bulkArea', 'PHY111, Friday, 09:00, 09:50, SC.LAB, B.Sc. Computer Science');
  await page.click('#importBtn');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.modules.some(m=>m.code==='PHY111'));
  const row = (await tables(page)).modules.find(m=>m.code==='PHY111');
  assert.equal('campus_id' in row, false, 'no campus column written before the migration');
  assert.deepEqual(errors, []);
});

test('super admin switches campus and imports onto that campus', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'admin@test.local');
  assert.match(await page.textContent('.staffbar'), /Super admin · all campuses/);
  await page.selectOption('#adminCampusSel', 'mbabane');
  await page.waitForFunction(()=>document.querySelector('#semesterLabel').textContent.startsWith('Mbabane'));
  await page.click('[data-t="modules"]');
  await page.fill('#bulkArea', 'NUR111, Monday, 08:00, 08:50, MB.1, B.Nursing');
  await page.click('#importBtn');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.modules.some(m=>m.code==='NUR111'));
  const db = await tables(page);
  assert.equal(db.modules.find(m=>m.code==='NUR111').campus_id, 'mbabane');
  assert.equal(db.programmes.find(p=>p.name==='B.Nursing').campus_id, 'mbabane');
  assert.deepEqual(errors, []);
});

test('campus admin is pinned to their campus and adds a lecturer with a module', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'kadmin@test.local');
  assert.equal(await page.locator('#adminCampusSel').count(), 0, 'no campus switcher');
  await page.click('[data-t="staffmgmt"]');
  await page.waitForSelector('#grEmail');
  assert.deepEqual(await page.locator('#grRole option').allTextContents(), ['Lecturer']);
  await page.fill('#grEmail', 'new@test.local');
  await page.fill('#grName', 'Mr New');
  await page.click('#grBtn');
  await page.waitForSelector('[data-assigninput="u-new"]');
  assert.match(await page.textContent('.admintbl'), /Mr New/);
  await page.fill('[data-assigninput="u-new"]', 'mat111');
  await page.click('[data-assign="u-new"]');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.lecturer_modules.some(r=>r.user_id==='u-new'));
  const lm = (await tables(page)).lecturer_modules.find(r=>r.user_id==='u-new');
  assert.equal(lm.campus_id, 'kwaluseni');
  assert.equal(lm.code, 'MAT111', 'code is upper-cased');
  assert.deepEqual(errors, []);
});

test('lecturer moves their session and posts a test notice', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'lect@test.local');
  await page.waitForSelector('.sessedit');
  assert.equal(await page.locator('.coursegroup .cgtitle').allTextContents().then(x=>x.join()), 'CSC111', 'only assigned modules');
  const first = page.locator('.sessedit').first();
  await first.locator('[data-f="venue"]').fill('G.020');
  await first.locator('[data-save]').click();
  await page.waitForFunction(()=>window.__FAKE_TABLES__.modules.some(m=>m.venue==='G.020'));
  await page.selectOption('#ntKind', 'test');
  await page.fill('#ntTitle', 'Quiz 2');
  await page.click('#ntPost');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.class_notices.some(n=>n.title==='Quiz 2'));
  const n = (await tables(page)).class_notices.find(x=>x.title==='Quiz 2');
  assert.equal(n.code, 'CSC111'); assert.equal(n.campus_id, 'kwaluseni'); assert.equal(n.author_name, 'Dr Lecturer');
  assert.deepEqual(errors, []);
});

test('an account without a role is told to ask their campus admin', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'new@test.local', 'secret123');
  assert.match(await page.textContent('#main'), /hasn't been given a staff role yet/);
  assert.deepEqual(errors, []);
});

test('admin publishes an announcement that students then see', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="notices"]');
  await page.fill('#anTitle', 'Library closed Friday');
  await page.fill('#anBody', 'Closed for stocktaking.');
  await page.click('#anPost');
  await page.waitForSelector('text=Announcement published');
  await page.click('#tab-announcements');
  assert.match(await page.textContent('.announcements'), /Library closed Friday/);
  assert.deepEqual(errors, []);
});

test('students list shows the course worked out from the ticked modules', async ()=>{
  const seed = campusSeed();
  seed.tables.students = [
    { id:'202401001', name:'Cs Student', campus_id:'kwaluseni', programme_id:null, module_ids:['k1','k2','k3','k5'], updated_at:'2026-10-01T08:00:00Z' },
    { id:'202401002', name:'New Student', campus_id:'kwaluseni', programme_id:null, module_ids:[], updated_at:'2026-10-02T08:00:00Z' },
  ];
  const { page, errors } = await openApp(browser, server.url, seed);
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="students"]');
  await page.waitForSelector('#stuRows tr td');
  const course = async id=>page.locator('#stuRows tr', { hasText:id }).locator('td').nth(2);
  assert.equal((await (await course('202401001')).textContent()).trim(), 'B.Sc. Computer Science +1');
  assert.equal(await (await course('202401001')).locator('[title]').getAttribute('title'), 'Bachelor of Commerce');
  assert.equal((await (await course('202401002')).textContent()).trim(), 'No modules yet');
  assert.doesNotMatch(await page.textContent('#stuRows'), /Unassigned/);
  assert.deepEqual(errors, []);
});
