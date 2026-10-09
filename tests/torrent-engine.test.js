import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installUint8EncodingCompat } from '../src/uint8-compat.js';
import { loadTorrentEngine } from '../src/torrent-playback.js';

test('legacy browsers have reliable Uint8Array Base64 and Hex methods for WebTorrent 3', () => {
  installUint8EncodingCompat();
  assert.equal(new Uint8Array([0, 255, 14]).toBase64(), 'AP8O');
  assert.equal(new Uint8Array([0, 127, 255]).toHex(), '007fff');
  assert.deepEqual(Array.from(Uint8Array.fromHex('001fFF')), [0, 31, 255]);
  assert.throws(() => Uint8Array.fromHex('abc'), SyntaxError);
  assert.throws(() => Uint8Array.fromHex('xx'), SyntaxError);
  assert.deepEqual(Array.from(Uint8Array.fromHex('')), []);
});

test('WebTorrent is imported as an ES module with default export, never from window', async () => {
  const source = readFileSync(new URL('../src/torrent-playback.js', import.meta.url), 'utf8');
  const bundle = readFileSync(new URL('../public/webtorrent.min.js', import.meta.url), 'utf8');
  assert.match(bundle.slice(-160), /export\{[^}]*as default\}/);
  assert.match(source, /import\(\/\* @vite-ignore \*\/ moduleUrl\)/);
  assert(!source.includes('window.WebTorrent'));
  let attempts = 0;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(loadTorrentEngine(async () => { attempts++; throw Error('network outage'); }),
      /No se pudo cargar WebTorrent/);
  } finally {
    console.warn = originalWarn;
  }
  class WebTorrentStub {}
  const ctor = await loadTorrentEngine(async () => { attempts++; return { default: WebTorrentStub }; });
  assert.equal(ctor, WebTorrentStub);
  assert.equal(await loadTorrentEngine(async () => { attempts++; throw Error('should not import twice'); }),
    WebTorrentStub);
  assert.equal(attempts, 2);
});
