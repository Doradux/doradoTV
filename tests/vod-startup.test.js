import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('torrent VOD waits for the first buffered HLS fragment, not just the manifest', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('const instance = new Hls({ maxBufferLength: 24');
  const end = source.indexOf('} else if (source.url)', start);
  assert(start >= 0 && end > start, 'Expected the VOD HLS startup branch');
  const vod = source.slice(start, end);
  const frag = vod.match(/instance\.on\(Hls\.Events\.FRAG_BUFFERED[\s\S]*?instance\.on\(Hls\.Events\.ERROR/);
  assert(frag, 'VOD subscribes to fragment buffering');
  assert.match(frag[0], /resolve\(\)/, 'The initial playback gate resolves after a fragment is buffered');
  const parsed = vod.match(/instance\.once\(Hls\.Events\.MANIFEST_PARSED[\s\S]*?instance\.attachMedia/);
  assert(parsed, 'VOD subscribes to the HLS manifest event');
  assert.doesNotMatch(parsed[0], /resolve\(\)/, 'The manifest alone cannot mark VOD as playable');
  assert.match(vod, /No llegó el primer segmento reproducible/, 'A stalled source explains the missing data');
  assert.match(vod, /vodHlsStartupCancel = \(\) => failStartup/, 'Closing the player aborts startup');
});
