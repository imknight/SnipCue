// Renders the toolbar/store icons as real PNGs at exact sizes (no dependencies).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inRoundRect, png } from './png.mjs';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'icons');
mkdirSync(out, { recursive: true });

const BLUE = [44, 95, 217], WHITE = [255, 255, 255];

// Blue rounded tile, white speech bubble with tail, two blue "text" lines.
const icon = (x, y) => {
  if (!inRoundRect(x, y, 0.03, 0.03, 0.97, 0.97, 0.22)) return [0, 0, 0, 0];
  const bubble = inRoundRect(x, y, 0.18, 0.22, 0.82, 0.68, 0.12);
  const tail = y >= 0.66 && y <= 0.84 && x >= 0.28 && x <= 0.46 && x - 0.28 <= (0.84 - y) * 1.0;
  if (bubble || tail) {
    const line1 = inRoundRect(x, y, 0.29, 0.35, 0.71, 0.42, 0.035);
    const line2 = inRoundRect(x, y, 0.29, 0.49, 0.58, 0.56, 0.035);
    return line1 || line2 ? [...BLUE, 1] : [...WHITE, 1];
  }
  return [...BLUE, 1];
};

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(out, `icon-${size}.png`), png(size, icon));
  console.log(`icons/icon-${size}.png ${size}x${size}`);
}
