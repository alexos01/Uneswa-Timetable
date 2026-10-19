// What the send-push Edge Function sends, and to whom. Plain JavaScript with no
// Deno or Node APIs, so tests/unit can import it. A subscription row comes from
// public.push_subscriptions (migration 003).
//
// Tags match the ones the open page uses (js/reminders.js), so a phone that gets
// both the push and the in-page alert shows one notification, not two.

export const TIME_ZONE = 'Africa/Mbabane';
export const CHANGE_KINDS = ['late', 'cancelled', 'moved'];
const KIND_LABEL = { test:'Test', cancelled:'Cancelled', moved:'Moved', extra:'Extra class', note:'Note', late:'Running late' };

/** Date, weekday and minute of the day on the campus clock. */
export function localClock(date, timeZone = TIME_ZONE){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', weekday:'long', hourCycle:'h23',
  }).formatToParts(date).map(x=>[x.type, x.value]));
  return { isoDate: `${p.year}-${p.month}-${p.day}`, day: p.weekday, minutes: Number(p.hour)*60 + Number(p.minute) };
}

function toMinutes(hhmm){
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1])*60 + Number(m[2]) : null;
}

export function moduleYear(code){
  const m = (code || '').match(/[A-Z]{2,5}(\d)\d{2}/);
  return m ? Number(m[1]) : null;
}

function summary(n){
  if(n.kind === 'late') return n.delay_minutes ? `running ${n.delay_minutes} min late` : 'running late';
  if(n.kind === 'moved' && n.venue) return `moved to ${n.venue}`;
  if(n.kind === 'cancelled') return 'cancelled';
  return KIND_LABEL[n.kind] || 'Note';
}

/** The message for a newly posted class notice. */
export function noticeMessage(n, today){
  const when = n.notice_date === today ? 'today' : n.notice_date;
  const at = n.start_time ? ` ${n.start_time}` : '';
  if(CHANGE_KINDS.includes(n.kind)){
    return {
      title: `${n.code} ${when}${at}: ${summary(n)}`,
      body: [n.title, n.venue && n.kind !== 'cancelled' ? n.venue : null].filter(Boolean).join(' · ') || 'Open the timetable for details',
      tag: `notice-${n.id}`,
    };
  }
  return {
    title: `${n.code} ${summary(n)}${n.title ? ': '+n.title : ''}`,
    body: [`${when}${at}`, n.venue].filter(Boolean).join(' · '),
    tag: `notice-${n.id}`,
  };
}

/** Subscriptions following the notice's module on its campus. A notice for one course
    (migration 004) only reaches subscriptions with a session of that module on that
    course; `modules` must then hold those sessions (id, code, programme_id). */
export function noticeTargets(n, subs, modules = []){
  const out = subs.filter(s=>s.campus_id === n.campus_id && (s.codes || []).includes(n.code));
  if(!n.programme_id) return out;
  const onCourse = new Set(modules.filter(m=>m.code === n.code && m.programme_id === n.programme_id).map(m=>m.id));
  return out.filter(s=>(s.module_ids || []).some(id=>onCourse.has(id)));
}

export function announcementMessage(a){
  const body = (a.body || '').replace(/\s+/g, ' ').trim();
  return { title: a.title, body: body.length > 180 ? body.slice(0, 177) + '…' : body, tag: `announcement-${a.id}` };
}

/** Subscriptions an announcement reaches. `courseCodes` are the module codes on the
    announcement's course (all years); needed only when it targets a course. */
export function announcementTargets(a, subs, courseCodes = []){
  let out = a.campus_id ? subs.filter(s=>s.campus_id === a.campus_id) : subs.slice();
  if(a.programme_id){
    const codes = new Set(courseCodes.filter(c=>!a.year || moduleYear(c) === a.year));
    out = out.filter(s=>(s.codes || []).some(c=>codes.has(c)));
  }
  return out;
}

/** Reminders due this minute: `minutes_before` ahead of each session and of each
    test or extra class, following any late, cancelled or moved notice for today. */
export function dueReminders({ subs, modules, notices, now }){
  const clock = localClock(now);
  const byId = new Map(modules.map(m=>[m.id, m]));
  const today = notices.filter(n=>n.notice_date === clock.isoDate);
  const changeFor = m=>today
    .filter(n=>n.code === m.code && CHANGE_KINDS.includes(n.kind) && (!n.start_time || n.start_time === m.start_time)
      && (!n.programme_id || n.programme_id === m.programme_id))
    .sort((a,b)=>(b.created_at || '').localeCompare(a.created_at || ''))[0];
  const out = [];
  for(const sub of subs){
    if(sub.reminders === false) continue;
    const lead = sub.minutes_before || 10;
    const seen = new Set();
    for(const id of sub.module_ids || []){
      const m = byId.get(id);
      if(!m || m.day !== clock.day) continue;
      let start = toMinutes(m.start_time);
      if(start == null || seen.has(`${m.code}|${m.start_time}`)) continue;
      seen.add(`${m.code}|${m.start_time}`);
      const change = changeFor(m);
      if(change?.kind === 'cancelled') continue;
      const delay = change?.kind === 'late' ? (change.delay_minutes || 0) : 0;
      if(start + delay - lead !== clock.minutes) continue;
      const venue = change?.kind === 'moved' && change.venue ? change.venue : m.venue;
      out.push({ sub, message: {
        title: delay ? `${m.code} starts in ${lead} min (running ${delay} min late)` : `${m.code} starts in ${lead} min`,
        body: `${venue || 'Venue TBC'} · ${m.start_time}${m.end_time ? '–'+m.end_time : ''}`,
        tag: `class-${m.id}-${clock.isoDate}`,
      }});
    }
    const onCourse = n=>!n.programme_id || (sub.module_ids || []).some(id=>{ const m = byId.get(id); return m && m.code === n.code && m.programme_id === n.programme_id; });
    for(const n of today){
      if(!['test', 'extra'].includes(n.kind) || !(sub.codes || []).includes(n.code) || !onCourse(n)) continue;
      const start = toMinutes(n.start_time);
      if(start == null || start - lead !== clock.minutes) continue;
      out.push({ sub, message: {
        title: `${n.code} ${KIND_LABEL[n.kind]}${n.title ? ': '+n.title : ''} in ${lead} min`,
        body: n.venue || 'Open the timetable for details',
        tag: `notice-${n.id}-start`,
      }});
    }
  }
  return out;
}
