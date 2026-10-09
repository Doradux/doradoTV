import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomsService, LEASE_SECONDS, UPLOAD_CHUNK_CHARS } from '../netlify/lib/rooms-service.js';
import { read } from '../netlify/lib/room-store.js';
import { digest, identity, cookie, ACCOUNT_COOKIE, GUEST_COOKIE, seal, unseal, checkCaptcha } from '../netlify/lib/room-security.js';
import { channelProvider, currentProgram, detectProviders, publicAddress } from '../netlify/lib/room-provider.js';
import { createRoomsHandler } from '../netlify/functions/rooms.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'), TURNSTILE_SITE_KEY: 'test-site-key', TURNSTILE_SECRET_KEY: 'test-secret', SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only', DORADO_APP_URL: 'https://app.example.test' };
const password = 'Una clave privada 123';
const relayForSlug = (slug) => ({ url: 'https://' + slug + '.example.com', secret: 'room-relay-secret-' + slug });
const playlist = '#EXTM3U\n#EXTINF:-1 group-title="General" tvg-logo="https://img.example.test/canal-uno.png",Canal uno\nhttps://media.example.test/live/user/password/1.m3u8\n#EXTINF:-1 group-title="Cine",Canal dos\nhttps://media.example.test/live/user/password/2.m3u8';
function fixture(maximum = 3) {
  const store = memoryBlobStore(), emails = []; let time = 100000;
  const provider = channelProvider({ url: 'https://media.example.test/live/user/password/1.m3u8' }, 'test', env);
  const service = new RoomsService(store, { env, clock: () => time, detect: async () => [{ id: provider, maximum }], program: async () => 'Noticias de prueba', verifyRelay: async () => ({ valid: true }), sendMail: async (...args) => emails.push(args) });
  return { store, service, emails, provider, clock: () => time, advance: (seconds) => { time += seconds; } };
}
async function owner(f, email = 'owner@example.test') {
  await f.service.register({ email, username: email.split('@')[0], password, passwordConfirm: password });
  await f.service.verify(f.emails.at(-1)[1]);
  const { token } = await f.service.login(email, password);
  const request = new Request('https://app.example.test', { headers: { cookie: cookie(ACCOUNT_COOKIE, token, new Request('https://app.example.test')) } });
  return identity(f.store, request, f.clock());
}
async function room(f, who, slug = 'sala-casa') {
  const created = await f.service.create(who.account, { slug, title: 'Mi sala', password, relay: relayForSlug(slug) });
  return f.service.upload(slug, who, { filename: 'canales.m3u', source: playlist, revision: created.revision });
}
async function guest(f, slug = 'sala-casa') {
  const { token } = await f.service.join(slug, password);
  return identity(f.store, new Request('https://app.example.test', { headers: { cookie: `${GUEST_COOKIE}=${token}` } }), f.clock());
}

