import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFilmQuery, filmScore, rankFilmResults } from '../src/cinema-search.js';
import { searchLoadingMarkup, detailLoadingMarkup } from '../src/stremio-loading.js';
import { readFileSync } from 'node:fs';

test('film search normalizes Spanish accents and ranks exact title before partial matches', () => {
  assert.equal(normalizeFilmQuery('  La Película: Fantástica! '), 'la pelicula fantastica');
  const results = rankFilmResults([
    { id: 'tt03', name: 'La película fantástica 2', type: 'movie' },
    { id: 'tt01', name: 'Película fantástica', type: 'movie', poster: 'https://example.org/poster' },
    { id: 'tt04', name: 'Gran película', type: 'movie' },
    { id: 'tt02', name: 'La película fantástica', type: 'movie' },
  ], 'la pelicula fantastica');
  assert.equal(results[0].id, 'tt02');
  assert.equal(results[1].id, 'tt03');
  assert(results.every(m => m.type === 'movie'));
  assert(filmScore(results[0], 'la película fantástica') > filmScore(results[1], 'la pelicula fantastica'));
});

test('film search deduplicates provider results and keeps the entry with a poster', () => {
  const rows = rankFilmResults([
    { id: 'tt42', type: 'movie', name: 'El corral', addonId: 'catalog1' },
    { id: 'TT42', type: 'movie', name: 'El corral', addonId: 'catalog2', poster: 'https://example.org/image.jpg' },
    { id: 'tt42', type: 'series', name: 'El corral', addonId: 'catalog3' },
    { id: '', type: 'movie', name: '' },
  ], 'el corral');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(m => m.type === 'movie').addonId, 'catalog2');
  assert.equal(rows.find(m => m.type === 'series').addonId, 'catalog3');
});

test('search and detail loading layouts are descriptive and keep title escaped', () => {
  const html = searchLoadingMarkup();
  assert.equal((html.match(/sa-search-placeholder/g) || []).length, 6);
  assert.match(html, /role="status"/);
  assert.match(detailLoadingMarkup('El corral'), /El corral/);
  assert.match(detailLoadingMarkup('&lt;script&gt;'), /&lt;script&gt;/);
  assert(!detailLoadingMarkup('&lt;script&gt;').includes('<script>'));
});

test('cinema search is debounced and shows catalog results as providers complete', () => {
  const s = readFileSync(new URL('../src/stremio-ui.js', import.meta.url), 'utf8');
  assert.match(s, /setTimeout\(\(\) => browse\(\), 370\)/);
  assert.match(s, /rankFilmResults\(responses, query\)/);
  assert.match(s, /resolved < jobs\.length \? ' · Buscando más/);
  assert.match(s, /searchCache\.set\(cacheKey/);
  assert.match(s, /detailLoadingMarkup\(e\(preview\.name\)\)/);
});

test('VOD encoding caps resolution at 1440p and improves H264/AAC quality without reusing older segments', () => {
  const file = readFileSync(new URL('../relay/vod-hls.js', import.meta.url), 'utf8');
  assert.match(file, /hls-1440p-crf20-aac192-v3/);
  assert.match(file, /'-crf','20'/);
  assert.match(file, /min\(2560\\\\,iw\)/);
  assert.match(file, /min\(1440\\\\,ih\)/);
  assert.match(file, /'-b:a','192k'/);
});
