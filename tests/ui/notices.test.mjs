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

test('before migration 003 there is no "Running late" option', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await staffSignIn(page, 'lect@test.local');
  await page.waitForSelector('#ntKind');
  assert.equal(await page.locator('#ntKind option[value="late"]').count(), 0);
  assert.deepEqual(errors, []);
});

test('lecturer posts "running 20 min late"; the class time and venue fill in', async ()=>{
  const { page, errors } = await openApp(browser, server.url, v3Seed(), { fixedTime:'2026-10-19T06:30:00' });
  await staffSignIn(page, 'lect@test.local');
  await page.waitForSelector('#ntKind');
  assert.equal(await page.inputValue('#ntKind'), 'late', 'late is the first choice');
  assert.equal(await page.isVisible('#ntDelay'), true);
  assert.equal(await page.inputValue('#ntStart'), '08:00', 'Monday CSC111 session');
  assert.equal(await page.inputValue('#ntVenue'), 'SC.LEC.TH.I');
  await page.selectOption('#ntDelay', '20');
  await page.click('#ntPost');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.class_notices.some(n=>n.kind==='late'));
  const n = (await tables(page)).class_notices.find(x=>x.kind==='late');
  assert.equal(n.delay_minutes, 20); assert.equal(n.notice_date, '2026-10-19'); assert.equal(n.start_time, '08:00');
  await page.waitForSelector('text=CSC111 · Running 20 min late'); // the page redraws after posting
  await page.selectOption('#ntKind', 'test');
  assert.equal(await page.isVisible('#ntDelay'), false, 'delay only for late');
  assert.deepEqual(errors, []);
});

test('student sees that their next class is running late', async ()=>{
  const seed = v3Seed();
  seed.tables.students = [{ id:'202100123', name:'Late Student', campus_id:'kwaluseni', module_ids:['k3'], semester_version:1, history:[] }];
  seed.tables.class_notices.push({ id:'n9', campus_id:'kwaluseni', code:'CSC211', kind:'late', notice_date:'2026-10-20', start_time:'09:00', delay_minutes:15 });
  const { page, errors } = await openApp(browser, server.url, seed, { fixedTime:'2026-10-20T07:00:00', localStorage:{ uneswa_last_student:'202100123' } });
  await page.waitForSelector('.today-banner');
  assert.match(await page.textContent('.today-banner'), /Today 09:00 · CSC211/);
  assert.match(await page.textContent('.today-banner .bannerchange'), /Running 15 min late/);
  assert.deepEqual(errors, []);
});

// Records notifications instead of showing them.
function recordNotifications(){
  window.__shown = [];
  window.Notification = class { constructor(title, opts){ window.__shown.push({ title, ...opts }); } };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = ()=>Promise.resolve('granted');
}

test('a late notice posted while the app is open alerts the student once', async ()=>{
  const seed = v3Seed();
  seed.tables.students = [{ id:'202100124', name:'Alert Student', campus_id:'kwaluseni', module_ids:['k1'], semester_version:1, history:[] }];
  seed.tables.class_notices.push({ id:'old', campus_id:'kwaluseni', code:'CSC111', kind:'moved', notice_date:'2026-10-19', venue:'G.020' });
  const { page, errors } = await openApp(browser, server.url, seed, {
    fixedTime:'2026-10-19T06:30:00', initScript: recordNotifications,
    localStorage:{ uneswa_last_student:'202100124', uneswa_notif: JSON.stringify({ enabled:true, minutesBefore:10 }) },
  });
  await page.waitForSelector('.today-banner');
  await page.waitForFunction(()=>localStorage.getItem('uneswa_seen_changes'));
  assert.deepEqual(await page.evaluate(()=>window.__shown), [], 'notices already there on first open are not replayed');

  await page.evaluate(()=>window.supabase.createClient().from('class_notices').insert({
    id:'new', campus_id:'kwaluseni', code:'CSC111', kind:'late', notice_date:'2026-10-19', start_time:'08:00', delay_minutes:10, venue:'SC.LEC.TH.I' }));
  await page.waitForFunction(()=>window.__shown.length > 0);
  const shown = await page.evaluate(()=>window.__shown);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'CSC111 today 08:00: running 10 min late');
  assert.equal(shown[0].tag, 'notice-new');
  assert.match(await page.textContent('.today-banner'), /Running 10 min late/);
  assert.deepEqual(errors, []);
});
