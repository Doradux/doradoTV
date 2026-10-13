import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/stremio.css', import.meta.url), 'utf8');
const declaration = selector => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(escaped + '\\s*\\{([^}]*)\\}'));
  assert(match, 'Missing skeleton selector: ' + selector);
  return match[1];
};

test('every animated skeleton uses a single, seamlessly repeated two-width gradient tile', () => {
  for (const selector of ['.sa-skeleton-line', '.sa-search-poster-shimmer', '.sa-detail-loading-poster']) {
    const styles = declaration(selector);
    assert.match(styles, /background-size:\s*200%\s+100%\s*;/);
    assert.match(styles, /background-repeat:\s*repeat-x\s*;/);
    assert.match(styles, /animation:\s*sa-skeleton-shimmer\s+1\.9s\s+linear\s+infinite\s*;/);
    assert.match(styles, /linear-gradient\(90deg\s*,/);
    assert.doesNotMatch(styles, /ease-in-out|240%|220%/);
  }
});

test('the animation starts and finishes on the same exact phase of the repeated gradient', () => {
  const keyframes = css.match(/@keyframes sa-skeleton-shimmer\s*\{([\s\S]*?)\n\}/)?.[1];
  assert(keyframes, 'Missing complete animation keyframes');
  assert.match(keyframes, /from\s*\{\s*background-position-x:\s*200%;\s*\}/);
  assert.match(keyframes, /to\s*\{\s*background-position-x:\s*0%;\s*\}/);
  // CSS percentage positioning: offset = (elementWidth - tileWidth) * fraction.
  const elementWidth = 187, tileWidth = 2 * elementWidth;
  const offset = percent => (elementWidth - tileWidth) * percent / 100;
  const modulo = value => ((value % tileWidth) + tileWidth) % tileWidth;
  assert.equal(modulo(offset(200)), modulo(offset(0)),
    'A full tile shift produces the same pixels at both loop boundaries');
});

test('loading placeholders retain reduced-motion support and do not pause while staggering', () => {
  assert.match(declaration('.sa-skeleton-line'), /animation-delay:\s*calc\(var\(--skeleton-index\)\s*\*\s*-\.14s\)/);
  assert.match(declaration('.sa-search-poster-shimmer'), /animation-delay:\s*calc\(var\(--skeleton-index\)\s*\*\s*-\.09s\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.sa-skeleton-line\s*\{\s*animation:\s*none\s*!important/);
});
