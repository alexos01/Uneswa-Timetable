import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { campusSeed, v3Seed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

async function staffSignIn(page, email, password='secret', tab='#tab-staff'){
  await page.click(tab);
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
  assert.equal(await page.locator('[data-remove="u-new"]').count(), 1, 'a campus admin can remove a class rep');
  assert.deepEqual(errors, []);
});
