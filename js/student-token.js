/* The device's sign-in token for the student using it (migration 004). One student
   per device at a time; the password itself is never kept. */
const KEY = 'uneswa_student_token';

export function getToken(id){
  try{ const t = JSON.parse(localStorage.getItem(KEY) || 'null'); return t && t.id === id ? t.token : null; }
  catch{ return null; }
}
export function setToken(id, token){ try{ localStorage.setItem(KEY, JSON.stringify({ id, token })); }catch{} }
export function clearToken(){ try{ localStorage.removeItem(KEY); }catch{} }
