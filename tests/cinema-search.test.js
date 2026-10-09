import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddonsHandler } from '../netlify/functions/addons.js';
import { streamView } from '../netlify/lib/stremio-addon.js';
import { digest } from '../netlify/lib/room-security.js';
import { memoryBlobStore } from './helpers/blob-store.js';

test('search queries all searchable catalogs, merges duplicate IDs, and allows room guests', async () => {
  const store = memoryBlobStore();
  const clock = 12000, ownerToken = 'c'.repeat(64), guestToken = 'd'.repeat(64);
  const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
  await store.setJSON('account/owner', { id: 'owner', username: 'Host', verified: true, version: 1 });
  await store.setJSON('session/' + digest(ownerToken), { kind: 'account', accountId: 'owner', version: 1, expires: clock + 3000 });
  await store.setJSON('session/' + digest(guestToken), { kind: 'guest', roomId: 'salacinema', version: 1, expires: clock + 3000 });
  await store.setJSON('room/salacinema', { slug: 'salacinema', title: 'Cine', ownerId: 'owner', version: 1, revision: 1 });
  const calls = [];
  const handler = createAddonsHandler({ getStore: () => store, env, clock: () => clock, fetchJson: async (url) => {
    calls.push(url);
    if (url.endsWith('/manifest.json')) return { id: url, name: url.includes('one.test') ? 'A' : 'B', version: '1', resources: ['catalog'], types: ['movie'], catalogs: [
      { id: 'search', type: 'movie', extra: [{ name: 'search' }] }, { id: 'popular', type: 'movie', extra: [] },
    ] };
    if (url.includes('two.test')) return { metas: [{ type: 'movie', id: 'tt1', name: 'Duplicada', poster: 'https://img.test/poster.jpg' }, { type: 'movie', id: 'tt2', name: 'Otra' }] };
    return { metas: [{ type: 'movie', id: 'tt1', name: 'Primera' }] };
  }});
  const send = async (action, token, data = {}) => {
    const req = new Request('https://app.test/.netlify/functions/addons?action=' + action + '&room=salacinema', {
      method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json', cookie: (token === ownerToken ? 'dorado_account=' : 'dorado_guest=') + token },
      body: JSON.stringify({ room: 'salacinema', ...data }),
    });
    const response = await handler(req);
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await send('install', ownerToken, { url: 'https://one.test/manifest.json' })).status, 201);
  assert.equal((await send('install', ownerToken, { url: 'https://two.test/manifest.json' })).status, 201);
  const result = await send('search', guestToken, { type: 'movie', search: 'Star Wars' });
  assert.equal(result.status, 200);
  assert.equal(result.data.engines, 2);
  assert.equal(result.data.metas.length, 2);
  assert(result.data.metas.every((m) => m.addonId));
  assert.equal(result.data.metas[0].poster, 'https://img.test/poster.jpg');
  assert.equal(calls.filter((url) => url.includes('/catalog/')).length, 2);
  assert(calls.every((url) => !url.includes('popular')));
  assert.equal((await send('search', guestToken, { type: 'movie', search: 'a' })).status, 400);
});

test('source cards retain seed counts and validate magnet hash', () => {
  const infoHash = 'a'.repeat(40);
  const torrent = streamView({ name: 'Video 1080p', infoHash, title: '1080p 👤 120 💾 2 GB', fileIdx: 1 }, 'Example');
  assert.equal(torrent.kind, 'torrent');
  assert.equal(torrent.seeders, 120);
  assert.equal(torrent.infoHash, infoHash);
  assert.equal(torrent.fileIdx, 1);
  assert.equal(torrent.supported, false);
  assert.equal(streamView({ infoHash: 'invalid', seeders: 42 }, 'Example').infoHash, '');
  assert.equal(streamView({ url: 'https://example.test/movie.mp4' }, 'Example').supported, true);
});

