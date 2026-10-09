import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomsService } from '../netlify/lib/rooms-service.js';
import { seal } from '../netlify/lib/room-security.js';
import { memoryBlobStore } from './helpers/blob-store.js';

test('server-issued torrent permissions are bound to the exact room and viewer', async () => {
  const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 18).toString('base64') };
  const store = memoryBlobStore();
  const room = 'legal-content-room', viewer = 'viewer_legal_test', now = 50000;
  const calls = [];
  await store.setJSON('room/' + room, {
    slug: room, ownerId: 'owner', version: 1, revision: 1,
    relayCredentials: seal(JSON.stringify({
      url: 'https://relay-public.example.com', secret: 'long-test-secret-for-unit',
    }), 'relay:' + room, env),
  });
  const service = new RoomsService(store, {
    env, clock: () => now,
    relayFactory: () => ({
      torrentStart: async (hash, fileIdx, sessionId) => {
        calls.push({ hash, fileIdx, sessionId });
        return { id: '12345678-1234-1234-1234-123456789012' };
      },
    }),
  });
  const user = { account: { id: 'owner', verified: true }, sessionId: viewer };
  const hash = 'a'.repeat(40);
  const ticket = (expires, subject = viewer) => seal(JSON.stringify({
    hash, fileIdx: 0, expires,
  }), 'torrent:' + room + ':' + subject, env);
  assert.deepEqual(await service.startTorrent(room, user, ticket(now + 60)), {
    id: '12345678-1234-1234-1234-123456789012',
  });
  assert.deepEqual(calls, [{ hash, fileIdx: 0, sessionId: viewer }]);
  await assert.rejects(service.startTorrent(room, user, ticket(now - 1)), { status: 403 });
  await assert.rejects(service.startTorrent(room, user, ticket(now + 601)), { status: 403 });
  await assert.rejects(service.startTorrent(room, user, ticket(now + 60, 'other_viewer')), { status: 403 });
  await assert.rejects(service.startTorrent(room, user, { hash }), { status: 403 });
  await assert.rejects(service.startTorrent('not-the-room', user, ticket(now + 60)), { status: 403 });
  assert.equal(calls.length, 1);
});

test('direct-audio permission tickets are room-scoped, viewer-scoped and short-lived', async () => {
  const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64') };
  const store = memoryBlobStore();
  const room = 'legal-videos', now = 10000, viewer = 'viewer-1';
  const calls = [];
  await store.setJSON('room/' + room, {
    slug: room, ownerId: 'owner', version: 1, revision: 1,
    relayCredentials: seal(JSON.stringify({
      url: 'https://relay.example.org', secret: 'a-private-room-relay-secret',
    }), 'relay:' + room, env),
  });
  const service = new RoomsService(store, { env, clock: () => now, relayFactory: () => ({
    directAudioStart: async (url, sessionId) => {
      calls.push({ url, sessionId });
      return { id: '11111111-2222-3333-4444-555555555555',
        url: 'https://relay.example.org/direct-audio/11111111-2222-3333-4444-555555555555?token=fake' };
    },
    directAudioStop: async (id, sessionId) => {
      calls.push({ id, sessionId }); return { ok: true };
    },
  }) });
  const user = { account: { id: 'owner', verified: true }, sessionId: viewer };
  const url = 'https://cdn.example.org/film.mkv?signed=token';
  const ticket = (expires, sessionId = viewer) => seal(JSON.stringify({ url, expires }),
    'direct-audio:' + room + ':' + sessionId, env);
  const result = await service.directAudio(room, user, 'direct-audio-start', { ticket: ticket(now + 120) });
  assert.equal(result.id, '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(calls, [{ url, sessionId: viewer }]);
  for (const input of [{ ticket: ticket(now - 2) }, { ticket: ticket(now + 601) },
    { ticket: ticket(now + 120, 'someone-else') }, { url }, {}]) {
    await assert.rejects(service.directAudio(room, user, 'direct-audio-start', input), { status: 403 });
  }
  await assert.rejects(service.directAudio('other-room', user, 'direct-audio-start',
    { ticket: ticket(now + 120) }), { status: 403 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await service.directAudio(room, user, 'direct-audio-stop',
    { id: '11111111-2222-3333-4444-555555555555' }), { ok: true });
  assert.equal(calls[1].sessionId, viewer);
});
