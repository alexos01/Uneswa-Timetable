import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { ids, signedInAs, v4Seed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

const gateError = page=>page.waitForSelector('#gateError:not([hidden])').then(e=>e.textContent());
async function enterNumber(page, id){
  await page.fill('#gateId', id);
  await page.click('#gateGo');
  await page.waitForSelector('#gatePass');
}

test('a new student chooses a password, stays signed in on this device, and needs it after signing out', async ()=>{
  const { page, errors } = await openApp(browser, server.url, v4Seed());
  await enterNumber(page, '202100700');
  assert.match(await page.textContent('h2'), /Create your timetable/);
  await page.fill('#gateName', 'New Student');
  await page.fill('#gatePass', 'abc');
  await page.click('#gateGo');
  assert.match(await gateError(page), /at least 6 characters/);
  await page.fill('#gatePass', 'secret1');
  await page.fill('#gatePass2', 'secret2');
  await page.click('#gateGo');
  assert.match(await gateError(page), /don't match/);
  await page.fill('#gatePass2', 'secret1');
  await page.click('#gateGo');
  await page.waitForSelector('#facSel');
  assert.match(await page.textContent('#main'), /Signed in as New Student/);

  const db = await tables(page);
  assert.equal(db.students.find(s=>s.id==='202100700').campus_id, 'kwaluseni');
  const stored = await page.evaluate(()=>JSON.stringify({ ...localStorage }));
  assert.doesNotMatch(stored, /secret1/, 'the password is not kept on the device');
  assert.match(stored, /uneswa_student_token/);

  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'CSC211' }).locator('input').check();
  await page.waitForFunction(()=>window.__FAKE_TABLES__.students.find(s=>s.id==='202100700').module_ids.length === 1);
  await page.addInitScript(t=>{ window.__FAKE_DB__.tables = t; }, await tables(page)); // the fake server keeps its data over the reload
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod'); // straight back in, no password

  await page.click('#switchStudentBtn');
  await page.waitForSelector('#gateId');
  assert.equal((await tables(page)).student_sessions.length, 0, 'signing out ends the session on the server');
  await enterNumber(page, '202100700');
  assert.match(await page.textContent('h2'), /Enter your password/);
  await page.fill('#gatePass', 'wrong12');
  await page.click('#gateGo');
  assert.match(await gateError(page), /Wrong password\. 4 more tries/);
  await page.fill('#gatePass', 'secret1');
  await page.click('#gateGo');
  await page.waitForSelector('table.grid .cell-mod');
  assert.match(await page.textContent('table.grid'), /CSC211/);
  assert.deepEqual(errors, []);
});

test('a student from before passwords is asked to choose one and keeps their modules', async ()=>{
  const seed = v4Seed();
  seed.tables.students = [{ id:'202100701', name:'Old Student', campus_id:'kwaluseni', module_ids:['k3'], semester_version:1, history:[] }];
  const { page, errors } = await openApp(browser, server.url, seed, { localStorage:{ uneswa_last_student:'202100701' } });
  await page.waitForSelector('#gateId');
  assert.match(await page.textContent('.warnbox'), /Timetables now have passwords/);
  await enterNumber(page, '202100701');
  assert.match(await page.textContent('#main'), /has no password yet/);
  assert.equal(await page.locator('#gateName').count(), 0);
  await page.fill('#gatePass', 'mine123');
  await page.fill('#gatePass2', 'mine123');
  await page.click('#gateGo');
  await page.waitForSelector('table.grid .cell-mod');
  assert.match(await page.textContent('table.grid'), /CSC211/);
  assert.match(await page.textContent('#main'), /Signed in as Old Student/);
  assert.deepEqual(errors, []);
});

test('five wrong passwords lock the number for 15 minutes', async ()=>{
  const seed = v4Seed();
  seed.tables.students = [{ id:'202100702', name:'Locked', campus_id:'kwaluseni', module_ids:[], semester_version:1, history:[] }];
  seed.tables.student_credentials = [{ student_id:'202100702', password:'right12', failed_attempts:0, locked_until:null }];
  const { page, errors } = await openApp(browser, server.url, seed);
  await enterNumber(page, '202100702');
  for(let i=1; i<=4; i++){
    await page.fill('#gatePass', `wrong${i}0`);
    await page.click('#gateGo');
    assert.match(await gateError(page), new RegExp(`${5-i} more tr`));
  }
  await page.fill('#gatePass', 'wrong50');
  await page.click('#gateGo');
  await page.waitForFunction(()=>/Too many wrong passwords/.test(document.querySelector('#gateError').textContent));
  await page.fill('#gatePass', 'right12');
  await page.click('#gateGo');
  await page.waitForFunction(()=>/Too many wrong passwords/.test(document.querySelector('#gateError').textContent) && !document.querySelector('#gateGo').disabled);
  assert.equal(await page.locator('#facSel').count(), 0, 'still locked out');
  assert.deepEqual(errors, []);
});

