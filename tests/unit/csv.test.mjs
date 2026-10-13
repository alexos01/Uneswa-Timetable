import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, normaliseDay, normaliseTime, normaliseDate, timetableRows } from '../../js/lib/csv.js';

test('CSV cells: quotes, escaped quotes, commas inside quotes, CRLF, BOM, blank lines', ()=>{
  const text = '\uFEFFCode,Venue,Course\r\n"CSC111","G.005, Block A","B.Sc. ""CS"""\r\n\r\nMAT111,MPH,BSc\n';
  assert.deepEqual(parseCsv(text), [['Code','Venue','Course'], ['CSC111','G.005, Block A','B.Sc. "CS"'], ['MAT111','MPH','BSc']]);
});

test('Excel semicolon and tab files are read too', ()=>{
  assert.deepEqual(parseCsv('a;b;c\n1;2,5;3'), [['a','b','c'], ['1','2,5','3']]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [['a','b'], ['1','2']]);
});

test('writing CSV quotes only what needs it and round-trips', ()=>{
  const rows = [['Code','Venue'], ['CSC111','G.005, Block A'], ['X', 'say "hi"']];
  assert.equal(toCsv(rows), 'Code,Venue\r\nCSC111,"G.005, Block A"\r\nX,"say ""hi"""\r\n');
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('days, times and dates in the forms people type', ()=>{
  assert.deepEqual(['mon','MONDAY','Tues','weds','Thurs.','fri','sa','x','t'].map(normaliseDay),
    ['Monday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday',null,null]);
  assert.deepEqual(['8:00','08h00','8.00','0800','8','2:30 PM','12:00 am','25:00','noon'].map(normaliseTime),
    ['08:00','08:00','08:00','08:00','08:00','14:30','00:00',null,null]);
  assert.deepEqual(['2026-12-5','05/12/2026','5-12-2026','5 Dec'].map(normaliseDate),
    ['2026-12-05','2026-12-05','2026-12-05',null]);
});

test('a header row is matched by name, in any order, with a Time range column', ()=>{
  const t = parseCsv('Course,Module Code,Weekday,Time,Room\nB.Sc. Computer Science,csc 111,mon,8:00-8:50,G.005\n');
  const { rows, errors, header } = timetableRows(t, 'modules');
  assert.equal(header, true);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ code:'CSC111', a:'Monday', start:'08:00', end:'08:50', venue:'G.005', prog:'B.Sc. Computer Science', faculty:null }]);
});

test('without a header, columns follow the paste-box order; bad lines are reported by line number', ()=>{
  const t = parseCsv('ACF411, Monday, 07:00, 07:50, G.005/G.006, Bachelor of Commerce, Faculty of Commerce\nACF412, Someday, 07:00, 07:50, G.005, BCom\nACF413, Monday, 07:00, 07:50, G.005\n');
  const { rows, errors } = timetableRows(t, 'modules');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].faculty, 'Faculty of Commerce');
  assert.deepEqual(errors, [{ line:2, message:'"Someday" is not a day' }, { line:3, message:'no course name' }]);
});

test('exam rows need a date', ()=>{
  const t = parseCsv('Code,Date,Start,End,Venue,Course\nCSC111,05/12/2026,9:00,12:00,MPH,BSc CS\nCSC211,Monday,9:00,12:00,MPH,BSc CS\n');
  const { rows, errors } = timetableRows(t, 'exams');
  assert.equal(rows[0].a, '2026-12-05');
  assert.match(errors[0].message, /not a date/);
  assert.equal(errors[0].line, 3);
});
