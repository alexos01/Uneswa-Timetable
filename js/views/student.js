import { DAYS, HOURS } from '../config.js';
import { checkSemesterReset, fetchStudent, saveStudent, ensureCampus } from '../db.js';
import { renderNoticeList } from './notices.js';
import { exportPdf } from '../pdf.js';
import { render } from '../render.js';
import { facName, moduleYear, progName, programmesInFaculty, state, yearLabel } from '../state.js';
import { esc, toast } from '../util.js';
import { searchModules } from '../lib/modules.js';

/* ================= STUDENT VIEW ================= */
export function myModules(student){ return state.modules.filter(m => (student.module_ids||[]).includes(m.id)); }
export function myExams(student){
  const codes = new Set(myModules(student).map(m=>m.code));
  return state.exams.filter(e => codes.has(e.code)).sort((a,b)=> (a.exam_date||'').localeCompare(b.exam_date||''));
}
export function nextClass(student){
  const now=new Date(); const dayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const mods = myModules(student); const todayIdx = now.getDay(); const nowMin = now.getHours()*60+now.getMinutes();
  const todays = mods.filter(m=>m.day===dayNames[todayIdx]);
  const upcomingToday = todays.filter(m=>{ const [h,mi]=m.start_time.split(':').map(Number); return h*60+mi>=nowMin; }).sort((a,b)=>a.start_time.localeCompare(b.start_time));
  if(upcomingToday.length) return {mod:upcomingToday[0], when:'today'};
  for(let d=1; d<=6; d++){
    const idx=(todayIdx+d)%7, dn=dayNames[idx];
    const found = mods.filter(m=>m.day===dn).sort((a,b)=>a.start_time.localeCompare(b.start_time));
    if(found.length) return {mod:found[0], when: d===1?'tomorrow':dn};
  }
  return null;
}

