/* global process, console */
// Uses the existing outlined brand assets. No fonts or network needed to render.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { Resvg } = createRequire(
  resolve(process.argv[2] || '/tmp/moldavite-brand-render', 'package.json')
)('@resvg/resvg-js');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const inner = (s) => s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const monogram = inner(read('public/monogram.svg'));
const wordmark = inner(read('public/wordmark.svg'));
const colors = { ink: '#0E0D0A', cream: '#F9F6ED', dark: '#14120C' };
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Moldavite">${body}</svg>\n`;
const mark = (body, x, y, width, sourceWidth, color) =>
  `<g transform="translate(${x} ${y}) scale(${width / sourceWidth})">${body.replaceAll('currentColor', color)}</g>`;
function save(name, source) {
  const base = resolve(root, 'branding', name);
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(base + '.svg', source);
  writeFileSync(base + '.png', new Resvg(source).render().asPng());
}
for (const [name, color] of Object.entries(colors).filter(([k]) => k !== 'dark')) {
  save(`logos/monogram-${name}`, svg(1024, 1024, mark(monogram, 0, 0, 1024, 1074.5, color)));
  save(`logos/wordmark-${name}`, svg(2400, 478, mark(wordmark, 0, 0, 2400, 4129.2, color)));
}
for (const theme of ['light', 'dark']) {
  const bg = theme === 'light' ? colors.cream : colors.dark;
  const fg = theme === 'light' ? colors.ink : colors.cream;
  const background = (w, h) => `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  save(
    `social/profile-${theme}-1080`,
    svg(1080, 1080, background(1080, 1080) + mark(monogram, 118, 118, 844, 1074.5, fg))
  );
  save(
    `social/banner-${theme}-1500x500`,
    svg(1500, 500, background(1500, 500) + mark(wordmark, 250, 150, 1000, 4129.2, fg))
  );
  save(
    `social/post-${theme}-1200x630`,
    svg(1200, 630, background(1200, 630) + mark(wordmark, 180, 231, 840, 4129.2, fg))
  );
}
// iOS supplies its own corner mask. The source must fill the entire opaque tile.
const icon = read('src-tauri/icons/icon-master.svg')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(' rx="230" ry="230"', '')
  .replace(/[ \t]+$/gm, '');
save('app-icons/moldavite-ios-ipados-1024', icon);
const catalog = 'src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset';
const entries = JSON.parse(read(catalog + '/Contents.json')).images;
for (const entry of entries) {
  const pixels = Number(entry.size.split('x')[0]) * Number(entry.scale.replace('x', ''));
  const png = new Resvg(icon, { fitTo: { mode: 'width', value: pixels } }).render().asPng();
  for (const folder of [catalog, 'src-tauri/icons/ios']) {
    writeFileSync(resolve(root, folder, entry.filename), png);
  }
}
execFileSync('xcrun', [
  'swift',
  resolve(root, 'branding/opaque-png.swift'),
  resolve(root, 'branding/app-icons/moldavite-ios-ipados-1024.png'),
  ...entries.flatMap(({ filename }) =>
    [catalog, 'src-tauri/icons/ios'].map((folder) => resolve(root, folder, filename))
  ),
]);
console.log('Generated brand assets and all 18 iPhone/iPad/App Store icon slots.');
