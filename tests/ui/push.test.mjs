import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launch, openApp, tables } from './helpers.mjs';
import { v3Seed } from './fixtures.mjs';

let server, browser;
before(async ()=>{ server = await startServer(); browser = await launch(); });
after(async ()=>{ await browser?.close(); await server?.close(); });

// The tests set the push key themselves, whatever js/config.js ships with.
function pushKey(key){
  return async ({ context })=>{
    await context.route('**/js/config.js', async route=>{
      const res = await route.fetch();
      route.fulfill({ response: res, body: (await res.text()).replace(/PUSH_PUBLIC_KEY = "[^"]*"/, `PUSH_PUBLIC_KEY = "${key}"`) });
    });
  };
}
const withPushKey = pushKey('BPushTestKey');

// A stand-in for the browser's push service, which needs Google's servers.
function fakePushService(){
  window.__push = { subscribed:false, unsubscribed:false };
  const sub = {
    endpoint:'https://push.test/endpoint-1',
    toJSON(){ return { endpoint:this.endpoint, keys:{ p256dh:'P256', auth:'AUTH' } }; },
    async unsubscribe(){ window.__push.unsubscribed = true; current = null; return true; },
  };
  let current = null;
  const reg = {
    pushManager:{ getSubscription: async ()=>current, subscribe: async ()=>{ window.__push.subscribed = true; current = sub; return sub; } },
    showNotification: async ()=>{},
  };
  Object.defineProperty(navigator.serviceWorker, 'getRegistration', { value: async ()=>reg });
  Object.defineProperty(navigator.serviceWorker, 'register', { value: async ()=>reg });
  window.PushManager = window.PushManager || function(){};
  window.Notification = class { constructor(){} };
  window.Notification.permission = 'granted';
  window.Notification.requestPermission = ()=>Promise.resolve('granted');
}

function seedStudent(){
  const seed = v3Seed();
  seed.tables.students = [{ id:'202100200', name:'Push Student', campus_id:'kwaluseni', module_ids:['k1','k2','k3'], semester_version:1, history:[] }];
  return seed;
}

test('turning reminders on subscribes this browser with the student\'s sessions; off removes it', async ()=>{
  const { page, errors } = await openApp(browser, server.url, seedStudent(), {
    initScript: fakePushService, beforeLoad: withPushKey,
    localStorage:{ uneswa_last_student:'202100200' },
  });
  await page.waitForSelector('#notifToggle');
  assert.match(await page.textContent('#main'), /arrive even when this page is closed/);
  await page.check('#notifToggle');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.push_subscriptions.length === 1);
  const [sub] = (await tables(page)).push_subscriptions;
  assert.equal(sub.endpoint, 'https://push.test/endpoint-1');
  assert.deepEqual(sub.codes, ['CSC111','CSC211']);
  assert.deepEqual(sub.module_ids, ['k1','k2','k3']);
  assert.equal(sub.campus_id, 'kwaluseni');
  assert.equal(sub.minutes_before, 10);

  await page.click('[data-mins="30"]');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.push_subscriptions[0]?.minutes_before === 30);
  await page.fill('#notifMins', '45');
  await page.press('#notifMins', 'Enter');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.push_subscriptions[0]?.minutes_before === 45);
  await page.fill('#notifMins', '500');
  await page.press('#notifMins', 'Enter');
  await page.waitForFunction(()=>document.querySelector('#notifMins').value === '45');
  assert.match(await page.textContent('#toast'), /between 1 and 120/);
  assert.equal(JSON.parse(await page.evaluate(()=>localStorage.getItem('uneswa_notif'))).minutesBefore, 45);

  await page.uncheck('#notifToggle');
  await page.waitForFunction(()=>window.__FAKE_TABLES__.push_subscriptions.length === 0);
  assert.equal(await page.evaluate(()=>window.__push.unsubscribed), true);
  assert.deepEqual(errors, []);
});

test('without a push key the browser is not subscribed', async ()=>{
  const seed = seedStudent();
  const { page, errors } = await openApp(browser, server.url, seed, {
    initScript: fakePushService, beforeLoad: pushKey(''),
    localStorage:{ uneswa_last_student:'202100200', uneswa_notif: JSON.stringify({ enabled:true, minutesBefore:10 }) },
  });
  await page.waitForSelector('#notifToggle');
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(()=>window.__push.subscribed), false);
  assert.match(await page.textContent('#main'), /only arrive while this page is open/);
  assert.deepEqual(errors, []);
});

test('the service worker shows a pushed message as a notification', async ()=>{
  const { page, context, errors } = await openApp(browser, server.url, v3Seed(), { serviceWorkers:'allow' });
  await context.grantPermissions(['notifications'], { origin: server.url.replace(/\/$/, '') });
  await page.evaluate(()=>navigator.serviceWorker.ready);
  const cdp = await context.newCDPSession(page);
  const registered = new Promise(resolve=>cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations })=>{
    const r = registrations.find(x=>!x.isDeleted); if(r) resolve(r.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  const registrationId = await registered;
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: server.url.replace(/\/$/, ''), registrationId,
    data: JSON.stringify({ title:'CSC111 today 08:00: cancelled', body:'MPH', tag:'notice-x' }),
  });
  const list = ()=>page.evaluate(async ()=>(await (await navigator.serviceWorker.ready).getNotifications()).map(n=>({ title:n.title, body:n.body, tag:n.tag })));
  let shown = [];
  for(let i=0; i<50 && !shown.length; i++){ shown = await list(); if(!shown.length) await page.waitForTimeout(100); }
  assert.deepEqual(shown, [{ title:'CSC111 today 08:00: cancelled', body:'MPH', tag:'notice-x' }]);
  assert.deepEqual(errors, []);
});
