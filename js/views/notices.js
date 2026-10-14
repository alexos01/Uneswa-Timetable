import { sb } from '../db.js';
import { state } from '../state.js';
import { esc, toast } from '../util.js';
import { DELAY_CHOICES, NOTICE_KINDS, describeNotice, localIsoDate, upcomingNotices } from '../lib/notices.js';
import { WEEKDAYS } from '../lib/modules.js';

/** The session of `code` on the weekday of `isoDate`, earliest first, or null. */
function sessionOn(code, isoDate){
  const [y, m, d] = isoDate.split('-').map(Number);
  if(!y) return null;
  const day = WEEKDAYS[(new Date(y, m-1, d).getDay() + 6) % 7];
  return state.modules.filter(s=>s.code===code && s.day===day)
    .sort((a,b)=>(a.start_time||'').localeCompare(b.start_time||''))[0] || null;
}

/** Form for posting a test / cancellation / late start / room change for one of `codes`. */
export function renderNoticeForm(codes, { onPosted } = {}){
  const card = document.createElement('div'); card.className = 'card';
  const kinds = Object.entries(NOTICE_KINDS).filter(([k])=>k!=='late' || state.caps.v3);
  if(state.caps.v3) kinds.unshift(kinds.splice(kinds.findIndex(([k])=>k==='late'), 1)[0]); // the most common one first
  card.innerHTML = `<h2><span class="htitle">Post a class notice</span></h2>
    ${codes.length ? '' : '<div class="warnbox">No modules are assigned to you yet, so there is nothing to post a notice for.</div>'}
    <div class="formgrid">
      <div class="field"><label for="ntCode">Module</label><select id="ntCode">${codes.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>
      <div class="field"><label for="ntKind">Type</label><select id="ntKind">${kinds.map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('')}</select></div>
      <div class="field" id="ntDelayField" hidden><label for="ntDelay">Late by</label><select id="ntDelay">${DELAY_CHOICES.map(m=>`<option value="${m}" ${m===15?'selected':''}>${m} minutes</option>`).join('')}</select></div>
      <div class="field"><label for="ntDate">Date</label><input id="ntDate" type="date" value="${localIsoDate()}"></div>
      <div class="field"><label for="ntStart">Start</label><input id="ntStart" type="time" step="600"></div>
      <div class="field"><label for="ntEnd">End</label><input id="ntEnd" type="time" step="600"></div>
      <div class="field"><label for="ntVenue">Venue</label><input id="ntVenue" placeholder="e.g. MPH"></div>
    </div>
    <div class="field"><label for="ntTitle">Title (optional)</label><input id="ntTitle" maxlength="140" placeholder="e.g. Test 1: chapters 1–3"></div>
    <div class="field"><label for="ntDetails">Details (optional)</label><textarea id="ntDetails" maxlength="2000" style="min-height:70px;font-family:inherit;font-size:14px;"></textarea></div>
    <button class="btn terracotta" id="ntPost" ${codes.length?'':'disabled'}>Post notice</button>`;
  setTimeout(()=>{
    const q = id=>card.querySelector(id);
    // Late, cancelled and moved are about an existing class: fill in its time and venue.
    const prefill = ()=>{
      const kind = q('#ntKind').value;
      q('#ntDelayField').hidden = kind !== 'late';
      if(!['late','cancelled','moved'].includes(kind)) return;
      const s = sessionOn(q('#ntCode').value, q('#ntDate').value);
      if(!s) return;
      q('#ntStart').value = s.start_time || '';
      q('#ntEnd').value = s.end_time || '';
      if(kind !== 'moved') q('#ntVenue').value = s.venue || '';
    };
    ['#ntCode','#ntKind','#ntDate'].forEach(id=>q(id).addEventListener('change', prefill));
    prefill();
    q('#ntPost').onclick = async ()=>{
      const v = id=>q(id).value.trim();
      const row = { campus_id: state.campusId, code: v('#ntCode'), kind: v('#ntKind'), notice_date: v('#ntDate'),
        start_time: v('#ntStart')||null, end_time: v('#ntEnd')||null, venue: v('#ntVenue')||null,
        title: v('#ntTitle')||null, details: v('#ntDetails')||null,
        author_name: state.staff?.display_name || null };
      if(row.kind === 'late') row.delay_minutes = Number(v('#ntDelay'));
      if(!row.code || !row.notice_date){ toast('Choose a module and a date'); return; }
      const btn = card.querySelector('#ntPost'); btn.disabled = true;
      const { data, error } = await sb.from('class_notices').insert(row).select().single();
      btn.disabled = false;
      if(error){ toast('Could not post: '+error.message); return; }
      state.notices.push(data);
      toast(`Notice posted for ${row.code}`);
      onPosted && onPosted(data);
    };
  },0);
  return card;
}

/** Upcoming notices for `codes`; staff get a delete button. */
export function renderNoticeList(codes, { title='Upcoming notices', canDelete=false, onChange } = {}){
  const card = document.createElement('div'); card.className = 'card';
  const list = upcomingNotices(state.notices, codes);
  card.innerHTML = `<h2><span class="htitle">${esc(title)}</span>${list.length ? ` <span class="tag">${list.length}</span>` : ''}</h2>` +
    (list.length ? list.map(n=>noticeRow(n, canDelete)).join('') : '<div class="muted">Nothing coming up.</div>');
  card.querySelectorAll('[data-delnotice]').forEach(b=>{
    b.onclick = async ()=>{
      const id = b.getAttribute('data-delnotice');
      const { error } = await sb.from('class_notices').delete().eq('id', id);
      if(error){ toast('Could not delete: '+error.message); return; }
      state.notices = state.notices.filter(n=>n.id!==id);
      toast('Notice deleted');
      onChange && onChange();
    };
  });
  return card;
}

export function noticeRow(n, canDelete=false){
  const d = describeNotice(n);
  return `<div class="noticerow kind-${esc(n.kind)}">
    <div>${n.kind==='late' ? '' : `<span class="noticekind">${esc(d.kind.label)}</span> `}<b>${esc(d.heading)}</b>
      <div class="muted">${esc(d.when)}${n.author_name?` · ${esc(n.author_name)}`:''}</div>
      ${n.details?`<div class="noticedetails">${esc(n.details)}</div>`:''}</div>
    ${canDelete?`<button class="btn small danger" data-delnotice="${esc(n.id)}">Delete</button>`:''}
  </div>`;
}
