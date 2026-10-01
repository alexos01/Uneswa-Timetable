import { renderAiImport } from '../ai-import.js';
import { sb, withCampus, ensureCampus, isSuperAdmin } from '../db.js';
import { render } from '../render.js';
import { programmesInFaculty, state } from '../state.js';
import { esc, toast } from '../util.js';
import { renderAdminEntries } from './admin-entries.js';
import { renderAdminSettings } from './admin-settings.js';
import { loadStudentsList, renderAdminStudents } from './admin-students.js';
import { renderAdminStaff } from './admin-staff.js';
import { renderAdminNotices } from './admin-notices.js';
import { staffHeader, signOut } from './staff.js';

/* ================= ADMIN VIEW ================= */
const ADMIN_TABS = [
  ['faculties', 'Faculties &amp; Courses'],
  ['modules', 'Class timetable'],
  ['exams', 'Exam timetable'],
  ['aiimport', 'AI Import'],
  ['notices', 'Announcements &amp; notices', s=>s.caps.notices],
  ['students', 'Students'],
  ['staffmgmt', 'Staff &amp; lecturers', s=>s.caps.campuses],
  ['settings', 'Settings'],
];

export function renderAdmin(){
  const wrap=document.createElement('div');
  const tabs = ADMIN_TABS.filter(([,, show])=>!show || show(state));
  if(!tabs.some(([id])=>id===state.adminTab)) state.adminTab = 'faculties';
  const switcher = (isSuperAdmin() && state.caps.campuses)
    ? `<label class="campusswitch">Campus <select id="adminCampusSel">${state.campuses.map(c=>`<option value="${esc(c.id)}" ${c.id===state.campusId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>`
    : '';
  wrap.innerHTML = `${staffHeader(switcher)}
  ${state.caps.campuses ? '' : `<div class="infobox">Campuses, lecturers and announcements switch on once <code>supabase/migrations/001_campuses_and_roles.sql</code> and <code>002_announcements_and_notices.sql</code> have been run in the Supabase SQL editor.</div>`}
  <div class="admintabs">
    ${tabs.map(([id,label])=>`<button data-t="${id}" class="${state.adminTab===id?'active':''}">${label}</button>`).join('')}
  </div>
  <div id="adminBody"></div>`;

  setTimeout(async ()=>{
    wrap.querySelectorAll('.admintabs button').forEach(b=>{ b.onclick=()=>{ state.adminTab=b.getAttribute('data-t'); render(); }; });
    document.getElementById('signOutBtn').onclick = signOut;
    const cs = document.getElementById('adminCampusSel');
    if(cs) cs.onchange = async e=>{ await ensureCampus(e.target.value); render(); };
    const body = document.getElementById('adminBody');
    if(state.adminTab==='faculties') body.appendChild(renderAdminFaculties());
    else if(state.adminTab==='modules') body.appendChild(renderAdminEntries('modules'));
    else if(state.adminTab==='exams') body.appendChild(renderAdminEntries('exams'));
    else if(state.adminTab==='aiimport') body.appendChild(renderAiImport());
    else if(state.adminTab==='notices') body.appendChild(renderAdminNotices());
    else if(state.adminTab==='students'){ await loadStudentsList(); body.appendChild(renderAdminStudents()); }
    else if(state.adminTab==='staffmgmt') body.appendChild(await renderAdminStaff());
    else body.appendChild(renderAdminSettings());
  },0);
  return wrap;
}

/* ---------------- Faculties & Courses ---------------- */
export function renderAdminFaculties(){
  const card=document.createElement('div'); card.className='card';
  card.innerHTML = `<h2><span class="htitle">Faculties</span></h2>
    <div class="row"><input id="newFacName" placeholder="New faculty name" style="flex:1;padding:9px;border:1px solid var(--line);border-radius:9px;">
      <button class="btn" id="addFacBtn">Add faculty</button></div>
    <div class="tablewrap" style="margin-top:14px;"><table class="admintbl"><thead><tr><th>Faculty</th><th>Courses</th><th></th></tr></thead>
      <tbody id="facRows"></tbody></table></div>
    <div class="divider"></div>
    <h2><span class="htitle">Courses (programmes)</span></h2>
    <div class="row">
      <input id="newProgName" placeholder="New course name" style="flex:1;min-width:180px;padding:9px;border:1px solid var(--line);border-radius:9px;">
      <select id="newProgFac" style="padding:9px;border:1px solid var(--line);border-radius:9px;">
        <option value="">No faculty yet</option>
        ${state.faculties.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}
      </select>
      <button class="btn" id="addProgBtn">Add course</button>
    </div>
    <div class="tablewrap" style="margin-top:14px;"><table class="admintbl"><thead><tr><th>Course</th><th>Faculty</th><th>Modules</th><th></th></tr></thead>
      <tbody id="progRows"></tbody></table></div>`;

  function refreshFac(){
    card.querySelector('#facRows').innerHTML = state.faculties.map(f=>`<tr>
      <td><b>${esc(f.name)}</b></td><td>${programmesInFaculty(f.id).length}</td>
      <td><button class="btn small danger" data-delfac="${f.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="3" class="muted" style="padding:14px;">No faculties yet.</td></tr>`;
    card.querySelectorAll('[data-delfac]').forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm('Delete this faculty? Its courses will become unassigned.')) return;
        await sb.from('faculties').delete().eq('id', b.getAttribute('data-delfac'));
        toast('Faculty deleted');
      };
    });
  }
  function refreshProg(){
    card.querySelector('#progRows').innerHTML = state.programmes.map(p=>`<tr>
      <td><b>${esc(p.name)}</b></td>
      <td><select data-reassign="${p.id}" style="padding:5px;border:1px solid var(--line);border-radius:7px;">
        <option value="">No faculty</option>
        ${state.faculties.map(f=>`<option value="${f.id}" ${p.faculty_id===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}
      </select></td>
      <td>${state.modules.filter(m=>m.programme_id===p.id).length}</td>
      <td><button class="btn small danger" data-delprog="${p.id}">Delete</button></td></tr>`).join('')
      || `<tr><td colspan="4" class="muted" style="padding:14px;">No courses yet.</td></tr>`;
    card.querySelectorAll('[data-reassign]').forEach(sel=>{
      sel.onchange = async (e)=>{
        await sb.from('programmes').update({faculty_id: e.target.value || null}).eq('id', sel.getAttribute('data-reassign'));
        toast('Faculty updated');
      };
    });
    card.querySelectorAll('[data-delprog]').forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm('Delete this course? Its modules and exam entries will be deleted too.')) return;
        await sb.from('programmes').delete().eq('id', b.getAttribute('data-delprog'));
        toast('Course deleted');
      };
    });
  }
  refreshFac(); refreshProg();
  setTimeout(()=>{
    card.querySelector('#addFacBtn').onclick = async ()=>{
      const name = card.querySelector('#newFacName').value.trim();
      if(!name){ toast('Enter a faculty name'); return; }
      const { error } = await sb.from('faculties').insert(withCampus({name}));
      if(error) toast(error.message); else { toast('Faculty added'); card.querySelector('#newFacName').value=''; }
    };
    card.querySelector('#addProgBtn').onclick = async ()=>{
      const name = card.querySelector('#newProgName').value.trim();
      const faculty_id = card.querySelector('#newProgFac').value || null;
      if(!name){ toast('Enter a course name'); return; }
      const { error } = await sb.from('programmes').insert(withCampus({name, faculty_id}));
      if(error) toast(error.message); else { toast('Course added'); card.querySelector('#newProgName').value=''; }
    };
  },0);
  return card;
}
