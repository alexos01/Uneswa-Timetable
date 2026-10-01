import { DAYS } from '../config.js';
import { fetchAllRows, sb } from '../db.js';
import { progName, state } from '../state.js';
import { esc } from '../util.js';
import { groupModulesByCode } from './student.js';

/* ---------------- Students directory ---------------- */
export async function loadStudentsList(){ state.students = await fetchAllRows('students', 'updated_at', false); }

export function renderAdminStudents(){
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<h2><span class="htitle">Registered students</span> <span class="pill">${state.students.length}</span></h2>
    <div class="field"><label>Search by name or student number</label><input id="stuSearch" value="${esc(state.studentSearch)}"></div>
    <div class="tablewrap"><table class="admintbl"><thead><tr>
      <th>ID</th><th>Name</th><th>Course</th><th>Modules</th><th>Updated</th><th></th>
    </tr></thead><tbody id="stuRows"></tbody></table></div>
    <div id="stuEditWrap" style="margin-top:16px;"></div>`;

  function matches(s,q){ if(!q) return true; q=q.toLowerCase(); return (s.id||'').toLowerCase().includes(q) || (s.name||'').toLowerCase().includes(q); }
  function refresh(){
    const rows = state.students.filter(s=>matches(s,state.studentSearch));
    card.querySelector('#stuRows').innerHTML = rows.map(s=>`<tr>
      <td>${esc(s.id)}</td><td>${esc(s.name||'—')}</td><td>${esc(progName(s.programme_id))}</td>
      <td>${(s.module_ids||[]).length}</td><td>${s.updated_at?new Date(s.updated_at).toLocaleDateString():''}</td>
      <td class="row"><button class="btn small secondary" data-edit="${esc(s.id)}">Edit</button>
      <button class="btn small danger" data-del="${esc(s.id)}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="6" class="muted" style="padding:14px;">No students match.</td></tr>`;
    card.querySelectorAll('[data-edit]').forEach(b=>{ b.onclick=()=>{ state.editingStudentId=b.getAttribute('data-edit'); renderEditPanel(); }; });
    card.querySelectorAll('[data-del]').forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm('Delete this student record?')) return;
        await sb.from('students').delete().eq('id', b.getAttribute('data-del'));
        await loadStudentsList(); if(state.editingStudentId===b.getAttribute('data-del')) state.editingStudentId=null;
        refresh(); renderEditPanel();
      };
    });
  }
  function renderEditPanel(){
    const w = card.querySelector('#stuEditWrap');
    const s = state.students.find(x=>x.id===state.editingStudentId);
    if(!s){ w.innerHTML=''; return; }
    w.innerHTML = `<h2><span class="htitle">Editing ${esc(s.name||s.id)}</span> <button class="btn small secondary" id="closeEditBtn">Close</button></h2>
      <div class="row">
        <div class="field" style="flex:1;"><label>Name</label><input id="editName" value="${esc(s.name)}"></div>
      </div>
      <div class="field"><label>Search modules to add/drop on this student's behalf</label><input id="editModSearch"></div>
      <div class="modlist" id="editModList"></div>`;
    function refreshEditList(q){
      const el = document.getElementById('editModList'); q=(q||'').toLowerCase();
      const mods = state.modules.filter(m=>!q || m.code.toLowerCase().includes(q));
      const byProg={}; mods.forEach(m=>{ (byProg[m.programme_id]=byProg[m.programme_id]||[]).push(m); });
      let html='';
      Object.keys(byProg).forEach(pid=>{
        html += `<div class="muted" style="padding:8px 2px 2px;font-weight:600;">${esc(progName(pid))}</div>`;
        const groups = groupModulesByCode(byProg[pid]);
        Object.keys(groups).sort().forEach(code=>{
          const sessions = groups[code].slice().sort((a,b)=> DAYS.indexOf(a.day)-DAYS.indexOf(b.day) || a.start_time.localeCompare(b.start_time));
          const ids = sessions.map(x=>x.id);
          const checked = ids.some(id=>(s.module_ids||[]).includes(id));
          const summary = sessions.map(x=>`${x.day.slice(0,3)} ${x.start_time}–${x.end_time||''} · ${x.venue||'TBC'}`).join(' · ');
          html += `<label class="modrow"><input type="checkbox" data-ids="${ids.join(',')}" ${checked?'checked':''}>
            <div><div class="code">${esc(code)}</div><div class="meta">${esc(summary)}</div></div></label>`;
        });
      });
      el.innerHTML = html || `<div class="empty-state">No modules loaded.</div>`;
      el.querySelectorAll('input[type=checkbox]').forEach(cb=>{
        cb.onchange = async (e)=>{
          const ids = e.target.getAttribute('data-ids').split(',');
          s.module_ids = s.module_ids || [];
          if(e.target.checked) ids.forEach(id=>{ if(!s.module_ids.includes(id)) s.module_ids.push(id); });
          else { const idSet=new Set(ids); s.module_ids = s.module_ids.filter(x=>!idSet.has(x)); }
          s.updated_at = new Date().toISOString(); s.semester_version = state.meta.semester_version;
          await sb.from('students').update({module_ids:s.module_ids, updated_at:s.updated_at, semester_version:s.semester_version}).eq('id', s.id);
          refresh();
        };
      });
    }
    refreshEditList();
    document.getElementById('editModSearch').oninput = e=>refreshEditList(e.target.value);
    document.getElementById('editName').onchange = async e=>{ s.name=e.target.value; await sb.from('students').update({name:s.name}).eq('id', s.id); refresh(); };
    document.getElementById('closeEditBtn').onclick = ()=>{ state.editingStudentId=null; renderEditPanel(); };
  }
  refresh(); renderEditPanel();
  setTimeout(()=>{ card.querySelector('#stuSearch').oninput = e=>{ state.studentSearch=e.target.value; refresh(); }; },0);
  return card;
}
