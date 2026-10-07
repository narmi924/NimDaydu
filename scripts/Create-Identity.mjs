import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const path = new URL('../extension/identity.json', import.meta.url);
if (!existsSync(path)) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const id = [...createHash('sha256').update(der).digest().subarray(0, 16)].flatMap(byte => [byte >> 4, byte & 15]).map(n => String.fromCharCode(97 + n)).join('');
  writeFileSync(path, JSON.stringify({ publicKey: der.toString('base64'), extensionId: id }, null, 2) + '\n');
}
console.log('Fixed extension identity:', JSON.parse(readFileSync(path)).extensionId);
