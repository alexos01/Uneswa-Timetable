import { DEFAULT_CAMPUS } from './config.js';
import { checkSemesterReset, detectCapabilities, fetchStudent, loadAll, loadStaff, saveStudent, sb, scheduleRefresh, subscribeRealtime } from './db.js';
import { render, setTab } from './render.js';
import { state } from './state.js';
import { startReminders } from './reminders.js';
import { restoreSnapshot, saveSnapshot } from './cache.js';
import { hideSplash, initShell } from './platform.js';
import { toast } from './util.js';

function readLocal(key){ try{ return localStorage.getItem(key); }catch{ return null; } }

/* ================= INIT ================= */
(async function init(){
  await initShell({
    // Android back button: return to My Timetable before leaving the app.
    onBack: ()=>{ if(state.tab !== 'student'){ setTab('student'); return true; } return false; },
    onResume: ()=>scheduleRefresh(0),
  });
  if(!sb){ render(); hideSplash(); return; }
  const savedNotif = readLocal('uneswa_notif');
  if(savedNotif){ try{ state.notif = JSON.parse(savedNotif); }catch{} }
  state.campusId = readLocal('uneswa_campus') || DEFAULT_CAMPUS;
  const lastId = readLocal('uneswa_last_student');

  try{
    await detectCapabilities();
    if(state.caps.campuses && !state.campuses.some(c=>c.id===state.campusId)) state.campusId = DEFAULT_CAMPUS;
    const student = lastId ? await fetchStudent(lastId) : null;
    if(student && state.caps.campuses && student.campus_id) state.campusId = student.campus_id;
    await loadAll();
    if(student){
      state.currentStudentId = lastId; state.currentStudent = student;
      const wasReset = checkSemesterReset(student);
      if(wasReset){ await saveStudent(student); state.resetNotice = true; }
    }
    const { data: sess } = await sb.auth.getSession();
    if(sess && sess.session) await loadStaff(sess.session);
    subscribeRealtime();
  }catch(err){
    console.error(err);
    const savedAt = restoreSnapshot(lastId);
    toast(savedAt
      ? `You're offline. Showing your timetable saved ${new Date(savedAt).toLocaleString()}.`
      : 'Could not reach the timetable server. Check your connection and reload.');
  }
  render();
  hideSplash();
  startReminders();
  document.dispatchEvent(new CustomEvent('timetable:changed'));
})();

document.addEventListener('timetable:changed', ()=>{
  try{ localStorage.setItem('uneswa_campus', state.campusId); }catch{}
  if(!state.offline) saveSnapshot();
});
