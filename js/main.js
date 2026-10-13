import { DEFAULT_CAMPUS } from './config.js';
import { checkSemesterReset, detectCapabilities, fetchStudent, loadAll, loadStaff, saveStudent, sb, scheduleRefresh, subscribeRealtime } from './db.js';
import { render, renderStatus, setTab } from './render.js';
import { state } from './state.js';
import { startReminders } from './reminders.js';
import { restoreSnapshot, saveSnapshot } from './cache.js';
import { flushOutbox, pendingStudents } from './sync.js';
import { hideSplash, initShell, initWebApp } from './platform.js';
import { toast } from './util.js';

function readLocal(key){ try{ return localStorage.getItem(key); }catch{ return null; } }

/** Loads everything from Supabase, sending any changes made offline first. Throws when the server can't be reached. */
async function connect(studentId){
  await detectCapabilities();
  if(state.caps.campuses && !state.campuses.some(c=>c.id===state.campusId)) state.campusId = DEFAULT_CAMPUS;
  await flushOutbox(sb);
  const student = studentId ? await fetchStudent(studentId) : null;
  if(student && state.caps.campuses && student.campus_id) state.campusId = student.campus_id;
  await loadAll();
  if(student){
    state.currentStudentId = studentId; state.currentStudent = student;
    const wasReset = checkSemesterReset(student);
    if(wasReset){ await saveStudent(student); state.resetNotice = true; }
  }
  const { data: sess } = await sb.auth.getSession();
  if(sess && sess.session) await loadStaff(sess.session);
  state.offline = false;
  subscribeRealtime();
}

/* ================= INIT ================= */
(async function init(){
  await initShell({
    // Android back button: return to My Timetable before leaving the app.
    onBack: ()=>{ if(state.tab !== 'student'){ setTab('student'); return true; } return false; },
    onResume: ()=>state.offline ? reconnect() : scheduleRefresh(0),
  });
  initWebApp();
  if(!sb){ render(); hideSplash(); return; }
  const savedNotif = readLocal('uneswa_notif');
  if(savedNotif){ try{ state.notif = JSON.parse(savedNotif); }catch{} }
  state.campusId = readLocal('uneswa_campus') || DEFAULT_CAMPUS;
  const lastId = readLocal('uneswa_last_student');

  try{
    await connect(lastId);
  }catch(err){
    console.error(err);
    const savedAt = await restoreSnapshot(lastId);
    state.offline = true;
    state.pendingSync = (await pendingStudents()).length;
    toast(savedAt
      ? `You're offline. Showing your timetable saved ${new Date(savedAt).toLocaleString()}.`
      : 'Could not reach the timetable server. Check your connection and reload.');
  }
  render();
  hideSplash();
  startReminders();
  document.dispatchEvent(new CustomEvent('timetable:changed'));
})();

/** Back online: send queued changes, reload everything, and say so. */
let reconnecting = false;
async function reconnect(){
  if(reconnecting || !sb) return;
  reconnecting = true;
  try{
    const queued = state.pendingSync;
    await connect(state.currentStudentId || readLocal('uneswa_last_student'));
    toast(queued ? "You're back online. Your changes are synced." : "You're back online.");
    render();
    document.dispatchEvent(new CustomEvent('timetable:changed'));
  }catch(err){ console.warn('Still offline', err); }
  finally{ reconnecting = false; }
}

window.addEventListener('online', reconnect);
window.addEventListener('offline', ()=>{ state.offline = true; renderStatus(); });

document.addEventListener('timetable:changed', ()=>{
  try{ localStorage.setItem('uneswa_campus', state.campusId); }catch{}
  renderStatus();
  saveSnapshot(); // the campus copy is only rewritten after a fresh load
});
