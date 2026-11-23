// Package the approved Cue Bubble renders from the logo generator.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../design/logos/cue-bubble/', import.meta.url));
const out = fileURLToPath(new URL('../static/icons/', import.meta.url));
mkdirSync(out, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  copyFileSync(join(source, `logo-${size}.png`), join(out, `icon-${size}.png`));
  console.log(`icons/icon-${size}.png ${size}x${size}`);
}
