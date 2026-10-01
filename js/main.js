import { checkSemesterReset, fetchStudent, loadAll, saveStudent, sb, subscribeRealtime } from './db.js';
import { render, setTab } from './render.js';
import { state } from './state.js';
import { startWebReminders } from './reminders.js';

document.getElementById('tabStudentBtn').onclick = ()=>setTab('student');
document.getElementById('tabAdminBtn').onclick = ()=>setTab('admin');

/* ================= INIT ================= */
(async function init(){
  if(!sb){ render(); return; }
  await loadAll();
  subscribeRealtime();
  const { data: sess } = await sb.auth.getSession();
  if(sess && sess.session){ state.isAdmin = true; state.adminSession = sess.session; }
  const savedNotif = localStorage.getItem('uneswa_notif');
  if(savedNotif) state.notif = JSON.parse(savedNotif);
  const lastId = localStorage.getItem('uneswa_last_student');
  if(lastId){
    const student = await fetchStudent(lastId);
    if(student){
      state.currentStudentId = lastId; state.currentStudent = student;
      const wasReset = checkSemesterReset(student);
      if(wasReset){ await saveStudent(student); state.resetNotice = true; }
    }
  }
  render();
  startWebReminders();
})();