export function renderStudentGate(){
  const wrap=document.createElement('div');
  wrap.innerHTML = `<div class="adminlock card">
    <h2 style="justify-content:center;"><span class="htitle">Find your timetable</span></h2>
    <div class="field"><label>Student number</label><input id="gateId" placeholder="e.g. 202100123"></div>
    <div class="field"><label>Your name</label><input id="gateName" placeholder="e.g. Nomvula Dlamini"></div>
    ${state.caps.campuses ? `<div class="field"><label for="gateCampus">Campus</label><select id="gateCampus">${state.campuses.map(c=>`<option value="${esc(c.id)}" ${c.id===state.campusId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>` : ''}
    <button class="btn terracotta" id="gateGo" style="width:100%;">Continue</button>
    <div class="muted" style="margin-top:10px;">Your module choices are saved to your student number so you can pick up where you left off.</div>
  </div>`;
  setTimeout(()=>{
    document.getElementById('gateGo').onclick = async ()=>{
      const id = document.getElementById('gateId').value.trim();
      const name = document.getElementById('gateName').value.trim();
      if(!id){ toast('Enter your student number'); return; }
      document.getElementById('gateGo').disabled = true;
      let student;
      try{ student = await fetchStudent(id); }
      catch(err){ toast('Could not reach the server — check your connection'); document.getElementById('gateGo').disabled = false; return; }
      const campusSel = document.getElementById('gateCampus');
      const campus = campusSel ? campusSel.value : null;
      if(campus) await ensureCampus(campus);
      if(!student){ student = { id, name, programme_id:null, module_ids:[], semester_version: state.meta.semester_version, updated_at:new Date().toISOString(), history:[] }; }
      else if(name) student.name = name;
      if(campus) student.campus_id = campus;
      const wasReset = checkSemesterReset(student);
      const saved = await saveStudent(student);
      if(saved){ state.currentStudentId = id; localStorage.setItem('uneswa_last_student', id); state.resetNotice = wasReset; }
      document.dispatchEvent(new CustomEvent('timetable:changed'));
      render();
    };
  },0);
  return wrap;
}

export function renderStudent(){
  const wrap = document.createElement('div');
  const student = state.currentStudent;
  if(!student){ wrap.appendChild(renderStudentGate()); return wrap; }

  if(state.resetNotice){
    const n=document.createElement('div'); n.className='notice';
    n.innerHTML = `<span>New semester started (${esc(state.meta.semester)}) — your module list was cleared. Choose your modules again below.</span>
      <button class="btn small secondary" id="dismissNotice">Got it</button>`;
    wrap.appendChild(n);
    setTimeout(()=>{ document.getElementById('dismissNotice').onclick=()=>{ state.resetNotice=false; render(); }; },0);
  }

  const idbar=document.createElement('div');
  idbar.className='row'; idbar.style.marginBottom='14px'; idbar.style.justifyContent='space-between';
  idbar.innerHTML = `<span class="muted">Signed in as <b>${esc(student.name||student.id)}</b> (${esc(student.id)})</span>
    <span class="row">${state.caps.campuses ? `<label class="campusswitch">Campus <select id="studentCampusSel">${state.campuses.map(c=>`<option value="${esc(c.id)}" ${c.id===state.campusId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <button class="btn small secondary" id="switchStudentBtn">Switch student</button></span>`;
  wrap.appendChild(idbar);
  setTimeout(()=>{
    const csel = document.getElementById('studentCampusSel');
    if(csel) csel.onchange = async e=>{
      if(!confirm('Switching campus starts a new module list for that campus. Continue?')){ e.target.value = state.campusId; return; }
      await ensureCampus(e.target.value);
      student.campus_id = e.target.value;
      checkSemesterReset(student);
      student.module_ids = [];
      await saveStudent(student);
      document.dispatchEvent(new CustomEvent('timetable:changed'));
      render();
    };
    document.getElementById('switchStudentBtn').onclick=()=>{ state.currentStudentId=null; state.currentStudent=null; localStorage.removeItem('uneswa_last_student'); render(); }; },0);

  const nc = nextClass(student);
  const banner=document.createElement('div');
  if(nc){
    banner.className='today-banner';
    banner.innerHTML = `<div class="lbl">Next class · ${esc(nc.when)}</div>
      <div class="next">${esc(nc.mod.code)} at ${esc(nc.mod.start_time)}</div>
      <div class="subd">${esc(nc.mod.venue||'Venue TBC')} · ${esc(nc.mod.day)}</div>`;
  } else {
    banner.className='today-banner empty';
    banner.innerHTML = `<div class="lbl">Next class</div><div class="next">Nothing scheduled</div>
      <div class="subd">Pick your faculty and course below to build your timetable.</div>`;
  }
  wrap.appendChild(banner);

  const grid2=document.createElement('div'); grid2.className='grid2';

  const left=document.createElement('div');
  left.innerHTML = `
    <div class="card">
      <h2><span class="htitle">Add your modules</span></h2>
      <div class="field"><label><span class="stepnum">1</span>Faculty</label>
        <select id="facSel"><option value="">Choose a faculty…</option>
          ${state.faculties.map(f=>`<option value="${f.id}" ${state.pickFaculty===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}
        </select></div>
      <div class="field"><label><span class="stepnum">2</span>Course</label>
        <select id="progSel"><option value="">Choose a course…</option></select></div>
      <div class="field"><label><span class="stepnum">3</span>Year (optional — narrows the list)</label>
        <select id="yearSel"><option value="">All years</option></select></div>
      <div class="field"><label><span class="stepnum">4</span>Modules on this course</label></div>
      <div class="modlist" id="modList"></div>
      <div class="divider"></div>
      <div class="field"><label>Search by module code</label><input id="modSearch" value="${esc(state.searchQuery)}" placeholder="e.g. CSC211"></div>
      <label class="row searchscope"><input type="checkbox" id="searchAll" ${state.searchAllCourses?'checked':''}> Include other courses (electives)</label>
      <div class="modlist" id="searchList" style="max-height:200px;"></div>
    </div>
    <div class="card">
      <h2><span class="htitle">Reminders</span></h2>
      <label class="row" style="font-size:13px;"><input type="checkbox" id="notifToggle" ${state.notif.enabled?'checked':''}> Notify me before class starts</label>
      <div class="field" style="margin-top:10px;"><label>Minutes before</label>
        <select id="notifMins">${[5,10,15,30,60].map(m=>`<option value="${m}" ${state.notif.minutesBefore===m?'selected':''}>${m} minutes</option>`).join('')}</select></div>
      <div class="muted">Works while this app is open in your browser or installed on your phone/desktop.</div>
    </div>`;
  grid2.appendChild(left);

  const right=document.createElement('div');
  right.appendChild(renderMyCourses(student));
  if(state.caps.notices){
    const codes = [...new Set(myModules(student).map(m=>m.code))];
    right.appendChild(renderNoticeList(codes, { title:'Coming up: tests and class changes' }));
  }
  right.appendChild(renderWeekGrid(student));
  right.appendChild(renderExamsCard(student));
  grid2.appendChild(right);
  wrap.appendChild(grid2);

  setTimeout(()=>{
    const facSel = document.getElementById('facSel');
    const progSel = document.getElementById('progSel');
    const yearSel = document.getElementById('yearSel');
    function refreshProgOptions(){
      const opts = programmesInFaculty(state.pickFaculty);
      progSel.innerHTML = `<option value="">Choose a course…</option>` + opts.map(p=>`<option value="${p.id}" ${state.pickProgramme===p.id?'selected':''}>${esc(p.name)}</option>`).join('');
    }
    function refreshYearOptions(){
      const mods = state.modules.filter(m=>m.programme_id===state.pickProgramme);
      const years = [...new Set(mods.map(m=>moduleYear(m.code)).filter(y=>y!=null))].sort((a,b)=>a-b);
      yearSel.innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}" ${String(state.pickYear)===String(y)?'selected':''}>${yearLabel(y)}</option>`).join('');
    }
    facSel.onchange = e=>{ state.pickFaculty = e.target.value; state.pickProgramme=''; state.pickYear=''; refreshProgOptions(); refreshYearOptions(); renderProgModList(student); };
    progSel.onchange = e=>{ state.pickProgramme = e.target.value; state.pickYear=''; refreshYearOptions(); renderProgModList(student); renderSearchList(student, state.searchQuery); };
    yearSel.onchange = e=>{ state.pickYear = e.target.value; renderProgModList(student); };
    refreshProgOptions();
    refreshYearOptions();
    renderProgModList(student);
    document.getElementById('modSearch').oninput = e=>renderSearchList(student, e.target.value);
    document.getElementById('searchAll').onchange = e=>{ state.searchAllCourses = e.target.checked; renderSearchList(student, state.searchQuery); };
    if(state.searchQuery) renderSearchList(student, state.searchQuery);
    const nt=document.getElementById('notifToggle');
    nt.onchange = async (e)=>{
      state.notif.enabled = e.target.checked;
      if(e.target.checked && 'Notification' in window){
        const perm = await Notification.requestPermission();
        if(perm!=='granted'){ state.notif.enabled=false; e.target.checked=false; toast('Notifications blocked in browser settings'); }
      }
      localStorage.setItem('uneswa_notif', JSON.stringify(state.notif));
    };
    document.getElementById('notifMins').onchange = e=>{ state.notif.minutesBefore=Number(e.target.value); localStorage.setItem('uneswa_notif', JSON.stringify(state.notif)); };
  },0);

  return wrap;
}

export function groupModulesByCode(mods){
  const map = {};
  mods.forEach(m=>{ (map[m.code] = map[m.code]||[]).push(m); });
  return map;
}
export async function toggleModuleGroup(student, ids, checked){
  student.module_ids = student.module_ids || [];
  if(checked){
    ids.forEach(id=>{ if(!student.module_ids.includes(id)) student.module_ids.push(id); });
  } else {
    const idSet = new Set(ids);
    student.module_ids = student.module_ids.filter(x=>!idSet.has(x));
  }
  student.semester_version = state.meta.semester_version;
  student.updated_at = new Date().toISOString();
  await saveStudent(student);
  document.dispatchEvent(new CustomEvent('timetable:changed'));
  render();
}

export function renderProgModList(student){
  const el = document.getElementById('modList');
  if(!el) return;
  if(!state.pickProgramme){ el.innerHTML = `<div class="empty-state">Pick a faculty and course above to see its modules.</div>`; return; }
  let mods = state.modules.filter(m=>m.programme_id===state.pickProgramme);
  if(state.pickYear){ mods = mods.filter(m=>String(moduleYear(m.code))===String(state.pickYear)); }
  if(mods.length===0){ el.innerHTML = `<div class="empty-state">${state.pickYear?'No modules for that year on this course.':'No modules loaded for this course yet.'}</div>`; return; }
  const groups = groupModulesByCode(mods);
  const codes = Object.keys(groups).sort();
  el.innerHTML = codes.map(code=>{
    const sessions = groups[code].slice().sort((a,b)=> DAYS.indexOf(a.day)-DAYS.indexOf(b.day) || a.start_time.localeCompare(b.start_time));
    const ids = sessions.map(s=>s.id);
    const checked = ids.some(id=>(student.module_ids||[]).includes(id));
    const summary = sessions.map(s=>`${s.day.slice(0,3)} ${s.start_time}–${s.end_time||''} · ${s.venue||'TBC'}`).join(' · ');
    return `<label class="modrow"><input type="checkbox" data-ids="${ids.join(',')}" ${checked?'checked':''}>
      <div><div class="code">${esc(code)} <span class="muted">(${sessions.length} session${sessions.length>1?'s':''}/wk)</span></div>
      <div class="meta">${esc(summary)}</div></div></label>`;
  }).join('');
  el.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.onchange = e=>toggleModuleGroup(student, e.target.getAttribute('data-ids').split(','), e.target.checked);
  });
}
export function renderSearchList(student, q){
  const el = document.getElementById('searchList');
  if(!el) return;
  state.searchQuery = q||'';
  const results = searchModules(state.modules, q, { programmeId: state.pickProgramme, allCourses: state.searchAllCourses });
  if(!(q||'').trim()){ el.innerHTML=''; return; }
  const scopeNote = state.pickProgramme && !state.searchAllCourses
    ? `No match in ${esc(progName(state.pickProgramme))}. Tick “Include other courses” to search electives.`
    : 'No matches.';
  el.innerHTML = results.map(g=>{
    const ids = g.sessions.map(s=>s.id);
    const checked = ids.some(id=>(student.module_ids||[]).includes(id));
    const summary = g.sessions.map(s=>`${s.day.slice(0,3)} ${s.start_time}–${s.end_time||''} · ${s.venue||'TBC'}`).join(' · ');
    return `<label class="modrow"><input type="checkbox" data-ids="${ids.join(',')}" ${checked?'checked':''}>
      <div><div class="code">${esc(g.code)} <span class="muted">· ${esc(progName(g.programme_id))}</span></div>
      <div class="meta">${esc(summary)}</div></div></label>`;
  }).join('') || `<div class="empty-state">${scopeNote}</div>`;
  el.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.onchange = e=>toggleModuleGroup(student, e.target.getAttribute('data-ids').split(','), e.target.checked);
  });
}

