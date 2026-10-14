import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { campusSeed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

async function adminSignIn(page){
  await page.click('#tab-staff');
  await page.fill('#adminEmail', 'kadmin@test.local');
  await page.fill('#adminPass', 'secret');
  await page.click('#adminGoBtn');
  await page.waitForSelector('#signOutBtn');
}

const CSV = [
  'Module Code;Weekday;Time;Room;Programme;Faculty',     // Excel with a semicolon delimiter, own column names
  'phy 111;Fri;9:00-9:50;SC.LAB;B.Sc. Physics;Faculty of Science and Engineering',
  'PHY112;thurs;14h00-14h50;"SC.LAB; bench 2";B.Sc. Physics;',
  'CSC111;Monday;08:00-08:50;SC.LEC.TH.I;B.Sc. Computer Science;',  // already on the timetable
  'PHY113;Someday;9:00;SC.LAB;B.Sc. Physics;',
].join('\r\n');

test('admin uploads the official class timetable as CSV, previews it, then imports', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await adminSignIn(page);
  await page.click('[data-t="modules"]');
  await page.setInputFiles('#csvFile', { name:'official.csv', mimeType:'text/csv', buffer: Buffer.from(CSV) });
  await page.waitForSelector('#csvImport');
  const preview = await page.textContent('#csvPreview');
  assert.match(preview, /3 sessions ready from official\.csv, across 2 courses \(1 new: B\.Sc\. Physics\)/);
  assert.match(preview, /Line 5: "Someday" is not a day/);
  assert.equal((await tables(page)).modules.filter(m=>m.code.startsWith('PHY')).length, 0, 'nothing written before confirming');

  await page.click('#csvImport');
  await page.waitForFunction(()=>/Done: 2 imported, 1 duplicates skipped/.test(document.querySelector('#importStatus').textContent));
  const db = await tables(page);
  const phy = db.modules.filter(m=>m.code.startsWith('PHY')).map(m=>[m.code, m.day, m.start_time, m.end_time, m.venue, m.campus_id]);
  assert.deepEqual(phy, [
    ['PHY111', 'Friday', '09:00', '09:50', 'SC.LAB', 'kwaluseni'],
    ['PHY112', 'Thursday', '14:00', '14:50', 'SC.LAB; bench 2', 'kwaluseni'],
  ]);
  const prog = db.programmes.find(p=>p.name==='B.Sc. Physics');
  assert.equal(db.faculties.find(f=>f.id===prog.faculty_id).name, 'Faculty of Science and Engineering', 'the faculty column is used for new courses');
  assert.deepEqual(errors, []);
});

test('the CSV template and an export of the current entries download, and the export imports back unchanged', async ()=>{
  const { page, errors } = await openApp(browser, server.url, campusSeed());
  await adminSignIn(page);
  await page.click('[data-t="exams"]');
  const [tpl] = await Promise.all([ page.waitForEvent('download'), page.click('#csvTemplate') ]);
  assert.equal(tpl.suggestedFilename(), 'exam-timetable-template.csv');
  assert.match(await readFile(await tpl.path(), 'utf8'), /^Code,Date,Start,End,Venue,Course,Faculty\r\nACF411,2026-12-05/);

  const [exp] = await Promise.all([ page.waitForEvent('download'), page.click('#csvExport') ]);
  assert.equal(exp.suggestedFilename(), 'exam-timetable-kwaluseni.csv');
  const text = await readFile(await exp.path(), 'utf8');
  assert.equal(text, 'Code,Date,Start,End,Venue,Course,Faculty\r\nCSC111,2026-12-05,09:00,12:00,MPH,B.Sc. Computer Science,Faculty of Science and Engineering\r\n');
  await page.setInputFiles('#csvFile', { name:'back.csv', mimeType:'text/csv', buffer: Buffer.from(text) });
  await page.click('#csvImport');
  await page.waitForFunction(()=>/0 imported, 1 duplicates skipped/.test(document.querySelector('#importStatus').textContent));
  assert.deepEqual(errors, []);
});
