// Runs the real send-push Edge Function under Deno against a stand-in for the
// Supabase REST API and a stand-in push service, then decrypts what it sent
// (RFC 8291, aes128gcm) to check the notification text. Needs Deno and openssl.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const b64u = buf=>Buffer.from(buf).toString('base64url');
const SECRET = 'test-secret';

// A browser's push keys, as PushSubscription.toJSON() would give them.
function browserKeys(){
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  return { ecdh, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(randomBytes(16)) };
}

function decrypt(body, { ecdh, auth }){
  const salt = body.subarray(0, 16), idlen = body[20], serverKey = body.subarray(21, 21 + idlen);
  const data = body.subarray(21 + idlen);
  const secret = ecdh.computeSecret(serverKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, Buffer.from(auth, 'base64url'), info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  let end = plain.length - 1; while(plain[end] === 0) end--; // strip padding, then the 0x02 delimiter
  return JSON.parse(plain.subarray(0, end).toString());
}

function eswatiniNow(addMinutes = 0){
  const d = new Date(Date.now() + addMinutes*60000);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone:'Africa/Mbabane', weekday:'long', hour:'2-digit', minute:'2-digit', year:'numeric', month:'2-digit', day:'2-digit', hourCycle:'h23' }).formatToParts(d).map(x=>[x.type, x.value]));
  return { day: p.weekday, time: `${p.hour}:${p.minute}`, iso: `${p.year}-${p.month}-${p.day}` };
}

