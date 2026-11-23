// Builds the unpacked extension into dist/. `--store` omits the dev "key" and zips for upload.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const store = process.argv.includes('--store');

rmSync(dist, { recursive: true, force: true });
cpSync(join(root, 'static'), dist, { recursive: true });

const common = { bundle: true, target: 'chrome116', minify: store, sourcemap: store ? false : 'linked', legalComments: 'none', logLevel: 'warning', define: { 'process.env.NODE_ENV': store ? '"production"' : '"development"' } };
await build({ ...common, entryPoints: { background: 'src/background/sw.ts' }, outdir: dist, format: 'esm', absWorkingDir: root });
await build({ ...common, entryPoints: { 'sidepanel/sidepanel': 'src/sidepanel/main.tsx', 'library/library': 'src/library/main.tsx' }, outdir: dist, format: 'esm', jsx: 'automatic', absWorkingDir: root });

const manifest = JSON.parse(readFileSync(join(root, 'static', 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
manifest.version = pkg.version;
const keyFile = join(root, 'dev-key.json');
if (!store && existsSync(keyFile)) manifest.key = JSON.parse(readFileSync(keyFile, 'utf8')).key;
writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

if (store) {
  const zip = join(root, `snipcue-${pkg.version}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-qr', zip, '.', '-x', '*.map', '.DS_Store'], { cwd: dist });
  console.log(`Store package: ${zip}`);
}
console.log(`Built ${store ? 'store' : 'development'} extension → ${dist}`);
