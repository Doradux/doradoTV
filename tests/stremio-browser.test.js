import test from 'node:test';
import assert from 'node:assert/strict';
import { browserManifestUrl, browserResourceUrl, browserAddonJson, browserSupports } from '../src/stremio-browser.js';

test('public addon URL keeps the configured prefix but rejects credentials and non-HTTPS', () => {
  const manifest = 'https://torrentio.strem.fun/sort=seeders%7Clanguage=spanish/manifest.json';
  assert.equal(browserManifestUrl(manifest), manifest);
  assert.equal(browserResourceUrl(manifest, 'stream', 'movie', 'tt123'),
    'https://torrentio.strem.fun/sort=seeders%7Clanguage=spanish/stream/movie/tt123.json');
  assert.equal(browserResourceUrl(manifest, 'catalog', 'movie', 'search', { search: 'dos palabras' }),
    'https://torrentio.strem.fun/sort=seeders%7Clanguage=spanish/catalog/movie/search/search=dos%20palabras.json');
  assert.throws(() => browserManifestUrl('http://localhost/manifest.json'));
  assert.throws(() => browserManifestUrl('https://user:token@addon.test/manifest.json'));
  assert.throws(() => browserManifestUrl('https://addon.test/manifest.json?api_key=secret'));
  assert.throws(() => browserResourceUrl(manifest, 'stream', 'invalid', 'tt123'));
});

test('browser addons require CORS and never transmit user cookies or relay credentials', async () => {
  let options;
  const data = await browserAddonJson('https://addon.example.org/manifest.json', {
    fetcher: async (_url, init) => {
      options = init;
      return { ok: true, headers: { get: () => '100' },
        text: async () => JSON.stringify({ id: 'test', name: 'Public' }) };
    },
  });
  assert.equal(data.id, 'test');
  assert.equal(options.mode, 'cors');
  assert.equal(options.credentials, 'omit');
  assert.deepEqual(options.headers, { Accept: 'application/json' });
  await assert.rejects(browserAddonJson('https://addon.example.org/manifest.json', {
    fetcher: async () => { throw TypeError('CORS blocked'); },
  }), /CORS/);
  await assert.rejects(browserAddonJson('https://addon.example.org/manifest.json', {
    fetcher: async () => ({ ok: false, status: 403 }),
  }), /403/);
  await assert.rejects(browserAddonJson('https://addon.example.org/manifest.json', {
    fetcher: async () => ({ ok: true, headers: { get: () => '9999999' } }),
  }), /demasiado grande/);
});

test('browser lookup only requests resources declared by the public addon manifest', () => {
  const manifest = { resources: [
    { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] },
    { name: 'catalog', types: ['movie'], idPrefixes: [] },
  ] };
  assert(browserSupports(manifest, 'stream', 'movie', 'tt123'));
  assert(!browserSupports(manifest, 'stream', 'movie', 'bad123'));
  assert(!browserSupports(manifest, 'meta', 'movie', 'tt123'));
});

test('browser addon streaming responses stop at 512 KiB rather than buffering unlimited data', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(520 * 1024)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(browserAddonJson('https://addon.example.org/catalog/movie/test.json', {
    fetcher: async () => ({ ok: true, status: 200, headers: { get: () => null }, body }),
  }), /demasiado grande/);
  assert(cancelled);
});
