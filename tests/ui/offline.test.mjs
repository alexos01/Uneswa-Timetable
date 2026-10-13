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
