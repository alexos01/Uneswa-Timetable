import { sb, withCampus, scoped } from '../db.js';
import { facName, progName, state } from '../state.js';
import { esc, toast } from '../util.js';
import { parseCsv, templateHeader, timetableRows, toCsv } from '../lib/csv.js';
import { saveText } from '../platform.js';

/* Class/exam entries */
export async function resolveProgrammeId(name, facultyName){
  name = (name||'').trim(); if(!name) return null;
  let prog = state.programmes.find(p=>p.name.toLowerCase()===name.toLowerCase());
  if(prog) return prog.id;
  let faculty_id = null;
  if(facultyName){
    const fname = facultyName.trim();
    let fac = state.faculties.find(f=>f.name.toLowerCase()===fname.toLowerCase());
    if(!fac){ const {data} = await sb.from('faculties').insert(withCampus({name:fname})).select().single(); fac=data; if(fac) state.faculties.push(fac); }
    if(fac) faculty_id = fac.id;
  }
  const { data, error } = await sb.from('programmes').insert(withCampus({name, faculty_id})).select().single();
  if(error){ console.error(error); return null; }
  state.programmes.push(data);
  return data.id;
}

const TEMPLATE_ROWS = {
  modules: [
    ['ACF411', 'Monday', '07:00', '07:50', 'G.005/G.006', 'Bachelor of Commerce', 'Faculty of Commerce'],
    ['CSC111', 'Wednesday', '10:00', '10:50', 'SC.LEC.TH.I', 'B.Sc. Computer Science', 'Faculty of Science and Engineering'],
  ],
  exams: [
    ['ACF411', '2026-12-05', '09:00', '12:00', 'MPH', 'Bachelor of Commerce', 'Faculty of Commerce'],
    ['CSC111', '2026-12-08', '14:00', '17:00', 'SC.LEC.TH.I', 'B.Sc. Computer Science', 'Faculty of Science and Engineering'],
  ],
};

/** Adds parsed rows (lib/csv.js timetableRows) to the timetable, skipping any already
    there or repeated, so importing the same file twice is safe. Returns a summary line. */
async function importRows(kind, parsed, list, statusEl){
  const isMod = kind==='modules';
  // Resolve every distinct course name once (not per line), creating new ones.
  const facultyFor = new Map();
  parsed.forEach(p=>{ if(!facultyFor.has(p.prog) || (!facultyFor.get(p.prog) && p.faculty)) facultyFor.set(p.prog, p.faculty); });
  statusEl.textContent = `Resolving ${facultyFor.size} course name(s)…`;
  const progIdMap = {};
  for(const [name, faculty] of facultyFor){ progIdMap[name] = await resolveProgrammeId(name, faculty); }

  const dedupeKey = r => isMod
    ? [r.code, r.day, r.start_time, r.end_time, r.venue, r.programme_id].join('|')
    : [r.code, r.exam_date, r.start_time, r.end_time, r.venue, r.programme_id].join('|');
  const seen = new Set(list.map(dedupeKey));
  const rows = [];
  let duplicates = 0;
  for(const p of parsed){
    const row = withCampus({ code:p.code, [isMod?'day':'exam_date']:p.a, start_time:p.start, end_time:p.end, venue:p.venue, programme_id: progIdMap[p.prog] });
    const k = dedupeKey(row);
    if(seen.has(k)){ duplicates++; continue; }
    seen.add(k); rows.push(row);
  }
  const BATCH = 500;
  let inserted = 0, failed = 0;
  for(let i=0;i<rows.length;i+=BATCH){
    const batch = rows.slice(i, i+BATCH);
    statusEl.textContent = `Importing… ${Math.min(i+BATCH, rows.length)} of ${rows.length}`;
    const { error, data } = await sb.from(isMod?'modules':'exams').insert(batch).select('id');
    if(error){ console.error(error); failed += batch.length; }
    else inserted += (data ? data.length : batch.length);
  }
  return { inserted, duplicates, failed };
}

function problemsHtml(errors){
  if(!errors.length) return '';
  const shown = errors.slice(0, 15).map(e=>`<li>Line ${e.line}: ${esc(e.message)}</li>`).join('');
  return `<div class="warnbox"><b>${errors.length} line${errors.length>1?'s':''} will be skipped:</b><ul class="problems">${shown}</ul>${errors.length>15?`…and ${errors.length-15} more.`:''}</div>`;
}

