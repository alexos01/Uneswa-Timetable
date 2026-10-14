import { sb } from '../db.js';
import { render } from '../render.js';
import { progName, state, yearLabel } from '../state.js';
import { esc, toast } from '../util.js';
import { repCourses } from '../lib/announcements.js';
import { announcementCard, sortAnnouncements } from './announcements.js';
import { loadLecturerCodes, renderSessionsEditor } from './lecturer.js';
import { renderNoticeForm, renderNoticeList } from './notices.js';
import { staffHeader, signOut } from './staff.js';

/* ================= CLASS REP =================
   A class rep is assigned module codes like a lecturer (lecturer_modules). They post
   class notices and move sessions for those codes, and post announcements to the
   courses those codes are taught on, optionally to one year. */
export function renderRep(){
  const wrap = document.createElement('div');
  wrap.innerHTML = staffHeader() + `<div id="repBody"><div class="muted">Loading your modules…</div></div>`;
  setTimeout(async ()=>{
    document.getElementById('signOutBtn').onclick = signOut;
    const codes = await loadLecturerCodes();
    const body = document.getElementById('repBody');
    if(!body) return;
    body.innerHTML = '';
    const grid = document.createElement('div'); grid.className = 'grid2';
    const left = document.createElement('div');
    left.appendChild(renderNoticeForm(codes, { onPosted: ()=>render() }));
    left.appendChild(renderCourseAnnouncementForm(codes));
    const right = document.createElement('div');
    right.appendChild(renderNoticeList(codes, { title:'Upcoming notices for your modules', canDelete:true, onChange: ()=>render() }));
    right.appendChild(renderMyAnnouncements());
    right.appendChild(renderSessionsEditor(codes));
    grid.append(left, right);
    body.appendChild(grid);
  },0);
  return wrap;
}

function renderCourseAnnouncementForm(codes){
  const card = document.createElement('div'); card.className = 'card';
  const courses = repCourses(state.modules, codes);
  card.innerHTML = `<h2><span class="htitle">Announce to your class</span></h2>
    ${courses.length ? '' : '<div class="warnbox">Your modules aren\'t on any course yet, so there is no class to announce to.</div>'}
    <div class="field"><label for="caCourse">Course</label><select id="caCourse">${courses.map(c=>`<option value="${esc(c.programme_id)}">${esc(progName(c.programme_id))}</option>`).join('')}</select></div>
    <div class="field"><label for="caYear">Year</label><select id="caYear"></select></div>
    <div class="field"><label for="caTitle">Title</label><input id="caTitle" maxlength="140" placeholder="e.g. Class meeting on Friday"></div>
    <div class="field"><label for="caBody">Message</label><textarea id="caBody" maxlength="4000" style="min-height:90px;font-family:inherit;font-size:14px;"></textarea></div>
    <button class="btn terracotta" id="caPost" ${courses.length?'':'disabled'}>Post to class</button>`;
  setTimeout(()=>{
    const q = id=>card.querySelector(id);
    const fillYears = ()=>{
      const c = courses.find(x=>x.programme_id===q('#caCourse').value);
      const years = c ? c.years : [];
      q('#caYear').innerHTML = `<option value="">All years</option>` + years.map(y=>`<option value="${y}" ${years.length===1?'selected':''}>${yearLabel(y)}</option>`).join('');
    };
    q('#caCourse').onchange = fillYears;
    fillYears();
    q('#caPost').onclick = async ()=>{
      const title = q('#caTitle').value.trim();
      if(!title){ toast('Give the announcement a title'); return; }
      const row = {
        campus_id: state.campusId, programme_id: q('#caCourse').value,
        year: q('#caYear').value ? Number(q('#caYear').value) : null,
        title, body: q('#caBody').value.trim(),
        author_name: state.staff?.display_name || null, created_by: state.session.user.id,
      };
      const btn = q('#caPost'); btn.disabled = true;
      const { data, error } = await sb.from('announcements').insert(row).select().single();
      btn.disabled = false;
      if(error){ toast('Could not post: '+error.message); return; }
      state.announcements.unshift(data);
      toast('Posted to your class');
      render();
    };
  },0);
  return card;
}

function renderMyAnnouncements(){
  const card = document.createElement('div'); card.className = 'card';
  const mine = sortAnnouncements(state.announcements.filter(a=>a.created_by===state.session.user.id));
  card.innerHTML = `<h2><span class="htitle">Your announcements</span>${mine.length ? ` <span class="tag">${mine.length}</span>` : ''}</h2>` +
    (mine.length ? mine.map(a=>announcementCard(a, `<div class="row" style="margin-top:8px;"><button class="btn small danger" data-delann="${esc(a.id)}">Delete</button></div>`)).join('')
      : '<div class="muted">Nothing posted yet.</div>');
  card.querySelectorAll('[data-delann]').forEach(b=>{
    b.onclick = async ()=>{
      if(!confirm('Delete this announcement?')) return;
      const id = b.getAttribute('data-delann');
      const { error } = await sb.from('announcements').delete().eq('id', id);
      if(error){ toast(error.message); return; }
      state.announcements = state.announcements.filter(x=>x.id!==id);
      toast('Announcement deleted'); render();
    };
  });
  return card;
}
