import { DAYS, HOURS } from './config.js';
import { state } from './state.js';
import { toast } from './util.js';
import { myExams, myModules } from './views/student.js';

export function exportPdf(student){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  const mods = myModules(student);

  // Header banner
  doc.setFillColor(31, 61, 46); // forest green
  doc.rect(0, 0, doc.internal.pageSize.getWidth(), 22, 'F');
  doc.setTextColor(255,255,255);
  doc.setFontSize(16); doc.text('UNESWA Personal Timetable', 10, 10);
  doc.setFontSize(10); doc.text(`${student.name || student.id}  ·  ${student.id}  ·  ${state.meta.semester || ''}`, 10, 17);
  doc.setTextColor(0,0,0);

  // Build the grid exactly like the on-screen view: rows = hour slots, cols = days
  const head = [['Time', ...DAYS]];
  const body = HOURS.map(h=>{
    const hourNum = Number(h.split(':')[0]);
    const row = [h];
    DAYS.forEach(day=>{
      const cell = mods.filter(m=> m.day===day && Number(m.start_time.split(':')[0])===hourNum)
        .sort((a,b)=>a.start_time.localeCompare(b.start_time))
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

  const exams = myExams(student);
  if(exams.length){
    let y = doc.lastAutoTable.finalY + 10;
    if(y > doc.internal.pageSize.getHeight() - 40){ doc.addPage(); y = 15; }
    doc.setFontSize(12); doc.setTextColor(31,61,46); doc.text('Exam schedule', 10, y); doc.setTextColor(0,0,0);
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

  doc.save(`${(student.name||student.id).replace(/\s+/g,'-')}-timetable.pdf`);
  toast('PDF downloaded');
}
