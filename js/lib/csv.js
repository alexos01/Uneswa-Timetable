// CSV reading and writing for the official timetable. Pure functions, unit tested.
//
// An admin can upload the class or exam timetable as a CSV file (Excel: File → Save As →
// CSV). A header row is matched by name in any order; without one, columns are read in
// the order of the paste-box format: code, day (or date), start, end, venue, course,
// and optionally faculty.

/** Splits CSV text into rows of cells. Handles quotes, "" escapes, CRLF, a BOM, and
    Excel's semicolon or tab delimiters (detected from the first line). */
export function parseCsv(text){
  text = String(text || '').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = ch=>first.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a,b)=>count(b)-count(a))[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for(let i=0; i<text.length; i++){
    const c = text[i];
    if(quoted){
      if(c === '"' && text[i+1] === '"'){ cell += '"'; i++; }
      else if(c === '"') quoted = false;
      else cell += c;
    }
    else if(c === '"' && cell === '') quoted = true;
    else if(c === delim){ row.push(cell); cell = ''; }
    else if(c === '\n' || c === '\r'){
      if(c === '\r' && text[i+1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    }
    else cell += c;
  }
  if(cell !== '' || row.length){ row.push(cell); rows.push(row); }
  return rows.map(r=>r.map(x=>x.trim())).filter(r=>r.some(x=>x !== ''));
}

function quote(v){
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows of values to CSV text (comma separated, CRLF, as Excel writes it). */
export function toCsv(rows){
  return rows.map(r=>r.map(quote).join(',')).join('\r\n') + '\r\n';
}

const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

/** "mon", "MONDAY", "Thurs" → "Monday", "Thursday"; null if not a day. */
export function normaliseDay(v){
  const s = String(v || '').trim().toLowerCase().replace(/\.$/, '').replace(/^weds$/, 'wed');
  if(s.length < 2) return null;
  return DAY_NAMES.find(d=>d.toLowerCase().startsWith(s)) || null;
}

/** "8:00", "08h00", "8.00", "0800", "8:00 am", "2:30 PM" → "08:00" / "14:30"; null if not a time. */
export function normaliseTime(v){
  const s = String(v || '').trim().toLowerCase();
  const m = /^(\d{1,2})(?:[:h.]?(\d{2}))?\s*(am|pm)?$/.exec(s);
  if(!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if(m[3] === 'pm' && h < 12) h += 12;
  if(m[3] === 'am' && h === 12) h = 0;
  if(h > 23 || min > 59) return null;
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

/** "2026-12-05", "05/12/2026", "5-12-2026" (day first, as in Eswatini) → "2026-12-05"; null if not a date. */
export function normaliseDate(v){
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if(m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

const HEADERS = {
  code:    ['code', 'module', 'module code', 'course code', 'subject'],
  day:     ['day', 'weekday'],
  date:    ['date', 'exam date'],
  time:    ['time', 'period'],
  start:   ['start', 'start time', 'from', 'begins'],
  end:     ['end', 'end time', 'to', 'finish', 'ends'],
  venue:   ['venue', 'room', 'location'],
  course:  ['course', 'programme', 'program', 'course name', 'programme name'],
  faculty: ['faculty'],
};

function headerMap(row){
  const map = {};
  row.forEach((h, i)=>{
    const key = h.toLowerCase().replace(/\s+/g, ' ').trim();
    for(const [field, names] of Object.entries(HEADERS)) if(names.includes(key) && !(field in map)) map[field] = i;
  });
  return map.code != null && (map.day != null || map.date != null) ? map : null;
}

/** Reads a parsed CSV as timetable entries. kind is 'modules' (weekly classes) or
    'exams'. Returns { rows: [{ code, a, start, end, venue, prog, faculty }], errors:
    [{ line, message }] }, where `a` is the day or the exam date. */
export function timetableRows(table, kind){
  const isMod = kind === 'modules';
  const header = table.length ? headerMap(table[0]) : null;
  const pos = { code:0, [isMod ? 'day' : 'date']:1, start:2, end:3, venue:4, course:5, faculty:6 };
  const map = header || pos;
  const rows = [], errors = [];
  table.slice(header ? 1 : 0).forEach((r, i)=>{
    const line = i + (header ? 2 : 1);
    const get = f=>map[f] != null ? (r[map[f]] || '').trim() : '';
    const code = get('code').toUpperCase().replace(/\s+/g, '');
    let start = normaliseTime(get('start')), end = normaliseTime(get('end'));
    const range = /^(.+?)\s*(?:-|–|to)\s*(.+)$/i.exec(get('time'));
    if(!start && range){ start = normaliseTime(range[1]); end = end || normaliseTime(range[2]); }
    const a = isMod ? normaliseDay(get('day')) : normaliseDate(get('date'));
    const prog = get('course');
    const problem = !code ? 'no module code'
      : !a ? (isMod ? `"${get('day')}" is not a day` : `"${get('date')}" is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
      : !start ? `"${get('start') || get('time')}" is not a start time`
      : !prog ? 'no course name'
      : null;
    if(problem){ errors.push({ line, message: problem }); return; }
    rows.push({ code, a, start, end, venue: get('venue') || null, prog, faculty: get('faculty') || null });
  });
  return { rows, errors, header: !!header };
}

/** The header row of the template and of exports. */
export function templateHeader(kind){
  return kind === 'modules'
    ? ['Code', 'Day', 'Start', 'End', 'Venue', 'Course', 'Faculty']
    : ['Code', 'Date', 'Start', 'End', 'Venue', 'Course', 'Faculty'];
}
