// Pure helpers for announcements. No DOM or Supabase access, so they can be unit tested in Node.

export function moduleYear(code){
  const m = (code||'').match(/[A-Z]{2,5}(\d)\d{2}/);
  return m ? Number(m[1]) : null;
}

/** Announcements a student should see: campus-wide ones, plus those for a course
    (and year) they take a module on. With no student, only campus-wide ones. */
export function visibleAnnouncements(list, mySessions){
  const taken = new Set((mySessions || []).map(m=>`${m.programme_id}|${moduleYear(m.code)}`));
  const courses = new Set((mySessions || []).map(m=>m.programme_id));
  return list.filter(a=>!a.programme_id
    || (a.year ? taken.has(`${a.programme_id}|${a.year}`) : courses.has(a.programme_id)));
}

/** Courses (and the years within them) that a class rep's module codes belong to. */
export function repCourses(modules, codes){
  const set = new Set(codes);
  const out = new Map();
  for(const m of modules){
    if(!set.has(m.code) || !m.programme_id) continue;
    if(!out.has(m.programme_id)) out.set(m.programme_id, new Set());
    const y = moduleYear(m.code);
    if(y != null) out.get(m.programme_id).add(y);
  }
  return [...out].map(([programme_id, years])=>({ programme_id, years: [...years].sort((a,b)=>a-b) }));
}
