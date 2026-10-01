import { state } from './state.js';
import { myModules } from './views/student.js';

export function startWebReminders(){
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
