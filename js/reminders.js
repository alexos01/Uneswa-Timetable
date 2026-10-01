import { state } from './state.js';
import { myModules } from './views/student.js';
import { isNative, replaceScheduledReminders } from './platform.js';
import { planReminders } from './lib/reminders.js';
import { upcomingNotices } from './lib/notices.js';

/* Class reminders.
   Native app: whenever the timetable, notices or reminder settings change, every
   pending notification is replaced with a fresh plan, so reminders fire even when
   the app is closed. Browser: a 30-second check while the page is open. */
export function startReminders(){
  if(isNative){
    let t = null;
    document.addEventListener('timetable:changed', ()=>{ clearTimeout(t); t = setTimeout(syncNativeReminders, 400); });
    syncNativeReminders();
  } else {
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
        const key='notified-'+m.id+'-'+now.toDateString();
        if(sessionStorage.getItem(key)) return;
        sessionStorage.setItem(key,'1');
        new Notification(`${m.code} starts in ${state.notif.minutesBefore} min`, { body:`${m.venue||'Venue TBC'} · ${m.start_time}-${m.end_time||''}` });
      }
    });
  }, 30000);
}
