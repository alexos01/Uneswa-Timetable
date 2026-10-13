/* Service worker for the web app (not used inside the Android/iOS shell).
   It keeps a copy of every file the app needs, so the site can be installed from
   the browser and opens with no connection. Timetable data is not cached here:
   js/cache.js keeps that on the device.

   App files are fetched from the network first, so a deploy reaches students on
   their next visit, and fall back to the copy when the network is slow or gone.
   Add any new file under js/, css/, vendor/ or icons/ to APP_FILES:
   tests/unit/sw.test.mjs fails until you do. */
const CACHE = 'uneswa-app-v1';
const FONT_CACHE = 'uneswa-fonts-v1';
const NETWORK_TIMEOUT_MS = 4000;

const APP_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/ai-import.js',
  'js/cache.js',
  'js/config.js',
  'js/db.js',
  'js/lib/announcements.js',
  'js/lib/modules.js',
  'js/lib/notices.js',
  'js/lib/reminders.js',
  'js/main.js',
  'js/pdf.js',
  'js/platform.js',
  'js/push.js',
  'js/reminders.js',
  'js/render.js',
  'js/state.js',
  'js/store.js',
  'js/sync.js',
  'js/util.js',
  'js/views/admin-entries.js',
  'js/views/admin-notices.js',
  'js/views/admin-settings.js',
  'js/views/admin-staff.js',
  'js/views/admin-students.js',
  'js/views/admin.js',
  'js/views/announcements.js',
  'js/views/footer.js',
  'js/views/lecturer.js',
  'js/views/notices.js',
  'js/views/rep.js',
  'js/views/staff.js',
  'js/views/student.js',
  'vendor/capacitor-core.js',
  'vendor/jspdf.plugin.autotable.min.js',
  'vendor/jspdf.umd.min.js',
  'vendor/supabase.js',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_FILES)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate', event=>{
  event.waitUntil((async ()=>{
    const keep = new Set([CACHE, FONT_CACHE]);
    for(const name of await caches.keys()) if(!keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event=>{
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.origin === self.location.origin) event.respondWith(networkFirst(req));
  else if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(req, FONT_CACHE));
  // Supabase and everything else goes straight to the network.
});

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  const network = fetch(req).then(res=>{
    if(res.ok) cache.put(req, res.clone());
    return res;
  });
  const timeout = new Promise(resolve=>setTimeout(resolve, NETWORK_TIMEOUT_MS));
  try{
    const res = await Promise.race([network, timeout]);
    if(res) return res;
  }catch{}
  const cached = await cache.match(req, { ignoreSearch:true })
    || (req.mode === 'navigate' ? await cache.match('index.html') : null);
  return cached || network;
}

async function cacheFirst(req, name){
  const cache = await caches.open(name);
  const cached = await cache.match(req);
  if(cached) return cached;
  const res = await fetch(req);
  if(res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

// Web Push from the send-push Edge Function: { title, body, tag }.
self.addEventListener('push', event=>{
  let data = {};
  try{ data = event.data ? event.data.json() : {}; }catch{ data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'UNESWA Timetable', {
    body: data.body || '', tag: data.tag, icon:'icons/icon-192.png', badge:'icons/favicon-32.png',
  }));
});

// Tapping a notification brings the app forward, or opens it.
self.addEventListener('notificationclick', event=>{
  event.notification.close();
  event.waitUntil((async ()=>{
    const open = (await self.clients.matchAll({ type:'window', includeUncontrolled:true })).find(c=>'focus' in c);
    return open ? open.focus() : self.clients.openWindow('./');
  })());
});
