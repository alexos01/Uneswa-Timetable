import { sb, withCampus, scoped } from '../db.js';
import { progName, state } from '../state.js';
import { esc, toast } from '../util.js';

/* ---------------- class/exam entries ---------------- */
export async function resolveProgrammeId(name, facultyName){
  name = (name||'').trim(); if(!name) return null;
  let prog = state.programmes.find(p=>p.name.toLowerCase()===name.toLowerCase());
  if(prog) return prog.id;
  let faculty_id = null;
  if(facultyName){
    const fname = facultyName.trim();
    let fac = state.faculties.find(f=>f.name.toLowerCase()===fname.toLowerCase());
    if(!fac){ const {data} = await sb.from('faculties').insert(withCampus({name:fname})).select().single(); fac=data; state.faculties.push(fac); }
    if(fac) faculty_id = fac.id;
  }
  const { data, error } = await sb.from('programmes').insert(withCampus({name, faculty_id})).select().single();
  if(error){ console.error(error); return null; }
  state.programmes.push(data);
  return data.id;
}

export function renderAdminEntries(kind){
  const isMod = kind==='modules';
  const list = isMod ? state.modules : state.exams;
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<h2><span class="htitle">${isMod?'Class timetable':'Exam timetable'}</span> <span class="pill">${list.length} entries</span>
      ${list.length ? `<button class="btn small danger" id="deleteAllBtn" style="margin-left:auto;">Delete all ${list.length} entries</button>` : ''}</h2>
    <div class="field"><label>Bulk import — paste as many lines as you like, one entry per line</label>
      <textarea id="bulkArea" style="min-height:160px;" placeholder="${isMod?'ACF411, Monday, 07:00, 07:50, G.005/G.006, Bachelor of Commerce':'ACF411, 2026-12-05, 09:00, 12:00, MPH, Bachelor of Commerce'}"></textarea>
      <div class="muted" style="margin-top:4px;">Format: ${isMod?'code, day, start, end, venue, course name':'code, date (YYYY-MM-DD), start, end, venue, course name'}. Unknown course names are created automatically (with no faculty — assign one in Faculties &amp; Courses). Works for a handful of lines or several thousand at once.</div>
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
    if(deleteAllBtn) deleteAllBtn.onclick = async ()=>{
      if(!confirm(`Delete all ${list.length} ${isMod?'class':'exam'} entries? This cannot be undone.`)) return;
      deleteAllBtn.disabled = true; deleteAllBtn.textContent = 'Deleting…';
      const { error } = await scoped(sb.from(isMod?'modules':'exams').delete().neq('id','00000000-0000-0000-0000-000000000000'));
      if(error){ console.error(error); toast('Delete failed — see console'); deleteAllBtn.disabled=false; }
      else toast('All entries deleted');
    };
    btn.onclick = async ()=>{
      const raw = card.querySelector('#bulkArea').value.trim();
      if(!raw) return;
      const lines = raw.split('\n').map(l=>l.trim()).filter(Boolean);
      const parsed = [];
      let skipped = 0;
      for(const line of lines){
        const parts = line.split(',').map(s=>s.trim());
        if(parts.length<6){ skipped++; continue; }
        const [code,a,start,end,venue,progNameStr] = parts;
        parsed.push({code, a, start, end, venue, prog: progNameStr});
      }
      if(parsed.length===0){ toast('Nothing valid to import — check the line format'); return; }

      btn.disabled = true;
      try{
        // Step 1: resolve every distinct course name ONCE (not per line)
        const distinctProgs = [...new Set(parsed.map(p=>p.prog))];
        statusEl.textContent = `Resolving ${distinctProgs.length} course name(s)…`;
        const progIdMap = {};
        for(const name of distinctProgs){ progIdMap[name] = await resolveProgrammeId(name, null); }

        // Step 2: build all row objects, then drop anything that's already in the
        // database or duplicated within this paste, so re-running import is safe
        const dedupeKey = r => isMod
          ? [r.code, r.day, r.start_time, r.end_time, r.venue, r.programme_id].join('|')
          : [r.code, r.exam_date, r.start_time, r.end_time, r.venue, r.programme_id].join('|');
        const seen = new Set(list.map(dedupeKey));
        const rows = [];
        let duplicates = 0;
        for(const p of parsed){
          const row = isMod
            ? withCampus({ code:p.code, day:p.a, start_time:p.start, end_time:p.end, venue:p.venue, programme_id: progIdMap[p.prog] })
            : withCampus({ code:p.code, exam_date:p.a, start_time:p.start, end_time:p.end, venue:p.venue, programme_id: progIdMap[p.prog] });
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
        statusEl.textContent = `Done — ${inserted} imported${duplicates?`, ${duplicates} duplicates skipped`:''}${failed?`, ${failed} failed (see console)`:''}${skipped?`, ${skipped} lines skipped (wrong format)`:''}.`;
        toast(statusEl.textContent);
        if(!failed) card.querySelector('#bulkArea').value='';
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
