import { SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_CAMPUS } from './config.js';
import { render } from './render.js';
import { state } from './state.js';
import { toast } from './util.js';
import { flushOutbox, isNetworkError, queueStudent, saveOwnRecord } from './sync.js';
import { clearToken, getToken, setToken } from './student-token.js';

export const sb = (SUPABASE_URL.includes('YOUR-PROJECT')) ? null : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* Capability detection
   New code is pushed to the live site before the migrations are run, so every
   feature that needs a new table checks for it first. Without migration 001 the
   app behaves exactly as it did with one campus and one admin login. */
export async function detectCapabilities(){
  const c = await sb.from('campuses').select('*').order('sort');
  if(c.error && isNetworkError(c.error)) throw c.error;
  state.caps.campuses = !c.error;
  state.campuses = c.error ? [] : (c.data || []);
  if(state.caps.campuses){
    const a = await sb.from('announcements').select('id').limit(1);
    state.caps.notices = !a.error;
  }
  if(state.caps.notices){
    const v = await sb.rpc('app_schema_version');
    if(v.error && isNetworkError(v.error)) throw v.error;
    state.caps.v3 = !v.error && v.data >= 3; // class reps, late notices, push (migration 003)
    state.caps.v4 = !v.error && v.data >= 4; // notices for one course, timetable PDF, student passwords (migration 004)
  }
  return state.caps;
}

export function campusName(id){
  const c = state.campuses.find(x=>x.id===id);
  return c ? c.name : (id || '');
}

/** Adds the current campus to a row being inserted (no-op before migration 001). */
export function withCampus(row){
  return state.caps.campuses ? { ...row, campus_id: state.campusId } : row;
}
/** Restricts a query to the current campus (no-op before migration 001). */
export function scoped(q){
  return state.caps.campuses ? q.eq('campus_id', state.campusId) : q;
}

