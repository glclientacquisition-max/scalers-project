// Generates the installable-app icons from public/brand/icon.svg's paths.
// Run: node scripts/gen-pwa-icons.mjs  (writes public/icons/*.png)
// icon.svg is a blue mark on transparent with only ~6% margin, so on a #0096FF square
// it needs a white re-colour and padding: the maskable copies keep the mark's farthest
// corner inside the 80% safe-zone circle (radius 0.4 * size).
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = path.join(import.meta.dirname, "..", "public", "icons");
mkdirSync(out, { recursive: true });

const PATHS = [
  ["M12 14c0-3.3 2.7-6 6-6h28c2.2 0 4 1.8 4 4v6c0 2.2-1.8 4-4 4H28l-8 8H18c-3.3 0-6-2.7-6-6V14z", "#FFFFFF", 1],
  ["M28 22l8 8-16 16-8-8 16-16z", "#FFFFFF", 0.72],
  ["M52 50c0 3.3-2.7 6-6 6H18c-2.2 0-4-1.8-4-4v-6c0-2.2 1.8-4 4-4h18l8-8h2c3.3 0 6 2.7 6 6v10z", "#FFFFFF", 1],
];

/** Mark bbox is x 12..52, y 8..56, centred on (32,32); farthest corner is 31.2 units out. */
export function svgFor(scale) {
  const t = `translate(32 32) scale(${scale}) translate(-32 -32)`;
  const body = PATHS.map(([d, fill, op]) => `<path d="${d}" fill="${fill}" fill-opacity="${op}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0096FF"/><g transform="${t}">${body}</g></svg>`;
}

const jobs = [
  ["icon-192.png", 192, 0.8],
  ["icon-512.png", 512, 0.8],
  // 0.62 * 31.2 = 19.3 units = 30% of the side: well inside the 40% safe radius.
  ["maskable-192.png", 192, 0.62],
  ["maskable-512.png", 512, 0.62],
  // iOS home screen (no maskable support; iOS rounds the corners itself).
  ["apple-180.png", 180, 0.8],
];
for (const [name, size, scale] of jobs) {
  await sharp(Buffer.from(svgFor(scale)), { density: 72 * (size / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, name));
  console.log(name);
}
