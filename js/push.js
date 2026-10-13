/* Web Push (browser only). When a student turns reminders on, this browser
   subscribes to push and stores the subscription in Supabase with the student's
   sessions, through the save_push_subscription RPC (migration 003). The send-push
   Edge Function then sends class reminders and late/cancelled/moved alerts even
   when the page is closed. The phone app uses local notifications instead. */
import { PUSH_PUBLIC_KEY } from './config.js';
import { sb } from './db.js';
import { isNative } from './platform.js';
import { state } from './state.js';

const SAVED_KEY = 'uneswa_push_saved'; // what was last sent, so unchanged settings aren't re-sent

export function pushAvailable(){
  return !isNative && !!PUSH_PUBLIC_KEY && state.caps.v3
    && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function keyBytes(b64){
  const s = atob((b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c=>c.charCodeAt(0));
}
function readLocal(k){ try{ return localStorage.getItem(k); }catch{ return null; } }
function writeLocal(k, v){ try{ v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); }catch{} }

/** Brings this browser's push subscription in line with the student and their reminder setting. */
export async function syncPush(){
  if(!pushAvailable() || state.offline) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(()=>null);
  if(!reg) return;
  const student = state.currentStudent;
  const wanted = !!student && state.notif.enabled && Notification.permission === 'granted';
  let sub = await reg.pushManager.getSubscription();
  if(!wanted){
    if(sub){
      await sb.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
      await sub.unsubscribe().catch(()=>{});
    }
    writeLocal(SAVED_KEY, null);
    return;
  }
  if(!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: keyBytes(PUSH_PUBLIC_KEY) });
  const { endpoint, keys } = sub.toJSON();
  const args = {
    p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
    p_campus: state.campusId, p_student: student.id, p_module_ids: student.module_ids || [],
    p_minutes_before: state.notif.minutesBefore, p_reminders: true,
  };
  const sig = JSON.stringify(args);
  if(readLocal(SAVED_KEY) === sig) return;
  const { error } = await sb.rpc('save_push_subscription', args);
  if(error){ console.warn('Push subscription not saved', error); return; }
  writeLocal(SAVED_KEY, sig);
}
