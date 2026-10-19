// Builds an iCalendar (.ics) file of a student's week, for Google Calendar, Apple
// Calendar and Outlook. Pure functions: no DOM, no Supabase.
//
// Each class becomes a weekly repeating event from the first matching day on or
// after the export date. The app has no semester end date, so classes repeat until
// the day before the student's first exam, or for CLASS_WEEKS weeks when no exam is
// loaded. Exams become one-off events. Times are Eswatini time (UTC+2 all year).

const DAY_INDEX = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 };
export const CLASS_WEEKS = 14;
const TZID = 'Africa/Mbabane';
const VTIMEZONE = ['BEGIN:VTIMEZONE', `TZID:${TZID}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
  'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0200', 'TZNAME:SAST', 'END:STANDARD', 'END:VTIMEZONE'];

const pad = n=>String(n).padStart(2, '0');
const ymd = d=>`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
function hhmmss(t){
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  return m ? `${pad(Number(m[1]))}${m[2]}00` : null;
}
function isoToDate(iso){
  const [y, m, d] = String(iso || '').split('-').map(Number);
  return y && m && d ? new Date(y, m-1, d) : null;
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }

/** Text value escaping (RFC 5545 §3.3.11). */
function text(s){ return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }

/** Folds a content line at 75 octets, continuing with a space (RFC 5545 §3.1). */
function fold(line){
  const bytes = new TextEncoder().encode(line);
  if(bytes.length <= 75) return line;
  const out = []; let cur = ''; let len = 0;
  for(const ch of line){
    const n = new TextEncoder().encode(ch).length;
    if(len + n > (out.length ? 74 : 75)){ out.push(cur); cur = ''; len = 0; }
    cur += ch; len += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** The last day classes repeat on: the day before the first exam from `today`, else CLASS_WEEKS weeks on. */
export function classesUntil(exams, today){
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const first = exams.map(e=>isoToDate(e.exam_date)).filter(d=>d && d > start).sort((a,b)=>a-b)[0];
  return first ? addDays(first, -1) : addDays(start, CLASS_WEEKS*7 - 1);
}

/** The .ics text for `sessions` (weekly) and `exams` (one-off), exported at `now`. */
export function buildCalendar({ sessions = [], exams = [], calendarName = 'UNESWA Timetable', now = new Date() }){
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = classesUntil(exams, now);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//UNESWA Timetable//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', `X-WR-CALNAME:${text(calendarName)}`, `X-WR-TIMEZONE:${TZID}`, ...VTIMEZONE];

  for(const s of sessions){
    const day = DAY_INDEX[s.day], start = hhmmss(s.start_time);
    if(day === undefined || !start) continue;
    const first = addDays(today, (day - today.getDay() + 7) % 7);
    if(first > until) continue;
    const end = hhmmss(s.end_time) || start;
    lines.push('BEGIN:VEVENT', `UID:class-${s.id}@uneswa-timetable`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${TZID}:${ymd(first)}T${start}`, `DTEND;TZID=${TZID}:${ymd(first)}T${end}`,
      // UNTIL in UTC: the end of the last day in Eswatini.
      `RRULE:FREQ=WEEKLY;UNTIL=${ymd(until)}T215959Z`,
      `SUMMARY:${text(s.code)}`, `LOCATION:${text(s.venue || 'Venue TBC')}`, 'END:VEVENT');
  }

  for(const e of exams){
    const date = isoToDate(e.exam_date);
    if(!date) continue;
    const start = hhmmss(e.start_time), end = hhmmss(e.end_time);
    lines.push('BEGIN:VEVENT', `UID:exam-${e.id || `${e.code}-${e.exam_date}`}@uneswa-timetable`, `DTSTAMP:${stamp}`,
      ...(start
        ? [`DTSTART;TZID=${TZID}:${ymd(date)}T${start}`, `DTEND;TZID=${TZID}:${ymd(date)}T${end || start}`]
        : [`DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(addDays(date, 1))}`]),
      `SUMMARY:${text(`${e.code} exam`)}`, `LOCATION:${text(e.venue || 'Venue TBC')}`, 'END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