// web-push only speaks HTTPS, so the push service gets a throwaway certificate that the function trusts.
function selfSignedCert(){
  const dir = mkdtempSync(join(tmpdir(), 'send-push-test-'));
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem')], { stdio:'ignore' });
  return { dir, key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

let mock, pushService, fn, base, pushBase, pushes, deleted;
const alive = browserKeys(), gone = browserKeys();
let subs, modules, notices;

before(async ()=>{
  pushes = []; deleted = [];
  const tls = selfSignedCert();
  pushService = createHttpsServer({ key: tls.key, cert: tls.cert }, (req, res)=>{
    const chunks = [];
    req.on('data', c=>chunks.push(c));
    req.on('end', ()=>{
      const who = new URL(req.url, 'https://x').pathname.split('/')[2];
      pushes.push({ who, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(who === 'gone' ? 410 : 201); res.end();
    });
  });
  await new Promise(r=>pushService.listen(0, r));
  pushBase = `https://localhost:${pushService.address().port}`;
  mock = createServer((req, res)=>{
    const chunks = [];
    req.on('data', c=>chunks.push(c));
    req.on('end', ()=>{
      const url = new URL(req.url, 'http://x');
      const json = v=>{ res.writeHead(200, { 'Content-Type':'application/json' }); res.end(JSON.stringify(v)); };
      if(url.pathname === '/rest/v1/push_subscriptions' && req.method === 'DELETE'){ deleted.push(url.searchParams.get('endpoint')); json([]); return; }
      if(url.pathname === '/rest/v1/push_subscriptions') return json(subs);
      if(url.pathname === '/rest/v1/modules') return json(modules);
      if(url.pathname === '/rest/v1/class_notices') return json(notices);
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r=>mock.listen(0, r));
  base = `http://localhost:${mock.address().port}`;
  subs = [
    { endpoint:`${pushBase}/push/alive`, p256dh: alive.p256dh, auth: alive.auth, campus_id:'kwaluseni', codes:['CSC111'], module_ids:['now10','now11'], minutes_before:10, reminders:true },
    { endpoint:`${pushBase}/push/gone`, p256dh: gone.p256dh, auth: gone.auth, campus_id:'kwaluseni', codes:['CSC111'], module_ids:[], minutes_before:10, reminders:true },
  ];

  const vapid = createECDH('prime256v1'); vapid.generateKeys();
  const port = 18000 + Math.floor(Math.random()*1000);
  fn = spawn('deno', ['run', '--allow-net', '--allow-env', '--allow-read', '--allow-sys', '--config', 'supabase/functions/send-push/deno.json', 'supabase/functions/send-push/index.ts'], {
    cwd: root, stdio:['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_EXTRA_CA_CERTS: join(tls.dir, 'cert.pem'), DENO_SERVE_ADDRESS:`tcp:127.0.0.1:${port}`, SUPABASE_URL: base, SUPABASE_SERVICE_ROLE_KEY:'service-key',
      VAPID_SUBJECT:'mailto:test@example.com', VAPID_PUBLIC_KEY: b64u(vapid.getPublicKey()), VAPID_PRIVATE_KEY: b64u(vapid.getPrivateKey()),
      PUSH_WEBHOOK_SECRET: SECRET },
  });
  fn.stderr.on('data', d=>process.env.DEBUG && process.stderr.write(d));
  fn.url = `http://127.0.0.1:${port}/`;
  for(let i=0; i<300; i++){
    try{ await fetch(fn.url); break; }catch{ await new Promise(r=>setTimeout(r, 200)); }
  }
});
after(async ()=>{ fn?.kill(); await new Promise(r=>mock?.close(r)); await new Promise(r=>pushService?.close(r)); });

const call = (body, secret = SECRET)=>fetch(fn.url, { method:'POST', headers:{ 'Content-Type':'application/json', 'x-push-secret': secret }, body: JSON.stringify(body) });

test('refuses calls without the shared secret', async ()=>{
  assert.equal((await call({ type:'tick' }, 'wrong')).status, 401);
});

test('a new late notice is pushed, encrypted, and a gone subscription is removed', async ()=>{
  pushes.length = 0; deleted.length = 0;
  const res = await call({ type:'INSERT', table:'class_notices', record:{ id:'n1', campus_id:'kwaluseni', code:'CSC111', kind:'late', notice_date: eswatiniNow().iso, start_time:'08:00', delay_minutes:15, venue:'G.005' } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sent:1, removed:1, failed:0 });
  const p = pushes.find(x=>x.who === 'alive');
  assert.equal(p.headers['content-encoding'], 'aes128gcm');
  assert.match(p.headers.authorization, /^vapid t=.+, k=.+/);
  assert.deepEqual(decrypt(p.body, alive), { title:'CSC111 today 08:00: running 15 min late', body:'G.005', tag:'notice-n1' });
  assert.deepEqual(deleted, [`eq.${pushBase}/push/gone`]);
});

test('the minute tick sends the class reminder that is due now', async ()=>{
  pushes.length = 0;
  // Two sessions, 10 and 11 minutes from now, so one is due whichever minute the tick lands in.
  const a = eswatiniNow(10), b = eswatiniNow(11);
  modules = [
    { id:'now10', code:'CSC111', day:a.day, start_time:a.time, end_time:null, venue:'SC.LEC.TH.I' },
    { id:'now11', code:'CSC111', day:b.day, start_time:b.time, end_time:null, venue:'SC.LEC.TH.I' },
  ];
  notices = [];
  const res = await call({ type:'tick' });
  assert.equal(res.status, 200);
  const got = pushes.filter(x=>x.who === 'alive').map(x=>decrypt(x.body, alive));
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'CSC111 starts in 10 min');
  assert.match(got[0].tag, /^class-now1[01]-\d{4}-\d{2}-\d{2}$/);
});

test('a notice for one course is pushed only to students taking the module on that course', async ()=>{
  const record = { id:'n2', campus_id:'kwaluseni', code:'CSC111', kind:'test', notice_date: eswatiniNow().iso, start_time:'14:00', venue:'MPH', title:'Test 1', programme_id:'prog-bsc' };
  pushes.length = 0;
  modules = [{ id:'now10', code:'CSC111', programme_id:'prog-bed' }, { id:'other', code:'CSC111', programme_id:'prog-bsc' }];
  let res = await call({ type:'INSERT', table:'class_notices', record });
  assert.deepEqual(await res.json(), { sent:0, removed:0, failed:0 }, 'the subscriber takes CSC111 on B.Ed., not B.Sc.');

  modules = [{ id:'now10', code:'CSC111', programme_id:'prog-bsc' }];
  res = await call({ type:'INSERT', table:'class_notices', record });
  assert.deepEqual(await res.json(), { sent:1, removed:0, failed:0 });
  assert.equal(decrypt(pushes.find(x=>x.who === 'alive').body, alive).title, 'CSC111 Test: Test 1');
});
