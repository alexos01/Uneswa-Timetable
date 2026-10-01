export function uid(){ return Math.random().toString(36).slice(2,10); }
export function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=>t.classList.remove('show'), 2800);
}
export function esc(s){ return (s||'').toString().replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
