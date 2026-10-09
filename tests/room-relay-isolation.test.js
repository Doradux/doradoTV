import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { RoomsService, roomView } from '../netlify/lib/rooms-service.js';
import { normalizeRelay, createRelayClient, relayFetch } from '../netlify/lib/room-relay.js';
import { seal, unseal } from '../netlify/lib/room-security.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = {
  DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64'),
  DORADO_RELAY_URL: 'https://OLD-SHARED.example.com',
  DORADO_RELAY_SECRET: 'obsolete-global-relay-key',
};
const owner = { id: 'person-1', username: 'Person1', verified: true, rooms: [] };
const myRelay = (name) => ({ url: 'https://' + name + '.example.com', secret: 'relay-unique-secret-' + name });

test('relay URL and secret must be explicitly supplied; private / redirect-style addresses are rejected', async () => {
  assert.deepEqual(normalizeRelay(myRelay('new-room')), myRelay('new-room'));
  for (const url of ['http://relay.example.com', 'https://127.0.0.1', 'https://localhost',
    'https://relay.local', 'https://relay.example.com/admin', 'https://user:pass@relay.example.com',
    'https://relay.example.com:8443', 'file:///tmp/local', 'https://relay.example.com?code=secret']) {
    assert.throws(() => normalizeRelay({ url, secret: 'long-secret-with-entropy' }), { status: 400 });
  }
  assert.throws(() => normalizeRelay({ ...myRelay('room'), secret: 'short' }), { status: 400 });
  assert.equal(createRelayClient(null).configured, false);
  // Existing Netlify environment variables must never activate an unconfigured room.
  const store = memoryBlobStore();
  const service = new RoomsService(store, { env, verifyRelay: async () => ({ valid: true }) });
  await store.setJSON('room/legacy-room', { slug: 'legacy-room', ownerId: owner.id, version: 1, revision: 1 });
  assert.deepEqual(await service.relayHealth('legacy-room', { account: owner }), { configured: false, ready: false });
});

test('relay verifies its authenticated /status endpoint (health alone is insufficient)', async () => {
  const calls = [];
  const cfg = myRelay('verify');
  const client = createRelayClient(cfg, async (target, request) => {
    calls.push({ uri: target.href, authorization: request.headers.Authorization, method: request.method });
    return Response.json(target.pathname === '/health'
      ? { ok: true }
      : { max_connections: 3, active_count: 0, viewer_count: 0 });
  });
  assert.deepEqual(await client.verify(), { valid: true, host: 'verify.example.com', maximum: 3 });
  assert.deepEqual(calls.map((call) => call.uri), [cfg.url + '/health', cfg.url + '/status']);
  assert(calls.every((call) => call.authorization === 'Bearer ' + cfg.secret));
  const invalid = createRelayClient(cfg, async (url) => url.pathname === '/health'
    ? Response.json({ ok: true })
    : Response.json({ error: 'Unauthorized' }, { status: 401 }));
  await assert.rejects(invalid.verify(), { status: 403, message: 'La clave del relay no es válida.' });
});

