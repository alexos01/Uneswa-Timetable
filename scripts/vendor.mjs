// Copies pinned browser builds of runtime libraries from node_modules into vendor/.
// vendor/ is committed: GitHub Pages serves the repo as-is and the native app must
// start without a network connection. Run `npm run vendor` after bumping a version.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const libs = [
  ['@supabase/supabase-js', 'dist/umd/supabase.js', 'supabase.js'],
  ['jspdf', 'dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['jspdf-autotable', 'dist/jspdf.plugin.autotable.min.js', 'jspdf.plugin.autotable.min.js'],
];

await mkdir('vendor', { recursive: true });
const versions = {};
for (const [pkg, from, to] of libs) {
  await copyFile(`node_modules/${pkg}/${from}`, `vendor/${to}`);
  versions[pkg] = JSON.parse(await readFile(`node_modules/${pkg}/package.json`, 'utf8')).version;
}
await writeFile('vendor/VERSIONS.json', JSON.stringify(versions, null, 2) + '\n');
console.log('Vendored', versions);