/* Data loading */
export async function fetchAllRows(table, orderCol, ascending, filter){
  let all = [], from = 0;
  const pageSize = 1000;
  while(true){
    let q = sb.from(table).select('*').range(from, from+pageSize-1);
    if(filter) q = filter(q);
    if(orderCol) q = q.order(orderCol, { ascending: ascending!==false });
    const { data, error } = await q;
    if(error){ console.error('fetchAllRows', table, error); throw error; }
    all = all.concat(data);
    if(!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
export function countDuplicates(list, keyFn){
  const seen = new Set();
  let dupes = 0;
  for(const item of list){
    const k = keyFn(item);
    if(seen.has(k)) dupes++; else seen.add(k);
  }
  return dupes;
}
export async function removeDuplicates(statusEl){
  const modKeyFn = m=>[m.code,m.day,m.start_time,m.end_time,m.venue,m.programme_id].join('|');
  const examKeyFn = e=>[e.code,e.exam_date,e.start_time,e.end_time,e.venue,e.programme_id].join('|');
  let totalRemoved = 0;
  for(const [table, list, keyFn] of [['modules', state.modules, modKeyFn], ['exams', state.exams, examKeyFn]]){
    const seen = new Map(); // key -> id to keep
    const toDelete = [];
    for(const item of list){
      const k = keyFn(item);
      if(seen.has(k)) toDelete.push(item.id); else seen.set(k, item.id);
    }
    for(let i=0;i<toDelete.length;i+=200){
      const batch = toDelete.slice(i, i+200);
      if(statusEl) statusEl.textContent = `Removing duplicates from ${table}… ${Math.min(i+200,toDelete.length)} of ${toDelete.length}`;
      const { error } = await sb.from(table).delete().in('id', batch);
      if(error) console.error(error); else totalRemoved += batch.length;
    }
  }
  await loadAll();
  return totalRemoved;
}

function todayIso(offsetDays=0){
  const d = new Date(); d.setDate(d.getDate()+offsetDays);
  return d.toISOString().slice(0,10);
}

export async function loadAll(){
  if(!state.campusId) state.campusId = DEFAULT_CAMPUS;
  const byCampus = state.caps.campuses ? (q=>q.eq('campus_id', state.campusId)) : null;
  const settingsQuery = state.caps.campuses
    ? sb.from('campus_settings').select('*').eq('campus_id', state.campusId).maybeSingle()
    : sb.from('settings').select('*').eq('id',1).single();
  const [f,p,m,e,s] = await Promise.all([
    scoped(sb.from('faculties').select('*')).order('name'),
    scoped(sb.from('programmes').select('*')).order('name'),
    fetchAllRows('modules','code', true, byCampus),
    fetchAllRows('exams','exam_date', true, byCampus),
    settingsQuery
  ]);
  if(f.error || p.error) throw (f.error || p.error);
  state.faculties = f.data || [];
  state.programmes = p.data || [];
  state.modules = m || [];
  state.exams = e || [];
  state.meta = s.data || { semester:'Not set yet', updated_at:null, semester_version:1 };
  if(state.caps.notices){
    const [a, n] = await Promise.all([
      sb.from('announcements').select('*').or(`campus_id.is.null,campus_id.eq.${state.campusId}`).order('created_at', { ascending:false }).limit(100),
      sb.from('class_notices').select('*').eq('campus_id', state.campusId).gte('notice_date', todayIso(-1)).order('notice_date').limit(500),
    ]);
    const now = Date.now();
    state.announcements = (a.data || []).filter(x=>!x.expires_at || new Date(x.expires_at).getTime() > now);
    state.notices = n.data || [];
  }
  state.loadedAt = new Date().toISOString();
}

/** Switches the loaded campus (reloads data only if it changed). */
export async function ensureCampus(id){
  if(!state.caps.campuses || !id || id===state.campusId) return false;
  state.campusId = id;
  state.pickFaculty = ''; state.pickProgramme = ''; state.pickYear = '';
  await loadAll();
  return true;
}

let refreshTimer = null;
// Bulk imports fire one realtime event per row; coalesce them into a single reload.
export function scheduleRefresh(delay=600){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(()=>refreshAndRender(), delay);
}
let subscribed = false;
export function subscribeRealtime(){
  if(subscribed) return;
  subscribed = true;
  const ch = sb.channel('db-changes');
  const tables = ['faculties','programmes','modules','exams','settings'];
  if(state.caps.campuses) tables.push('campus_settings');
  if(state.caps.notices) tables.push('announcements','class_notices');
  for(const table of tables){
    ch.on('postgres_changes', {event:'*', schema:'public', table}, ()=>scheduleRefresh());
  }
  ch.subscribe();
}
export async function refreshAndRender(){
  const prevVersion = state.meta.semester_version;
  try{ await flushOutbox(sb); await loadAll(); state.offline = false; }catch(err){ console.error(err); return; }
  if(state.currentStudent && state.meta.semester_version !== prevVersion){
    const wasReset = checkSemesterReset(state.currentStudent);
    if(wasReset){ await saveStudent(state.currentStudent); state.resetNotice = true; }
  }
  render();
  document.dispatchEvent(new CustomEvent('timetable:changed'));
}

export function checkSemesterReset(student){
  const cur = state.meta.semester_version || 1;
  if(student.semester_version !== cur){
    student.history = student.history || [];
    if(student.module_ids && student.module_ids.length){
      student.history.push({semester_version:student.semester_version, module_ids:student.module_ids, archived_at:new Date().toISOString()});
    }
    student.module_ids = [];
    student.semester_version = cur;
    student.updated_at = new Date().toISOString();
    return true;
  }
  return false;
}
/** Saves a student record. With no connection the change is kept on the device
    and sent later (js/sync.js), so this still succeeds offline. */
export async function saveStudent(student){
  const row = { ...student };
  if(state.caps.campuses) row.campus_id = row.campus_id || state.campusId;
  else delete row.campus_id;
  if(!state.offline){
    const { data, error, signedOut } = await saveOwnRecord(sb, row);
    if(signedOut){ studentSignedOut(); return null; }
    if(!error){ state.currentStudent = data; return data; }
    if(!isNetworkError(error)){ console.error(error); toast('Could not save: '+error.message); return null; }
    goneOffline();
  }
  await queueStudent(row);
  state.currentStudent = row;
  return row;
}

/** Marks the app offline after a request could not reach the server. */
export function goneOffline(){
  if(state.offline) return;
  state.offline = true;
  toast("You're offline. Your changes are saved on this device and will sync when you're back online.");
}
/** Thrown by fetchStudent when this device is not (or no longer) signed in as the student. */
export class SignedOutError extends Error {
  constructor(hadToken){ super('Signed out'); this.name = 'SignedOutError'; this.hadToken = hadToken; }
}

export async function fetchStudent(id){
  if(state.caps.v4){
    const token = getToken(id);
    if(!token) throw new SignedOutError(false);
    const { data, error } = await sb.rpc('student_get', { p_token: token });
    if(error) throw error;
    if(data?.error){ clearToken(); throw new SignedOutError(true); }
    return data.student;
  }
  const { data, error } = await sb.from('students').select('*').eq('id', id).maybeSingle();
  if(error) throw error;
  return data;
}

/* Student passwords (migration 004) */
export const GATE_NOTICE = {
  passwords: 'Timetables now have passwords. Enter your student number to choose yours.',
  signedOut: 'You were signed out, perhaps because your password was reset. Sign in again.',
};

/** 'new', 'no_password' or 'password'. */
export async function studentAccountStatus(id){
  const { data, error } = await sb.rpc('student_account_status', { p_id: id });
  if(error) throw error;
  return data;
}

/** Signs in, or sets the first password. Resolves to { student } or { error, ... }; keeps the token on success. */
export async function studentSignIn(id, password, { name = null, campus = null } = {}){
  const { data, error } = await sb.rpc('student_sign_in', { p_id: id, p_password: password, p_name: name, p_campus: campus });
  if(error) throw error;
  if(data.token) setToken(id, data.token);
  return data;
}

/** Ends this device's sign-in. Offline, the token is only forgotten here. */
export async function studentSignOut(id){
  const token = getToken(id);
  clearToken();
  if(token && !state.offline) await sb.rpc('student_sign_out', { p_token: token }).catch(()=>{});
}

export async function resetStudentPassword(id){
  const { error } = await sb.rpc('reset_student_password', { p_id: id });
  if(error) throw error;
}

/** The server no longer accepts this device's token: back to the sign-in screen. */
export function studentSignedOut(notice = GATE_NOTICE.signedOut){
  clearToken();
  state.currentStudent = null; state.currentStudentId = null;
  state.gateNotice = notice;
  try{ localStorage.removeItem('uneswa_last_student'); }catch{}
  document.dispatchEvent(new CustomEvent('timetable:changed')); // clears this student's reminders
  render();
}

/* Semester settings */
export async function updateSemester(fields){
  const row = { ...fields, updated_at: new Date().toISOString() };
  const q = state.caps.campuses
    ? sb.from('campus_settings').update(row).eq('campus_id', state.campusId)
    : sb.from('settings').update(row).eq('id', 1);
  const { error } = await q;
  if(error) throw error;
}

/* Staff */
/** Loads the signed-in account's staff row; before migration 001 any login is admin. */
export async function loadStaff(session){
  state.session = session || null;
  state.staff = null;
  if(!session) return null;
  if(!state.caps.campuses){
    state.staff = { user_id: session.user.id, role:'super_admin', campus_id:null, email: session.user.email, legacy:true };
    return state.staff;
  }
  const { data, error } = await sb.from('staff').select('*').eq('user_id', session.user.id).maybeSingle();
  if(error) console.error(error);
  state.staff = data || null;
  return state.staff;
}
export function isAdmin(){ return !!state.staff && (state.staff.role==='super_admin' || state.staff.role==='campus_admin'); }
export function isSuperAdmin(){ return !!state.staff && state.staff.role==='super_admin'; }
export function isLecturer(){ return !!state.staff && state.staff.role==='lecturer'; }
export function isClassRep(){ return !!state.staff && state.staff.role==='class_rep'; }
