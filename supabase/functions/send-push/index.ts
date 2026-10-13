// send-push: sends Web Push notifications to students' browsers.
//
// Called with a POST carrying the x-push-secret header, in one of two shapes:
//   { type: 'INSERT', table: 'class_notices' | 'announcements', record: {...} }
//     from the database triggers in setup.sql, or a Supabase Database Webhook:
//     alerts the students following that module, course or campus.
//   { type: 'tick' }
//     every minute from pg_cron: class reminders due this minute.
//
// What to send and to whom is decided in ../_shared/push-plan.js (unit tested).
// Subscriptions the push service reports as gone (404/410) are deleted.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  announcementMessage, announcementTargets, dueReminders, localClock, noticeMessage, noticeTargets,
} from '../_shared/push-plan.js';

type Sub = { endpoint: string; p256dh: string; auth: string; campus_id: string; codes: string[]; module_ids: string[]; minutes_before: number; reminders: boolean };
type Message = { title: string; body: string; tag: string };

const env = (k: string) => {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Missing secret ${k}`);
  return v;
};

webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'));
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const SECRET = env('PUSH_WEBHOOK_SECRET');

async function subscriptions(filter?: (q: any) => any): Promise<Sub[]> {
  let q = db.from('push_subscriptions').select('*');
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

async function send(targets: { sub: Sub; message: Message }[]) {
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(targets.map(async ({ sub, message }) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(message),
        { TTL: 60 * 60, urgency: 'high', topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) },
      );
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) gone.push(sub.endpoint);
      else console.error('push failed', status, (err as Error).message);
    }
  }));
  // One by one with eq: endpoints hold characters a PostgREST in.(...) list can misread.
  for (const endpoint of gone) await db.from('push_subscriptions').delete().eq('endpoint', endpoint);
  return { sent, removed: gone.length, failed: targets.length - sent - gone.length };
}

async function onNotice(record: any) {
  const subs = await subscriptions(q => q.eq('campus_id', record.campus_id).contains('codes', [record.code]));
  const message = noticeMessage(record, localClock(new Date()).isoDate);
  return send(noticeTargets(record, subs).map((sub: Sub) => ({ sub, message })));
}

async function onAnnouncement(record: any) {
  const subs = await subscriptions(record.campus_id ? q => q.eq('campus_id', record.campus_id) : undefined);
  let courseCodes: string[] = [];
  if (record.programme_id) {
    const { data, error } = await db.from('modules').select('code').eq('programme_id', record.programme_id);
    if (error) throw error;
    courseCodes = [...new Set((data ?? []).map((m: { code: string }) => m.code))];
  }
  const message = announcementMessage(record);
  return send(announcementTargets(record, subs, courseCodes).map((sub: Sub) => ({ sub, message })));
}

async function onTick() {
  const now = new Date();
  const subs = await subscriptions(q => q.eq('reminders', true));
  if (!subs.length) return { sent: 0, removed: 0, failed: 0 };
  const ids = [...new Set(subs.flatMap(s => s.module_ids ?? []))];
  const modules: any[] = [];
  for (let i = 0; i < ids.length; i += 200) { // keeps the request URL short
    const { data, error } = await db.from('modules').select('id, code, day, start_time, end_time, venue').in('id', ids.slice(i, i + 200));
    if (error) throw error;
    modules.push(...(data ?? []));
  }
  const { data: notices, error } = await db.from('class_notices').select('*').eq('notice_date', localClock(now).isoDate);
  if (error) throw error;
  return send(dueReminders({ subs, modules, notices: notices ?? [], now }));
}

Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (req.headers.get('x-push-secret') !== SECRET) return new Response('Unauthorized', { status: 401 });
  try {
    const body = await req.json();
    let result;
    if (body.type === 'tick') result = await onTick();
    else if (body.type === 'INSERT' && body.table === 'class_notices') result = await onNotice(body.record);
    else if (body.type === 'INSERT' && body.table === 'announcements') result = await onAnnouncement(body.record);
    else return new Response('Ignored', { status: 202 });
    return Response.json(result);
  } catch (err) {
    console.error(err);
    return new Response((err as Error).message, { status: 500 });
  }
});
