import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptPlaylist, decryptPlaylist } from '../src/crypto.js';

const playlist = '#EXTM3U\n#EXTINF:-1,Canal\nhttps://example.com/directo.m3u8\n';
const key = randomBytes(32).toString('base64');

test('the playlist is encrypted and decrypts with the session key', async () => {
  const document = await encryptPlaylist(playlist, key);
  assert.equal(document.version, 2);
  assert.equal(await decryptPlaylist(document, key), playlist);
  assert.equal(JSON.stringify(document).includes('example.com'), false);
});

test('another key and modified ciphertext are rejected', async () => {
  const document = await encryptPlaylist(playlist, key);
  await assert.rejects(decryptPlaylist(document, randomBytes(32).toString('base64')));
  document.data = document.data.replace(/./, document.data[0] === 'A' ? 'B' : 'A');
  await assert.rejects(decryptPlaylist(document, key));
});

test('fallback decrypts Web Crypto ciphertext on local network origins', async () => {
  const document = await encryptPlaylist(playlist, key);
  assert.equal(await decryptPlaylist(document, key, { forceFallback: true }), playlist);
});

test('fallback encryption can be decrypted by Web Crypto', async () => {
  const document = await encryptPlaylist(playlist, key, { forceFallback: true });
  assert.equal(await decryptPlaylist(document, key), playlist);
});
