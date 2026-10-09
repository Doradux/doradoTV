import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomsService, roomView } from '../netlify/lib/rooms-service.js';
import { validateProviderCredentials } from '../netlify/lib/room-provider.js';
import { createRelayClient } from '../netlify/lib/room-relay.js';
import { hashPassword, unseal } from '../netlify/lib/room-security.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString('base64') };
const profile = { id: 'owner', username: 'Owner', verified: true, rooms: [] };
const relayConfig = { url: 'https://provider-room.example.com', secret: 'relay-key-for-provider-room' };
const provider = { origin: 'https://test-provider.example', username: 'customer', password: 'secret-pass-123' };

test('provider verification rejects malformed credentials and validates Xtream auth', async () => {
  const verified = await validateProviderCredentials(provider, async (url) => {
    assert.equal(url.pathname, '/player_api.php');
    assert.equal(url.searchParams.get('username'), provider.username);
    return { user_info: { auth: 1, status: 'Active', max_connections: '3' } };
  });
  assert.equal(verified.maximum, 3);
  await assert.rejects(validateProviderCredentials({ ...provider, origin: 'file:///etc/passwd' }), /dirección/);
  await assert.rejects(validateProviderCredentials(provider, async () => ({ user_info: { auth: 0 } })), /rechazó/);
});

test('provider credentials are separately encrypted and private to room owner; update re-verifies', async () => {
  const store = memoryBlobStore();
  await store.setJSON('account/owner', profile);
  let count = 0;
  const service = new RoomsService(store, { env, clock: () => 80000,
    verifyRelay: async () => ({ valid: true }), verifyProvider: async (input) => { count++; if (input.password === 'bad') throw Error('Contraseña incorrecta'); return { ...input, maximum: 3 }; },
  });
  const created = await service.create(profile, { slug: 'provider-room', title: 'Provider Room', password: 'room_password_123', provider, relay: relayConfig });
  assert.equal(created.providerConfigured, true);
  assert.equal(created.providerHost, 'test-provider.example');
  assert.equal(count, 1);
  const raw = await store.get('room/provider-room', { type: 'json' });
  assert.equal(JSON.stringify(raw).includes(provider.password), false);
  assert.equal(JSON.stringify(raw).includes(provider.username), false);
  assert.equal(JSON.parse(unseal(raw.providerCredentials, 'provider:provider-room', env)).username, provider.username);
  assert.equal(roomView(raw, { id: 'guest' }).providerHost, null);
  assert.equal(roomView(raw, { id: 'guest' }).owner, false);
  await assert.rejects(service.update('provider-room', { account: profile }, {
    revision: created.revision, title: 'Provider Room', limit: null, provider: { ...provider, password: 'bad' },
  }), /Contraseña incorrecta/);
  const update = await service.update('provider-room', { account: profile }, {
    revision: created.revision, title: 'Provider Room', limit: null,
    provider: { ...provider, password: 'changed-pass' },
  });
  assert.equal(update.revision, created.revision + 1);
  const newer = await store.get('room/provider-room', { type: 'json' });
  assert.equal(JSON.parse(unseal(newer.providerCredentials, 'provider:provider-room', env)).password, 'changed-pass');
  assert.equal(newer.version, raw.version + 1);
  assert.equal(count, 3);
  await assert.rejects(service.upload('provider-room', { account: profile }, {
    filename: 'sample.m3u', revision: newer.revision,
    source: '#EXTM3U\n#EXTINF:-1,Demo\nhttps://test-provider.example/live/customer/secret-pass-123/1.m3u8',
  }), /otro proveedor/);
});

test('explicit room relay health and isolation without global fallback', async () => {
  const calls = [];
  const relay = createRelayClient({
    url: 'https://relay.example.com',
    secret: 'server-side-only-key',
  }, async (url, options) => {
    calls.push({ url: url.href, method: options.method });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.deepEqual(await relay.health(), { configured: true, ready: true });
  assert.deepEqual(calls, [{ url: 'https://relay.example.com/health', method: 'GET' }]);
  const disabled = createRelayClient(null, async () => { throw Error('should not request'); });
  assert.deepEqual(await disabled.health(), { configured: false, ready: false });
});