test('verification is required, single-use, and recovery revokes old account sessions', async () => {
  const f = fixture();
  await f.service.register({ email: 'Owner@Example.test', username: 'owner', password, passwordConfirm: password });
  await assert.rejects(f.service.login('owner@example.test', password), { status: 401 });
  const verification = f.emails[0][1];
  const outcomes = await Promise.allSettled([f.service.verify(verification), f.service.verify(verification)]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  const { token } = await f.service.login('owner@example.test', password);
  const request = new Request('https://app.example.test', { headers: { cookie: `${ACCOUNT_COOKIE}=${token}` } });
  assert((await identity(f.store, request, f.clock())).account);
  await f.service.requestReset('owner@example.test');
  await f.service.verify(f.emails.at(-1)[1], 'Otra contraseña 456', 'Otra contraseña 456');
  assert.equal((await identity(f.store, request, f.clock())).account, null);
  await assert.rejects(f.service.login('owner@example.test', password), { status: 401 });
  assert((await f.service.login('owner@example.test', 'Otra contraseña 456')).token);
});

test('expired verification links cannot activate accounts', async () => {
  const f = fixture();
  await f.service.register({ email: 'owner@example.test', username: 'owner', password, passwordConfirm: password });
  f.advance(1801);
  await assert.rejects(f.service.verify(f.emails[0][1]), /caducado/);
});

test('rooms enforce owner isolation, guest read-only access and encrypted storage', async () => {
  const f = fixture(), first = await owner(f), second = await owner(f, 'second@example.test');
  await room(f, first);
  const visitor = await guest(f);
  const stored = await f.service.access('sala-casa', visitor);
  assert.equal(f.service.playlist(stored), playlist);
  assert.equal(JSON.stringify(stored).includes('https://media'), false);
  assert.equal(JSON.stringify(stored).includes(password), false);
  await assert.rejects(f.service.access('sala-casa', second), { status: 403 });
  await assert.rejects(f.service.upload('sala-casa', visitor, { filename: 'x.m3u', source: playlist, revision: 2 }), { status: 403 });
  await assert.rejects(f.service.update('sala-casa', visitor, { limit: 1, revision: 2 }), { status: 403 });
  await assert.rejects(f.service.remove('sala-casa', visitor, 2), { status: 403 });
  await assert.rejects(f.service.join('sala-casa', 'wrong'), { status: 401 });
  assert.throws(() => unseal(stored.playlist, 'playlist:another-room', env));
});

test('simultaneous room creation protects the unique slug and per-owner quota', async () => {
  const f = fixture(), who = await owner(f);
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => f.service.create(who.account, { slug: `sala-${i}`, title: 'Sala', password, relay: relayForSlug('sala-' + i) })));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 3);
  const account = await read(f.store, `account/${who.account.id}`);
  assert.equal(account.rooms.length, 3);
  const other = await owner(f, 'other@example.test');
  await assert.rejects(f.service.create(other.account, { slug: account.rooms[0], title: 'Otra', password, relay: relayForSlug(account.rooms[0]) }), { status: 409 });
});

test('invalid uploads preserve the previous list and stale updates cannot overwrite it', async () => {
  const f = fixture(), who = await owner(f); const current = await room(f, who);
  for (const input of [{ filename: 'file.txt', source: playlist }, { filename: 'file.m3u', source: '<html>bad</html>' }, { filename: 'file.m3u', source: '#EXTM3U\n' }]) {
    await assert.rejects(f.service.upload(current.slug, who, { ...input, revision: current.revision }));
  }
  const oversized = `#EXTM3U\n#EXTINF:-1,Canal\nhttp://media.example.test/live/1.m3u8\n${'#'.repeat(10 * 1024 * 1024)}`;
  await assert.rejects(f.service.upload(current.slug, who, { filename: 'file.m3u', source: oversized, revision: current.revision }), { message: 'La lista debe ocupar como máximo 10 MB.' });
  await assert.rejects(f.service.upload(current.slug, who, { filename: 'file.m3u', source: playlist, revision: 1 }), { status: 409 });
  assert.equal(f.service.playlist(await f.service.access(current.slug, who)), playlist);
  await assert.rejects(f.service.update(current.slug, who, { limit: 4, revision: current.revision }));
  await assert.rejects(f.service.update(current.slug, who, { limit: null, revision: current.revision }));
});

test('chunked uploads reassemble the playlist and incomplete uploads preserve the current list', async () => {
  const f = fixture(), who = await owner(f);
  const created = await f.service.create(who.account, { slug: 'sala-casa', title: 'Mi sala', password, relay: relayForSlug('sala-casa') });
  const split = Math.ceil(playlist.length / 2);
  const begin = await f.service.beginUpload(created.slug, who, {
    filename: 'canales.m3u',
    revision: created.revision,
    bytes: Buffer.byteLength(playlist),
    totalChunks: 2,
  });
  await f.service.uploadChunk(created.slug, who, { id: begin.id, index: 0, chunk: playlist.slice(0, split) });
  await f.service.uploadChunk(created.slug, who, { id: begin.id, index: 1, chunk: playlist.slice(split) });
  const uploaded = await f.service.commitUpload(created.slug, who, { id: begin.id });
  assert.equal(f.service.playlist(await f.service.access(created.slug, who)), playlist);
  assert.equal(await read(f.store, `upload/${created.slug}`), null);

  const replacement = playlist.replace('Canal uno', 'Canal cambiado');
  const incomplete = await f.service.beginUpload(created.slug, who, {
    filename: 'canales.m3u',
    revision: uploaded.revision,
    bytes: Buffer.byteLength(replacement),
    totalChunks: 2,
  });
  await f.service.uploadChunk(created.slug, who, { id: incomplete.id, index: 0, chunk: replacement.slice(0, split) });
  await assert.rejects(f.service.commitUpload(created.slug, who, { id: incomplete.id }), { status: 409 });
  assert.equal(f.service.playlist(await f.service.access(created.slug, who)), playlist);
  const oversized = await f.service.beginUpload(created.slug, who, {
    filename: 'canales.m3u', revision: uploaded.revision, bytes: 1, totalChunks: 1,
  });
  await assert.rejects(
    f.service.uploadChunk(created.slug, who, { id: oversized.id, index: 0, chunk: 'x'.repeat(UPLOAD_CHUNK_CHARS + 1) }),
    { status: 413 },
  );
});

