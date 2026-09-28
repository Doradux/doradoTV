import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptPlaylist, decryptPlaylist } from '../src/crypto.js';

const playlist = '#EXTM3U\n#EXTINF:-1,Canal\nhttps://example.com/directo.m3u8\n';

test('round trip decrypts the playlist with the correct password', async () => {
  const document = await encryptPlaylist(playlist, 'una-clave-larga-de-prueba');
  assert.equal(await decryptPlaylist(document, 'una-clave-larga-de-prueba'), playlist);
  assert.equal(JSON.stringify(document).includes('example.com'), false);
});

test('wrong password or modified ciphertext cannot be decrypted', async () => {
  const document = await encryptPlaylist(playlist, 'una-clave-larga-de-prueba');
  await assert.rejects(decryptPlaylist(document, 'clave-incorrecta'));
  document.data = document.data.replace(/./, document.data[0] === 'A' ? 'B' : 'A');
  await assert.rejects(decryptPlaylist(document, 'una-clave-larga-de-prueba'));
});

test('fallback decrypts Web Crypto ciphertext on local network origins', async () => {
  const document = await encryptPlaylist(playlist, 'una-clave-larga-de-prueba');
  assert.equal(await decryptPlaylist(document, 'una-clave-larga-de-prueba', { forceFallback: true }), playlist);
  await assert.rejects(decryptPlaylist(document, 'clave-incorrecta', { forceFallback: true }));
});
