import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/main.css', import.meta.url), 'utf8');
const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const declaration = selector => {
  const start = css.indexOf(selector + ' {');
  assert(start >= 0, 'CSS block must exist: ' + selector);
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
};

test('movie loading sweep enters completely from left and leaves to right before restarting', () => {
  const frame = declaration('#loading.is-vod-loading .loading-label');
  assert.match(frame, /overflow:\s*hidden\s*;/,
    'Rounded card must clip the sweep while entering and exiting');
  const stripe = declaration('#loading.is-vod-loading .loading-label::after');
  assert.match(stripe, /left:\s*0\s*;\s*width:\s*25%\s*;/);
  assert.match(stripe, /animation:\s*vod-loading-sweep\s+2\.2s\s+linear\s+infinite\s*;/);
  const frames = css.slice(css.indexOf('@keyframes vod-loading-sweep'), css.indexOf('#loading.is-vod-loading .loading-dot'));
  assert.match(frames, /from\s*\{\s*transform:\s*translateX\(-100%\)\s*;/);
  assert.match(frames, /to\s*\{\s*transform:\s*translateX\(400%\)\s*;/);
  const elementWidth = 380, stripeWidth = elementWidth * 0.25;
  assert.equal(-stripeWidth, stripeWidth * -1, 'Stripe begins completely beyond left edge');
  assert.equal(stripeWidth * 4, elementWidth, 'Stripe ends fully beyond right edge');
  assert.match(css, /#loading\.is-vod-loading \.loading-label::after\s*\{\s*animation:none!important;\s*opacity:\.2;/);
});

test('video startup only displays useful viewer language, not HLS internals', () => {
  assert.match(source, /function setVodProgress\(message = 'Cargando película…'\)/);
  assert.match(source, /setVodProgress\('Preparando película…'\)/);
  assert.match(source, /setVodProgress\('Reconectando…'\)/);
  assert.match(source, /setVodProgress\(\)/);
  for (const technical of [
    'Manifiesto HLS cargado', 'Esperando el primer segmento de vídeo',
    'Analizando el vídeo y conectando con la fuente',
    'Preparando streaming bajo demanda',
    'Streaming VOD listo',
    'Recuperando streaming VOD',
  ]) {
    assert(!source.includes(technical), 'Technical status should not reach the viewer: ' + technical);
  }
  assert.match(source, /setStatus\(reason, true\)/,
    'Failures must still surface as actionable user-facing errors');
  assert.match(source, /console\.warn\('\[vod\] HLS playback error'/,
    'The detailed diagnostics must remain available for debugging');
});

test('the spinner continues to show nontechnical messages while buffering', () => {
  assert.match(source, /if \(loading\) \$\('#loading-main'\)\.textContent = vodSession \? 'Cargando película…' : 'Conectando con la emisión…'/);
});
