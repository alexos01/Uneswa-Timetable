import { DAYS, HOURS } from './config.js';
import { moduleYear, progName, state, yearLabel } from './state.js';
import { toast } from './util.js';
import { savePdf } from './platform.js';
import { myExams, myModules } from './views/student.js';

/** A landscape timetable: a week grid of `sessions` and, if any, a table of `exams`. */
export function buildTimetablePdf({ title, subtitle, sessions, exams = [], examTitle = 'Exam schedule' }){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });

  // Header banner
  doc.setFillColor(31, 61, 46); // forest green
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(16); doc.text(title, 10, 10);
  doc.setFontSize(10); doc.text(subtitle, 10, 17);
  doc.setTextColor(0,0,0);

  // Build the grid exactly like the on-screen view: rows = hour slots, cols = days
  const head = [['Time', ...DAYS]];
  const body = HOURS.map(h=>{
    const hourNum = Number(h.split(':')[0]);
    const row = [h];
    DAYS.forEach(day=>{
      const cell = sessions.filter(m=> m.day===day && Number((m.start_time||'').split(':')[0])===hourNum)
        .sort((a,b)=>a.start_time.localeCompare(b.start_time) || a.code.localeCompare(b.code))
        .map(m=>`${m.code}\n${m.start_time}-${m.end_time||''}\n${m.venue||'TBC'}`)
        .join('\n\n');
      row.push(cell);
    });
    return row;
  });

  doc.autoTable({
    startY: 27,
    head, body,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 2, valign: 'top', lineColor: [220,220,220], lineWidth: 0.2 },
    headStyles: { fillColor: [31,61,46], textColor: 255, fontStyle: 'bold', halign: 'center' },
    columnStyles: { 0: { cellWidth: 18, fontStyle: 'bold', halign: 'center', fillColor: [247,245,238] } },
    alternateRowStyles: { fillColor: [252,251,247] },
    didParseCell: (data)=>{
      if(data.section==='body' && data.column.index>0 && data.cell.raw){ data.cell.styles.fillColor = [243,230,196]; } // highlight occupied cells
    }
  });

  if(exams.length){
    let y = doc.lastAutoTable.finalY + 10;
    if(y > doc.internal.pageSize.getHeight() - 40){ doc.addPage(); y = 15; }
    doc.setFontSize(12); doc.setTextColor(31,61,46); doc.text(examTitle, 10, y); doc.setTextColor(0,0,0);
    doc.autoTable({
      startY: y+4,
      head:[['Module','Date','Time','Venue']],
      body: exams.map(e=>[e.code, e.exam_date||'TBC', `${e.start_time||''}${e.end_time?'-'+e.end_time:''}`, e.venue||'TBC']),
      styles:{fontSize:9}, theme:'grid',
      headStyles: { fillColor: [166,51,63], textColor: 255, fontStyle: 'bold' }
    });
  }

  const pageCount = doc.internal.getNumberOfPages();
  for(let i=1;i<=pageCount;i++){
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(140,140,140);
    doc.text(`Generated ${new Date().toLocaleDateString()} · University of Eswatini`, 10, doc.internal.pageSize.getHeight()-6);
  }
  return doc;
}

async function save(doc, filename){
  try{
    const how = await savePdf(doc, filename);
    toast(how === 'shared' ? 'PDF ready to save or share' : 'PDF downloaded');
  }catch(err){
    if(!/cancel/i.test(err?.message||'')) toast('Could not export the PDF: '+(err?.message||err));
  }
}

const fileSafe = s=>String(s).trim().replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-|-$/g, '');

export async function exportPdf(student){
  const doc = buildTimetablePdf({
    title: 'UNESWA Personal Timetable',
    subtitle: `${student.name || student.id}  ·  ${student.id}  ·  ${state.meta.semester || ''}`,
    sessions: myModules(student), exams: myExams(student),
  });
  await save(doc, `${(student.name||student.id).replace(/\s+/g,'-')}-timetable.pdf`);
}

/** Sessions (and exams) on a course, optionally one year: the official timetable for that class. */
export function courseTimetable(programmeId, year){
  const inYear = m=>!year || String(moduleYear(m.code))===String(year);
  const sessions = state.modules.filter(m=>m.programme_id===programmeId && inYear(m));
  const codes = new Set(sessions.map(m=>m.code));
  const exams = state.exams.filter(e=>e.programme_id===programmeId && codes.has(e.code))
    .sort((a,b)=>(a.exam_date||'').localeCompare(b.exam_date||''));
  return { sessions, exams };
}

export async function exportCoursePdf(programmeId, year){
  const { sessions, exams } = courseTimetable(programmeId, year);
  const name = progName(programmeId) + (year ? ` · ${yearLabel(Number(year))}` : '');
  const doc = buildTimetablePdf({ title: 'UNESWA Class Timetable', subtitle: `${name}  ·  ${state.meta.semester || ''}`, sessions, exams });
  await save(doc, `${fileSafe(progName(programmeId))}${year ? '-year-'+year : ''}-timetable.pdf`);
}
