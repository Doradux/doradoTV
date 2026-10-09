import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomsService } from '../netlify/lib/rooms-service.js';
import { hashPassword } from '../netlify/lib/room-security.js';
import { memoryBlobStore } from './helpers/blob-store.js';

test('only signed-in visitors get persistent room history; access is never promoted', async () => {
  const store = memoryBlobStore(), time = 222000;
  const service = new RoomsService(store, { clock: () => time });
  const credential = 'correct-room-password';
  await store.setJSON('room/friends-hall', {
    slug: 'friends-hall', title: 'Sala de amigos', ownerId: 'owner-1',
    passwordHash: await hashPassword(credential), version: 1, revision: 1,
  });
  await store.setJSON('account/visitor', { id: 'visitor', username: 'Invitado registrado', verified: true, rooms: [] });
  const account = await store.get('account/visitor', { type: 'json' });
  await assert.rejects(service.join('friends-hall', 'incorrect', account), { status: 401 });
  assert.deepEqual((await service.visited(account)), []);
  await service.join('friends-hall', credential);
  assert.deepEqual((await service.visited(account)), []);
  await service.join('friends-hall', credential, account);
  const next = await store.get('account/visitor', { type: 'json' });
  assert.deepEqual(next.rooms, []);
  assert.deepEqual((await service.visited(next)).map((r) => r.slug), ['friends-hall']);
  assert.equal((await service.visited(next))[0].visitedAt, time);
  await assert.rejects(service.access('friends-hall', { account: next, guest: null }), { status: 403 });
  await assert.rejects(service.update('friends-hall', { account: next, guest: null }, { revision: 1 }), { status: 403 });
  await service.join('friends-hall', credential, next);
  assert.equal((await service.visited(await store.get('account/visitor', { type: 'json' }))).length, 1);
  await service.forgetVisited(next, 'friends-hall');
  assert.deepEqual(await service.visited(await store.get('account/visitor', { type: 'json' })), []);
  await assert.rejects(service.forgetVisited(null, 'friends-hall'), { status: 401 });
});

test('room history skips deleted rooms and never exposes playlist/credentials', async () => {
  const store = memoryBlobStore(), service = new RoomsService(store);
  const account = { id: 'test', verified: true, rooms: [], visitedRooms: [
    { slug: 'valid-room', visitedAt: 1234 }, { slug: 'deleted-room', visitedAt: 1233 },
  ] };
  await store.setJSON('room/valid-room', { slug: 'valid-room', title: 'Sala accesible', ownerId: 'other',
    passwordHash: 'secret', playlist: 'encrypted', deleted: false });
  await store.setJSON('room/deleted-room', { slug: 'deleted-room', title: 'Borrada', ownerId: 'other', deleted: true });
  assert.deepEqual(await service.visited(account), [{ slug: 'valid-room', title: 'Sala accesible', visitedAt: 1234 }]);
});

