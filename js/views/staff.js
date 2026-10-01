import { sb, loadStaff, isAdmin, isLecturer, ensureCampus, campusName } from '../db.js';
import { render } from '../render.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';
import { renderAdmin } from './admin.js';
import { renderLecturer } from './lecturer.js';

/* ================= STAFF: sign-in and role routing ================= */
export function renderStaff(){
  if(!state.session) return renderSignIn();
  if(isAdmin()) return renderAdmin();
  if(isLecturer()) return renderLecturer();
  return renderNoRole();
}

async function afterSignIn(session){
  await loadStaff(session);
  if(state.staff?.campus_id && state.staff.role!=='super_admin') await ensureCampus(state.staff.campus_id);
  render();
}

export async function signOut(){
  await sb.auth.signOut();
  state.session = null; state.staff = null;
  render();
}

function renderSignIn(){
  const wrap = document.createElement('div');
  const canSignUp = state.caps.campuses;
  wrap.innerHTML = `<div class="adminlock card">
    <h2 style="justify-content:center;"><span class="htitle">${canSignUp ? 'Staff sign in' : 'Admin sign in'}</span></h2>
    <div class="field"><label for="adminEmail">Email</label><input id="adminEmail" type="email" autocomplete="username" placeholder="you@example.com"></div>
    <div class="field"><label for="adminPass">Password</label><input id="adminPass" type="password" autocomplete="current-password"></div>
    <button class="btn terracotta" id="adminGoBtn" style="width:100%;">Sign in</button>
    ${canSignUp ? `<button class="btn secondary" id="signUpBtn" style="width:100%;margin-top:8px;">Create a staff account</button>
      <div class="muted" style="margin-top:10px;">Lecturers and campus admins: create an account, then ask your campus admin to give it a role.</div>`
      : `<div class="muted" style="margin-top:10px;">Create this login once in your Supabase dashboard under Authentication → Users.</div>`}
  </div>`;
  setTimeout(()=>{
    const creds = ()=>({ email: document.getElementById('adminEmail').value.trim(), password: document.getElementById('adminPass').value });
    document.getElementById('adminGoBtn').onclick = async ()=>{
      const { email, password } = creds();
      if(!email || !password){ toast('Enter email and password'); return; }
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error){ toast(error.message); return; }
      await afterSignIn(data.session);
    };
    const up = document.getElementById('signUpBtn');
    if(up) up.onclick = async ()=>{
      const { email, password } = creds();
      if(!email || password.length < 8){ toast('Enter your email and a password of at least 8 characters'); return; }
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error){ toast(error.message); return; }
      if(!data.session){ toast('Account created. Check your email to confirm it, then sign in.'); return; }
      toast('Account created');
      await afterSignIn(data.session);
    };
  },0);
  return wrap;
}

function renderNoRole(){
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="adminlock card" style="text-align:left;">
    <h2><span class="htitle">Waiting for a role</span></h2>
    <p>You're signed in as <b>${esc(state.session.user.email)}</b>, but this account hasn't been given a staff role yet.</p>
    <p class="muted">Ask your campus admin to add this email under <b>Staff → Staff &amp; lecturers</b>. Then sign out and sign in again.</p>
    <div class="row"><button class="btn secondary" id="recheckBtn">Check again</button><button class="btn secondary" id="signOutBtn">Sign out</button></div>
  </div>`;
  setTimeout(()=>{
    document.getElementById('signOutBtn').onclick = signOut;
    document.getElementById('recheckBtn').onclick = ()=>afterSignIn(state.session);
  },0);
  return wrap;
}

/** Header strip shared by the admin and lecturer views. */
export function staffHeader(extraHtml=''){
  const s = state.staff;
  const roleLabel = { super_admin:'Super admin', campus_admin:'Campus admin', lecturer:'Lecturer' }[s.role] || s.role;
  const where = s.legacy ? '' : (s.role==='super_admin' ? 'all campuses' : campusName(s.campus_id));
  return `<div class="staffbar"><span class="muted">Signed in as <b>${esc(s.display_name || s.email || state.session.user.email)}</b>
      · ${esc(roleLabel)}${where ? ` · ${esc(where)}` : ''}</span>${extraHtml}
    <button class="btn secondary small" id="signOutBtn">Sign out</button></div>`;
}
