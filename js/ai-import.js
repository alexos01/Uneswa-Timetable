import { SLOTS } from './config.js';
import { sb } from './db.js';
import { render } from './render.js';
import { state } from './state.js';
import { esc, toast } from './util.js';
import { resolveProgrammeId } from './views/admin-entries.js';

/* ---------------- AI Import (bring-your-own Anthropic key) ---------------- */
export function getAnthropicKey(){ return localStorage.getItem('uneswa_admin_anthropic_key') || ''; }
export function getAiProvider(){ return localStorage.getItem('uneswa_ai_provider') || 'anthropic'; }
export function getOllamaConfig(){
  return {
    baseUrl: localStorage.getItem('uneswa_ollama_base_url') || 'https://ollama.com',
    apiKey: localStorage.getItem('uneswa_ollama_api_key') || '',
    model: localStorage.getItem('uneswa_ollama_model') || ''
  };
}
export async function callClaudeBYOK(promptText){
  const key = getAnthropicKey();
  if(!key) throw new Error('No API key saved — paste it above and click "Save settings" first.');
  let res;
  try{
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:2000, messages:[{role:'user', content: promptText}] })
    });
  }catch(networkErr){
    throw new Error('Could not reach the Anthropic API from this browser (network or CORS issue). Check your connection and try again.');
  }
  let data;
  try{ data = await res.json(); }catch(e){ throw new Error('Anthropic API returned an unreadable response (HTTP '+res.status+').'); }
  if(!res.ok || data.error){
    const msg = (data.error && data.error.message) || ('HTTP '+res.status);
    if(res.status===401) throw new Error('Authentication failed — double-check your API key is correct and active. (' + msg + ')');
    if(res.status===400 && /credit|billing/i.test(msg)) throw new Error('Your Anthropic account has no API credit yet — add a payment method at console.anthropic.com. (' + msg + ')');
    throw new Error(msg);
  }
  return (data.content||[]).map(b=>b.text||'').join('\n');
}
export async function callOllama(promptText){
  const { baseUrl, apiKey, model } = getOllamaConfig();
  if(!model) throw new Error('No Ollama model name saved — enter one (e.g. gpt-oss:20b for cloud, or llama3.1 for local) and click "Save settings".');
  const url = baseUrl.replace(/\/+$/,'') + '/v1/chat/completions';
  let res;
  try{
    res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', ...(apiKey ? {'Authorization':'Bearer '+apiKey} : {}) },
      body: JSON.stringify({ model, messages:[{role:'user', content: promptText}], max_tokens:2000 })
    });
  }catch(networkErr){
    const hint = baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')
      ? ' Make sure Ollama is running on this computer and started with OLLAMA_ORIGINS set to allow this site (see the note below the fields).'
      : ' This may be a CORS restriction on Ollama Cloud from a browser — if it keeps failing, try running Ollama locally instead (free, and CORS-friendly once configured).';
    throw new Error('Could not reach Ollama at ' + url + '.' + hint);
  }
  let data;
  try{ data = await res.json(); }catch(e){ throw new Error('Ollama returned an unreadable response (HTTP '+res.status+').'); }
  if(!res.ok || data.error){
    const msg = (data.error && (data.error.message||data.error)) || ('HTTP '+res.status);
    if(res.status===401) throw new Error('Authentication failed — check your Ollama Cloud API key. (' + msg + ')');
    if(res.status===404) throw new Error('Model not found — pull/select it first (locally: "ollama pull '+model+'"). (' + msg + ')');
    throw new Error(msg);
  }
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
export function getGeminiConfig(){
  return {
    apiKey: localStorage.getItem('uneswa_gemini_api_key') || '',
    model: localStorage.getItem('uneswa_gemini_model') || 'gemini-2.5-flash'
  };
}
export async function callGemini(promptText){
  const { apiKey, model } = getGeminiConfig();
  if(!apiKey) throw new Error('No Gemini API key saved — paste it above and click "Save settings" first.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let res;
  try{
    res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents:[{ parts:[{ text: promptText }] }], generationConfig:{ maxOutputTokens: 1500 } })
    });
  }catch(networkErr){
    throw new Error('Could not reach the Gemini API from this browser (network or CORS issue). Check your connection and try again.');
  }
  let data;
  try{ data = await res.json(); }catch(e){ throw new Error('Gemini API returned an unreadable response (HTTP '+res.status+').'); }
  if(!res.ok || data.error){
    const msg = (data.error && data.error.message) || ('HTTP '+res.status);
    if(res.status===400 && /API key/i.test(msg)) throw new Error('Invalid API key — double-check it at aistudio.google.com/apikey. (' + msg + ')');
    if(res.status===404) throw new Error('Model "'+model+'" not found — try "gemini-2.5-flash" or check current model names at ai.google.dev. (' + msg + ')');
    if(res.status===429) throw new Error('Rate limit or free-tier quota hit — wait a bit and try again, or fewer chunks at once. (' + msg + ')');
    throw new Error(msg);
  }
  const cand = data.candidates && data.candidates[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.map(p=>p.text||'').join('') : '';
  return text;
}
export function getOpenRouterConfig(){
  return {
    apiKey: localStorage.getItem('uneswa_openrouter_api_key') || '',
    model: localStorage.getItem('uneswa_openrouter_model') || 'openrouter/free'
  };
}
export async function callOpenRouter(promptText){
  const { apiKey, model } = getOpenRouterConfig();
  if(!apiKey) throw new Error('No OpenRouter API key saved — paste it above and click "Save settings" first.');
  let res;
  try{
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':'Bearer '+apiKey,
        'HTTP-Referer': location.origin,
        'X-Title': 'UNESWA Timetable'
      },
      body: JSON.stringify({ model, messages:[{role:'user', content: promptText}], max_tokens: 1500 })
    });
  }catch(networkErr){
    throw new Error('Could not reach OpenRouter from this browser (network issue). Check your connection and try again.');
  }
  let data;
  try{ data = await res.json(); }catch(e){ throw new Error('OpenRouter returned an unreadable response (HTTP '+res.status+').'); }
  if(!res.ok || data.error){
    const msg = (data.error && (data.error.message||data.error)) || ('HTTP '+res.status);
    if(res.status===401) throw new Error('Authentication failed — check your OpenRouter API key. (' + msg + ')');
    if(res.status===402) throw new Error('That model needs credits — switch the model to "openrouter/free" or add credit at openrouter.ai. (' + msg + ')');
    if(res.status===429) throw new Error('Rate limit hit on OpenRouter — wait a bit and try again. (' + msg + ')');
    throw new Error(msg);
  }
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}
export async function callAI(promptText){
  const p = getAiProvider();
  if(p==='ollama') return callOllama(promptText);
  if(p==='gemini') return callGemini(promptText);
  if(p==='openrouter') return callOpenRouter(promptText);
  return callClaudeBYOK(promptText);
}
export function parseJsonLoose(text){
  const cleaned = (text||'').replace(/```json|```/gi,'').trim();
  const tryParse = (s)=>{ try{ return JSON.parse(s); }catch(e){ return undefined; } };
  let r = tryParse(cleaned);
  if(r !== undefined) return r;
  // strip trailing commas before ] or }
  const noTrailing = cleaned.replace(/,\s*([\]}])/g, '$1');
  r = tryParse(noTrailing);
  if(r !== undefined) return r;
  // find the first [ ... last ] (balanced-ish) rather than a greedy single regex
  const start = cleaned.indexOf('['); const end = cleaned.lastIndexOf(']');
  if(start !== -1 && end !== -1 && end > start){
    const slice = cleaned.slice(start, end+1);
    r = tryParse(slice);
    if(r !== undefined) return r;
    r = tryParse(slice.replace(/,\s*([\]}])/g, '$1'));
    if(r !== undefined) return r;
  }
  return null;
}
export function chunkByChars(text, maxChars){
  const words = text.split(/\s+/); const chunks=[]; let cur=[];
  words.forEach(w=>{ if(cur.join(' ').length+w.length+1>maxChars){ chunks.push(cur.join(' ')); cur=[]; } cur.push(w); });
  if(cur.length) chunks.push(cur.join(' '));
  return chunks.filter(c=>c.trim().length>10);
}
export function splitModuleTextByDay(text){
  const dayRegex = /(Monday|Tuesday|Wednesday|Thursday|Friday)/g;
  const idxs=[]; let m;
  while((m=dayRegex.exec(text))){ idxs.push({day:m[1], index:m.index}); }
  if(idxs.length===0) return [{day:'Unknown', text}];
  const segs=[];
  for(let i=0;i<idxs.length;i++){
    const start=idxs[i].index; const end=i+1<idxs.length?idxs[i+1].index:text.length;
    segs.push({day:idxs[i].day, text:text.slice(start,end)});
  }
  return segs;
}
export async function extractPdfPages(file){
  if(!window.pdfjsLib){ await loadPdfJs(); }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  const pages=[];
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(it=>it.str).join(' '));
  }
  return pages;
}
export function loadPdfJs(){
  return new Promise((resolve,reject)=>{
    const s=document.createElement('script');
    s.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload=resolve; s.onerror=reject; document.head.appendChild(s);
  });
}