export function renderMyCourses(student){
  const card=document.createElement('div'); card.className='card';
  const mods = myModules(student);
  const uniqueCodes = new Set(mods.map(m=>m.code));
  card.innerHTML = `<h2><span class="htitle">My registered courses</span> <span class="pill">${uniqueCodes.size} module${uniqueCodes.size!==1?'s':''}</span></h2>`;
  if(mods.length===0){ card.innerHTML += `<div class="empty-state"><div class="big">📚</div>Nothing selected yet — choose a faculty and course on the left.</div>`; return card; }
  const byProg = {};
  mods.forEach(m=>{ (byProg[m.programme_id]=byProg[m.programme_id]||[]).push(m); });
  Object.keys(byProg).forEach(pid=>{
    const g=document.createElement('div'); g.className='coursegroup';
    const groups = groupModulesByCode(byProg[pid]);
    const chips = Object.keys(groups).sort().map(code=>{
      const n = groups[code].length;
      return `<span class="modchip">${esc(code)}${n>1?` ×${n}`:''}</span>`;
    }).join('');
    g.innerHTML = `<div class="cgfac">${esc(facName(state.programmes.find(p=>p.id===pid)?.faculty_id))}</div>
      <div class="cgtitle">${esc(progName(pid))}</div>
      <div>${chips}</div>`;
    card.appendChild(g);
  });
  return card;
}

