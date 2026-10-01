import { campusName } from '../db.js';
import { state } from '../state.js';
import { esc } from '../util.js';

/* ================= ANNOUNCEMENTS (students) ================= */
export function sortAnnouncements(list){
  return list.slice().sort((a,b)=>(b.pinned?1:0)-(a.pinned?1:0) || (b.created_at||'').localeCompare(a.created_at||''));
}

export function announcementCard(a, actionsHtml=''){
  const audience = a.campus_id ? `${campusName(a.campus_id)} campus` : 'All campuses';
  const date = a.created_at ? new Date(a.created_at).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }) : '';
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
  const list = sortAnnouncements(state.announcements);
  wrap.innerHTML = `<h2><span class="htitle">Announcements</span> <span class="pill">${list.length}</span></h2>` +
    (list.length ? list.map(a=>announcementCard(a)).join('')
      : `<div class="empty-state"><div class="big">📣</div>No announcements for ${esc(campusName(state.campusId))} right now.</div>`);
  return wrap;
}
