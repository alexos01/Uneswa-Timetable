// Copies the static web app into www/ for Capacitor (npx cap sync copies www/ into
// the Android and iOS projects). The web app itself needs no build: GitHub Pages
// serves the repo root as-is.
import { cp, mkdir, rm, stat } from 'node:fs/promises';

const entries = ['index.html', 'manifest.webmanifest', 'css', 'js', 'vendor', 'icons'];
const copied = [];
await rm('www', { recursive: true, force: true });
await mkdir('www');
for (const e of entries) {
  if (!(await stat(e).catch(() => null))) continue;
  await cp(e, `www/${e}`, { recursive: true });
  copied.push(e);
}
console.log('Built www/ from', copied.join(', '));
