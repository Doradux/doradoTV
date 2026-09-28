import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { encryptPlaylist } from '../src/crypto.js';

const args = process.argv.slice(2);
const input = args[0];
const outIndex = args.indexOf('--out');
const output = outIndex >= 0 ? args[outIndex + 1] : 'dist/playlist.enc.json';
if (!input || !output || args.some((arg, index) => index > 0 && arg !== '--out' && index !== outIndex + 1)) {
  process.stderr.write('Uso: npm run encrypt:playlist -- /ruta/lista.m3u [--out dist/playlist.enc.json]\n');
  process.exit(1);
}
if (!process.stdin.isTTY) {
  process.stderr.write('Ejecuta este comando en una terminal para introducir la clave sin mostrarla.\n');
  process.exit(1);
}

function askSecret(prompt) {
  return new Promise((resolveSecret, reject) => {
    let value = '';
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
      if (error) reject(error); else resolveSecret(value);
    };
    const onData = (chunk) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { finish(new Error('Cancelado.')); return; }
        if (char === '\r' || char === '\n') { finish(); return; }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else value += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

try {
  const source = await readFile(resolve(input), 'utf8');
  if (!source.includes('#EXTINF:')) throw new Error('El archivo no parece una lista M3U.');
  const password = await askSecret('Clave de cifrado: ');
  if (password.length < 12) throw new Error('La clave debe tener al menos 12 caracteres.');
  const confirmation = await askSecret('Repite la clave: ');
  if (password !== confirmation) throw new Error('Las claves no coinciden.');
  const encrypted = await encryptPlaylist(source, password);
  await writeFile(resolve(output), JSON.stringify(encrypted));
  process.stdout.write(`Lista cifrada guardada en ${resolve(output)}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