test('one simultaneous viewer wins the last slot; expired leases release capacity', async () => {
  const f = fixture(), who = await owner(f); let current = await room(f, who);
  current = await f.service.update(current.slug, who, { limit: 1, revision: current.revision });
  const visitors = await Promise.all(Array.from({ length: 4 }, () => guest(f)));
  const attempts = await Promise.allSettled(visitors.map((visitor, i) => f.service.start(current.slug, visitor, { channelId: 1, tab: `browser-tab-${i}` })));
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal((await f.service.status(current.slug, who)).active, 1);
  f.advance(LEASE_SECONDS + 1);
  assert((await f.service.start(current.slug, visitors[1], { channelId: 1, tab: 'browser-tab-1' })).id);
});

test('only room owners can inspect viewers and their current channels', async () => {
  const f = fixture(), who = await owner(f); const current = await room(f, who), visitor = await guest(f);
  await f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-guest' });
  await assert.rejects(f.service.status(current.slug, visitor), { status: 403 });
  await assert.rejects(f.service.status(current.slug, { account: null, guest: null }), { status: 403 });
  const otherOwner = await owner(f, 'another@example.test');
  await assert.rejects(f.service.status(current.slug, otherOwner), { status: 403 });
  const ownerStatus = await f.service.status(current.slug, who);
  assert.equal(ownerStatus.active, 1);
  assert.deepEqual(ownerStatus.connections[0], {
    id: ownerStatus.connections[0].id,
    name: 'Invitado',
    channelId: 1,
    channelName: 'Canal uno',
    channelLogo: 'https://img.example.test/canal-uno.png',
    program: 'Noticias de prueba',
  });
  assert.equal(typeof ownerStatus.connections[0].id, 'string');
});

