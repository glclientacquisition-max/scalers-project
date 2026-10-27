// Generates the installable-app icons from the official transparent mark
// (public/brand/icon.png, same file as "Scalers Icon - Transparent background.png").
// Run: node scripts/gen-pwa-icons.mjs  (writes public/icons/*.png)
//
// any + apple: the mark on a transparent square. Launchers that draw their own plate
//   (Samsung, Pixel themed icons) put it on theirs; others show the mark alone.
// maskable: Android always fills the mask, so the plate is the light Desk canvas
//   (#f4f7fb, --canvas), never blue. The mark's bounding-box corners stay inside the
//   80% safe-zone circle (radius 0.4 * side), so circle, squircle and rounded-square
//   masks never clip it.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..", "public");
const out = path.join(root, "icons");
mkdirSync(out, { recursive: true });

export const MASKABLE_PLATE = "#f4f7fb";

/** Tight bbox of the mark: alpha above 16, so the soft shadow halo does not count. */
async function markBuffer() {
  const src = sharp(path.join(root, "brand", "icon.png")).ensureAlpha();
  const { data, info } = await src.clone().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  return { buf: await src.extract(box).png().toBuffer(), box };
}

/** heightRatio: mark height as a share of the side. */
async function render(name, size, heightRatio, background) {
  const { buf, box } = await markBuffer();
  const h = Math.round(size * heightRatio);
  const w = Math.round((box.width / box.height) * h);
  const mark = await sharp(buf).resize(w, h).png().toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: mark, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(out, name));
  // Safe-zone check for maskable: half-diagonal of the mark box vs 0.4 * side.
  const reach = Math.hypot(w / 2, h / 2) / size;
  console.log(`${name} mark ${w}x${h} reach ${(reach * 100).toFixed(1)}% of side`);
}

// Mark is 412x676 (aspect 0.61). Half-diagonal at 0.62 height = 0.363 of the side < 0.40.
const jobs = [
  ["icon-192.png", 192, 0.84, null],
  ["icon-512.png", 512, 0.84, null],
  ["apple-180.png", 180, 0.8, null],
  // favicon: browser tab and the Windows/Chrome notification header ("Scalers" row).
  // Transparent, mark nearly full height so it still reads at 16px. Never a black plate.
  ["favicon-32.png", 32, 0.94, null],
  ["favicon-48.png", 48, 0.94, null],
  ["favicon-192.png", 192, 0.94, null],
  ["maskable-192.png", 192, 0.62, MASKABLE_PLATE],
  ["maskable-512.png", 512, 0.62, MASKABLE_PLATE],
];
for (const [name, size, ratio, bg] of jobs) await render(name, size, ratio, bg);

// badge: Android status-bar badge. Monochrome white silhouette of the mark (alpha kept),
// transparent 96px; Android only reads the alpha channel.
{
  const { buf, box } = await markBuffer();
  const size = 96, h = Math.round(size * 0.84), w = Math.round((box.width / box.height) * h);
  const alpha = await sharp(buf).resize(w, h).extractChannel(3).toBuffer();
  const white = await sharp({ create: { width: w, height: h, channels: 3, background: "#ffffff" } })
    .joinChannel(alpha).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: white, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }])
    .png({ compressionLevel: 9 }).toFile(path.join(out, "badge-96.png"));
  console.log("badge-96.png");
}
