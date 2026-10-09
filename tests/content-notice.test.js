import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomsHandler } from '../netlify/functions/rooms.js';
import { memoryBlobStore } from './helpers/blob-store.js';

test('public notice reporting requires configured mailbox and validates submissions', async () => {
  const env = {
    DORADO_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
    DORADO_REPORT_EMAIL: 'moderation@example.test',
    SMTP_USER: 'smtp@example.test', SMTP_PASSWORD: 'test-key',
  };
  const notices = [], store = memoryBlobStore();
  const handler = createRoomsHandler({ env, getStore: () => store, clock: () => 12000,
    sendNotice: async (input) => { notices.push(input); },
  });
  const post = async (payload, origin = 'https://app.test') => {
    const response = await handler(new Request('https://app.test/.netlify/functions/rooms?action=report', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(payload),
    }), { ip: '203.0.113.10' });
    return { status: response.status, data: await response.json() };
  };
  const request = { category: 'copyright', room: 'my-room', resource: 'Un canal',
    email: 'reporter@example.test', details: 'Considero que esta emisión carece de derechos.' };
  assert.equal((await post(request, 'https://evil.test')).status, 403);
  assert.equal((await post({ ...request, details: 'corto' })).status, 400);
  assert.equal((await post(request)).status, 200);
  assert.deepEqual(notices, [request]);
  const cfg = await handler(new Request('https://app.test/.netlify/functions/rooms?action=config'));
  assert.equal((await cfg.json()).noticeReporting, true);
  const disabled = createRoomsHandler({ env: { DORADO_ENCRYPTION_KEY: env.DORADO_ENCRYPTION_KEY }, getStore: () => memoryBlobStore(),
    sendNotice: async () => { throw Error('should not send'); },
  });
  const missing = await disabled(new Request('https://app.test/.netlify/functions/rooms?action=report', {
    method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(request),
  }));
  assert.equal(missing.status, 503);
});

