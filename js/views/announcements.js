import { campusName } from '../db.js';
import { progName, state, yearLabel } from '../state.js';
import { esc } from '../util.js';
import { visibleAnnouncements } from '../lib/announcements.js';
import { myModules } from './student.js';

/** What the student (or a visitor) sees: campus-wide posts and their own course's. */
export function studentAnnouncements(){
  return visibleAnnouncements(state.announcements, state.currentStudent ? myModules(state.currentStudent) : []);
}

/* Announcements, as students see them */
export function sortAnnouncements(list){
  return list.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || (b.created_at||'').localeCompare(a.created_at||''));
}

export function announcementCard(a, actionsHtml=''){
  const audience = a.programme_id ? `${progName(a.programme_id)}${a.year ? ' · '+yearLabel(a.year) : ''}`
    : a.campus_id ? `${campusName(a.campus_id)} campus` : 'All campuses';
  const date = a.created_at ? new Date(a.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '';
  return `<article class="announcement${a.pinned?' pinned':''}">
    <div class="anmeta">${a.pinned?'<span class="tag">Pinned</span> ':''}${esc(audience)} · ${esc(date)}${a.author_name?` · ${esc(a.author_name)}`:''}</div>
    <h3>${esc(a.title)}</h3>
    ${a.body ? `<div class="anbody">${esc(a.body).replace(/\n/g,'<br>')}</div>` : ''}
    ${actionsHtml}
  </article>`;
}

export function renderAnnouncements(){
  const wrap = document.createElement('div');
  wrap.className = 'card announcements';
  const list = sortAnnouncements(studentAnnouncements());
  wrap.innerHTML = `<h2><span class="htitle">Announcements</span>${list.length ? ` <span class="pill">${list.length}</span>` : ''}</h2>` +
    (list.length ? list.map(a=>announcementCard(a)).join('')
      : `<div class="empty-state">No announcements for ${esc(campusName(state.campusId))} right now.</div>`);
  return wrap;
}
