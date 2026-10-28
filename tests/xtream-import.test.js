import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomsService } from '../netlify/lib/rooms-service.js';
import { createRoomsHandler } from '../netlify/functions/rooms.js';
import { fetchXtreamPlaylist } from '../netlify/lib/room-xtream.js';
import { channelProvider } from '../netlify/lib/room-provider.js';
import { parsePlaylist } from '../src/playlist.js';
import { unseal, newSession, ACCOUNT_COOKIE, GUEST_COOKIE } from '../netlify/lib/room-security.js';
import { read } from '../netlify/lib/room-store.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 12).toString('base64') };
const account = { id: 'owner', username: 'owner', verified: true, version: 1, rooms: [] };
const provider = { origin: 'https://example.test:8080', username: 'sample-user', password: 'sample-secret' };
const relay = { url: 'https://relay.example.com', secret: 'example-relay-secret-123' };
const fetcher = async (url) => url.searchParams.get('action') === 'get_live_categories'
  ? [{ category_id: 10, category_name: 'Noticias' }]
  : [{ stream_id: 5, name: 'Noticias, HD', category_id: 10, stream_icon: 'https://logo.example.test/1.png' },
     { stream_id: 6, name: 'Deporte', category_id: 20 }, { stream_id: 'wrong', name: 'Invalid' }];
const verifyProvider = async (value) => {
  if (value.password !== provider.password) throw Error('Credenciales incorrectas');
  return { ...value, maximum: 2 };
};
const detect = async (channels) => [{ id: channelProvider(channels[0], 'xtream-sala', env), maximum: null }];
async function fixture() {
  const store = memoryBlobStore();
  await store.setJSON('account/owner', account);
  const service = new RoomsService(store, {
    env, verifyRelay: async () => ({ valid: true }), verifyProvider, detect,
    xtreamFetcher: (value) => fetchXtreamPlaylist(value, fetcher),
  });
  const room = await service.create(account, { slug: 'xtream-sala', title: 'Sala Xtream', password: 'sala-secreta-123', relay });
  return { store, service, room, who: { account } };
}

test('Xtream live feed builds an M3U with groups, icons, and playable .ts URLs', async () => {
  const result = await fetchXtreamPlaylist(provider, fetcher);
  const channels = parsePlaylist(result.source);
  assert.equal(result.count, 2);
  assert.deepEqual(channels.map(({ name, group }) => [name, group]), [['Noticias · HD', 'Noticias'], ['Deporte', 'General']]);
  assert.equal(channels[0].url, provider.origin + '/live/sample-user/sample-secret/5.ts');
  assert.equal(channels[0].logo, 'https://logo.example.test/1.png');
});

test('owner can import Xtream encrypted; stale revision and other users cannot overwrite', async () => {
  const { store, service, room, who } = await fixture();
  const old = '#EXTM3U\n#EXTINF:-1,Original\nhttps://example.test/test.ts';
  const uploaded = await service.upload(room.slug, who, { filename: 'old.m3u', source: old, revision: room.revision });
  await assert.rejects(service.importXtream(room.slug, { account: { id: 'other' } }, { ...provider, revision: uploaded.revision }), { status: 403 });
  await assert.rejects(service.importXtream(room.slug, who, { ...provider, revision: room.revision }), { status: 409 });
  await assert.rejects(service.importXtream(room.slug, who, { ...provider, password: 'bad', revision: uploaded.revision }), /Credenciales incorrectas/);
  assert.equal(service.playlist(await service.access(room.slug, who)), old);
  const next = await service.importXtream(room.slug, who, { ...provider, revision: uploaded.revision });
  assert.equal(next.channelCount, 2);
  assert.equal(next.detectedMaximum, 2);
  assert.equal(next.providerConfigured, true);
  assert.equal(next.revision, uploaded.revision + 1);
  const stored = await read(store, 'room/' + room.slug);
  assert.equal(stored.relayHost, 'relay.example.com');
  assert(!JSON.stringify(stored).includes(provider.password));
  assert.equal(JSON.parse(unseal(stored.providerCredentials, 'provider:' + room.slug, env)).username, provider.username);
  assert.equal(parsePlaylist(service.playlist(stored)).length, 2);
  const guest = await service.join(room.slug, 'sala-secreta-123');
  assert.equal(guest.room.providerHost, null);
  assert.equal(guest.room.hasPlaylist, true);
});

test('Xtream invalid feeds cannot replace the saved playlist', async () => {
  const { service, room, who } = await fixture();
  const current = await service.importXtream(room.slug, who, { ...provider, revision: room.revision });
  const saved = service.playlist(await service.access(room.slug, who));
  service.xtreamFetcher = async () => { throw Error('Provider offline'); };
  await assert.rejects(service.importXtream(room.slug, who, { ...provider, revision: current.revision }), /Provider offline/);
  assert.equal(service.playlist(await service.access(room.slug, who)), saved);
  await assert.rejects(fetchXtreamPlaylist(provider, async (url) => url.searchParams.get('action') === 'get_live_streams' ? {} : []), /lista válida/);
  const huge = Array.from({ length: 15001 }, (_, i) => ({ stream_id: i + 1 }));
  await assert.rejects(fetchXtreamPlaylist(provider, async (url) => url.searchParams.get('action') === 'get_live_streams' ? huge : []), /demasiados canales/);
});

test('Xtream import route requires an owner session and checks room revisions', async () => {
  const { store, room } = await fixture();
  const handler = createRoomsHandler({ getStore: () => store, env: { ...env, DORADO_APP_URL: 'https://app.example.test' }, verifyProvider, detect,
    xtreamFetcher: (value) => fetchXtreamPlaylist(value, fetcher), verifyRelay: async () => ({ valid: true }) });
  const ownerToken = await newSession(store, { kind: 'account', accountId: account.id, version: 1 });
  const guestToken = await newSession(store, { kind: 'guest', roomId: room.slug, version: 1 });
  const send = (token, cookie) => handler(new Request('https://app.example.test/.netlify/functions/rooms?action=import-xtream', {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json', cookie: cookie + '=' + token },
    body: JSON.stringify({ room: room.slug, ...provider, revision: room.revision }),
  }));
  assert.equal((await send(guestToken, GUEST_COOKIE)).status, 403);
  const first = await send(ownerToken, ACCOUNT_COOKIE);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).channelCount, 2);
  assert.equal((await send(ownerToken, ACCOUNT_COOKIE)).status, 409);
});

test('Xtream providers that only allow HLS receive m3u8 channel URLs', async () => {
  const onlyHls = await fetchXtreamPlaylist({ ...provider, formats: ['m3u8'] }, fetcher);
  assert.equal(parsePlaylist(onlyHls.source)[0].url, provider.origin + '/live/sample-user/sample-secret/5.m3u8');
});
