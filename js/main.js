import { DEFAULT_CAMPUS } from './config.js';
import { checkSemesterReset, detectCapabilities, fetchStudent, loadAll, loadStaff, saveStudent, sb, subscribeRealtime } from './db.js';
import { render } from './render.js';
import { state } from './state.js';
import { startWebReminders } from './reminders.js';
import { toast } from './util.js';

function readLocal(key){ try{ return localStorage.getItem(key); }catch{ return null; } }

/* ================= INIT ================= */
(async function init(){
  if(!sb){ render(); return; }
  const savedNotif = readLocal('uneswa_notif');
  if(savedNotif){ try{ state.notif = JSON.parse(savedNotif); }catch{} }
  state.campusId = readLocal('uneswa_campus') || DEFAULT_CAMPUS;

  try{
    await detectCapabilities();
    if(state.caps.campuses && !state.campuses.some(c=>c.id===state.campusId)) state.campusId = DEFAULT_CAMPUS;

    const lastId = readLocal('uneswa_last_student');
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
    toast('Could not reach the timetable server. Check your connection and reload.');
  }
  render();
  startWebReminders();
  document.dispatchEvent(new CustomEvent('timetable:changed'));
})();

// Remember the campus so the next visit opens on it.
document.addEventListener('timetable:changed', ()=>{ try{ localStorage.setItem('uneswa_campus', state.campusId); }catch{} });
