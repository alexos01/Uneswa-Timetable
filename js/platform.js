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
