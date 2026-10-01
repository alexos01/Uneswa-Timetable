import { sb } from '../db.js';
import { render } from '../render.js';
import { state, progName } from '../state.js';
import { esc, toast } from '../util.js';
import { WEEKDAYS, sortSessions } from '../lib/modules.js';
import { renderNoticeForm, renderNoticeList } from './notices.js';
import { staffHeader, signOut } from './staff.js';

/* ================= LECTURER PORTAL =================
   A lecturer sees only the module codes assigned to them on their campus. They can
   move a session for good (day, time, venue) or post a one-off notice. */
export async function loadLecturerCodes(){
  const { data, error } = await sb.from('lecturer_modules').select('code')
    .eq('user_id', state.session.user.id).eq('campus_id', state.campusId);
  if(error){ toast('Could not load your modules: '+error.message); return []; }
  return [...new Set((data||[]).map(r=>r.code))].sort();
}

export function renderLecturer(){
  const wrap = document.createElement('div');
  wrap.innerHTML = staffHeader() + `<div id="lecBody"><div class="muted">Loading your modules…</div></div>`;
  setTimeout(async ()=>{
    document.getElementById('signOutBtn').onclick = signOut;
    const codes = await loadLecturerCodes();
    const body = document.getElementById('lecBody');
    if(!body) return;
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'grid2';
    const left = document.createElement('div');
    left.appendChild(renderNoticeForm(codes, { onPosted: ()=>render() }));
    left.appendChild(renderNoticeList(codes, { title:'Your upcoming notices', canDelete:true, onChange: ()=>render() }));
    const right = document.createElement('div');
    right.appendChild(renderSessionsEditor(codes));
    grid.append(left, right);
    body.appendChild(grid);
  },0);
  return wrap;
}

function renderSessionsEditor(codes){
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<h2><span class="htitle">Your modules</span> <span class="pill">${codes.length}</span></h2>
    <div class="muted" style="margin-bottom:10px;">Changing a session here moves it for every student on this module, every week. For a one-off change, post a notice instead.</div>`;
  if(!codes.length){
    card.innerHTML += `<div class="empty-state">No modules assigned yet. Ask your campus admin to assign your module codes.</div>`;
    return card;
  }
  for(const code of codes){
    const sessions = sortSessions(state.modules.filter(m=>m.code===code));
    const block = document.createElement('div'); block.className = 'coursegroup';
    block.innerHTML = `<div class="cgtitle">${esc(code)}</div>` + (sessions.length ? sessions.map(s=>`
      <div class="sessedit" data-id="${esc(s.id)}">
        <div class="muted">${esc(progName(s.programme_id))}</div>
        <div class="row">
          <select data-f="day" aria-label="Day">${WEEKDAYS.slice(0,6).map(d=>`<option ${d===s.day?'selected':''}>${d}</option>`).join('')}</select>
          <input data-f="start_time" type="time" step="600" value="${esc(s.start_time||'')}" aria-label="Start">
          <input data-f="end_time" type="time" step="600" value="${esc(s.end_time||'')}" aria-label="End">
          <input data-f="venue" value="${esc(s.venue||'')}" placeholder="Venue" aria-label="Venue" style="width:120px;">
          <button class="btn small" data-save>Save</button>
        </div>
      </div>`).join('') : `<div class="muted">No sessions on the timetable for this code yet.</div>`);
    card.appendChild(block);
  }
  card.querySelectorAll('[data-save]').forEach(btn=>{
    btn.onclick = async ()=>{
      const rowEl = btn.closest('.sessedit');
      const id = rowEl.getAttribute('data-id');
      const patch = {};
      rowEl.querySelectorAll('[data-f]').forEach(el=>{ patch[el.getAttribute('data-f')] = el.value.trim() || null; });
      if(!patch.start_time){ toast('A session needs a start time'); return; }
      btn.disabled = true;
      const { data, error } = await sb.from('modules').update(patch).eq('id', id).select();
      btn.disabled = false;
      if(error || !data || !data.length){ toast('Could not save: '+(error?.message || 'you can only change your own modules')); return; }
      Object.assign(state.modules.find(m=>m.id===id) || {}, data[0]);
      toast('Session updated for all students');
    };
  });
  return card;
}
