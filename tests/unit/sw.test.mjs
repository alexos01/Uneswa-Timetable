import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

async function walk(dir){
  const out = [];
  for(const e of await readdir(join(root, dir), { withFileTypes:true })){
    const p = join(dir, e.name);
    if(e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

async function appFiles(){
  const src = await readFile(join(root, 'sw.js'), 'utf8');
  const list = /const APP_FILES = \[([\s\S]*?)\];/.exec(src)[1];
  return [...list.matchAll(/'([^']+)'/g)].map(m=>m[1]);
}

test('the service worker caches every file the app loads', async ()=>{
  const cached = new Set(await appFiles());
  const needed = [
    ...(await walk('js')), ...(await walk('css')), ...(await walk('icons')),
    ...(await walk('vendor')).filter(f=>f.endsWith('.js')),
    'index.html', 'manifest.webmanifest',
  ].map(f=>relative('.', f));
  const missing = needed.filter(f=>!cached.has(f));
  assert.deepEqual(missing, [], 'add these to APP_FILES in sw.js');
});

test('the service worker lists no file that does not exist', async ()=>{
  const { access } = await import('node:fs/promises');
  for(const f of await appFiles()){
    if(f === './') continue;
    await access(join(root, f)).catch(()=>assert.fail(`sw.js lists ${f}, which does not exist`));
  }
});
