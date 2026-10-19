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

/** Loads everything from Supabase, sending any changes made offline first. Throws when the server can't be reached.
    With `behind` set, the page is already showing the saved copy and the student may have
    acted meanwhile: their record is only replaced if they are still on it and haven't changed it since. */
async function connect(studentId, { behind = false } = {}){
  await detectCapabilities();
  if(state.caps.campuses && !state.campuses.some(c=>c.id===state.campusId)) state.campusId = DEFAULT_CAMPUS;
  await flushOutbox(sb);
  let student = studentId ? await fetchStudent(studentId) : null;
  if(behind){
    const local = state.currentStudent;
    if(state.currentStudentId !== studentId) student = null;
    else if(student && local && (local.updated_at||'') > (student.updated_at||'')) student = local;
  }
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

/** What the page shows, to tell whether a sync changed anything. */
function shownData(){
  const { caps, campusId, campuses, meta, faculties, programmes, modules, exams, notices, announcements, currentStudent, staff, resetNotice } = state;
  return JSON.stringify({ caps, campusId, campuses, meta, faculties, programmes, modules, exams, notices, announcements, currentStudent, staff, resetNotice });
}

// Last time the student touched, typed or scrolled.
let lastInput = 0;
for(const t of ['pointerdown','keydown','input','focusin','scroll','wheel','touchstart']){
  window.addEventListener(t, ()=>{ lastInput = Date.now(); }, { capture:true, passive:true });
}
const IDLE_MS = 1500;
const TYPING = /^(textarea|select)$|^input:(text|search|number|email|password|tel|url|date|time)$/;
function typingInMain(){
  const el = document.activeElement;
  if(!el || !el.closest('#main')) return false;
  return TYPING.test(el.tagName.toLowerCase() + (el.tagName === 'INPUT' ? ':' + (el.type || 'text') : ''));
}

/** Redraws after a background sync without pulling the page from under the student:
    waits until they have stopped tapping, typing and scrolling and are not in a text
    field, then keeps the scroll position. A tap in progress is never lost to a redraw. */
function redrawWhenIdle(){
  if(Date.now() - lastInput < IDLE_MS || typingInMain()){ setTimeout(redrawWhenIdle, 500); return; }
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

const savedOn = at=>new Date(at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });

/* Init */
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
  const show = ()=>{
    render();
    hideSplash();
    startReminders();
    document.dispatchEvent(new CustomEvent('timetable:changed'));
  };

  // Open straight away on the copy saved on this device, and sync behind it.
  const savedAt = await restoreSnapshot(lastId).catch(err=>{ console.error(err); return null; });
  if(savedAt){
    state.offline = false; state.syncing = true;
    state.pendingSync = (await pendingStudents()).length;
    show();
    const before = shownData();
    try{
      await connect(lastId, { behind:true });
      state.syncing = false;
      if(shownData() !== before) redrawWhenIdle(); else renderStatus();
      document.dispatchEvent(new CustomEvent('timetable:changed'));
    }catch(err){
      console.error(err);
      state.syncing = false; state.offline = true;
      renderStatus();
      toast(`You're offline. Showing your timetable saved ${savedOn(savedAt)}.`);
    }
    return;
  }

  // Nothing saved on this device yet: wait for the server.
  try{
    await connect(lastId);
  }catch(err){
    console.error(err);
    state.offline = true;
    state.pendingSync = (await pendingStudents()).length;
    toast('Could not reach the timetable server. Check your connection and reload.');
  }
  show();
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
