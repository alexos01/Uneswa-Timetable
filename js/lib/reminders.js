// Plans class reminders for the native app. Pure functions: no DOM, no plugins.
//
// Weekly classes become repeating notifications (weekday + time). Tests and other
// class notices become one-off notifications: the evening before at 18:00, and the
// chosen number of minutes before they start. iOS keeps at most 64 pending
// notifications, so the plan is capped and filled soonest first.

const DAY_INDEX = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
export const EVENING_BEFORE_HOUR = 18;
export const MAX_PENDING = 60;

function toMinutes(hhmm){
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
  return m ? Number(m[1])*60 + Number(m[2]) : null;
}
function hhmm(min){ return `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`; }

/** Stable positive 31-bit id, so rescheduling replaces rather than duplicates. */
export function reminderId(key){
  let h = 2166136261;
  for(let i=0;i<key.length;i++){ h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}

/** Repeating reminders for weekly sessions. weekday follows Capacitor: Sunday = 1 … Saturday = 7. */
export function weeklyReminders(sessions, minutesBefore){
  const seen = new Set();
  const out = [];
  for(const s of sessions){
    const day = DAY_INDEX[s.day];
    const start = toMinutes(s.start_time);
    if(day == null || start == null) continue;
    const key = `${s.code}|${s.day}|${s.start_time}`;
    if(seen.has(key)) continue; // duplicate rows of the same session
    seen.add(key);
    let fire = start - minutesBefore, fireDay = day;
    if(fire < 0){ fire += 1440; fireDay = (day + 6) % 7; }
    out.push({
      id: reminderId('class|'+key),
      title: `${s.code} starts in ${minutesBefore} min`,
      body: `${s.venue || 'Venue TBC'} · ${s.start_time}${s.end_time ? '–'+s.end_time : ''}`,
      weekday: fireDay + 1, hour: Math.floor(fire/60), minute: fire % 60,
      dayIndex: fireDay, fireMinutes: fire,
    });
  }
  return out;
}

/** Next time a weekly reminder fires after `now`. */
export function nextWeeklyFire(r, now){
  const d = new Date(now);
  d.setSeconds(0, 0);
  const nowMin = d.getHours()*60 + d.getMinutes();
  let add = (r.dayIndex - d.getDay() + 7) % 7;
  if(add === 0 && r.fireMinutes <= nowMin) add = 7;
  d.setDate(d.getDate() + add);
  d.setHours(r.hour, r.minute, 0, 0);
  return d;
}

const KIND_WORD = { test:'Test', cancelled:'Cancelled', moved:'Moved', extra:'Extra class', note:'Note' };

/** One-off reminders for class notices that are still ahead of `now`. */
export function noticeReminders(notices, minutesBefore, now){
  const out = [];
  for(const n of notices){
    const [y, mo, da] = (n.notice_date || '').split('-').map(Number);
    if(!y) continue;
    const word = KIND_WORD[n.kind] || 'Note';
    const label = n.title ? `${word}: ${n.title}` : word;
    const where = [n.start_time, n.venue].filter(Boolean).join(' · ');
    const eve = new Date(y, mo-1, da-1, EVENING_BEFORE_HOUR, 0, 0);
    if(eve > now) out.push({ id: reminderId(`notice|${n.id}|eve`), at: eve,
      title: `Tomorrow · ${n.code} ${label}`, body: where || 'Check the timetable app for details' });
    const start = toMinutes(n.start_time);
    if(start != null && n.kind !== 'cancelled'){
      const at = new Date(y, mo-1, da, 0, 0, 0);
      at.setMinutes(start - minutesBefore);
      if(at > now) out.push({ id: reminderId(`notice|${n.id}|start|${minutesBefore}`), at,
        title: `${n.code} ${label} in ${minutesBefore} min`, body: where });
    }
  }
  return out;
}

/** Everything to schedule, soonest first, capped at `limit`. */
export function planReminders({ sessions = [], notices = [], minutesBefore = 15, now = new Date(), limit = MAX_PENDING }){
  const weekly = weeklyReminders(sessions, minutesBefore).map(r=>({ ...r, next: nextWeeklyFire(r, now) }));
  const once = noticeReminders(notices, minutesBefore, now).map(r=>({ ...r, next: r.at }));
  return [...weekly, ...once].sort((a,b)=>a.next - b.next).slice(0, limit);
}

export { hhmm as _hhmm };
