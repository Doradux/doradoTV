import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('media switch stays at top inside right sidebar and displays a distinct selected state', () => {
  const html = source('src/main.js');
  const css = source('src/stremio.css');
  const sidebar = html.indexOf('<aside class="channel-panel"');
  const switchAt = html.indexOf('<nav class="media-tabs"');
  const filters = html.indexOf('<div class="channel-filters">');
  assert(sidebar !== -1 && sidebar < switchAt && switchAt < filters);
  const controls = html.slice(switchAt, html.indexOf('</nav>', switchAt));
  assert(controls.includes('id="media-channels"'));
  assert(controls.includes('id="media-cinema"'));
  assert(controls.includes('aria-pressed="true"'));
  assert(controls.includes('aria-pressed="false"'));
  assert(css.includes('.media-tab[aria-pressed="true"]'));
  assert(css.includes('.media-tab[aria-pressed="false"]:hover'));
  assert(css.includes('white-space: nowrap'));
  assert(css.includes('min-width: max-content'));
  assert(css.includes('flex-wrap: wrap'));
});

test('cinema search has one field and requests both movies and series', () => {
  const cinema = source('src/stremio-ui.js');
  const backend = source('netlify/functions/addons.js');
  assert.equal(cinema.match(/id="sa-search-input"/g)?.length, 1);
  assert(!cinema.includes('data-kind='));
  assert(cinema.includes("type: 'all', search: query"));
  assert(backend.includes("catalog.type === type"));
  assert(backend.includes("'all'"));
});