test('room relay settings are encrypted and uniquely assigned; replacing one revokes old claim', async () => {
  const store = memoryBlobStore();
  await store.setJSON('account/' + owner.id, owner);
  const service = new RoomsService(store, { env, clock: () => 10000,
    verifyRelay: async () => ({ valid: true, maximum: 3 }) });
  const settings = myRelay('first-room');
  await assert.rejects(service.create(owner, { slug: 'first-room', title: 'One', password: 'password123' }), { status: 400 });
  const first = await service.create(owner, { slug: 'first-room', title: 'One', password: 'password123', relay: settings });
  assert.equal(first.relayConfigured, true);
  assert.equal(first.relayHost, 'first-room.example.com');
  const stored = await store.get('room/first-room', { type: 'json' });
  assert(stored.relayCredentials);
  assert(!JSON.stringify(stored).includes(settings.secret));
  assert.deepEqual(JSON.parse(unseal(stored.relayCredentials, 'relay:first-room', env)), settings);
  assert.throws(() => unseal(stored.relayCredentials, 'relay:other-room', env));
  assert.equal(roomView(stored, { id: 'visitor' }).relayHost, null);
  assert.equal(roomView(stored, { id: 'visitor' }).relayConfigured, true);
  await assert.rejects(service.create(owner, { slug: 'other-room', title: 'Two', password: 'password123', relay: settings }), { status: 409 });
  const secondCfg = myRelay('other-room');
  const second = await service.create(owner, { slug: 'other-room', title: 'Two', password: 'password123', relay: secondCfg });
  assert.equal(second.relayConfigured, true);
  assert.notEqual((await store.get('room/other-room', { type: 'json' })).relayCredentials, stored.relayCredentials);
  const replacement = myRelay('replacement');
  const moved = await service.update('first-room', { account: owner }, {
    revision: first.revision, title: first.title, limit: null, relay: replacement,
  });
  assert.equal(moved.relayHost, 'replacement.example.com');
  assert.equal((await store.get('room/first-room', { type: 'json' })).version, stored.version + 1);
  await assert.rejects(service.update('other-room', { account: owner }, {
    revision: second.revision, title: second.title, limit: null, relay: replacement,
  }), { status: 409 });
  // After moving, old URL can be claimed by a new room.
  const third = await service.create(owner, { slug: 'third-room', title: 'Three',
    password: 'password123', relay: settings });
  assert.equal(third.relayHost, 'first-room.example.com');
  await service.remove('third-room', { account: owner }, third.revision);
  assert.equal(await store.get('relay-owner/' + (await import('../netlify/lib/room-security.js')).digest(settings.url), { type: 'json' }), null);
});

test('SSRF-safe relay client refuses private DNS answers without making a network call', async () => {
  let called = false;
  await assert.rejects(relayFetch(new URL('https://relay.example.com/status'),
    { method: 'GET', headers: { Authorization: 'Bearer hidden' } },
    { resolver: async () => [{ address: '127.0.0.1', family: 4 }],
      transport: () => { called = true; throw Error('Must not call'); } }), { status: 403 });
  assert.equal(called, false);
});


test('separate room relays receive isolated start and ping operations', async () => {
  const store = memoryBlobStore();
  await store.setJSON('account/' + owner.id, owner);
  const events = [];
  const service = new RoomsService(store, { env, clock: () => 100000,
    detect: async () => [], verifyRelay: async () => ({ valid: true }),
    relayFactory: (cfg) => ({
      configured: !!cfg,
      health: async () => ({ configured: !!cfg, ready: !!cfg }),
      start: async (channel) => {
        events.push(['start', cfg.url]);
        return { sessionId: cfg.url + '/session', emissionId: cfg.url + '/emission',
          url: cfg.url + '/media/123/index.m3u8?token=example' };
      },
      ping: async () => { events.push(['ping', cfg.url]); return { kicked: false }; },
    }),
  });
  for (const slug of ['room-alpha', 'room-bravo']) {
    const created = await service.create(owner, { slug, title: slug,
      password: 'password123', relay: myRelay(slug) });
    await service.upload(slug, { account: owner }, {
      filename: 'channels.m3u', revision: created.revision,
      source: '#EXTM3U\n#EXTINF:-1,Demo\nhttp://iptv.example.com/live/demo/channel.ts',
    });
    const sessionId = 'user-' + slug;
    const result = await service.start(slug, { account: owner, sessionId },
      { channelId: 1, tab: 'browser-tab-' + slug });
    await service.playback(slug, { account: owner, sessionId }, { id: result.id }, 'ping');
  }
  assert.deepEqual(events, [
    ['start', myRelay('room-alpha').url], ['ping', myRelay('room-alpha').url],
    ['start', myRelay('room-bravo').url], ['ping', myRelay('room-bravo').url],
  ]);
});


test('new-room and settings UI require verified private relay configuration', async () => {
  const { readFileSync } = await import('node:fs');
  const ui = readFileSync(new URL('../src/rooms-ui.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../netlify/functions/rooms.js', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../netlify/lib/rooms-service.js', import.meta.url), 'utf8');
  for (const field of ['create-relay-url', 'create-relay-secret', 'create-verify-relay',
    'settings-relay-url', 'settings-relay-secret', 'settings-verify-relay']) {
    assert(ui.includes('id="' + field + '"'));
  }
  assert(ui.includes("roomApi('verify-relay'"));
  assert(ui.includes("dataset.relayVerified !== 'true'"));
  assert(api.includes("action === 'verify-relay'"));
  assert(service.includes('await this.checkedRelay(relayInput)'));
  assert(!service.includes('createRelayClient(env)'));
});
