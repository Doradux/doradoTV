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

test('on-demand VOD can only start from a server-issued room and viewer ticket', async () => {
  const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString('base64') };
  const store = memoryBlobStore();
  const room = 'stream-room', viewerId = 'viewer-hls', now = 62000;
  const calls = [];
  await store.setJSON('room/' + room, {
    slug: room, ownerId: 'owner', revision: 1, version: 1,
    relayCredentials: seal(JSON.stringify({
      url: 'https://relay.example.org', secret: 'private-test-only',
    }), 'relay:' + room, env),
  });
  const service = new RoomsService(store, { env, clock: () => now, relayFactory: () => ({
    vodStart: async (source, viewer) => {
      calls.push({ source, viewer }); return { id: '11111111-2222-3333-4444-555555555555' };
    },
    vodStatus: async (id, viewer) => ({ state: 'ready', id, viewer }),
    vodStop: async () => ({ ok: true }),
  }) });
  const who = { account: { id: 'owner', verified: true }, sessionId: viewerId };
  const hash = 'a'.repeat(40);
  const torrentTicket = (expiry, viewer = viewerId) => seal(JSON.stringify({
    hash, fileIdx: 0, expires: expiry,
  }), 'torrent:' + room + ':' + viewer, env);
  const directTicket = (expiry, viewer = viewerId) => seal(JSON.stringify({
    url: 'https://cdn.example.org/video.mkv?token=signed', expires: expiry,
  }), 'direct-audio:' + room + ':' + viewer, env);
  assert.equal((await service.startVod(room, who, { kind: 'torrent', ticket: torrentTicket(now + 60) })).id,
    '11111111-2222-3333-4444-555555555555');
  assert.equal((await service.startVod(room, who, { kind: 'https', ticket: directTicket(now + 60) })).id,
    '11111111-2222-3333-4444-555555555555');
  assert.deepEqual(calls, [
    { source: { info_hash: hash, file_idx: 0 }, viewer: viewerId },
    { source: { url: 'https://cdn.example.org/video.mkv?token=signed' }, viewer: viewerId },
  ]);
  for (const input of [
    { kind: 'https', ticket: directTicket(now - 1) },
    { kind: 'torrent', ticket: torrentTicket(now + 601) },
    { kind: 'https', ticket: directTicket(now + 60, 'another-viewer') },
    { kind: 'torrent', ticket: directTicket(now + 60) },
    { kind: 'https', url: 'https://cdn.example.org/anything.mkv' },
  ]) await assert.rejects(service.startVod(room, who, input), { status: 403 });
  await assert.rejects(service.startVod('another-room', who,
    { kind: 'torrent', ticket: torrentTicket(now + 60) }), { status: 403 });
  assert.equal(calls.length, 2);
  assert.deepEqual(await service.vodCommand(room, who, 'vod-stop',
    '11111111-2222-3333-4444-555555555555'), { ok: true });
});
