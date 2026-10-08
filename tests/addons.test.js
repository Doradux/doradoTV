import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddonsHandler } from '../netlify/functions/addons.js';
import { safeJson, manifestUrl, normalizeManifest, resourceUrl, supports } from '../netlify/lib/stremio-addon.js';
import { digest } from '../netlify/lib/room-security.js';
import { read } from '../netlify/lib/room-store.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
const manifest = {
  id: 'org.example.movies', name: 'Películas libres', version: '1.0.0',
  description: 'Catálogo de prueba', types: ['movie', 'series'],
  resources: ['catalog', 'meta', { name: 'stream', types: ['movie'], idPrefixes: ['tt'] }, 'subtitles'],
  catalogs: [{ id: 'test', name: 'Películas', type: 'movie', extra: [{ name: 'search' }] }],
};
async function fixture() {
  const store = memoryBlobStore(), ownerToken = 'a'.repeat(64), guestToken = 'b'.repeat(64);
  const time = 100000;
  await store.setJSON('account/owner', { id: 'owner', username: 'Propietario', verified: true, version: 1 });
  await store.setJSON(`session/${digest(ownerToken)}`, { kind: 'account', accountId: 'owner', version: 1, expires: time + 9999 });
  await store.setJSON(`session/${digest(guestToken)}`, { kind: 'guest', roomId: 'sala-cine', version: 1, expires: time + 9999 });
  await store.setJSON('room/sala-cine', { slug: 'sala-cine', title: 'Cine', ownerId: 'owner', version: 1, revision: 1 });
  await store.setJSON('room/otra-sala', { slug: 'otra-sala', title: 'Otro', ownerId: 'owner', version: 1, revision: 1 });
  const called = [];
  const handler = createAddonsHandler({ getStore: () => store, env, clock: () => time, fetchJson: async (url) => {
    called.push(url);
    if (url.endsWith('manifest.json')) return manifest;
    if (url.includes('/catalog/')) return { metas: [{ id: 'tt12345', name: 'Película libre', type: 'movie', poster: 'https://image.test/cover.jpg' }] };
    if (url.includes('/meta/')) return { meta: { id: 'tt12345', name: 'Película libre', type: 'movie', videos: [] } };
    if (url.includes('/stream/')) return { streams: [{ url: 'https://media.test/film.mp4', name: '1080p' }, { infoHash: 'deadbeef', name: 'Torrent' }] };
    return { subtitles: [{ id: 'es', lang: 'spa', url: 'https://media.test/sub.vtt' }] };
  } });
  async function call(action, kind = 'owner', data = {}, room = 'sala-cine') {
    const method = action === 'list' ? 'GET' : 'POST';
    const request = new Request(`https://app.test/.netlify/functions/addons?action=${action}&room=${room}`, {
      method, headers: { cookie: `${kind === 'owner' ? 'dorado_account' : 'dorado_guest'}=${kind === 'owner' ? ownerToken : guestToken}`,
        ...(method === 'POST' ? { origin: 'https://app.test', 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ room, ...data }) } : {}),
    });
    const response = await handler(request);
    return { status: response.status, data: await response.json() };
  }
  return { store, handler, called, call };
}

test('only the room owner can install or remove addons; credentials are encrypted', async () => {
  const f = await fixture();
  const url = 'https://addon.test/private-secret/manifest.json';
  assert.equal((await f.call('install', 'guest', { url })).status, 403);
  const installed = await f.call('install', 'owner', { url });
  assert.equal(installed.status, 201);
  const saved = await read(f.store, 'addons/sala-cine');
  assert.equal(JSON.stringify(saved).includes('private-secret'), false);
  const guestList = await f.call('list', 'guest');
  assert.equal(guestList.status, 200);
  assert.equal(guestList.data.owner, false);
  assert.equal(guestList.data.addons[0].manifest.name, 'Películas libres');
  assert.equal(JSON.stringify(guestList.data).includes('private-secret'), false);
  assert.equal((await f.call('install', 'owner', { url })).status, 409);
  assert.equal((await f.call('remove', 'guest', { addonId: installed.data.addon.id })).status, 403);
  assert.equal((await f.call('remove', 'owner', { addonId: installed.data.addon.id })).status, 200);
  assert.equal((await f.call('list', 'guest')).data.addons.length, 0);
});

test('authorized guests can browse catalogs and discover supported direct streams', async () => {
  const f = await fixture();
  const { data } = await f.call('install', 'owner', { url: 'https://addon.test/config/manifest.json' });
  const id = data.addon.id;
  const result = await f.call('catalog', 'guest', { addonId: id, type: 'movie', catalogId: 'test', search: 'film' });
  assert.equal(result.status, 200);
  assert.equal(result.data.metas[0].name, 'Película libre');
  assert(f.called.some((url) => url.includes('/catalog/movie/test/') && url.includes('search=film')));
  const meta = await f.call('meta', 'guest', { addonId: id, type: 'movie', id: 'tt12345' });
  assert.equal(meta.data.meta.id, 'tt12345');
  const streams = await f.call('streams', 'guest', { type: 'movie', id: 'tt12345' });
  assert.equal(streams.data.streams.length, 2);
  assert.equal(streams.data.streams[0].supported, true);
  assert.equal(streams.data.streams[1].supported, false);
  assert.equal((await f.call('catalog', 'guest', { addonId: id, type: 'movie', catalogId: 'test' }, 'otra-sala')).status, 403);
  assert.equal((await f.call('streams', 'guest', { type: 'movie', id: 'invalid' })).data.streams.length, 0);
});

test('unsafe addon URLs and private DNS targets are rejected', async () => {
  for (const url of ['http://addon.test/manifest.json', 'https://localhost/manifest.json', 'https://user:pass@addon.test/manifest.json', 'https://addon.test:8888/manifest.json']) {
    assert.throws(() => manifestUrl(url));
  }
  assert.equal(manifestUrl('stremio://addon.test'), 'https://addon.test/manifest.json');
  await assert.rejects(safeJson('https://internal.test/manifest.json', {
    resolver: async () => [{ address: '127.0.0.1', family: 4 }],
  }), { status: 403 });
  await assert.rejects(safeJson('https://rebinding.test/manifest.json', {
    resolver: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }],
  }), { status: 403 });
});

test('Stremio resource filtering respects content types and id prefixes', () => {
  const normalized = normalizeManifest(manifest);
  assert(supports(normalized, 'stream', 'movie', 'tt123'));
  assert(!supports(normalized, 'stream', 'movie', 'imdb:123'));
  assert(!supports(normalized, 'stream', 'series', 'tt123'));
  assert(resourceUrl('https://addon.test/user/manifest.json', 'catalog', 'movie', 'test', { search: 'film' }).includes('/user/catalog/movie/test/search=film.json'));
});
