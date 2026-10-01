import { countDuplicates, removeDuplicates, sb, scoped, updateSemester, campusName } from '../db.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';

/* ---------------- Settings ---------------- */
export function renderAdminSettings(){
  const card=document.createElement('div'); card.className='card';
  const modDupeCount = countDuplicates(state.modules, m=>[m.code,m.day,m.start_time,m.end_time,m.venue,m.programme_id].join('|'));
  const examDupeCount = countDuplicates(state.exams, e=>[e.code,e.exam_date,e.start_time,e.end_time,e.venue,e.programme_id].join('|'));
  card.innerHTML = `<h2><span class="htitle">Timetable settings${state.caps.campuses ? ` · ${esc(campusName(state.campusId))}` : ''}</span></h2>
    <div class="field"><label>Semester / version label</label>
      <input id="semInput" value="${esc(state.meta.semester)}" placeholder="e.g. Semester 1, 2026/2027"></div>
    <button class="btn secondary" id="saveSemBtn">Update label (no reset)</button>

    <div class="divider"></div>
    <h2><span class="htitle">Clean up duplicate entries</span></h2>
    ${(modDupeCount+examDupeCount) > 0
      ? `<div class="warnbox">Found ${modDupeCount} duplicate class session(s) and ${examDupeCount} duplicate exam entr${examDupeCount===1?'y':'ies'} — likely from bulk-importing the same file more than once. This removes the extras and keeps one copy of each.</div>
         <button class="btn danger" id="cleanupBtn">Remove ${modDupeCount+examDupeCount} duplicate entries</button>`
      : `<div class="infobox">No duplicates found — the timetable looks clean.</div>`}
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
