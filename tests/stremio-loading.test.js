import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sourcesLoadingMarkup } from '../src/stremio-loading.js';

const read = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');

test('stream discovery provides a real accessible loading layout with source placeholders', () => {
  const html = sourcesLoadingMarkup(3);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Consultando 3 orígenes/);
  assert.equal((html.match(/class="sa-source-skeleton"/g) || []).length, 3);
  assert.match(sourcesLoadingMarkup(1), /Consultando 1 origen/);
  assert(!sourcesLoadingMarkup(100000).includes('100000'));
});

test('loading state has responsive skeletons and reduced-motion support', () => {
  const css = read('stremio.css');
  assert.match(css, /\.sa-sources-loading-items/);
  assert.match(css, /\.sa-source-skeleton/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const js = read('stremio-ui.js');
  assert.match(js, /sourcesLoadingMarkup\(providers\)/);
  assert.match(js, /setAttribute\('aria-busy', 'true'\)/);
  assert.match(js, /setAttribute\('aria-busy', 'false'\)/);
  assert.match(js, /fuentes encontradas/);
});

test('VOD playback uses HLS.js before native HLS on MediaSource-supported browsers', () => {
  const source = read('main.js');
  const start = source.indexOf('const { default: Hls } = await import(\'hls.js\');',
    source.indexOf('async function playVod'));
  const end = source.indexOf('const instance = new Hls', start);
  assert(start > 0 && end > start);
  const branch = source.slice(start, end);
  assert.match(branch, /if \(!Hls\.isSupported\(\)\)/);
  assert.match(branch, /video\.src = ready\.url/);
  assert.match(source, /hlsActive: Boolean\(hls\)/);
});
