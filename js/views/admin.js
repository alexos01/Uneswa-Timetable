import { renderAiImport } from '../ai-import.js';
import { sb } from '../db.js';
import { render } from '../render.js';
import { programmesInFaculty, state } from '../state.js';
import { esc, toast } from '../util.js';
import { renderAdminEntries } from './admin-entries.js';
import { renderAdminSettings } from './admin-settings.js';
import { loadStudentsList, renderAdminStudents } from './admin-students.js';

/* ================= ADMIN VIEW ================= */
export function renderAdmin(){
  const wrap=document.createElement('div');
  if(!state.isAdmin){
    wrap.innerHTML = `<div class="adminlock card">
      <h2 style="justify-content:center;"><span class="htitle">Admin sign-in</span></h2>
      <div class="field"><label>Email</label><input id="adminEmail" type="email" placeholder="admin@uneswa.ac.sz"></div>
      <div class="field"><label>Password</label><input id="adminPass" type="password"></div>
      <button class="btn terracotta" id="adminGoBtn" style="width:100%;">Sign in</button>
      <div class="muted" style="margin-top:10px;">Create this login once in your Supabase dashboard under Authentication → Users.</div>
    </div>`;
    setTimeout(()=>{
      document.getElementById('adminGoBtn').onclick = async ()=>{
        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPass').value;
        if(!email || !password){ toast('Enter email and password'); return; }
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if(error){ toast(error.message); return; }
        state.isAdmin = true; state.adminSession = data.session;
        render();
      };
    },0);
    return wrap;
  }

  wrap.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:16px;">
    <div class="admintabs">
      <button data-t="faculties" class="${state.adminTab==='faculties'?'active':''}">Faculties &amp; Courses</button>
      <button data-t="modules" class="${state.adminTab==='modules'?'active':''}">Class timetable</button>
      <button data-t="exams" class="${state.adminTab==='exams'?'active':''}">Exam timetable</button>
      <button data-t="aiimport" class="${state.adminTab==='aiimport'?'active':''}">AI Import</button>
      <button data-t="students" class="${state.adminTab==='students'?'active':''}">Students</button>
      <button data-t="settings" class="${state.adminTab==='settings'?'active':''}">Settings</button>
    </div>
    <button class="btn secondary small" id="signOutBtn">Sign out</button>
  </div>
  <div id="adminBody"></div>`;

  setTimeout(async ()=>{
    wrap.querySelectorAll('.admintabs button').forEach(b=>{ b.onclick=()=>{ state.adminTab=b.getAttribute('data-t'); render(); }; });
    document.getElementById('signOutBtn').onclick = async ()=>{ await sb.auth.signOut(); state.isAdmin=false; render(); };
    const body = document.getElementById('adminBody');
    if(state.adminTab==='faculties') body.appendChild(renderAdminFaculties());
    else if(state.adminTab==='modules') body.appendChild(renderAdminEntries('modules'));
    else if(state.adminTab==='exams') body.appendChild(renderAdminEntries('exams'));
    else if(state.adminTab==='aiimport') body.appendChild(renderAiImport());
    else if(state.adminTab==='students'){ await loadStudentsList(); body.appendChild(renderAdminStudents()); }
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
      const { error } = await sb.from('faculties').insert({name});
      if(error) toast(error.message); else { toast('Faculty added'); card.querySelector('#newFacName').value=''; }
    };
    card.querySelector('#addProgBtn').onclick = async ()=>{
      const name = card.querySelector('#newProgName').value.trim();
      const faculty_id = card.querySelector('#newProgFac').value || null;
      if(!name){ toast('Enter a course name'); return; }
      const { error } = await sb.from('programmes').insert({name, faculty_id});
      if(error) toast(error.message); else { toast('Course added'); card.querySelector('#newProgName').value=''; }
    };
  },0);
  return card;
}
