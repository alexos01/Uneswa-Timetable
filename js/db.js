import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { render } from './render.js';
import { state } from './state.js';
import { toast } from './util.js';

export const sb = (SUPABASE_URL.includes('YOUR-PROJECT')) ? null : supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ---------------- data loading ---------------- */
export async function fetchAllRows(table, orderCol, ascending){
  let all = [], from = 0;
  const pageSize = 1000;
  while(true){
    let q = sb.from(table).select('*').range(from, from+pageSize-1);
    if(orderCol) q = q.order(orderCol, { ascending: ascending!==false });
    const { data, error } = await q;
    if(error){ console.error('fetchAllRows', table, error); break; }
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
export async function loadAll(){
  const [f,p,m,e,s] = await Promise.all([
    sb.from('faculties').select('*').order('name'),
    sb.from('programmes').select('*').order('name'),
    fetchAllRows('modules','code'),
    fetchAllRows('exams','exam_date'),
    sb.from('settings').select('*').eq('id',1).single()
  ]);
  state.faculties = f.data || [];
  state.programmes = p.data || [];
  state.modules = m || [];
  state.exams = e || [];
  if(s.data) state.meta = s.data;
}
let refreshTimer = null;
// Bulk imports fire one realtime event per row; coalesce them into a single reload.
export function scheduleRefresh(delay=600){
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(()=>refreshAndRender(), delay);
}
export function subscribeRealtime(){
  const ch = sb.channel('db-changes');
  for(const table of ['faculties','programmes','modules','exams','settings']){
    ch.on('postgres_changes', {event:'*', schema:'public', table}, ()=>scheduleRefresh());
  }
  ch.subscribe();
}
export async function refreshAndRender(){
  const prevVersion = state.meta.semester_version;
  await loadAll();
  if(state.currentStudent && state.meta.semester_version !== prevVersion){
    const wasReset = checkSemesterReset(state.currentStudent);
    if(wasReset){ await saveStudent(state.currentStudent); state.resetNotice = true; }
  }
  render();
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
export async function saveStudent(student){
  const { data, error } = await sb.from('students').upsert(student).select().single();
  if(error){ console.error(error); toast('Could not save — check connection'); return null; }
  state.currentStudent = data;
  return data;
}
export async function fetchStudent(id){
  const { data } = await sb.from('students').select('*').eq('id', id).maybeSingle();
  return data;
}
