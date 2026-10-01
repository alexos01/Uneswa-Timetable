/* Offline snapshot of the signed-in student's own timetable.
   Saved after every successful load; used when the server can't be reached, so the
   app still opens on a phone with no signal. Holds only what that student needs. */
import { state } from './state.js';

const KEY = 'uneswa_snapshot_v1';

export function saveSnapshot(){
  const s = state.currentStudent;
  if(!s) return;
  const ids = new Set(s.module_ids || []);
  const modules = state.modules.filter(m=>ids.has(m.id));
  const codes = new Set(modules.map(m=>m.code));
  const progIds = new Set(modules.map(m=>m.programme_id));
  const snap = {
    savedAt: new Date().toISOString(),
    caps: state.caps, campuses: state.campuses, campusId: state.campusId, meta: state.meta,
    student: s, modules,
    exams: state.exams.filter(e=>codes.has(e.code)),
    notices: state.notices.filter(n=>codes.has(n.code)),
    announcements: state.announcements,
    programmes: state.programmes.filter(p=>progIds.has(p.id)),
    faculties: state.faculties,
  };
  try{ localStorage.setItem(KEY, JSON.stringify(snap)); }catch(err){ console.warn('snapshot not saved', err); }
}

/** Restores the snapshot into state. Returns its timestamp, or null if there is none. */
export function restoreSnapshot(studentId){
  let snap = null;
  try{ snap = JSON.parse(localStorage.getItem(KEY) || 'null'); }catch{}
  if(!snap || !snap.student || (studentId && snap.student.id !== studentId)) return null;
  Object.assign(state, {
    caps: snap.caps, campuses: snap.campuses, campusId: snap.campusId, meta: snap.meta,
    modules: snap.modules, exams: snap.exams, notices: snap.notices, announcements: snap.announcements,
    programmes: snap.programmes, faculties: snap.faculties,
    currentStudent: snap.student, currentStudentId: snap.student.id,
    offline: true, loadedAt: snap.savedAt,
  });
  return snap.savedAt;
}
