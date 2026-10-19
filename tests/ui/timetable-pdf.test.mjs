import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { v3Seed, v4Seed } from './fixtures.mjs';

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
const pdfFile = (name, text)=>({ name, mimeType:'application/pdf', buffer: Buffer.from(`%PDF-1.4\n${text}\n%%EOF`) });
const storedPaths = page=>page.evaluate(()=>Object.keys(window.__FAKE_STORAGE__));

test('campus admin uploads, replaces and removes the official timetable PDF', async ()=>{
  const { page, errors } = await openApp(browser, server.url, v4Seed());
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="settings"]');
  await page.waitForSelector('#ttPdfFile');

  await page.setInputFiles('#ttPdfFile', { name:'notes.txt', mimeType:'text/plain', buffer: Buffer.from('hello') });
  await page.click('#ttPdfUpload');
  assert.match(await page.textContent('#toast'), /not a PDF/);

  await page.setInputFiles('#ttPdfFile', pdfFile('Kwaluseni Semester 1.pdf', 'first'));
  await page.click('#ttPdfUpload');
  await page.waitForSelector('text=Students see Kwaluseni Semester 1.pdf');
  const first = (await tables(page)).campus_settings.find(c=>c.campus_id==='kwaluseni');
  assert.match(first.timetable_pdf_path, /^kwaluseni\/\d+-Kwaluseni-Semester-1\.pdf$/);
  assert.equal(first.timetable_pdf_name, 'Kwaluseni Semester 1.pdf');
  assert.deepEqual(await storedPaths(page), [`timetables/${first.timetable_pdf_path}`]);

  await page.setInputFiles('#ttPdfFile', pdfFile('Revised.pdf', 'second'));
  await page.click('#ttPdfUpload');
  await page.waitForSelector('text=Students see Revised.pdf');
  const second = (await tables(page)).campus_settings.find(c=>c.campus_id==='kwaluseni');
  assert.deepEqual(await storedPaths(page), [`timetables/${second.timetable_pdf_path}`], 'the old file is deleted');

  page.once('dialog', d=>d.accept());
  await page.click('#ttPdfRemove');
  await page.waitForSelector('text=Upload the university');
  assert.equal((await tables(page)).campus_settings.find(c=>c.campus_id==='kwaluseni').timetable_pdf_path, null);
  assert.deepEqual(await storedPaths(page), []);
  assert.deepEqual(errors, []);
});

function studentSeed(make){
  const s = make();
  s.tables.students = [{ id:'202100500', name:'Pdf Student', campus_id:'kwaluseni', module_ids:['k1'], semester_version:1, history:[] }];
  Object.assign(s.tables.campus_settings.find(c=>c.campus_id==='kwaluseni'),
    { timetable_pdf_path:'kwaluseni/1-official.pdf', timetable_pdf_name:'Official timetable.pdf', timetable_pdf_at:'2026-10-15T08:00:00Z' });
  s.storage = { 'timetables/kwaluseni/1-official.pdf': '%PDF-1.4\nofficial\n%%EOF' };
  return s;
}

test('students find the PDF at the bottom of My Timetable, and it opens offline', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, studentSeed(v4Seed), { localStorage:{ uneswa_last_student:'202100500' } });
  await page.waitForSelector('.pdfcard');
  assert.equal(await page.evaluate(()=>{ const all = [...document.querySelectorAll('#main .card')]; return all[all.length-1].classList.contains('pdfcard'); }), true, 'it is the last card on the page');
  assert.match(await page.textContent('.pdfcard'), /uploaded on 15 Oct 2026/);
  // Saved on the device in the background, then offered from there.
  await page.waitForFunction(()=>new Promise(r=>{ const q = indexedDB.open('uneswa-timetable'); q.onsuccess = ()=>{
    const g = q.result.transaction('kv').objectStore('kv').get('timetable-pdf:kwaluseni'); g.onsuccess = ()=>r(g.result?.blob instanceof Blob); }; }));

  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await page.waitForSelector('#ttPdfLink');
  await page.waitForFunction(()=>document.querySelector('#ttPdfState').textContent === 'Saved on this device');
  assert.match(await page.getAttribute('#ttPdfLink', 'href'), /^blob:/);
  const [download] = await Promise.all([ page.waitForEvent('download'), page.click('#ttPdfLink') ]);
  assert.equal(download.suggestedFilename(), 'Official timetable.pdf');
  assert.match(await readFile(await download.path(), 'utf8'), /official/);
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows/.test(e)), []);
});

test('before migration 004 there is no PDF card or upload', async ()=>{
  const { page, errors } = await openApp(browser, server.url, studentSeed(v3Seed), { localStorage:{ uneswa_last_student:'202100500' } });
  await page.waitForSelector('table.grid');
  assert.equal(await page.locator('.pdfcard').count(), 0);
  await staffSignIn(page, 'kadmin@test.local');
  await page.click('[data-t="settings"]');
  await page.waitForSelector('#saveSemBtn');
  assert.equal(await page.locator('#ttPdfFile').count(), 0);
  assert.deepEqual(errors, []);
});
