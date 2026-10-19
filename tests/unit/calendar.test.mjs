import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, classesUntil, CLASS_WEEKS } from '../../js/lib/calendar.js';

const now = new Date(2026, 9, 21, 9, 30); // Wednesday 21 Oct 2026
const sessions = [
  { id:'s1', code:'CSC111', day:'Monday', start_time:'08:00', end_time:'08:50', venue:'SC.LEC.TH.I' },
  { id:'s2', code:'MAT111', day:'Wednesday', start_time:'15:00', end_time:'15:50', venue:'MPH, Hall 2' },
];
const exams = [
  { id:'e2', code:'MAT111', exam_date:'2026-12-09', start_time:'14:00', end_time:'17:00', venue:'MPH' },
  { id:'e1', code:'CSC111', exam_date:'2026-12-05', start_time:'09:00', end_time:'12:00', venue:'MPH' },
];
const events = ics=>ics.split('BEGIN:VEVENT').slice(1).map(e=>e.split('END:VEVENT')[0]);

test('classes repeat weekly from the next matching day until the day before the first exam', ()=>{
  const ics = buildCalendar({ sessions, exams, now });
  const [mon, wed] = events(ics);
  assert.match(mon, /DTSTART;TZID=Africa\/Mbabane:20261026T080000/, 'next Monday');
  assert.match(mon, /DTEND;TZID=Africa\/Mbabane:20261026T085000/);
  assert.match(wed, /DTSTART;TZID=Africa\/Mbabane:20261021T150000/, 'today is Wednesday, so it starts today');
  assert.match(mon, /RRULE:FREQ=WEEKLY;UNTIL=20261204T215959Z/, 'until 23:59 Eswatini time on 4 Dec');
  assert.match(wed, /LOCATION:MPH\\, Hall 2/, 'commas are escaped');
  assert.match(mon, /UID:class-s1@uneswa-timetable/);
});

test('exams are one-off events, all-day when there is no time', ()=>{
  const ics = buildCalendar({ sessions:[], exams:[...exams, { id:'e3', code:'ACF111', exam_date:'2026-12-10' }], now });
  const ev = events(ics);
  assert.equal(ev.length, 3);
  assert.match(ev[0], /DTSTART;TZID=Africa\/Mbabane:20261209T140000\r\nDTEND;TZID=Africa\/Mbabane:20261209T170000\r\nSUMMARY:MAT111 exam/);
  assert.match(ev[2], /DTSTART;VALUE=DATE:20261210\r\nDTEND;VALUE=DATE:20261211/);
  assert.doesNotMatch(ev[0], /RRULE/);
});

test('with no exam ahead, classes repeat for the default number of weeks', ()=>{
  const until = classesUntil([{ exam_date:'2026-06-01' }], now);
  assert.equal(until.toDateString(), new Date(2026, 9, 21 + CLASS_WEEKS*7 - 1).toDateString());
});

test('the file is valid iCalendar text: CRLF lines, folded at 75 octets, one timezone', ()=>{
  const ics = buildCalendar({ sessions:[{ ...sessions[0], venue:'A very long venue name that goes on and on past the seventy five octet limit' }], exams:[], now });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  for(const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.match(ics.replace(/\r\n /g, ''), /LOCATION:A very long venue name .* octet limit\r\n/, 'unfolding (dropping CRLF + space) gives the line back');
  assert.equal(ics.match(/BEGIN:VTIMEZONE/g).length, 1);
});

test('sessions without a weekday or start time are left out', ()=>{
  const ics = buildCalendar({ sessions:[{ id:'x', code:'BAD', day:'Someday', start_time:'08:00' }, { id:'y', code:'BAD2', day:'Monday', start_time:'' }], now });
  assert.equal(events(ics).length, 0);
});
