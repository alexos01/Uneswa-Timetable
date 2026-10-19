// Pure helpers for class notices (tests, cancellations, room changes).

export const NOTICE_KINDS = {
  test:      { label:'Test',        verb:'Test' },
  cancelled: { label:'Cancelled',   verb:'Class cancelled' },
  moved:     { label:'Moved',       verb:'Class moved' },
  extra:     { label:'Extra class', verb:'Extra class' },
  note:      { label:'Note',        verb:'Note' },
  late:      { label:'Running late', verb:'Running late' },
};

/** Kinds that change a class on the day, shown on the student's next-class banner. */
export const CHANGE_KINDS = ['late', 'cancelled', 'moved'];
export const DELAY_CHOICES = [5, 10, 15, 20, 30, 45, 60];

const WEEKDAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** "2026-10-20" → "Tue 20 Oct", read as a local calendar date so no time zone can shift it. */
export function formatDay(iso){
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if(!y || !m || !d) return iso || '';
  return `${WEEKDAY_SHORT[new Date(y, m-1, d).getDay()]} ${d} ${MONTH_SHORT[m-1]}`;
}

export function localIsoDate(d = new Date()){
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/** The notices that apply to a student's ticked `sessions`: their module codes, and for a
    notice posted to one course, only if they take that module on that course. */
export function noticesFor(notices, sessions){
  const codes = new Set(sessions.map(s=>s.code));
  const onCourse = new Set(sessions.map(s=>`${s.code}|${s.programme_id}`));
  return notices.filter(n=>codes.has(n.code) && (!n.programme_id || onCourse.has(`${n.code}|${n.programme_id}`)));
}

/** The courses a module runs on, to post a notice to one of them. */
export function coursesForCode(modules, code){
  return [...new Set(modules.filter(m=>m.code===code && m.programme_id).map(m=>m.programme_id))];
}

/** Notices for the given module codes from `today` on, soonest first. */
export function upcomingNotices(notices, codes, today = localIsoDate()){
  const set = new Set(codes);
  return notices
    .filter(n=>set.has(n.code) && n.notice_date >= today)
    .sort((a,b)=>a.notice_date.localeCompare(b.notice_date) || (a.start_time||'').localeCompare(b.start_time||''));
}

/** "Running 15 min late", "Class cancelled", …: the notice in a few words. */
export function noticeSummary(n){
  const kind = NOTICE_KINDS[n.kind] || NOTICE_KINDS.note;
  if(n.kind === 'late') return n.delay_minutes ? `Running ${n.delay_minutes} min late` : 'Running late';
  if(n.kind === 'moved' && n.venue) return `Moved to ${n.venue}`;
  return kind.verb;
}

export function describeNotice(n){
  const kind = NOTICE_KINDS[n.kind] || NOTICE_KINDS.note;
  const time = n.start_time ? `, ${n.start_time}${n.end_time ? '–'+n.end_time : ''}` : '';
  const venue = n.venue ? ` · ${n.venue}` : '';
  const heading = n.kind === 'late' ? noticeSummary(n) + (n.title ? `: ${n.title}` : '') : (n.title || kind.verb);
  return { kind, heading: `${n.code} · ${heading}`, when: `${formatDay(n.notice_date)}${time}${venue}` };
}

/** The latest same-day change (late, cancelled, moved) to one class, or null.
    A notice with a start time only matches the session starting then. */
export function changeFor(notices, code, isoDate, startTime){
  const hits = notices.filter(n=>n.code===code && n.notice_date===isoDate && CHANGE_KINDS.includes(n.kind)
    && (!n.start_time || !startTime || n.start_time===startTime));
  hits.sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
  return hits[0] || null;
}

/** Same-day changes for `codes` that are not in `seenIds`, from `today` on. */
export function unseenChanges(notices, codes, seenIds, today = localIsoDate()){
  const set = new Set(codes), seen = new Set(seenIds);
  return notices.filter(n=>set.has(n.code) && CHANGE_KINDS.includes(n.kind) && n.notice_date >= today && !seen.has(n.id));
}

/** Notification text for a change notice. */
export function changeAlert(n, today = localIsoDate()){
  const when = n.notice_date === today ? 'today' : n.notice_date;
  const at = n.start_time ? ` ${n.start_time}` : '';
  const what = noticeSummary(n).replace(/^Class /, '');
  return {
    title: `${n.code} ${when}${at}: ${what[0].toLowerCase()}${what.slice(1)}`,
    body: [n.title, n.venue && n.kind !== 'cancelled' ? n.venue : null].filter(Boolean).join(' · ') || 'Open the timetable for details',
  };
}
