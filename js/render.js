import { sb } from './db.js';
import { state } from './state.js';
import { renderAdmin } from './views/admin.js';
import { renderStudent } from './views/student.js';

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
export function setTab(t){ state.tab=t;
  document.getElementById('tabStudentBtn').classList.toggle('active', t==='student');
  document.getElementById('tabAdminBtn').classList.toggle('active', t==='admin');
  render();
}
export function render(){
  document.getElementById('semesterLabel').textContent =
    state.meta.semester + (state.meta.updated_at ? ' · updated ' + new Date(state.meta.updated_at).toLocaleDateString() : '') + ' · v' + (state.meta.semester_version||1);
  const main = document.getElementById('main');
  main.innerHTML = '';
  if(!sb){ main.appendChild(renderNoConfig()); return; }
  if(state.tab==='student') main.appendChild(renderStudent());
  else main.appendChild(renderAdmin());
}