export function renderAdminEntries(kind){
  const isMod = kind==='modules';
  const list = isMod ? state.modules : state.exams;
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<h2><span class="htitle">${isMod?'Class timetable':'Exam timetable'}</span> <span class="pill">${list.length} entries</span>
      ${list.length ? `<button class="btn small danger" id="deleteAllBtn" style="margin-left:auto;">Delete all ${list.length} entries</button>` : ''}</h2>
    <div class="field"><label for="csvFile">Upload the official ${isMod?'class':'exam'} timetable (CSV)</label>
      <input type="file" id="csvFile" accept=".csv,text/csv,text/plain">
      <div class="muted" style="margin-top:4px;">One row per ${isMod?'session':'exam'}. In Excel or Google Sheets use the columns ${templateHeader(kind).map(h=>`<b>${h}</b>`).join(', ')} (Faculty is optional), then save or download as CSV. Days like “Mon”, times like “8:00” and dates like 05/12/2026 are fine.</div>
      <div class="row" style="margin-top:8px;">
        <button class="btn small secondary" id="csvTemplate">Download CSV template</button>
        ${list.length ? `<button class="btn small secondary" id="csvExport">Download these ${list.length} entries as CSV</button>` : ''}
      </div>
    </div>
    <div id="csvPreview"></div>
    <div class="divider"></div>
    <div class="field"><label for="bulkArea">Or paste lines, one entry per line</label>
      <textarea id="bulkArea" style="min-height:120px;" placeholder="${isMod?'ACF411, Monday, 07:00, 07:50, G.005/G.006, Bachelor of Commerce':'ACF411, 2026-12-05, 09:00, 12:00, MPH, Bachelor of Commerce'}"></textarea>
      <div class="muted" style="margin-top:4px;">Format: ${isMod?'code, day, start, end, venue, course name':'code, date (YYYY-MM-DD), start, end, venue, course name'}. Unknown course names are created automatically, with no faculty; assign one in Faculties &amp; Courses. Works for a handful of lines or several thousand at once.</div>
    </div>
    <div class="row"><button class="btn terracotta" id="importBtn">Import lines</button></div>
    <div class="muted" id="importStatus" style="margin-top:8px;font-weight:600;"></div>
    <div class="tablewrap" style="margin-top:16px;"><table class="admintbl"><thead><tr>
      <th>Code</th><th>Course</th><th>${isMod?'Day':'Date'}</th><th>Time</th><th>Venue</th><th></th></tr></thead>
      <tbody id="entryRows"></tbody></table></div>`;

  function refreshRows(){
    const tb = card.querySelector('#entryRows');
    const shown = list.slice(0, 500);
    tb.innerHTML = shown.map(e=>`<tr><td><b>${esc(e.code)}</b></td><td>${esc(progName(e.programme_id))}</td>
      <td>${isMod?esc(e.day):esc(e.exam_date||'')}</td><td>${esc(e.start_time||'')}${e.end_time?'–'+esc(e.end_time):''}</td>
      <td>${esc(e.venue||'')}</td><td><button class="btn small danger" data-del="${e.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="6" class="muted" style="padding:14px;">No entries yet.</td></tr>`;
    if(list.length > 500){
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="6" class="muted" style="padding:10px;">…and ${list.length-500} more (showing first 500 only)</td>`;
      tb.appendChild(tr);
    }
    tb.querySelectorAll('[data-del]').forEach(b=>{
      b.onclick = async ()=>{ await sb.from(isMod?'modules':'exams').delete().eq('id', b.getAttribute('data-del')); toast('Deleted'); };
    });
  }
  refreshRows();

  setTimeout(()=>{
    const statusEl = card.querySelector('#importStatus');
    const btn = card.querySelector('#importBtn');
    const deleteAllBtn = card.querySelector('#deleteAllBtn');
    const report = r=>`Done: ${r.inserted} imported${r.duplicates?`, ${r.duplicates} duplicates skipped`:''}${r.failed?`, ${r.failed} failed (see console)`:''}`;
    if(deleteAllBtn) deleteAllBtn.onclick = async ()=>{
      if(!confirm(`Delete all ${list.length} ${isMod?'class':'exam'} entries? This cannot be undone.`)) return;
      deleteAllBtn.disabled = true; deleteAllBtn.textContent = 'Deleting…';
      const { error } = await scoped(sb.from(isMod?'modules':'exams').delete().neq('id','00000000-0000-0000-0000-000000000000'));
      if(error){ console.error(error); toast('Delete failed. The browser console has the details.'); deleteAllBtn.disabled=false; }
      else toast('All entries deleted');
    };

    card.querySelector('#csvTemplate').onclick = ()=>saveText(toCsv([templateHeader(kind), ...TEMPLATE_ROWS[kind]]), `${kind==='modules'?'class':'exam'}-timetable-template.csv`);
    const exp = card.querySelector('#csvExport');
    if(exp) exp.onclick = ()=>{
      const rows = list.map(e=>{
        const prog = state.programmes.find(p=>p.id===e.programme_id);
        return [e.code, isMod?e.day:e.exam_date, e.start_time, e.end_time, e.venue, prog?.name||'', prog?.faculty_id ? facName(prog.faculty_id) : ''];
      });
      saveText(toCsv([templateHeader(kind), ...rows]), `${kind==='modules'?'class':'exam'}-timetable-${state.campusId||'all'}.csv`);
    };

    // Upload: read the file, show what will be imported and what is wrong, then import on confirm.
    const preview = card.querySelector('#csvPreview');
    card.querySelector('#csvFile').onchange = async e=>{
      const file = e.target.files[0];
      if(!file) return;
      const { rows, errors } = timetableRows(parseCsv(await file.text()), kind);
      if(!rows.length){ preview.innerHTML = `<div class="warnbox">Nothing in <b>${esc(file.name)}</b> could be read as ${isMod?'a class session':'an exam'}.</div>${problemsHtml(errors)}`; return; }
      const courses = new Set(rows.map(r=>r.prog));
      const newCourses = [...courses].filter(n=>!state.programmes.some(p=>p.name.toLowerCase()===n.toLowerCase()));
      preview.innerHTML = `<div class="infobox"><b>${rows.length} ${isMod?'session':'exam'}${rows.length>1?'s':''}</b> ready from ${esc(file.name)}, across ${courses.size} course${courses.size>1?'s':''}${newCourses.length?` (${newCourses.length} new: ${esc(newCourses.slice(0,5).join(', '))}${newCourses.length>5?'…':''})`:''}. Entries already on the timetable are skipped.</div>
        ${problemsHtml(errors)}
        <button class="btn terracotta" id="csvImport">Import ${rows.length} ${isMod?'session':'exam'}${rows.length>1?'s':''}</button>`;
      preview.querySelector('#csvImport').onclick = async ()=>{
        const b = preview.querySelector('#csvImport'); b.disabled = true;
        try{
          const r = await importRows(kind, rows, list, statusEl);
          statusEl.textContent = report(r) + (errors.length?`, ${errors.length} lines skipped (see above)`:'') + '.';
          toast(statusEl.textContent);
          preview.innerHTML = '';
        }catch(err){ console.error(err); statusEl.textContent = 'Import failed: ' + err.message; toast(statusEl.textContent); b.disabled = false; }
      };
    };

    btn.onclick = async ()=>{
      const raw = card.querySelector('#bulkArea').value.trim();
      if(!raw) return;
      const { rows, errors } = timetableRows(parseCsv(raw), kind);
      if(rows.length===0){ toast('Nothing to import. Check the line format.'); statusEl.innerHTML = problemsHtml(errors); return; }
      btn.disabled = true;
      try{
        const r = await importRows(kind, rows, list, statusEl);
        statusEl.textContent = report(r) + (errors.length?`, ${errors.length} lines skipped (wrong format)`:'') + '.';
        toast(statusEl.textContent);
        if(!r.failed) card.querySelector('#bulkArea').value='';
      }catch(err){
        console.error(err);
        statusEl.textContent = 'Import failed: ' + err.message;
        toast(statusEl.textContent);
      }
      btn.disabled = false;
    };
  },0);
  return card;
}
