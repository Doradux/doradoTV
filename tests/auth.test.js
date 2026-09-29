import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createUser,
  deleteUser,
  expiredCookie,
  hashPassword,
  sessionCookie,
  updateUser,
  validUsername,
  verifyPassword,
  verifyRequestOrigin,
} from '../netlify/lib/auth.js';

test('passwords are salted, verifiable, and not stored in clear text', async () => {
  const first = await hashPassword('test password');
  const second = await hashPassword('test password');
  assert.notEqual(first, second);
  assert.equal(first.includes('test password'), false);
  assert.equal(await verifyPassword('test password', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('test password', 'invalid'), false);
});

test('usernames are simple account names, not addresses', () => {
  assert.equal(validUsername('marcos'), true);
  assert.equal(validUsername('marcos@example.com'), false);
  assert.equal(validUsername('a'), false);
});

test('session cookies are inaccessible to JavaScript and mutations require same origin', () => {
  const request = new Request('https://tv.example.test/.netlify/functions/auth', { method: 'POST', headers: { Origin: 'https://tv.example.test' } });
  verifyRequestOrigin(request);
  assert.match(sessionCookie('token', request), /HttpOnly; SameSite=Strict.*Secure/);
  assert.match(expiredCookie(request), /Max-Age=0/);
  assert.throws(() => verifyRequestOrigin(new Request(request.url, { method: 'POST', headers: { Origin: 'https://other.example.test' } })));
});

test('user management validates usernames and passwords', async () => {
  const invalidUser = await createUser('a', '1234');
  assert.equal(invalidUser.status, 400);

  const shortPass = await createUser('validuser', '12');
  assert.equal(shortPass.status, 400);

  const selfDelete = await deleteUser('marcos', 'marcos');
  assert.equal(selfDelete.status, 400);

  const emptyUpdate = await updateUser('', '1234');
  assert.equal(emptyUpdate.status, 400);
});