export function renderAiImport(){
  const card=document.createElement('div'); card.className='card';
  const hasKey = !!getAnthropicKey();
  const provider = getAiProvider();
  const ollamaCfg = getOllamaConfig();
  const geminiCfg = getGeminiConfig();
  const openrouterCfg = getOpenRouterConfig();
  card.innerHTML = `<h2><span class="htitle">AI Import</span></h2>
    <div class="infobox">Upload a timetable PDF (or paste text). The AI reads it and proposes structured entries — nothing is published until you review and confirm them.</div>

    <div class="field"><label>AI provider</label>
      <select id="aiProviderSel">
        <option value="anthropic" ${provider==='anthropic'?'selected':''}>Anthropic (Claude) — paid API key</option>
        <option value="gemini" ${provider==='gemini'?'selected':''}>Google Gemini — free tier</option>
        <option value="openrouter" ${provider==='openrouter'?'selected':''}>OpenRouter — free router model</option>
        <option value="ollama" ${provider==='ollama'?'selected':''}>Ollama — free (cloud key or local, no cost)</option>
      </select></div>

    <div id="providerFieldsWrap"></div>
    <button class="btn small secondary" id="saveKeyBtn" style="margin:10px 0 14px;">Save settings</button>

    <div class="row" style="margin-bottom:10px;">
      <label class="row" style="font-size:13px;"><input type="radio" name="aikind" value="modules" ${state.aiImportKind==='modules'?'checked':''}> Class timetable</label>
      <label class="row" style="font-size:13px;"><input type="radio" name="aikind" value="exams" ${state.aiImportKind==='exams'?'checked':''}> Exam timetable</label>
    </div>
    <div class="row">
      <div class="field" style="flex:1;"><label>Faculty</label><input id="aiFac" placeholder="e.g. Faculty of Commerce" value="${esc(state.aiImportFaculty)}"></div>
      <div class="field" style="flex:1;"><label>Course this import belongs to</label><input id="aiProg" placeholder="e.g. Bachelor of Commerce" value="${esc(state.aiImportProgramme)}"></div>
    </div>
    <div class="field"><label>Upload PDF (optional)</label><input type="file" id="aiPdfInput" accept="application/pdf"></div>
    <div id="aiPageSelectWrap"></div>
    <div class="field"><label>Text to parse — auto-filled from the PDF page you pick above, or paste your own</label><textarea id="aiPasteArea" style="min-height:140px;" placeholder="Paste a page or section of the released timetable here">${esc(state.aiPasteText)}</textarea></div>
    <div class="row"><button class="btn terracotta" id="aiParseBtn">Parse with AI</button></div>
    <div id="aiStatusLine" class="muted" style="margin-top:10px;font-weight:600;"></div>
    <div id="aiDebugWrap" style="margin-top:10px;"></div>
    <div id="aiPendingWrap" style="margin-top:16px;"></div>`;

  function refreshStatus(){ card.querySelector('#aiStatusLine').textContent = state.aiStatus; }

  function renderDebugPanel(){
    const w = card.querySelector('#aiDebugWrap');
    if(!state.aiDebugRaw.length){ w.innerHTML=''; return; }
    w.innerHTML = `<details class="warnbox" style="cursor:pointer;">
      <summary style="font-weight:700;">Found 0 entries — click to see what the AI actually replied (for debugging)</summary>
      ${state.aiDebugRaw.slice(0,3).map((d,i)=>`
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--terracotta);">
          <div style="font-weight:600;">Attempt ${i+1} — text sent (first 200 chars):</div>
          <pre style="white-space:pre-wrap;font-size:11px;background:#fff;padding:8px;border-radius:6px;">${esc(d.chunk)}</pre>
          <div style="font-weight:600;margin-top:6px;">AI's raw response:</div>
          <pre style="white-space:pre-wrap;font-size:11px;background:#fff;padding:8px;border-radius:6px;">${esc(d.response || '(empty response)')}</pre>
        </div>`).join('')}
      </details>`;
  }

  function renderPendingTable(){
    const w = card.querySelector('#aiPendingWrap');
    if(state.aiPending.length===0){ w.innerHTML=''; return; }
    const isMod = state.aiImportKind==='modules';
    w.innerHTML = `<h2><span class="htitle">Review before publishing</span> <span class="pill outline">${state.aiPending.length} proposed</span></h2>
      <div class="warnbox">Double-check times and venues — text extracted from PDFs can shift columns. Uncheck or edit anything wrong before adding.</div>
      <div class="tablewrap"><table class="admintbl"><thead><tr>
        <th></th><th>Code</th><th>${isMod?'Day':'Date'}</th><th>Start</th><th>End</th><th>Venue</th><th></th>
      </tr></thead><tbody id="pendingRows"></tbody></table></div>
      <div class="row" style="margin-top:10px;">
        <button class="btn" id="addPendingBtn">Add checked entries to timetable</button>
        <button class="btn danger" id="clearPendingBtn">Discard all</button>
      </div>`;
    const tb = w.querySelector('#pendingRows');
    tb.innerHTML = state.aiPending.map((p,i)=>`<tr>
      <td><input type="checkbox" data-i="${i}" class="pinc" ${p.included?'checked':''}></td>
      <td><input data-i="${i}" data-f="code" value="${esc(p.code)}" style="width:90px;padding:4px;border:1px solid var(--line);border-radius:6px;"></td>
      <td><input data-i="${i}" data-f="${isMod?'day':'date'}" value="${esc(isMod?p.day:p.date)}" style="width:100px;padding:4px;border:1px solid var(--line);border-radius:6px;"></td>
      <td><input data-i="${i}" data-f="start" value="${esc(p.start)}" style="width:70px;padding:4px;border:1px solid var(--line);border-radius:6px;"></td>
      <td><input data-i="${i}" data-f="end" value="${esc(p.end)}" style="width:70px;padding:4px;border:1px solid var(--line);border-radius:6px;"></td>
      <td><input data-i="${i}" data-f="venue" value="${esc(p.venue)}" style="width:110px;padding:4px;border:1px solid var(--line);border-radius:6px;"></td>
      <td><button class="btn small danger" data-del="${i}">✕</button></td>
    </tr>`).join('');
    tb.querySelectorAll('.pinc').forEach(cb=>{ cb.onchange = e=>{ state.aiPending[Number(e.target.dataset.i)].included = e.target.checked; }; });
    tb.querySelectorAll('input[data-f]').forEach(inp=>{ inp.oninput = e=>{ state.aiPending[Number(e.target.dataset.i)][e.target.dataset.f] = e.target.value; }; });
    tb.querySelectorAll('[data-del]').forEach(b=>{ b.onclick = ()=>{ state.aiPending.splice(Number(b.dataset.del),1); renderPendingTable(); }; });
    w.querySelector('#addPendingBtn').onclick = async ()=>{
      const toAdd = state.aiPending.filter(p=>p.included);
      let added=0;
      for(const p of toAdd){
        const programme_id = await resolveProgrammeId(p.programme, p.faculty);
        const entry = isMod ? {code:p.code, day:p.day, start_time:p.start, end_time:p.end, venue:p.venue, programme_id}
                             : {code:p.code, exam_date:p.date, start_time:p.start, end_time:p.end, venue:p.venue, programme_id};
        const { error } = await sb.from(isMod?'modules':'exams').insert(entry);
        if(!error) added++;
      }
      toast(added+' entries added to the timetable');
      state.aiPending = [];
      render();
    };
    w.querySelector('#clearPendingBtn').onclick = ()=>{ state.aiPending=[]; render(); };
  }
  renderPendingTable();

  async function parseModulesChunk(chunkText, day, programme, faculty){
    const prompt = `You are extracting a university class timetable from messy text pulled out of a PDF table.
Day: ${day}
The known time columns in order are: ${SLOTS.join(', ')}.
Module codes look like 2-4 letters followed by 3 digits, sometimes with a suffix like (N2) or (A). Venues are short codes like "G.005/G.006", "MPH", "SC.LEC.TH.I", or room numbers.
Raw text for this day:
"""
${chunkText}
"""
Return ONLY a JSON array, no prose, no markdown fences, of objects: {"code":"...", "start":"HH:MM", "end":"HH:MM", "venue":"..."}.
Assign start/end times using the known columns in the order codes appear (first code(s) = 07:00-07:50, next column = 08:00-08:50, and so on). Make your best estimate if unsure — a human will review this before publishing. Skip anything unreadable.`;
    const text = await callAI(prompt);
    const arr = parseJsonLoose(text);
    if(!arr || arr.length===0) state.aiDebugRaw.push({chunk: chunkText.slice(0,200), response: text});
    return (arr||[]).map(o=>({ code:o.code||'', day, start:o.start||'', end:o.end||'', venue:o.venue||'', programme, faculty, included:true }));
  }
  async function parseExamsChunk(chunkText, programme, faculty){
    const prompt = `Extract an exam timetable from this raw text pulled out of a PDF or pasted by an admin.
Module codes look like 2-4 letters followed by 3 digits. Dates may appear in various formats — convert to YYYY-MM-DD, guessing the year from context if needed.
Raw text:
"""
${chunkText}
"""
Return ONLY a JSON array, no prose, no markdown fences, of objects: {"code":"...", "date":"YYYY-MM-DD", "start":"HH:MM", "end":"HH:MM", "venue":"..."}. Skip anything unreadable.`;
    const text = await callAI(prompt);
    const arr = parseJsonLoose(text);
    if(!arr || arr.length===0) state.aiDebugRaw.push({chunk: chunkText.slice(0,200), response: text});
    return (arr||[]).map(o=>({ code:o.code||'', date:o.date||'', start:o.start||'', end:o.end||'', venue:o.venue||'', programme, faculty, included:true }));
  }

  async function runImportOnText(rawText){
    const programme = card.querySelector('#aiProg').value.trim() || state.aiImportProgramme || 'Unspecified';
    const faculty = card.querySelector('#aiFac').value.trim() || state.aiImportFaculty || '';
    state.aiImportProgramme = programme; state.aiImportFaculty = faculty;
    if(!rawText || rawText.trim().length<10){ toast('Nothing to parse — paste text or pick a PDF page first'); return; }
    if(state.aiBusy){ toast('Already parsing — please wait for it to finish.'); return; }
    state.aiBusy = true;
    state.aiDebugRaw = [];
    const btn = card.querySelector('#aiParseBtn');
    if(btn) btn.disabled = true;
    const startedAt = Date.now();
    let newEntries=[];
    try{
      if(state.aiImportKind==='modules'){
        const daySegs = splitModuleTextByDay(rawText);
        let chunkList=[];
        daySegs.forEach(seg=>{ chunkByChars(seg.text, 2200).forEach(c=>chunkList.push({day:seg.day, text:c})); });
        for(let i=0;i<chunkList.length;i++){
          const secs = Math.round((Date.now()-startedAt)/1000);
          state.aiStatus = `Parsing chunk ${i+1} of ${chunkList.length}… (${secs}s elapsed)`; refreshStatus();
          const found = await parseModulesChunk(chunkList[i].text, chunkList[i].day, programme, faculty);
          newEntries = newEntries.concat(found);
        }
      } else {
        const chunks = chunkByChars(rawText, 2400);
        for(let i=0;i<chunks.length;i++){
          const secs = Math.round((Date.now()-startedAt)/1000);
          state.aiStatus = `Parsing chunk ${i+1} of ${chunks.length}… (${secs}s elapsed)`; refreshStatus();
          const found = await parseExamsChunk(chunks[i], programme, faculty);
          newEntries = newEntries.concat(found);
        }
      }
      state.aiPending = state.aiPending.concat(newEntries);
      const totalSecs = Math.round((Date.now()-startedAt)/1000);
      state.aiStatus = `Done in ${totalSecs}s — ${newEntries.length} entries proposed.` + (newEntries.length ? ' Review below.' : ' See debug details below.');
      toast(state.aiStatus);
    }catch(err){
      console.error(err);
      state.aiStatus = 'AI import failed: ' + err.message;
      toast(state.aiStatus);
    }
    state.aiBusy = false;
    render();
  }

  function renderProviderFields(){
    const w = card.querySelector('#providerFieldsWrap');
    const p = card.querySelector('#aiProviderSel').value;
    if(p==='anthropic'){
      w.innerHTML = `<div class="field"><label>Your Anthropic API key</label>
        <input id="anthKey" type="password" placeholder="sk-ant-..." value="${hasKey?'••••••••••••••••':''}">
        <div class="muted" style="margin-top:4px;">Stored only in your browser. Get one at console.anthropic.com — each import uses a small amount of paid API credit on your account.</div></div>`;
    } else if(p==='gemini'){
      w.innerHTML = `<div class="row">
          <div class="field" style="flex:1;"><label>Your Gemini API key</label>
            <input id="gemKey" type="password" placeholder="AIza..." value="${geminiCfg.apiKey?'••••••••••••••••':''}"></div>
          <div class="field" style="flex:1;"><label>Model name</label>
            <input id="gemModel" value="${esc(geminiCfg.model)}" placeholder="gemini-2.5-flash"></div>
        </div>
        <div class="muted" style="margin-top:2px;">Free at aistudio.google.com/apikey — Gemini's free tier has generous daily limits for a task like this. If you hit "rate limit" errors, just wait a minute and retry.</div>`;
    } else if(p==='openrouter'){
      w.innerHTML = `<div class="row">
          <div class="field" style="flex:1;"><label>Your OpenRouter API key</label>
            <input id="orKey" type="password" placeholder="sk-or-..." value="${openrouterCfg.apiKey?'••••••••••••••••':''}"></div>
          <div class="field" style="flex:1;"><label>Model</label>
            <input id="orModel" value="${esc(openrouterCfg.model)}" placeholder="openrouter/free"></div>
        </div>
        <div class="muted" style="margin-top:2px;">Free key at openrouter.ai/keys. Leave the model as <code>openrouter/free</code> to let OpenRouter auto-pick a free model — or browse openrouter.ai/models and pick a specific one ending in <code>:free</code>.</div>`;
    } else {
      w.innerHTML = `<div class="row">
          <div class="field" style="flex:1;"><label>Ollama base URL</label>
            <input id="ollBase" value="${esc(ollamaCfg.baseUrl)}" placeholder="https://ollama.com or http://localhost:11434"></div>
          <div class="field" style="flex:1;"><label>Model name</label>
            <input id="ollModel" value="${esc(ollamaCfg.model)}" placeholder="e.g. gpt-oss:20b"></div>
        </div>
        <div class="field"><label>Ollama Cloud API key (leave blank for local)</label>
          <input id="ollKey" type="password" value="${ollamaCfg.apiKey?'••••••••••••••••':''}" placeholder="only needed for ollama.com"></div>
        <div class="muted" style="margin-top:2px;">Free at ollama.com/settings/keys. For a fully local $0 setup instead: install Ollama, run <code>ollama pull &lt;model&gt;</code>, then start it with <code>OLLAMA_ORIGINS=*</code> set so this page (a different site) is allowed to call it, and use base URL <code>http://localhost:11434</code> with no key.</div>`;
    }
  }
  renderProviderFields();

  setTimeout(()=>{
    card.querySelector('#aiProviderSel').onchange = (e)=>{ localStorage.setItem('uneswa_ai_provider', e.target.value); renderProviderFields(); };
    card.querySelector('#saveKeyBtn').onclick = ()=>{
      const p = card.querySelector('#aiProviderSel').value;
      if(p==='anthropic'){
        const v = card.querySelector('#anthKey').value.trim();
        if(v && !v.includes('•')){ localStorage.setItem('uneswa_admin_anthropic_key', v); }
      } else if(p==='gemini'){
        const key = card.querySelector('#gemKey').value.trim();
        const model = card.querySelector('#gemModel').value.trim();
        if(key && !key.includes('•')) localStorage.setItem('uneswa_gemini_api_key', key);
        if(model) localStorage.setItem('uneswa_gemini_model', model);
      } else if(p==='openrouter'){
        const key = card.querySelector('#orKey').value.trim();
        const model = card.querySelector('#orModel').value.trim();
        if(key && !key.includes('•')) localStorage.setItem('uneswa_openrouter_api_key', key);
        if(model) localStorage.setItem('uneswa_openrouter_model', model);
      } else {
        const base = card.querySelector('#ollBase').value.trim();
        const model = card.querySelector('#ollModel').value.trim();
        const key = card.querySelector('#ollKey').value.trim();
        if(base) localStorage.setItem('uneswa_ollama_base_url', base);
        if(model) localStorage.setItem('uneswa_ollama_model', model);
        if(key && !key.includes('•')) localStorage.setItem('uneswa_ollama_api_key', key);
      }
      toast('Settings saved to this browser');
    };
    card.querySelectorAll('input[name=aikind]').forEach(r=>{ r.onchange = e=>{ state.aiImportKind=e.target.value; render(); }; });
    card.querySelector('#aiProg').oninput = e=>{ state.aiImportProgramme=e.target.value; };
    card.querySelector('#aiFac').oninput = e=>{ state.aiImportFaculty=e.target.value; };
    card.querySelector('#aiPdfInput').onchange = async (e)=>{
      const file = e.target.files[0]; if(!file) return;
      state.aiStatus='Reading PDF…'; refreshStatus();
      try{
        const pages = await extractPdfPages(file);
        state.aiPages = pages.map((t,i)=>({index:i+1,text:t}));
        state.aiStatus = pages.length+' page(s) extracted — pick one below, or it defaults to page 1.';
        if(state.aiPages.length){ state.aiPasteText = state.aiPages[0].text; }
      }catch(err){ console.error(err); state.aiStatus='Could not read that PDF.'; }
      render();
    };
    const pw = card.querySelector('#aiPageSelectWrap');
    if(state.aiPages.length > 1){
      pw.innerHTML = `<div class="field"><label>PDF page to load into the box below</label>
        <select id="aiPageSel">${state.aiPages.map(p=>`<option value="${p.index}">Page ${p.index} — ${esc(p.text.slice(0,60))}…</option>`).join('')}</select></div>`;
      pw.querySelector('#aiPageSel').onchange = (e)=>{
        const p = state.aiPages.find(x=>x.index===Number(e.target.value));
        if(p){ state.aiPasteText = p.text; card.querySelector('#aiPasteArea').value = p.text; }
      };
    }
    card.querySelector('#aiPasteArea').oninput = (e)=>{ state.aiPasteText = e.target.value; };
    card.querySelector('#aiParseBtn').onclick = ()=>runImportOnText(card.querySelector('#aiPasteArea').value);
    refreshStatus();
    renderDebugPanel();
  },0);
  return card;
}
