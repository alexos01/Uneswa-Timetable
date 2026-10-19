/* Changes made with no connection wait in an outbox on the device and are sent to
   Supabase when the connection is back. Only student records go through here:
   staff edits need a connection. The latest copy of each record wins. */
import { state } from './state.js';
import * as store from './store.js';
import { getToken } from './student-token.js';

const OUTBOX = 'outbox:students';

/** True when a Supabase error means "could not reach the server" rather than "refused". */
export function isNetworkError(err){
  return !!err && /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(err.message || String(err));
}

export async function queueStudent(row){
  const box = (await store.get(OUTBOX)) || {};
  box[row.id] = row;
  await store.set(OUTBOX, box);
  state.pendingSync = Object.keys(box).length;
}

export async function pendingStudents(){
  return Object.values((await store.get(OUTBOX)) || {});
}

/** Saves a student's own record: through student_save() with the device token since
    migration 004, straight into the table before it. Resolves to { data, error } or
    { signedOut: true } when the token is missing or no longer valid. */
export async function saveOwnRecord(sb, row){
  if(!state.caps.v4) return sb.from('students').upsert(row).select().single();
  const token = getToken(row.id);
  if(!token) return { signedOut: true };
  const { data, error } = await sb.rpc('student_save', { p_token: token, p_student: row });
  if(error) return { data: null, error };
  if(data?.error) return { signedOut: true };
  return { data: data.student, error: null };
}

/** Sends every queued record. Returns how many were sent; stops at the first network error. */
export async function flushOutbox(sb){
  const box = (await store.get(OUTBOX)) || {};
  let sent = 0;
  for(const [id, row] of Object.entries(box)){
    const { error, signedOut } = await saveOwnRecord(sb, row);
    if(error && isNetworkError(error)) break;
    if(error || signedOut) console.error('Queued change rejected', id, error || 'signed out'); // dropped: retrying would fail the same way
    else sent++;
    delete box[id];
  }
  await store.set(OUTBOX, box);
  state.pendingSync = Object.keys(box).length;
  return sent;
}
