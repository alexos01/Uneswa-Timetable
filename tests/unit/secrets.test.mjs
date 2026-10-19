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

// The repo is public. The push webhook secret lives in Supabase (function secret and
// Vault) and must never be pasted into the SQL or docs here, as happened once.
test('no webhook secret is written into the Supabase files', async ()=>{
  const files = (await walk('supabase')).filter(f=>/\.(sql|md|ts|js)$/.test(f));
  const found = [];
  for(const f of files){
    const text = await readFile(join(root, f), 'utf8');
    if(/\b[0-9a-f]{32,}\b/i.test(text)) found.push(relative('.', f));
  }
  assert.deepEqual(found, [], 'a long hex value looks like a secret: keep it in Supabase secrets or Vault');
});
