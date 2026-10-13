/* Offline copy of the timetable on the device.
   After every successful load, the whole campus timetable (faculties, courses,
   sessions, exams, notices, announcements) is kept in js/store.js, along with the
   signed-in student's record. With no connection the app opens on that copy, and a
   student can still browse courses and change their modules (js/sync.js sends the
   changes once the connection is back). */
import { state } from './state.js';
import * as store from './store.js';

const LAST = 'last';
const campusKey = id=>`campus:${id}`;
const studentKey = id=>`student:${id}`;
const LEGACY_KEY = 'uneswa_snapshot_v1'; // localStorage, before the IndexedDB copy

let savedLoad = null; // state.loadedAt of the campus copy already on the device

export async function saveSnapshot(){
  const s = state.currentStudent;
  if(state.loadedAt && savedLoad !== `${state.campusId}|${state.loadedAt}`){
    savedLoad = `${state.campusId}|${state.loadedAt}`;
    await store.set(campusKey(state.campusId), {
      savedAt: state.loadedAt,
      caps: state.caps, campuses: state.campuses, meta: state.meta,
      faculties: state.faculties, programmes: state.programmes, modules: state.modules, exams: state.exams,
      notices: state.notices, announcements: state.announcements,
    });
  }
  if(s) await store.set(studentKey(s.id), s);
  await store.set(LAST, { campusId: state.campusId, studentId: s ? s.id : null });
}

/** The student record kept on the device, or null. */
export function cachedStudent(id){ return store.get(studentKey(id)); }

/** Restores the device copy into state. Returns its timestamp, or null if there is none. */
export async function restoreSnapshot(studentId){
  const last = (await store.get(LAST)) || {};
  const student = studentId ? await cachedStudent(studentId) : null;
  const campusId = student?.campus_id || last.campusId || state.campusId;
  const snap = await store.get(campusKey(campusId));
  if(!snap) return restoreLegacy(studentId);
  Object.assign(state, {
    caps: snap.caps, campuses: snap.campuses, campusId, meta: snap.meta,
    faculties: snap.faculties, programmes: snap.programmes, modules: snap.modules, exams: snap.exams,
    notices: snap.notices, announcements: snap.announcements,
    offline: true, loadedAt: snap.savedAt,
  });
  if(student){ state.currentStudent = student; state.currentStudentId = student.id; }
  savedLoad = `${campusId}|${snap.savedAt}`;
  return snap.savedAt;
}

/** Older app versions kept only the student's own sessions in localStorage. */
function restoreLegacy(studentId){
  let snap = null;
  try{ snap = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); }catch{}
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
