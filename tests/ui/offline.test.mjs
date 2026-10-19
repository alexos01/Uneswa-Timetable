import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp } from './helpers.mjs';
import { legacySeed, ids } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

async function signIn(page, id='202100777', name='Offline Student'){
  await page.fill('#gateId', id);
  await page.fill('#gateName', name);
  await page.click('#gateGo');
  await page.waitForSelector('#facSel');
}

test('installed web app opens with no connection at all', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed(), { serviceWorkers:'allow' });
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload(); // the page is now controlled by the service worker
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await signIn(page);
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');

  await context.setOffline(true);
  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod');
  assert.match(await page.textContent('table.grid'), /CSC211/);
  assert.match(await page.textContent('#semesterLabel'), /offline/);
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows|ERR_INTERNET_DISCONNECTED/.test(e)), []);
});

test('offline, the whole campus timetable is still there to browse', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page, '202100778', 'Browsing Student');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');
  await page.waitForFunction(()=>new Promise(r=>{ const q = indexedDB.open('uneswa-timetable'); q.onsuccess = ()=>{
    const g = q.result.transaction('kv').objectStore('kv').get('student:202100778'); g.onsuccess = ()=>r(!!g.result?.module_ids?.length); }; }));

  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod');
  await page.selectOption('#facSel', ids.FAC_COM);
  await page.selectOption('#progSel', ids.BCOM);
  assert.match(await page.textContent('#modList'), /ACF111/, 'another course is browsable offline');
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows/.test(e)), []);
});

test('modules ticked offline are saved on the device and sync when back online', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page, '202100779', 'Syncing Student');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');

  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'MAT111' }).locator('input').check();
  await page.waitForFunction(()=>document.querySelector('#semesterLabel').textContent.includes('1 change waiting to sync'));
  assert.match(await page.textContent('table.grid'), /MAT111/, 'the change shows straight away');

  await page.evaluate(()=>{ window.__FAKE_DB__.failNetwork = false; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(()=>window.__FAKE_TABLES__.students.some(s=>s.id==='202100779' && s.module_ids.includes('m4')));
  await page.waitForFunction(()=>!/offline|waiting to sync/.test(document.querySelector('#semesterLabel').textContent));
  assert.match(await page.textContent('#toast'), /back online/);
  assert.match(await page.textContent('table.grid'), /MAT111/);
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows/.test(e)), []);
});

test('a student can sign in for the first time with no connection', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page, '202100780', 'First Visit'); // loads the campus copy
  await page.click('#switchStudentBtn');
  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await signIn(page, '202100781', 'Offline Newcomer');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC111' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');
  assert.match(await page.textContent('#semesterLabel'), /waiting to sync/);
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows/.test(e)), []);
});

test('on a slow connection the app opens on the saved copy at once and syncs behind it', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page, '202100780', 'Slow Student');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');
  await page.waitForFunction(()=>new Promise(r=>{ const q = indexedDB.open('uneswa-timetable'); q.onsuccess = ()=>{
    const g = q.result.transaction('kv').objectStore('kv').get('student:202100780'); g.onsuccess = ()=>r(!!g.result?.module_ids?.length); }; }));

  // Every request now takes 3 s, and a lecturer has moved CSC211 meanwhile.
  await context.addInitScript(()=>{
    window.__FAKE_DB__.latencyMs = 3000;
    window.__FAKE_DB__.tables.modules.find(m=>m.code==='CSC211').venue = 'NEW.ROOM';
  });
  const started = Date.now();
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod');
  assert.ok(Date.now() - started < 2500, `timetable shown before the server answered (${Date.now() - started} ms)`);
  assert.match(await page.textContent('#semesterLabel'), /syncing/);
  assert.match(await page.textContent('table.grid'), /G\.005/, 'the saved copy');

  await page.waitForFunction(()=>!/syncing/.test(document.querySelector('#semesterLabel').textContent), null, { timeout:30000 });
  await page.waitForFunction(()=>document.querySelector('table.grid').textContent.includes('NEW.ROOM'), null, { timeout:10000 });
  assert.doesNotMatch(await page.textContent('#semesterLabel'), /offline/);
  assert.deepEqual(errors, []);
});

test('a sync that finishes while the student is typing waits until they stop', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page, '202100781', 'Typing Student');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');
  await page.waitForFunction(()=>new Promise(r=>{ const q = indexedDB.open('uneswa-timetable'); q.onsuccess = ()=>{
    const g = q.result.transaction('kv').objectStore('kv').get('student:202100781'); g.onsuccess = ()=>r(!!g.result?.module_ids?.length); }; }));

  await context.addInitScript(()=>{
    window.__FAKE_DB__.latencyMs = 1500;
    window.__FAKE_DB__.tables.modules.find(m=>m.code==='CSC211').venue = 'NEW.ROOM';
  });
  await page.reload();
  await page.waitForSelector('#modSearch');
  await page.click('#modSearch');
  await page.keyboard.type('MAT', { delay:50 });
  await page.waitForFunction(()=>!/syncing/.test(document.querySelector('#semesterLabel').textContent), null, { timeout:30000 });
  await page.waitForTimeout(800);
  assert.equal(await page.inputValue('#modSearch'), 'MAT', 'what they typed is still there');
  assert.equal(await page.evaluate(()=>document.activeElement.id), 'modSearch', 'still in the field');
  assert.match(await page.textContent('table.grid'), /G\.005/, 'not redrawn yet');

  await page.click('h1');
  await page.waitForFunction(()=>document.querySelector('table.grid').textContent.includes('NEW.ROOM'), null, { timeout:10000 });
  assert.deepEqual(errors, []);
});
