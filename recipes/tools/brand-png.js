// Renders the brand SVGs to PNG.  node tools/brand-png.js [outDir]
//   app icons  -> recipes/icon-*.png and brand/icons/*.png (always)
//   logo PNGs  -> <outDir>/logos/png (only when outDir is given; they're for the kit download, not the site)
const path = require('path');
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const ROOT = path.resolve(__dirname, '..');
const BRAND = path.join(ROOT, 'brand');

async function render(page, svgFile, width, height, out, transparent) {
  const svg = fs.readFileSync(svgFile, 'utf8').replace('<svg ', `<svg width="${width}" height="${height}" style="display:block" `);
  await page.setViewportSize({ width, height });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: out, omitBackground: !!transparent, clip: { x: 0, y: 0, width, height } });
}

(async () => {
  const outDir = process.argv[2];
  const b = await chromium.launch();
  const page = await b.newPage();
  const icons = path.join(BRAND, 'icons');
  const sets = [
    ['app-icon.svg', [[1024, 'app-icon-1024.png'], [512, 'app-icon-512.png'], [192, 'app-icon-192.png'], [180, 'app-icon-180.png']]],
    ['app-icon-maskable.svg', [[512, 'app-icon-maskable-512.png']]],
    ['favicon.svg', [[32, 'favicon-32.png'], [16, 'favicon-16.png']]],
  ];
  for (const [src, sizes] of sets) for (const [s, name] of sizes) await render(page, path.join(icons, src), s, s, path.join(icons, name), src === 'favicon.svg');
  for (const [from, to] of [['app-icon-180.png', 'icon-180.png'], ['app-icon-192.png', 'icon-192.png'], ['app-icon-512.png', 'icon-512.png'], ['app-icon-maskable-512.png', 'icon-maskable-512.png']]) fs.copyFileSync(path.join(icons, from), path.join(ROOT, to));
  if (outDir) {
    const idx = JSON.parse(fs.readFileSync(path.join(BRAND, 'logos', 'index.json'), 'utf8'));
    const dir = path.join(outDir, 'logos', 'png');
    fs.mkdirSync(dir, { recursive: true });
    for (const it of idx) {
      const w = it.logo === 'monogram' || it.logo === 'seal' || it.logo === 'mark-open' || it.logo === 'stacked' ? 1200 : 2400;
      const h = Math.round(w * it.h / it.w);
      await render(page, path.join(BRAND, it.file), w, h, path.join(dir, path.basename(it.file, '.svg') + '.png'), true);
    }
  }
  await b.close();
})();
