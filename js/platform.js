/* Platform adapter: the only place that knows whether we run in a browser or in the
   Capacitor shell on Android/iOS. Feature code calls these functions and never
   checks the platform itself. Native plugins are reached through registerPlugin()
   from the vendored @capacitor/core; on the web they are never called. */
import { Capacitor, registerPlugin } from '../vendor/capacitor-core.js';

export const isNative = Capacitor.isNativePlatform();
export const platformName = Capacitor.getPlatform(); // 'web' | 'android' | 'ios'

const LocalNotifications = registerPlugin('LocalNotifications');
const Filesystem = registerPlugin('Filesystem');
const Share = registerPlugin('Share');
const App = registerPlugin('App');
const StatusBar = registerPlugin('StatusBar');
const SplashScreen = registerPlugin('SplashScreen');

const CHANNEL_ID = 'class-reminders';

/** Status bar colour, Android back button, splash screen, resume refresh. */
export async function initShell({ onBack, onResume } = {}){
  if(!isNative) return;
  document.documentElement.classList.add('native', `native-${platformName}`);
  try{
    await StatusBar.setStyle({ style: 'DARK' }); // light text on the dark green bar
    if(platformName === 'android') await StatusBar.setBackgroundColor({ color: '#1F3D2E' });
  }catch(err){ console.warn('StatusBar', err); }
  App.addListener('backButton', ({ canGoBack })=>{
    if(onBack && onBack()) return;          // the app handled it (e.g. left a sub-tab)
    if(canGoBack) window.history.back(); else App.minimizeApp();
  });
  App.addListener('resume', ()=>onResume && onResume());
  if(platformName === 'android'){
    try{
      await LocalNotifications.createChannel({ id: CHANNEL_ID, name: 'Class reminders',
        description: 'Reminders before your classes and tests', importance: 4, visibility: 1, vibration: true });
    }catch(err){ console.warn('createChannel', err); }
  }
}

/** Web only: registers the service worker (offline + install) and wires the
    "Install app" button, which shows once the browser offers to install. */
export function initWebApp(){
  if(isNative || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(err=>console.warn('Service worker not registered', err));
  const btn = document.getElementById('installBtn');
  if(!btn) return;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e=>{
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  window.addEventListener('appinstalled', ()=>{ deferred = null; btn.hidden = true; });
  btn.onclick = async ()=>{
    if(!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(()=>null);
    deferred = null; btn.hidden = true;
  };
}

export async function hideSplash(){
  if(isNative){ try{ await SplashScreen.hide(); }catch{} }
}

/** Saves a jsPDF document: a download on the web, the share sheet on a phone. */
export async function savePdf(doc, filename){
  if(!isNative){ doc.save(filename); return 'downloaded'; }
  const data = doc.output('datauristring').split(',')[1];
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
  await Share.share({ title: filename, files: [uri], dialogTitle: 'Save or share your timetable' });
  return 'shared';
}

/* ---------------- notifications ---------------- */
export async function requestNotificationPermission(){
  if(!isNative){
    if(!('Notification' in window)) return false;
    return (await Notification.requestPermission()) === 'granted';
  }
  let { display } = await LocalNotifications.checkPermissions();
  if(display !== 'granted') ({ display } = await LocalNotifications.requestPermissions());
  return display === 'granted';
}

/** Shows a notification now. `tag` stops the same alert showing twice (for example
    from the open page and from a push message). */
export async function showNow({ id, title, body, tag }){
  if(isNative){
    await LocalNotifications.schedule({ notifications:[{ id, title, body, channelId: CHANNEL_ID }] });
    return;
  }
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
  // Chrome on Android only allows notifications through the service worker.
  if(reg) await reg.showNotification(title, { body, tag, icon:'icons/icon-192.png', badge:'icons/favicon-32.png' });
  else new Notification(title, { body, tag, icon:'icons/icon-192.png' });
}

/** Replaces every pending reminder with `plan` (from lib/reminders.js planReminders). */
export async function replaceScheduledReminders(plan){
  if(!isNative) return false;
  const { notifications: pending } = await LocalNotifications.getPending();
  if(pending.length) await LocalNotifications.cancel({ notifications: pending.map(n=>({ id: n.id })) });
  if(!plan.length) return true;
  await LocalNotifications.schedule({
    notifications: plan.map(r=>({
      id: r.id, title: r.title, body: r.body, channelId: CHANNEL_ID,
      schedule: r.at
        ? { at: r.at, allowWhileIdle: true }
        : { on: { weekday: r.weekday, hour: r.hour, minute: r.minute }, allowWhileIdle: true },
    })),
  });
  return true;
}
