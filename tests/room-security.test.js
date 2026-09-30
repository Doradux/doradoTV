import assert from 'node:assert/strict';
import test from 'node:test';
import { cookie, hashPassword, requireOrigin, verifyPassword } from '../netlify/lib/room-security.js';

test('passwords are salted, verifiable, and not stored in clear text', async () => {
  const first = await hashPassword('test password');
  const second = await hashPassword('test password');
  assert.notEqual(first, second);
  assert.equal(first.includes('test password'), false);
  assert.equal(await verifyPassword('test password', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('test password', 'invalid'), false);
});

test('account cookies are inaccessible to JavaScript and mutations require same origin', () => {
  const request = new Request('https://tv.example.test/.netlify/functions/rooms', {
    method: 'POST',
    headers: { Origin: 'https://tv.example.test' },
  });
  requireOrigin(request);
  assert.match(cookie('dorado_account', 'a'.repeat(64), request), /HttpOnly; SameSite=Strict.*Secure/);
  assert.throws(() => requireOrigin(new Request(request.url, {
    method: 'POST',
    headers: { Origin: 'https://other.example.test' },
  })));
});
