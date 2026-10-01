// Pure helpers for class notices (tests, cancellations, room changes).

export const NOTICE_KINDS = {
  test:      { label:'Test',        verb:'Test' },
  cancelled: { label:'Cancelled',   verb:'Class cancelled' },
  moved:     { label:'Moved',       verb:'Class moved' },
  extra:     { label:'Extra class', verb:'Extra class' },
  note:      { label:'Note',        verb:'Note' },
};

export function localIsoDate(d = new Date()){
  const p = n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

/** Notices for the given module codes from `today` on, soonest first. */
export function upcomingNotices(notices, codes, today = localIsoDate()){
  const set = new Set(codes);
  return notices
    .filter(n=>set.has(n.code) && n.notice_date >= today)
    .sort((a,b)=>a.notice_date.localeCompare(b.notice_date) || (a.start_time||'').localeCompare(b.start_time||''));
}

export function describeNotice(n){
  const kind = NOTICE_KINDS[n.kind] || NOTICE_KINDS.note;
  const time = n.start_time ? ` ${n.start_time}${n.end_time ? '–'+n.end_time : ''}` : '';
  const venue = n.venue ? ` · ${n.venue}` : '';
  return { kind, heading: `${n.code} · ${n.title || kind.verb}`, when: `${n.notice_date}${time}${venue}` };
}
