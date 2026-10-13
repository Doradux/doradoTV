import test from 'node:test';
import assert from 'node:assert/strict';
import { vodHlsErrorMessage, vodMediaErrorMessage } from '../src/vod-playback-errors.js';

test('VOD errors show the upstream HTTP failure rather than a misleading audio hint', () => {
  const failure = vodHlsErrorMessage({
    type: 'networkError', details: 'fragLoadError', response: { code: 503 },
    frag: { sn: 4, url: 'https://relay.example.com/movie.ts?token=PRIVATE' },
  });
  assert.match(failure, /relay.*segmento/i);
  assert.doesNotMatch(failure, /token=|Audio compatible|PRIVATE/);
  assert.equal(vodMediaErrorMessage({ code: 4 }, { kind: 'torrent', hlsError: failure }), failure);
  assert.match(vodHlsErrorMessage({ type: 'networkError', response: { code: 429 } }), /limitado/i);
  assert.match(vodHlsErrorMessage({ type: 'networkError', response: { code: 410 } }), /caducado/i);
});

test('VOD decoding errors suggest a different video source, not audio conversion', () => {
  const decoding = vodHlsErrorMessage({ type: 'mediaError', details: 'bufferAppendError' });
  assert.match(decoding, /decodificar/);
  assert.doesNotMatch(decoding, /Audio compatible/);
  assert.match(vodMediaErrorMessage({ code: 3 }, { kind: 'torrent' }), /formato/);
  assert.match(vodMediaErrorMessage({ code: 2 }, { kind: 'torrent' }), /descarga/);
  assert.match(vodMediaErrorMessage(null, { kind: 'torrent' }), /torrent/);
  assert.doesNotMatch(vodMediaErrorMessage(null, { kind: 'torrent' }), /Audio compatible/);
  assert.match(vodMediaErrorMessage(null, { kind: 'https' }), /Audio compatible/);
});
