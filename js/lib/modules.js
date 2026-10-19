// Pure helpers for module sessions. No DOM or Supabase access, so they can be unit tested in Node.

export const WEEKDAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

export function sortSessions(sessions){
  return sessions.slice().sort((a,b)=>
    WEEKDAYS.indexOf(a.day)-WEEKDAYS.indexOf(b.day) || (a.start_time||'').localeCompare(b.start_time||''));
}

/**
 * Module search for the student picker.
 * By default only the chosen course is searched; `allCourses` widens it to every
 * course loaded for the campus (electives). Results are grouped per course + code,
 * so ticking a result never pulls in another stream's sessions of the same code.
 */
export function searchModules(modules, query, { programmeId = '', allCourses = false, limit = 40 } = {}){
  const q = (query||'').trim().toLowerCase();
  if(!q) return [];
  const scoped = (programmeId && !allCourses) ? modules.filter(m=>m.programme_id===programmeId) : modules;
  const groups = new Map();
  for(const m of scoped){
    if(!(m.code||'').toLowerCase().includes(q)) continue;
    const key = `${m.programme_id||''}|${m.code}`;
    if(!groups.has(key)) groups.set(key, { code:m.code, programme_id:m.programme_id||null, sessions:[] });
    groups.get(key).sessions.push(m);
  }
  return [...groups.values()]
    .map(g=>({ ...g, sessions: sortSessions(g.sessions) }))
    .sort((a,b)=>a.code.localeCompare(b.code) || String(a.programme_id).localeCompare(String(b.programme_id)))
    .slice(0, limit);
}

/**
 * The courses a student's ticked sessions come from, the course with the most
 * module codes first. Students don't record a course, so this is what the staff
 * Students list shows. Ties keep the order the courses were first met.
 */
export function coursesOfStudent(moduleIds, modules){
  const ticked = new Set(moduleIds||[]);
  const codes = new Map();
  for(const m of modules){
    if(!ticked.has(m.id) || !m.programme_id) continue;
    if(!codes.has(m.programme_id)) codes.set(m.programme_id, new Set());
    codes.get(m.programme_id).add(m.code);
  }
  return [...codes.entries()].sort((a,b)=>b[1].size-a[1].size).map(([pid])=>pid);
}
