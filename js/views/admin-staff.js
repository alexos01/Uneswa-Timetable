import { sb, campusName, isSuperAdmin } from '../db.js';
import { render } from '../render.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';

const ROLE_LABEL = { super_admin:'Super admin', campus_admin:'Campus admin', lecturer:'Lecturer' };

/* ---------------- Staff & lecturers ----------------
   Staff create their own account (Staff sign in -> Create a staff account); an admin
   then grants a role by email through the grant_staff_role() RPC, which checks on the
   server that the caller may grant it. */
export async function renderAdminStaff(){
  const card = document.createElement('div'); card.className = 'card';
  const [st, lm] = await Promise.all([
    sb.from('staff').select('*').order('role'),
    sb.from('lecturer_modules').select('*').eq('campus_id', state.campusId),
  ]);
  if(st.error){ card.innerHTML = `<div class="warnbox">Could not load staff: ${esc(st.error.message)}</div>`; return card; }
  const staff = (st.data||[]).filter(s=>s.role==='super_admin' || s.campus_id===state.campusId);
  const assignments = lm.data || [];
  const codes = [...new Set(state.modules.map(m=>m.code))].sort();
  const roles = isSuperAdmin() ? ['lecturer','campus_admin','super_admin'] : ['lecturer'];
  const me = state.session.user.id;

  card.innerHTML = `<h2><span class="htitle">Staff &amp; lecturers · ${esc(campusName(state.campusId))}</span> <span class="pill">${staff.length}</span></h2>
    <div class="infobox">Ask the person to open <b>Staff → Create a staff account</b> first. Then add their email here.</div>
    <div class="formgrid">
      <div class="field"><label for="grEmail">Email</label><input id="grEmail" type="email" placeholder="lecturer@example.com"></div>
      <div class="field"><label for="grName">Display name</label><input id="grName" placeholder="e.g. Dr N. Dlamini"></div>
      <div class="field"><label for="grRole">Role</label><select id="grRole">${roles.map(r=>`<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select></div>
    </div>
    <button class="btn" id="grBtn">Add to ${esc(campusName(state.campusId))}</button>
    <div class="tablewrap" style="margin-top:16px;"><table class="admintbl"><thead><tr><th>Name</th><th>Role</th><th>Modules taught</th><th></th></tr></thead>
    <tbody>${staff.map(s=>{
      const mine = assignments.filter(a=>a.user_id===s.user_id).map(a=>a.code).sort();
      const canRemove = s.user_id!==me && (isSuperAdmin() || s.role==='lecturer');
      return `<tr>
        <td><b>${esc(s.display_name || '—')}</b><div class="muted">${esc(s.email||'')}</div></td>
        <td>${esc(ROLE_LABEL[s.role]||s.role)}${s.role==='super_admin'?'<div class="muted">all campuses</div>':''}</td>
        <td>${s.role==='lecturer' ? `${mine.map(c=>`<span class="modchip">${esc(c)} <button class="chipx" aria-label="Unassign ${esc(c)}" data-unassign="${esc(s.user_id)}|${esc(c)}">×</button></span>`).join('')}
            <div class="row" style="margin-top:6px;"><input list="codeList" data-assigninput="${esc(s.user_id)}" placeholder="Module code" style="width:120px;padding:5px;border:1px solid var(--line);border-radius:7px;">
            <button class="btn small secondary" data-assign="${esc(s.user_id)}">Assign</button></div>` : '<span class="muted">—</span>'}</td>
        <td>${canRemove?`<button class="btn small danger" data-remove="${esc(s.user_id)}">Remove</button>`:''}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="4" class="muted" style="padding:14px;">No staff on this campus yet.</td></tr>`}</tbody></table></div>
    <datalist id="codeList">${codes.map(c=>`<option value="${esc(c)}">`).join('')}</datalist>`;

  setTimeout(()=>{
    card.querySelector('#grBtn').onclick = async ()=>{
      const email = card.querySelector('#grEmail').value.trim();
      const role = card.querySelector('#grRole').value;
      if(!email){ toast('Enter the person\'s email'); return; }
      const { error } = await sb.rpc('grant_staff_role', { p_email: email, p_role: role, p_campus: state.campusId, p_name: card.querySelector('#grName').value.trim() || null });
      if(error){ toast(error.message); return; }
      toast(`${email} is now ${ROLE_LABEL[role].toLowerCase()}`);
      render();
    };
    card.querySelectorAll('[data-assign]').forEach(b=>{
      b.onclick = async ()=>{
        const uid = b.getAttribute('data-assign');
        const code = card.querySelector(`[data-assigninput="${uid}"]`).value.trim().toUpperCase();
        if(!code){ toast('Enter a module code'); return; }
        if(!codes.includes(code) && !confirm(`${code} is not on this campus's timetable yet. Assign it anyway?`)) return;
        const { error } = await sb.from('lecturer_modules').insert({ user_id: uid, campus_id: state.campusId, code });
        if(error){ toast(error.code==='23505' ? `${code} is already assigned` : error.message); return; }
        toast(`${code} assigned`); render();
      };
    });
    card.querySelectorAll('[data-unassign]').forEach(b=>{
      b.onclick = async ()=>{
        const [uid, code] = b.getAttribute('data-unassign').split('|');
        const { error } = await sb.from('lecturer_modules').delete().eq('user_id', uid).eq('campus_id', state.campusId).eq('code', code);
        if(error){ toast(error.message); return; }
        toast(`${code} unassigned`); render();
      };
    });
    card.querySelectorAll('[data-remove]').forEach(b=>{
      b.onclick = async ()=>{
        if(!confirm('Remove this person\'s staff role? Their account stays, but they lose access.')) return;
        const { error } = await sb.from('staff').delete().eq('user_id', b.getAttribute('data-remove'));
        if(error){ toast(error.message); return; }
        toast('Staff role removed'); render();
      };
    });
  },0);
  return card;
}
