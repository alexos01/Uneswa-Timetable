/* The university's own timetable PDF for the campus (migration 004).
   A campus admin uploads it to the public "timetables" Storage bucket and
   campus_settings points at it. Students get a link at the bottom of My Timetable.
   Each new upload is downloaded once and kept on the device, so it opens offline. */
import { sb } from './db.js';
import { state } from './state.js';
import * as store from './store.js';

export const BUCKET = 'timetables';
const key = campusId=>`timetable-pdf:${campusId}`;

/** The current PDF for the loaded campus, or null: { path, name, at, url }. */
export function timetablePdf(){
  const m = state.meta || {};
  if(!state.caps.v4 || !m.timetable_pdf_path || !sb) return null;
  return { path: m.timetable_pdf_path, name: m.timetable_pdf_name || 'timetable.pdf', at: m.timetable_pdf_at,
    url: sb.storage.from(BUCKET).getPublicUrl(m.timetable_pdf_path).data.publicUrl };
}

/** The copy on this device, if it is the current one. */
export async function savedPdf(){
  const pdf = timetablePdf();
  if(!pdf) return null;
  const saved = await store.get(key(state.campusId));
  return saved && saved.path === pdf.path && saved.blob instanceof Blob ? saved.blob : null;
}

/** Downloads a new upload to the device. Quietly does nothing offline or on failure. */
export async function keepPdfOnDevice(){
  const pdf = timetablePdf();
  if(!pdf || state.offline || await savedPdf()) return;
  try{
    const res = await fetch(pdf.url);
    if(!res.ok) return;
    await store.set(key(state.campusId), { path: pdf.path, blob: await res.blob() });
  }catch(err){ console.warn('Timetable PDF not saved for offline use', err); }
}

/** Uploads `file` as the campus's timetable PDF, replacing (and deleting) the previous one. */
export async function uploadTimetablePdf(file){
  const old = state.meta.timetable_pdf_path;
  const safe = file.name.replace(/[^A-Za-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'timetable.pdf';
  const path = `${state.campusId}/${Date.now()}-${safe}`;
  const up = await sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false });
  if(up.error) throw up.error;
  const fields = { timetable_pdf_path: path, timetable_pdf_name: file.name, timetable_pdf_at: new Date().toISOString() };
  const { error } = await sb.from('campus_settings').update(fields).eq('campus_id', state.campusId);
  if(error){ await sb.storage.from(BUCKET).remove([path]); throw error; }
  Object.assign(state.meta, fields);
  if(old) await sb.storage.from(BUCKET).remove([old]); // a leftover file is harmless, so errors are ignored
}

/** Takes the timetable PDF down. */
export async function removeTimetablePdf(){
  const old = state.meta.timetable_pdf_path;
  const fields = { timetable_pdf_path: null, timetable_pdf_name: null, timetable_pdf_at: null };
  const { error } = await sb.from('campus_settings').update(fields).eq('campus_id', state.campusId);
  if(error) throw error;
  Object.assign(state.meta, fields);
  if(old) await sb.storage.from(BUCKET).remove([old]);
}
