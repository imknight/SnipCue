// Generates a development signing key so the unpacked extension has a stable ID
// (needed for the native-messaging allowlist). The private key stays local and
// is gitignored; only the public key goes into the manifest.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pubPath = join(root, 'dev-key.json');

export function extensionIdFromKey(b64) {
  const hex = createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (existsSync(pubPath) && !process.argv.includes('--force')) {
    const { key } = JSON.parse(readFileSync(pubPath, 'utf8'));
    console.log(`Existing dev key. Extension ID: ${extensionIdFromKey(key)}`);
  } else {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const key = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    mkdirSync(join(root, 'keys'), { recursive: true });
    writeFileSync(join(root, 'keys', 'dev-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    writeFileSync(pubPath, JSON.stringify({ key, extension_id: extensionIdFromKey(key) }, null, 2) + '\n');
    console.log(`New dev key. Extension ID: ${extensionIdFromKey(key)}`);
  }
}
