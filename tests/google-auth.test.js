import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createRoomsHandler } from '../netlify/functions/rooms.js';
import { verifyGoogleCredential, GOOGLE_COOKIE } from '../netlify/lib/room-google.js';
import { RoomsService } from '../netlify/lib/rooms-service.js';
import { ACCOUNT_COOKIE, digest, identity } from '../netlify/lib/room-security.js';
import { read } from '../netlify/lib/room-store.js';
import { memoryBlobStore } from './helpers/blob-store.js';

const env = { DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com' };
const origin = 'https://app.example.test';
const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256' };
const keys = createLocalJWKSet({ keys: [jwk] });
const now = Math.floor(Date.now() / 1000);
const claims = { sub: 'subject-1', email: 'owner@gmail.com', email_verified: true, iss: 'https://accounts.google.com', aud: env.GOOGLE_CLIENT_ID, iat: now, exp: now + 300 };
const sign = (nonce, overrides = {}, key = pair.privateKey) => new SignJWT({ ...claims, nonce, ...overrides }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
function fixture() {
  const store = memoryBlobStore(); let time = now;
  const clock = () => time;
  const handler = createRoomsHandler({ getStore: () => store, env, clock, googleVerify: (credential, nonce, config) => verifyGoogleCredential(credential, nonce, config, keys, time) });
  const post = (action, data = {}, cookies = '', from = origin) => handler(new Request(`${origin}/.netlify/functions/rooms?action=${action}`, { method: 'POST', headers: { origin: from, cookie: cookies, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), { ip: '127.0.0.1' });
  return { store, post, handler, clock, advance: (seconds) => { time += seconds; }, service: new RoomsService(store, { env, clock }) };
}
async function challenge(f) {
  const response = await f.post('google-start');
  assert.equal(response.status, 200);
  return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function login(f, overrides = {}) {
  const start = await challenge(f);
  const response = await f.post('google-login', { credential: await sign(start.nonce, overrides) }, start.cookie);
  assert.equal(response.status, 200);
  const accountCookie = response.headers.getSetCookie().find((value) => value.startsWith(`${ACCOUNT_COOKIE}=`));
  assert.match(accountCookie, /HttpOnly; SameSite=Strict/); assert.match(accountCookie, /Secure/);
  const cookie = accountCookie.split(';')[0];
  return { ...await response.json(), cookie, request: new Request(origin, { headers: { cookie } }) };
}

test('Google credentials require a valid signature, audience, issuer, age, verified email and browser nonce', async () => {
  const nonce = 'test-browser-nonce';
  assert.deepEqual(await verifyGoogleCredential(await sign(nonce), digest(nonce), env, keys, now), { sub: claims.sub, email: claims.email });
  const bad = [
    { aud: 'another-client' }, { iss: 'https://evil.test' }, { exp: now - 60 }, { iat: now + 60 },
    { iat: now - 4000 }, { sub: '' }, { sub: undefined }, { email_verified: false },
    { email: 'invalid' }, { email: undefined }, { nonce: 'another-browser' }, { nonce: undefined }, { azp: 'another-client' },
  ];
  for (const value of bad) await assert.rejects(verifyGoogleCredential(await sign(nonce, value), digest(nonce), env, keys, now), { status: 401 });
  const other = await generateKeyPair('RS256');
  await assert.rejects(verifyGoogleCredential(await sign(nonce, {}, other.privateKey), digest(nonce), env, keys, now), { status: 401 });
  await assert.rejects(verifyGoogleCredential('not-a-token', digest(nonce), env, keys, now), { status: 401 });
});

test('Google sign-in works without SMTP/CAPTCHA and requires a username before creating rooms', async () => {
  const f = fixture();
  const config = await (await f.handler(new Request(`${origin}/?action=config`))).json();
  assert.equal(config.registration, false); assert.equal(config.googleClientId, env.GOOGLE_CLIENT_ID);
  const user = await login(f);
  assert.equal(user.account.needsUsername, true);
  assert.equal((await f.post('create', { slug: 'my-room', title: 'Room', password: 'Very private password' }, user.cookie)).status, 403);
  assert.equal((await f.post('username', { username: 'my username' }, user.cookie)).status, 400);
  assert.equal((await f.post('username', { username: 'marcos' })).status, 401);
  const profile = await f.post('username', { username: 'marcos' }, user.cookie);
  assert.equal(profile.status, 200); assert.equal((await profile.json()).account.needsUsername, false);
  const account = (await identity(f.store, user.request, f.clock())).account;
  assert.equal(account.username, 'marcos'); assert.equal(account.passwordHash, undefined);
  assert.equal((await f.post('create', { slug: 'my-room', title: 'Room', password: 'Very private password' }, user.cookie)).status, 201);
  assert.equal((await f.post('logout', {}, user.cookie)).status, 200);
  assert.equal((await identity(f.store, user.request, f.clock())).account, null);
});

test('Google challenges block login CSRF, missing cookies, replay and concurrent reuse', async () => {
  const f = fixture();
  assert.equal((await f.post('google-start', {}, '', 'https://evil.test')).status, 403);
  const start = await challenge(f), credential = await sign(start.nonce);
  assert.match(start.cookie, new RegExp(`^${GOOGLE_COOKIE}=`));
  assert.equal((await f.post('google-login', { credential })).status, 401);
  assert.equal((await f.post('google-login', { credential }, start.cookie, 'https://evil.test')).status, 403);
  const other = await challenge(f);
  assert.equal((await f.post('google-login', { credential }, other.cookie)).status, 401);
  const responses = await Promise.all([f.post('google-login', { credential }, start.cookie), f.post('google-login', { credential }, start.cookie)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 401]);
  assert.equal((await f.post('google-login', { credential }, start.cookie)).status, 401);
});

test('expired challenges and unconfigured Google access fail closed', async () => {
  const f = fixture(), start = await challenge(f);
  f.advance(601);
  assert.equal((await f.post('google-login', { credential: await sign(start.nonce) }, start.cookie)).status, 401);
  const handler = createRoomsHandler({ env: { ...env, GOOGLE_CLIENT_ID: '' }, getStore: () => f.store });
  assert.equal((await handler(new Request(`${origin}/?action=google-start`, { method: 'POST', headers: { origin }, body: '{}' }))).status, 503);
});

test('Google accounts use subject IDs, preserve rooms on email changes and never merge by email', async () => {
  const f = fixture(), first = await login(f);
  await f.post('username', { username: 'first' }, first.cookie);
  await f.post('create', { slug: 'first-room', title: 'Room', password: 'Very private password' }, first.cookie);
  const changed = await login(f, { email: 'changed@gmail.com' });
  assert.equal(changed.account.id, first.account.id); assert.equal(changed.account.username, 'first');
  assert.equal((await f.service.mine((await identity(f.store, changed.request, f.clock())).account)).length, 1);
  const other = await login(f, { sub: 'different-subject', email: 'changed@gmail.com' });
  assert.notEqual(other.account.id, first.account.id);
  await assert.rejects(f.service.access('first-room', await identity(f.store, other.request, f.clock())), { status: 403 });
  const localId = digest('owner@gmail.com');
  await f.store.setJSON(`account/${localId}`, { id: localId, email: 'owner@gmail.com', passwordHash: 'existing-hash', verified: true, rooms: ['old-room'] });
  await login(f);
  assert.equal((await read(f.store, `account/${localId}`)).passwordHash, 'existing-hash');
});

test('concurrent Google profile completion preserves unique usernames and one name per account', async () => {
  const f = fixture(), first = await login(f), second = await login(f, { sub: 'subject-2' });
  const responses = await Promise.all([f.post('username', { username: 'SameName' }, first.cookie), f.post('username', { username: 'samename' }, second.cookie)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const third = await login(f, { sub: 'subject-3' });
  await Promise.all([f.post('username', { username: 'alpha' }, third.cookie), f.post('username', { username: 'bravo' }, third.cookie)]);
  const account = (await identity(f.store, third.request, f.clock())).account;
  assert(['alpha', 'bravo'].includes(account.username));
  const otherName = account.username === 'alpha' ? 'bravo' : 'alpha';
  assert.equal(await read(f.store, `username/${otherName}`), null);
  assert.equal((await read(f.store, `username/${account.username}`)).accountId, account.id);
});

test('profile completion recovers after a reserved username survives an interrupted account write', async () => {
  const f = fixture(), first = await login(f);
  const account = (await identity(f.store, first.request, f.clock())).account;
  const set = f.store.setJSON; let fail = true;
  f.store.setJSON = async (key, value, options) => {
    if (fail && key === `account/${account.id}` && value.username === 'recovered') { fail = false; throw new Error('Interrupted write'); }
    return set(key, value, options);
  };
  await assert.rejects(f.service.completeGoogleProfile(account, 'recovered'), /Interrupted/);
  assert.equal((await f.service.completeGoogleProfile(account, 'recovered')).username, 'recovered');
});

test('Google sign-in endpoints have persistent rate limits', async () => {
  const f = fixture();
  for (let i = 0; i < 40; i++) assert.equal((await f.post('google-login', { credential: 'fake' })).status, 401);
  assert.equal((await f.post('google-login', { credential: 'fake' })).status, 429);
  assert.equal([...f.store.values.keys()].filter((key) => key.startsWith('account/')).length, 0);
});

test('Google access token verification validates tokeninfo payload', async () => {
  const { verifyGoogleAccessToken } = await import('../netlify/lib/room-google.js');
  const mockFetch = async () => Response.json({
    aud: env.GOOGLE_CLIENT_ID,
    sub: 'google-sub-123',
    email: 'TEST@GMAIL.COM',
    email_verified: 'true',
  });
  const res = await verifyGoogleAccessToken('valid_token', env, mockFetch);
  assert.deepEqual(res, { sub: 'google-sub-123', email: 'test@gmail.com' });

  // Rejects invalid audience
  const badAud = async () => Response.json({ aud: 'wrong-client', sub: '123', email: 'a@b.com', email_verified: 'true' });
  await assert.rejects(verifyGoogleAccessToken('bad_token', env, badAud), /No se pudo validar tu acceso/);

  // Rejects unverified email
  const unverified = async () => Response.json({ aud: env.GOOGLE_CLIENT_ID, sub: '123', email: 'a@b.com', email_verified: 'false' });
  await assert.rejects(verifyGoogleAccessToken('bad_token', env, unverified), /No se pudo validar tu acceso/);
});