test('HTTP channels use the HTTPS relay and relay sessions follow playback leases', async () => {
  const f = fixture(), who = await owner(f);
  const relayCalls = [];
  f.service.testRelayClient = {
    configured: true,
    async start(channel, identity, tab) {
      relayCalls.push(['start', channel.url, identity, tab]);
      return {
        sessionId: 'relay-session',
        emissionId: 'relay-emission',
        url: 'https://relay.example.test/media/session/index.m3u8?token=test',
      };
    },
    async ping(sessionId, identity, playing) {
      relayCalls.push(['ping', sessionId, identity, playing]);
      return { kicked: false, status: playing ? 'running' : 'closed' };
    },
    async close(emissionId, closedBy) {
      relayCalls.push(['close', emissionId, closedBy]);
      return { ok: true };
    },
  };
  const created = await f.service.create(who.account, { slug: 'sala-http', title: 'HTTP', password, relay: relayForSlug('sala-http') });
  const httpPlaylist = playlist.replaceAll('https://media.example.test', 'http://media.example.test');
  const current = await f.service.upload(created.slug, who, { filename: 'http.m3u', source: httpPlaylist, revision: created.revision });
  const visitor = await guest(f, current.slug);
  const started = await f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-http' });
  assert.match(started.url, /^https:\/\/relay\.example\.test\//);
  const storedLease = (await read(f.store, `leases/room-${current.slug}`)).leases[0];
  assert.equal(storedLease.relaySessionId, 'relay-session');
  assert.equal(storedLease.relayEmissionId, 'relay-emission');

  const heartbeat = await f.service.playback(current.slug, visitor, { id: started.id }, 'ping');
  assert.equal(heartbeat.kicked, false);
  await f.service.playback(current.slug, visitor, { id: started.id }, 'release');
  assert(relayCalls.some((call) => call[0] === 'ping' && call[3] === true));
  assert(relayCalls.some((call) => call[0] === 'ping' && call[3] === false));

  const restarted = await f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-http' });
  await f.service.playback(current.slug, who, { id: restarted.id }, 'close');
  assert(relayCalls.some((call) => call[0] === 'close' && call[1] === 'relay-emission'));
});

test('HTTP channels fail clearly when no HTTPS relay is configured', async () => {
  const f = fixture(), who = await owner(f);
  const created = await f.service.create(who.account, { slug: 'sala-http', title: 'HTTP', password, relay: relayForSlug('sala-http') });
  const httpPlaylist = playlist.replaceAll('https://media.example.test', 'http://media.example.test');
  const current = await f.service.upload(created.slug, who, { filename: 'http.m3u', source: httpPlaylist, revision: created.revision });
  const visitor = await guest(f, current.slug);
  await f.store.setJSON('room/sala-http', { ...await read(f.store, 'room/sala-http'), relayCredentials: null, relayHost: null });
  await assert.rejects(
    f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-http' }),
    { status: 503, message: 'Esta sala no tiene relay configurado. Pide al propietario que lo configure en Ajustes.' },
  );
  assert.equal((await f.service.status(current.slug, who)).active, 0);
});

test('provider slots are shared by rooms using the same account', async () => {
  const f = fixture(1), who = await owner(f); await room(f, who); await room(f, who, 'otra-sala');
  const first = await guest(f), second = await guest(f, 'otra-sala');
  const lease = await f.service.start('sala-casa', first, { channelId: 1, tab: 'browser-tab-1' });
  await assert.rejects(f.service.start('otra-sala', second, { channelId: 1, tab: 'browser-tab-2' }), { status: 409 });
  assert.equal((await f.service.status('otra-sala', who)).active, 0);
  await f.service.playback('sala-casa', first, { id: lease.id }, 'release');
  assert((await f.service.start('otra-sala', second, { channelId: 1, tab: 'browser-tab-2' })).id);
});

test('changing room password revokes guests and releases their playback slots', async () => {
  const f = fixture(), who = await owner(f); const current = await room(f, who), visitor = await guest(f);
  await f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-1' });
  await f.service.update(current.slug, who, { password: 'La nueva contraseña', limit: 2, revision: current.revision });
  await assert.rejects(f.service.access(current.slug, visitor), { status: 403 });
  await assert.rejects(f.service.join(current.slug, password), { status: 401 });
  assert.equal((await f.service.status(current.slug, who)).active, 0);
});

test('unknown provider limits remain configurable; transient failures preserve known limits', async () => {
  const f = fixture(null), who = await owner(f); let current = await room(f, who);
  assert.equal(current.limit, null); assert.equal(current.detectedMaximum, null);
  current = await f.service.update(current.slug, who, { limit: 2, revision: current.revision });
  assert.equal(current.limit, 2);
  f.service.detect = async () => [{ id: f.provider, maximum: 3 }];
  current = await f.service.upload(current.slug, who, { filename: 'x.m3u', source: playlist, revision: current.revision });
  f.service.detect = async () => [{ id: f.provider, maximum: null }];
  current = await f.service.upload(current.slug, who, { filename: 'x.m3u', source: playlist, revision: current.revision });
  assert.equal(current.detectedMaximum, 3);
});

test('current programme lookup decodes EPG titles and reuses its short cache', async () => {
  let calls = 0;
  const source = 'https://epg.example.test/live/viewer/password/987.m3u8';
  const now = 200000;
  const fetcher = async (url) => {
    calls += 1;
    assert.equal(url.searchParams.get('action'), 'get_short_epg');
    assert.equal(url.searchParams.get('stream_id'), '987');
    return { epg_listings: [{ start_timestamp: now - 60, stop_timestamp: now + 60, title: Buffer.from('Noticias').toString('base64') }] };
  };
  assert.equal(await currentProgram(source, fetcher, () => now), 'Noticias');
  assert.equal(await currentProgram(source, fetcher, () => now + 1), 'Noticias');
  assert.equal(calls, 1);
});

test('provider detection rejects invalid maxima and private network addresses', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', '::ffff:127.0.0.1', 'fc00::1', '192.168.1.1']) assert.equal(publicAddress(address), false);
  assert.equal(publicAddress('1.1.1.1'), true);
  const channels = [{ url: 'https://media.example.test/live/user/password/1.ts' }];
  assert.equal((await detectProviders(channels, env, async () => ({ user_info: { max_connections: '3' } })))[0].maximum, 3);
  assert.equal((await detectProviders(channels, env, async () => ({ user_info: { max_connections: '0' } })))[0].maximum, null);
});

