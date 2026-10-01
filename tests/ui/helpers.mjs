// Shared harness for UI tests: serves the repo, launches Chromium and swaps
// vendor/supabase.js for the in-memory fake so tests never touch live data.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };

export async function startServer(){
  const server = createServer(async (req, res)=>{
    let file = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if((await stat(file).catch(()=>null))?.isDirectory()) file = join(file, 'index.html');
    try{ const body = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(body); }
    catch{ res.writeHead(404); res.end(); }
  });
  await new Promise(r=>server.listen(0, r));
  return { url:`http://localhost:${server.address().port}/`, close:()=>new Promise(r=>server.close(r)) };
}

function chromiumPath(){
  if(process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for(const p of ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome']) if(existsSync(p)) return p;
  return undefined; // fall back to a Playwright-managed browser
}

export async function launch(){
  return chromium.launch({ executablePath: chromiumPath(), args:['--no-sandbox'] });
}

/** Opens the app with a seeded fake backend. Returns { page, errors }. */
export async function openApp(browser, baseUrl, seed, { viewport={ width:1280, height:900 }, localStorage={} } = {}){
  const context = await browser.newContext({ viewport, acceptDownloads:true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{ if(m.type()==='error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route('**/vendor/supabase.js', route=>route.fulfill({ path: join(root, 'tests/ui/fake-supabase.js'), contentType:'text/javascript' }));
  await page.route(/^https?:\/\/(?!localhost)/, route=>route.abort()); // no outside network in tests
  await page.addInitScript(([s, ls])=>{
    window.__FAKE_DB__ = s;
    for(const [k,v] of Object.entries(ls)) window.localStorage.setItem(k, v);
  }, [seed, localStorage]);
  await page.goto(baseUrl);
  await page.waitForFunction(()=>document.querySelector('#semesterLabel')?.textContent !== 'Loading…');
  return { page, context, errors };
}

export async function tables(page){ return page.evaluate(()=>window.__FAKE_TABLES__); }
