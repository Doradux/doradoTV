import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('relay Docker image rebuilds the native WebTorrent binding and verifies it loads', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile.relay', import.meta.url), 'utf8');
  assert.match(dockerfile, /npm ci --omit=dev --ignore-scripts/);
  assert.match(dockerfile, /npm rebuild node-datachannel --foreground-scripts/);
  assert.match(dockerfile, /import\('webtorrent'\)/);
  assert.match(dockerfile, /new WebTorrent\(/);
  assert.match(dockerfile, /Native torrent module OK/);
});

test('relay health exposes a native-binding installation diagnostic', () => {
  const server = readFileSync(new URL('../relay/server.js', import.meta.url), 'utf8');
  assert.match(server, /nativeInstalled: existsSync\(new URL\(/);
  assert.match(server, /node-datachannel\/build\/Release\/node_datachannel\.node/);
});