test('HTTP registration fails closed without CAPTCHA, blocks cross-origin and oversized bodies', async () => {
  const store = memoryBlobStore(); let sent = 0;
  const handler = createRoomsHandler({ getStore: () => store, env: { ...env, TURNSTILE_SECRET_KEY: '' }, sendMail: async () => { sent += 1; } });
  const body = { email: 'person@example.test', username: 'test', password, passwordConfirm: password };
  const post = (data, origin = 'https://app.example.test') => new Request('https://app.example.test/.netlify/functions/rooms?action=register', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await handler(post(body))).status, 503);
  assert.equal((await handler(post(body, 'https://evil.example'))).status, 403);
  assert.equal((await handler(post({ padding: 'x'.repeat(20000) }))).status, 413);
  assert.equal(sent, 0); assert.equal(await read(store, `account/${digest(body.email)}`), null);
});

test('CAPTCHA requires an authentic result for the correct hostname and action', async () => {
  const request = new Request('https://app.example.test');
  await checkCaptcha('token', request, 'account', env, async () => Response.json({ success: true, hostname: 'app.example.test', action: 'account' }));
  for (const result of [{ success: false }, { success: true, hostname: 'evil.test', action: 'account' }, { success: true, hostname: 'app.example.test', action: 'access' }]) {
    await assert.rejects(checkCaptcha('token', request, 'account', env, async () => Response.json(result)));
  }
});

test('leases remain releasable after a playlist changes provider', async () => {
  const f = fixture(1), who = await owner(f), current = await room(f, who), visitor = await guest(f);
  const started = await f.service.start(current.slug, visitor, { channelId: 1, tab: 'browser-tab-1' });
  await f.service.upload(current.slug, who, { filename: 'new.m3u', source: playlist.replaceAll('media.example.test', 'other.example.test'), revision: current.revision });
  await f.service.playback(current.slug, visitor, { id: started.id }, 'release');
  assert.equal((await read(f.store, `leases/${f.provider}`)).leases.length, 0);
});

test('an unknown maximum in a second room cannot bypass a known provider cap', async () => {
  const f = fixture(1), who = await owner(f); await room(f, who);
  f.service.detect = async () => [{ id: f.provider, maximum: null }];
  const other = await room(f, who, 'otra-sala');
  assert.equal(other.detectedMaximum, 1);
  const first = await guest(f), second = await guest(f, 'otra-sala');
  await f.service.start('sala-casa', first, { channelId: 1, tab: 'browser-tab-1' });
  await assert.rejects(f.service.start('otra-sala', second, { channelId: 1, tab: 'browser-tab-2' }), { status: 409 });
});

test('an interrupted owner index update is recovered without hiding the room', async () => {
  const f = fixture(), who = await owner(f); await room(f, who);
  const saved = await read(f.store, 'room/sala-casa');
  const account = await read(f.store, `account/${who.account.id}`);
  await f.store.setJSON(`account/${account.id}`, { ...account, rooms: [], pendingRooms: [{ operation: saved.creationOperation, slug: saved.slug, expires: 0 }] });
  const recovered = await f.service.mine(await read(f.store, `account/${account.id}`));
  assert.equal(recovered.length, 1); assert.equal(recovered[0].slug, saved.slug);
});

test('registration validates username and confirmation on the server', async () => {
  const f = fixture();
  for (const data of [
    { username: 'owner', passwordConfirm: 'different password' },
    { username: 'owner', passwordConfirm: undefined },
    { username: 'My Real Name', passwordConfirm: password },
    { username: 'x', passwordConfirm: password },
  ]) {
    await assert.rejects(f.service.register({ email: 'owner@example.test', password, ...data }), { status: 400 });
  }
  assert.equal(f.emails.length, 0);
  assert.equal(await read(f.store, `account/${digest('owner@example.test')}`), null);
});

test('usernames are unique regardless of case and can be used to sign in', async () => {
  const f = fixture();
  await owner(f);
  await assert.rejects(f.service.register({ email: 'other@example.test', username: 'OWNER', password, passwordConfirm: password }), { status: 409 });
  const signedIn = await f.service.login('OWNER', password);
  assert.equal(signedIn.account.username, 'owner');
  await assert.rejects(f.service.login('OWNER', 'wrong'), { status: 401 });
});
