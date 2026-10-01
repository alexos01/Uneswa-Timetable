import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { legacySeed, ids } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

async function signIn(page, id='202100123', name='Test Student'){
  await page.fill('#gateId', id);
  await page.fill('#gateName', name);
  await page.click('#gateGo');
  await page.waitForSelector('#facSel');
}

test('student registers, picks a course and sees the module in the weekly grid', async ()=>{
  const { page, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page);
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  const rows = await page.locator('#modList .modrow').allTextContents();
  assert.equal(rows.length, 3, 'one row per module code, not per session');
  assert.match(rows[0], /CSC111.*2 sessions/);
  await page.locator('#modList .modrow', { hasText:'CSC111' }).locator('input').check();
  await page.waitForSelector('table.grid .cell-mod');
  const cells = await page.locator('table.grid .cell-mod').allTextContents();
  assert.equal(cells.length, 2);
  const db = await tables(page);
  assert.deepEqual(db.students[0].module_ids.sort(), ['m1','m2']);
  assert.deepEqual(errors, []);
});

test('timetable exports as a PDF', async ()=>{
  const { page, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page);
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForSelector('#exportPdfBtn');
  const [download] = await Promise.all([ page.waitForEvent('download'), page.click('#exportPdfBtn') ]);
  assert.match(download.suggestedFilename(), /Test-Student-timetable\.pdf/);
  assert.deepEqual(errors, []);
});

test('search is scoped to the chosen course, electives only when asked', async ()=>{
  const { page, errors } = await openApp(browser, server.url, legacySeed());
  await signIn(page);
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.fill('#modSearch', 'CSC111');
  assert.equal(await page.locator('#searchList .modrow').count(), 1, 'only the chosen course');
  await page.check('#searchAll');
  const rows = page.locator('#searchList .modrow');
  assert.equal(await rows.count(), 2, 'one row per course');
  await rows.filter({ hasText:'Bachelor of Commerce' }).locator('input').check();
  await page.waitForFunction(()=>window.__FAKE_TABLES__.students[0]?.module_ids?.length === 1);
  assert.deepEqual((await tables(page)).students[0].module_ids, ['m6'], 'no sessions from other streams');
  assert.equal(await page.inputValue('#modSearch'), 'CSC111', 'query survives the re-render');
  assert.deepEqual(errors, []);
});
