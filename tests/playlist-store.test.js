import test from 'node:test';
import assert from 'node:assert/strict';
import { commitPlaylist, getChunk, getManifest, isAdmin, saveChunk } from '../netlify/lib/playlist-store.js';
import { encryptPlaylist } from '../src/crypto.js';

function memoryStore() {
  const data = new Map();
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => { data.set(key, value); },
    delete: async (key) => { data.delete(key); },
  };
}

test('only the admin role is authorized for playlist operations', () => {
  assert.equal(isAdmin(null), false);
  assert.equal(isAdmin({ roles: [] }), false);
  assert.equal(isAdmin({ roles: ['viewer'] }), false);
  assert.equal(isAdmin({ roles: ['admin'] }), true);
});

test('publishes a complete encrypted upload and replaces it atomically', async () => {
  const store = memoryStore();
  const batch = '12345678-1234-1234-1234-123456789abc';
  const payload = JSON.stringify(await encryptPlaylist('#EXTM3U\n#EXTINF:-1,Canal\nhttps://example.com/a.ts', 'clave-de-prueba-segura'));
  const middle = Math.ceil(payload.length / 2);
  await saveChunk(store, batch, 0, payload.slice(0, middle));
  assert.equal(await getManifest(store), null);
  await assert.rejects(commitPlaylist(store, batch, 2), /Faltan fragmentos/);
  await saveChunk(store, batch, 1, payload.slice(middle));
  await commitPlaylist(store, batch, 2);
  assert.deepEqual(await getManifest(store), { batch, count: 2 });
  assert.equal((await getChunk(store, 0)) + (await getChunk(store, 1)), payload);
});

test('rejects invalid chunks and plaintext uploads', async () => {
  const store = memoryStore();
  const batch = '12345678-1234-1234-1234-123456789abc';
  await assert.rejects(saveChunk(store, '../wrong', 0, 'x'));
  await saveChunk(store, batch, 0, '#EXTM3U\n');
  await assert.rejects(commitPlaylist(store, batch, 1));
  assert.equal(await getManifest(store), null);
});
