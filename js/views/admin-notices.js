import { sb, campusName, isSuperAdmin } from '../db.js';
import { render } from '../render.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';
import { renderNoticeForm, renderNoticeList } from './notices.js';
import { announcementCard, sortAnnouncements } from './announcements.js';

/* ---------------- Announcements & class notices (admin) ---------------- */
export function renderAdminNotices(){
  const wrap = document.createElement('div');
  wrap.className = 'grid2';
  const left = document.createElement('div');
  left.appendChild(renderAnnouncementForm());
  const codes = [...new Set(state.modules.map(m=>m.code))].sort();
  left.appendChild(renderNoticeForm(codes, { onPosted: ()=>render() }));
  const right = document.createElement('div');
  right.appendChild(renderAnnouncementAdminList());
  right.appendChild(renderNoticeList(codes, { title:'Upcoming class notices', canDelete:true, onChange: ()=>render() }));
  wrap.append(left, right);
  return wrap;
}

function renderAnnouncementForm(){
  const card = document.createElement('div'); card.className = 'card';
  card.innerHTML = `<h2><span class="htitle">New announcement</span></h2>
    <div class="field"><label for="anTitle">Title</label><input id="anTitle" maxlength="140" placeholder="e.g. Exam timetable published"></div>
    <div class="field"><label for="anBody">Message</label><textarea id="anBody" maxlength="4000" style="min-height:100px;font-family:inherit;font-size:14px;"></textarea></div>
    <div class="formgrid">
      <div class="field"><label for="anAudience">Who sees it</label><select id="anAudience">
        <option value="campus">${esc(campusName(state.campusId))} campus</option>
        ${isSuperAdmin() ? '<option value="all">All campuses</option>' : ''}</select></div>
      <div class="field"><label for="anExpires">Hide after (optional)</label><input id="anExpires" type="date"></div>
    </div>
    <label class="row" style="font-size:13px;margin-bottom:10px;"><input type="checkbox" id="anPinned"> Pin to the top</label>
    <button class="btn terracotta" id="anPost">Publish announcement</button>`;
  setTimeout(()=>{
    card.querySelector('#anPost').onclick = async ()=>{
      const title = card.querySelector('#anTitle').value.trim();
      if(!title){ toast('Give the announcement a title'); return; }
      const expires = card.querySelector('#anExpires').value;
      const row = {
        campus_id: card.querySelector('#anAudience').value==='all' ? null : state.campusId,
        title, body: card.querySelector('#anBody').value.trim(),
        pinned: card.querySelector('#anPinned').checked,
        expires_at: expires ? new Date(expires+'T23:59:59').toISOString() : null,
        author_name: state.staff?.display_name || null,
      };
      const btn = card.querySelector('#anPost'); btn.disabled = true;
      const { data, error } = await sb.from('announcements').insert(row).select().single();
      btn.disabled = false;
      if(error){ toast('Could not publish: '+error.message); return; }
      state.announcements.unshift(data);
      toast('Announcement published');
      render();
    };
  },0);
  return card;
}

function renderAnnouncementAdminList(){
  const card = document.createElement('div'); card.className = 'card';
  const list = sortAnnouncements(state.announcements);
  card.innerHTML = `<h2><span class="htitle">Published announcements</span> <span class="tag">${list.length}</span></h2>` +
    (list.length ? list.map(a=>announcementCard(a, `
      <div class="row" style="margin-top:8px;">
        <button class="btn small secondary" data-pin="${esc(a.id)}">${a.pinned?'Unpin':'Pin'}</button>
        <button class="btn small danger" data-delann="${esc(a.id)}">Delete</button>
      </div>`)).join('') : '<div class="muted">No announcements yet.</div>');
  card.querySelectorAll('[data-pin]').forEach(b=>{
    b.onclick = async ()=>{
      const a = state.announcements.find(x=>x.id===b.getAttribute('data-pin'));
      const { error } = await sb.from('announcements').update({ pinned: !a.pinned }).eq('id', a.id);
      if(error){ toast(error.message); return; }
      a.pinned = !a.pinned; render();
    };
  });
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
