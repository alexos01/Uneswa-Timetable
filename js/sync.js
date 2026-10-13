/* Changes made with no connection wait in an outbox on the device and are sent to
   Supabase when the connection is back. Only student records go through here:
   staff edits need a connection. The latest copy of each record wins. */
import { state } from './state.js';
import * as store from './store.js';

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

/** Sends every queued record. Returns how many were sent; stops at the first network error. */
export async function flushOutbox(sb){
  const box = (await store.get(OUTBOX)) || {};
  let sent = 0;
  for(const [id, row] of Object.entries(box)){
    const { error } = await sb.from('students').upsert(row);
    if(error && isNetworkError(error)) break;
    if(error) console.error('Queued change rejected', id, error); // dropped: retrying would fail the same way
    else sent++;
    delete box[id];
  }
  await store.set(OUTBOX, box);
  state.pendingSync = Object.keys(box).length;
  return sent;
}
