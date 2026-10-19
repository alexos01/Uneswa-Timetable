import { countDuplicates, removeDuplicates, sb, scoped, updateSemester, campusName } from '../db.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';
import { removeTimetablePdf, timetablePdf, uploadTimetablePdf } from '../timetable-pdf.js';
import { render } from '../render.js';

const MAX_PDF_MB = 20; // the bucket's limit (migration 004)

/** Upload, replace or remove the university's timetable PDF for this campus. */
function pdfSection(){
  const pdf = timetablePdf();
  const day = pdf?.at ? new Date(pdf.at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '';
  return `<div class="divider"></div>
    <h2><span class="htitle">Official timetable PDF</span></h2>
    ${pdf
      ? `<div class="infobox">Students see <b>${esc(pdf.name)}</b>${day ? `, uploaded ${esc(day)},` : ''} at the bottom of My Timetable. <a href="${esc(pdf.url)}" target="_blank" rel="noopener">Open it</a></div>`
      : `<div class="muted" style="margin-bottom:10px;">Upload the university's timetable PDF and students will find it at the bottom of My Timetable, offline too.</div>`}
    <div class="field"><label for="ttPdfFile">${pdf ? 'Replace with' : 'PDF file'} (up to ${MAX_PDF_MB} MB)</label><input id="ttPdfFile" type="file" accept="application/pdf,.pdf"></div>
    <div class="row"><button class="btn" id="ttPdfUpload">Upload</button>${pdf ? '<button class="btn danger" id="ttPdfRemove">Remove</button>' : ''}</div>`;
}

/* Settings */
export function renderAdminSettings(){
  const card=document.createElement('div'); card.className='card';
  const modDupeCount = countDuplicates(state.modules, m=>[m.code,m.day,m.start_time,m.end_time,m.venue,m.programme_id].join('|'));
  const examDupeCount = countDuplicates(state.exams, e=>[e.code,e.exam_date,e.start_time,e.end_time,e.venue,e.programme_id].join('|'));
  card.innerHTML = `<h2><span class="htitle">Timetable settings${state.caps.campuses ? ` · ${esc(campusName(state.campusId))}` : ''}</span></h2>
    <div class="field"><label>Semester / version label</label>
      <input id="semInput" value="${esc(state.meta.semester)}" placeholder="e.g. Semester 1, 2026/2027"></div>
    <button class="btn secondary" id="saveSemBtn">Update label (no reset)</button>
    ${state.caps.v4 ? pdfSection() : ''}

    <div class="divider"></div>
    <h2><span class="htitle">Clean up duplicate entries</span></h2>
    ${(modDupeCount+examDupeCount) > 0
      ? `<div class="warnbox">Found ${modDupeCount} duplicate class session(s) and ${examDupeCount} duplicate exam entr${examDupeCount===1?'y':'ies'}, probably from importing the same file more than once. This removes the extras and keeps one copy of each.</div>
         <button class="btn danger" id="cleanupBtn">Remove ${modDupeCount+examDupeCount} duplicate entries</button>`
      : `<div class="infobox">No duplicates found.</div>`}
    <div id="cleanupStatus" class="muted" style="margin-top:8px;font-weight:600;"></div>

    <div class="divider"></div>
    <h2><span class="htitle">Start a new semester</span></h2>
    <div class="warnbox">This clears every student's module selection${state.caps.campuses ? ` on the ${esc(campusName(state.campusId))} campus` : ''} so they choose again from scratch. Past choices are kept in their history.</div>
    <div class="field"><label>New semester label</label><input id="newSemInput" placeholder="e.g. Semester 2, 2026/2027"></div>
    <label class="row" style="font-size:13px;margin-bottom:10px;"><input type="checkbox" id="alsoClearTimetable"> Also clear the current class &amp; exam timetable</label>
    <button class="btn danger" id="startSemBtn">Start new semester &amp; reset student selections</button>`;
  setTimeout(()=>{
    card.querySelector('#saveSemBtn').onclick = async ()=>{
      try{ await updateSemester({ semester: card.querySelector('#semInput').value||'Not set' }); toast('Label updated'); }
      catch(err){ toast('Could not update: '+err.message); }
    };
    const upBtn = card.querySelector('#ttPdfUpload');
    if(upBtn) upBtn.onclick = async ()=>{
      const file = card.querySelector('#ttPdfFile').files[0];
      if(!file){ toast('Choose the PDF first'); return; }
      if(file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)){ toast('That is not a PDF'); return; }
      if(file.size > MAX_PDF_MB*1024*1024){ toast(`The PDF must be ${MAX_PDF_MB} MB or smaller`); return; }
      upBtn.disabled = true;
      try{ await uploadTimetablePdf(file); toast('Timetable PDF uploaded. Students see it at the bottom of My Timetable.'); render(); }
      catch(err){ toast('Could not upload: '+err.message); upBtn.disabled = false; }
    };
    const rmBtn = card.querySelector('#ttPdfRemove');
    if(rmBtn) rmBtn.onclick = async ()=>{
      if(!confirm('Take the timetable PDF down? Students will no longer see it.')) return;
      try{ await removeTimetablePdf(); toast('Timetable PDF removed'); render(); }
      catch(err){ toast('Could not remove: '+err.message); }
    };
    const cleanupBtn = card.querySelector('#cleanupBtn');
    if(cleanupBtn) cleanupBtn.onclick = async ()=>{
      if(!confirm(`Delete ${modDupeCount+examDupeCount} duplicate entries? One copy of each is always kept.`)) return;
      cleanupBtn.disabled = true;
      const statusEl = card.querySelector('#cleanupStatus');
      const removed = await removeDuplicates(statusEl);
      statusEl.textContent = `Removed ${removed} duplicate entries.`;
      toast(statusEl.textContent);
    };
    card.querySelector('#startSemBtn').onclick = async ()=>{
      const label = card.querySelector('#newSemInput').value.trim();
      if(!label){ toast('Enter a semester label first'); return; }
      if(!confirm("This resets every registered student's module selection. Continue?")) return;
      try{ await updateSemester({ semester:label, semester_version:(state.meta.semester_version||1)+1 }); }
      catch(err){ toast('Could not start the semester: '+err.message); return; }
      if(card.querySelector('#alsoClearTimetable').checked){
        await scoped(sb.from('modules').delete().neq('id','00000000-0000-0000-0000-000000000000'));
        await scoped(sb.from('exams').delete().neq('id','00000000-0000-0000-0000-000000000000'));
      }
      toast('New semester started');
    };
  },0);
  return card;
}
