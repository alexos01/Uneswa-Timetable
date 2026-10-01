import { CONTACT } from '../config.js';
import { esc } from '../util.js';

/* Footer with the maintainer's contact details for queries. */
export function renderFooter(){
  const el = document.getElementById('footer');
  if(!el) return;
  const links = [
    CONTACT.linkedin && `<a href="${esc(CONTACT.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`,
    CONTACT.facebook && `<a href="${esc(CONTACT.facebook)}" target="_blank" rel="noopener">Facebook</a>`,
  ].filter(Boolean);
  el.innerHTML = `<div class="footinner">
    <div><b>Questions, or a class time that looks wrong?</b><br>
      Contact ${esc(CONTACT.name)} at <a href="mailto:${esc(CONTACT.email)}" class="footmail">${esc(CONTACT.email)}</a></div>
    ${links.length ? `<div class="footlinks">${links.join(' · ')}</div>` : ''}
    <div class="muted footnote">Student-built timetable app. Not an official University of Eswatini service; always check notices from your department.</div>
  </div>`;
}