export function renderWeekGrid(student){
  const card=document.createElement('div'); card.className='card';
  const mods = myModules(student);
  card.innerHTML = `<h2><span class="htitle">Weekly timetable</span> <button class="btn small terracotta" id="exportPdfBtn">Export PDF</button></h2>`;
  if(mods.length===0){ card.appendChild(Object.assign(document.createElement('div'),{className:'empty-state',innerHTML:'<div class="big">📭</div>Nothing to show yet.'})); return card; }
  const table=document.createElement('table'); table.className='grid';
  let thead='<tr><th class="timecol">Time</th>'+DAYS.map(d=>`<th>${d}</th>`).join('')+'</tr>';
  let rows='';
  HOURS.forEach(h=>{
    const hourNum=Number(h.split(':')[0]);
    rows+=`<tr><td class="timecol">${h}</td>`;
    DAYS.forEach(day=>{
      const cellMods = mods.filter(m=> m.day===day && Number(m.start_time.split(':')[0])===hourNum);
      rows+=`<td>${cellMods.map(m=>`<div class="cell-mod"><b>${esc(m.code)}</b>${esc(m.start_time)}–${esc(m.end_time||'')}<br>${esc(m.venue||'TBC')}</div>`).join('')}</td>`;
    });
    rows+='</tr>';
  });
  table.innerHTML = thead+rows;
  card.appendChild(table);
  setTimeout(()=>{ document.getElementById('exportPdfBtn').onclick = ()=>exportPdf(student); },0);
  return card;
}

export function renderExamsCard(student){
  const card=document.createElement('div'); card.className='card';
  const exams = myExams(student);
  card.innerHTML = `<h2><span class="htitle">My exams</span> <span class="tag">${exams.length}</span></h2>`;
  if(exams.length===0){ card.innerHTML += `<div class="muted">No exam dates published yet for your modules.</div>`; }
  else exams.forEach(e=>{
    const row=document.createElement('div'); row.className='examrow';
    row.innerHTML = `<span><b>${esc(e.code)}</b> &nbsp; <span class="muted">${esc(e.venue||'Venue TBC')}</span></span>
      <span>${e.exam_date?new Date(e.exam_date).toLocaleDateString(undefined,{weekday:'short',day:'numeric',month:'short'}):'TBC'} · ${esc(e.start_time||'')}</span>`;
    card.appendChild(row);
  });
  return card;
}