test('a campus admin resets a password: the student is signed out and chooses a new one', async ()=>{
  const seed = v4Seed();
  seed.tables.students = [{ id:'202100703', name:'Forgetful', campus_id:'kwaluseni', module_ids:['k1'], semester_version:1, history:[] }];
  seed.tables.student_credentials = [{ student_id:'202100703', password:'forgot1', failed_attempts:0, locked_until:null }];
  const { page, errors } = await openApp(browser, server.url, seed, { localStorage: signedInAs(seed, '202100703') });
  await page.waitForSelector('table.grid .cell-mod');

  await page.click('#tab-staff');
  await page.fill('#adminEmail', 'kadmin@test.local');
  await page.fill('#adminPass', 'secret');
  await page.click('#adminGoBtn');
  await page.click('[data-t="students"]');
  await page.waitForSelector('[data-reset="202100703"]');
  assert.match(await page.textContent('#stuRows'), /Forgetful/, 'admins still read the students table');
  page.once('dialog', d=>d.accept());
  await page.click('[data-reset="202100703"]');
  await page.waitForFunction(()=>!window.__FAKE_TABLES__.student_credentials.length && !window.__FAKE_TABLES__.student_sessions.length);

  // Back on the student's side, the next save finds the device signed out.
  await page.click('#tab-student');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'MAT111' }).locator('input').click(); // the page turns into sign-in, so not check()
  await page.waitForSelector('#gateId');
  assert.match(await page.textContent('.warnbox'), /signed out, perhaps because your password was reset/);
  await enterNumber(page, '202100703');
  assert.match(await page.textContent('#main'), /has no password yet/);
  await page.fill('#gatePass', 'newpass1');
  await page.fill('#gatePass2', 'newpass1');
  await page.click('#gateGo');
  await page.waitForSelector('table.grid .cell-mod');
  assert.match(await page.textContent('table.grid'), /CSC111/);
  assert.deepEqual(errors, []);
});

test('offline, a signed-in student still opens and changes their timetable; signing in again needs a connection', async ()=>{
  const seed = v4Seed();
  seed.tables.students = [{ id:'202100704', name:'Offline', campus_id:'kwaluseni', module_ids:['k1'], semester_version:1, history:[] }];
  seed.tables.student_credentials = [{ student_id:'202100704', password:'offline1', failed_attempts:0, locked_until:null }];
  const { page, context, errors } = await openApp(browser, server.url, seed, { localStorage: signedInAs(seed, '202100704') });
  await page.waitForSelector('table.grid .cell-mod');
  await page.waitForFunction(()=>new Promise(r=>{ const q = indexedDB.open('uneswa-timetable'); q.onsuccess = ()=>{
    const g = q.result.transaction('kv').objectStore('kv').get('student:202100704'); g.onsuccess = ()=>r(!!g.result); }; }));

  await context.addInitScript(()=>{ window.__FAKE_DB__.failNetwork = true; });
  await page.reload();
  await page.waitForSelector('table.grid .cell-mod');
  await page.selectOption('#facSel', ids.FAC_SCI);
  await page.selectOption('#progSel', ids.BSC_CS);
  await page.locator('#modList .modrow', { hasText:'MAT111' }).locator('input').check();
  await page.waitForFunction(()=>document.querySelector('#semesterLabel').textContent.includes('1 change waiting to sync'));

  await page.evaluate(()=>{ window.__FAKE_DB__.failNetwork = false; window.dispatchEvent(new Event('online')); });
  await page.waitForFunction(()=>window.__FAKE_TABLES__.students.find(s=>s.id==='202100704').module_ids.includes('k4'));

  await page.evaluate(()=>{ window.__FAKE_DB__.failNetwork = true; window.dispatchEvent(new Event('offline')); });
  await page.click('#switchStudentBtn');
  await page.waitForSelector('#gateId');
  await page.fill('#gateId', '202100704');
  await page.click('#gateGo');
  assert.match(await gateError(page), /offline\. Connect to the internet to sign in/);
  assert.deepEqual(errors.filter(e=>!/Failed to fetch|fetchAllRows/.test(e)), []);
});
