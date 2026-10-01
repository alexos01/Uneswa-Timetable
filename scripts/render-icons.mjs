// Renders the SVG sources in assets/ to the PNGs that @capacitor/assets and the web
// manifest use. Run after editing an SVG: node scripts/render-icons.mjs
import sharp from 'sharp';

const jobs = [
  ['assets/icon.svg', 'assets/icon-only.png', 1024],
  ['assets/icon-foreground.svg', 'assets/icon-foreground.png', 1024],
  ['assets/icon-background.svg', 'assets/icon-background.png', 1024],
  ['assets/splash.svg', 'assets/splash.png', 2732],
  ['assets/splash.svg', 'assets/splash-dark.png', 2732],
  ['assets/icon.svg', 'icons/icon-512.png', 512],
  ['assets/icon.svg', 'icons/icon-192.png', 192],
  ['assets/icon.svg', 'icons/apple-touch-icon.png', 180],
  ['assets/icon.svg', 'icons/favicon-32.png', 32],
];
for (const [src, out, size] of jobs) {
  await sharp(src, { density: 300 }).resize(size, size).png().toFile(out);
  console.log(out);
}
