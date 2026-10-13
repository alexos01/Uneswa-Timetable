import { state } from './state.js';
import { myModules } from './views/student.js';
import { isNative, replaceScheduledReminders, showNow } from './platform.js';
import { planReminders, reminderId } from './lib/reminders.js';
import { CHANGE_KINDS, changeAlert, localIsoDate, unseenChanges, upcomingNotices } from './lib/notices.js';
import { syncPush } from './push.js';

/* Class reminders.
   Native app: whenever the timetable, notices or reminder settings change, every
   pending notification is replaced with a fresh plan, so reminders fire even when
   the app is closed. Browser: a 30-second check while the page is open. */
export function startReminders(){
  document.addEventListener('timetable:changed', ()=>alertNewChanges().catch(err=>console.warn('Change alert failed', err)));
  if(isNative){
    let t = null;
    document.addEventListener('timetable:changed', ()=>{ clearTimeout(t); t = setTimeout(syncNativeReminders, 400); });
    syncNativeReminders();
  } else {
    let t = null;
    document.addEventListener('timetable:changed', ()=>{ clearTimeout(t); t = setTimeout(()=>syncPush().catch(err=>console.warn('Push not set up', err)), 400); });
    startWebReminders();
  }
}

export function currentPlan(now = new Date()){
  const student = state.currentStudent;
  if(!student || !state.notif.enabled) return [];
  const sessions = myModules(student);
  const codes = [...new Set(sessions.map(s=>s.code))];
  return planReminders({ sessions, notices: upcomingNotices(state.notices, codes), minutesBefore: state.notif.minutesBefore, now });
}

async function syncNativeReminders(){
  try{ await replaceScheduledReminders(currentPlan()); }
  catch(err){ console.error('Could not schedule reminders', err); }
}

/* Alerts for late, cancelled and moved classes that arrive while the app is open
   (realtime reload). The ids already seen are kept on the device; on the very
   first run they are only recorded, so opening the app doesn't replay old ones. */
const SEEN_KEY = 'uneswa_seen_changes';
async function alertNewChanges(){
  const student = state.currentStudent;
  if(!student || !state.caps.notices) return;
  const codes = [...new Set(myModules(student).map(m=>m.code))];
  let seen = null;
  try{ seen = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); }catch{}
  const fresh = unseenChanges(state.notices, codes, seen || []);
  const current = state.notices.filter(n=>CHANGE_KINDS.includes(n.kind)).map(n=>n.id);
  try{ localStorage.setItem(SEEN_KEY, JSON.stringify(current)); }catch{}
  if(!seen || !state.notif.enabled) return;
  for(const n of fresh){
    const { title, body } = changeAlert(n);
    await showNow({ id: reminderId('change|'+n.id), title, body, tag: 'notice-'+n.id });
  }
}

function startWebReminders(){
  setInterval(()=>{
    const student = state.currentStudent;
    if(!student || !state.notif.enabled || !('Notification' in window) || Notification.permission!=='granted') return;
    const now=new Date(); const dayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const today=dayNames[now.getDay()]; const nowMin=now.getHours()*60+now.getMinutes();
    myModules(student).forEach(m=>{
      if(m.day!==today) return;
      const [h,mi]=m.start_time.split(':').map(Number); const startMin=h*60+mi;
      if(startMin-nowMin===state.notif.minutesBefore){
        const key=`class-${m.id}-${localIsoDate(now)}`; // same tag as the push reminder, so only one shows
        if(sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key,'1');
        showNow({ id: reminderId(key), title:`${m.code} starts in ${state.notif.minutesBefore} min`, body:`${m.venue||'Venue TBC'} · ${m.start_time}-${m.end_time||''}`, tag:key });
      }
    });
  }, 30000);
}
