import { sb, campusName, ensureCampus, isAdmin, isLecturer } from './db.js';
import { state } from './state.js';
import { esc } from './util.js';
import { renderStaff } from './views/staff.js';
import { renderStudent } from './views/student.js';
import { renderAnnouncements } from './views/announcements.js';
import { renderFooter } from './views/footer.js';

/* ---------------- config gate ---------------- */
export function renderNoConfig(){
  const wrap = document.createElement('div');
  wrap.className='card';
  wrap.style.maxWidth='560px'; wrap.style.margin='60px auto';
  wrap.innerHTML = `<h2><span class="htitle">Almost there</span></h2>
    <p>This page needs to be pointed at your Supabase project before it will work. Open <code>js/config.js</code> in a text editor and fill in:</p>
    <pre style="background:var(--paper);padding:12px;border-radius:9px;font-size:12px;">const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";</pre>
    <p class="muted">Both are on your Supabase dashboard under Project Settings → API. Save the file and reload this page.</p>`;
  return wrap;
}

/* ---------------- tabs ---------------- */
function tabList(){
  const tabs = [['student','My Timetable']];
  if(state.caps.notices) tabs.push(['announcements', 'Announcements']);
  tabs.push(['staff', state.caps.campuses ? 'Staff' : 'Admin']);
  return tabs;
}

/** Switches the top-level tab, loading the campus that tab works on. */
export async function setTab(t){
  state.tab = t;
  try{
    if(t==='student' && state.currentStudent?.campus_id) await ensureCampus(state.currentStudent.campus_id);
    if(t==='staff' && state.staff?.campus_id && (isLecturer() || (isAdmin() && state.staff.role!=='super_admin'))) await ensureCampus(state.staff.campus_id);
  }catch(err){ console.error(err); }
  render();
}

function renderTabs(){
  const el = document.getElementById('tabs');
  el.innerHTML = tabList().map(([id,label])=>{
    const count = id==='announcements' ? state.announcements.length : 0;
    return `<button data-tab="${id}" id="tab-${id}" class="${state.tab===id?'active':''}">${esc(label)}${count?` <span class="tabcount">${count}</span>`:''}</button>`;
  }).join('');
  el.querySelectorAll('button').forEach(b=>{ b.onclick = ()=>setTab(b.getAttribute('data-tab')); });
}

function semesterLine(){
  const parts = [];
  if(state.caps.campuses) parts.push(campusName(state.campusId) + ' campus');
  parts.push(state.meta.semester || 'Semester not set');
  if(state.meta.updated_at) parts.push('updated ' + new Date(state.meta.updated_at).toLocaleDateString());
  if(state.offline) parts.push('offline');
  return parts.join(' · ');
}

export function render(){
  document.getElementById('semesterLabel').textContent = semesterLine();
  const main = document.getElementById('main');
  main.innerHTML = '';
  if(!sb){ main.appendChild(renderNoConfig()); return; }
  renderTabs();
  if(state.tab==='announcements' && state.caps.notices) main.appendChild(renderAnnouncements());
  else if(state.tab==='staff') main.appendChild(renderStaff());
  else main.appendChild(renderStudent());
  renderFooter();
}
