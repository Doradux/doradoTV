import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createAddonHandler, parseTorznab, torrentHash, sourcesForMedia } from '../addon.js';

const TOKEN = 'A'.repeat(48);
const HASH = '0123456789abcdef0123456789abcdef01234567';
const XML = `<?xml version="1.0"?>
<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item>
<title>Ejemplo 1080p Castellano</title>
<link>magnet:?xt=urn:btih:${HASH}&amp;dn=demo</link>
<torznab:attr name="seeders" value="12"/>
</item><item><title>Ignorar sin hash</title><link>https://example.net/demo.torrent</link></item></channel></rss>`;

test('parsea magnet y fuentes Torznab sin exponer el enlace del indexador', () => {
  assert.equal(torrentHash('magnet:?xt=urn:btih:' + HASH + '&dn=test'), HASH);
  assert.equal(torrentHash('invalid'), '');
  assert.deepEqual(parseTorznab(XML), [{ infoHash: HASH, name: 'DoradoTV propio', title: 'Ejemplo 1080p Castellano', seeders: 12 }]);
});
test('catálogo manual sólo entrega torrents válidos y enlazados a su ID', () => {
  const data = JSON.stringify({ ['movie:tt12345']: [
    { infoHash: HASH, title: 'Película local', fileIdx: 2 },
    { infoHash: 'bad' },
  ] });
  assert.deepEqual(sourcesForMedia(data, 'movie', 'tt12345'), [
    { infoHash: HASH, name: 'DoradoTV propio', title: 'Película local', fileIdx: 2 },
  ]);
  assert.deepEqual(sourcesForMedia(data, 'series', 'tt12345'), []);
});
test('addon Stremio privado: valida token, id y responde streams sin Debrid', async () => {
  const called = [];
  const handler = createAddonHandler({
    token: TOKEN, torznabUrl: 'http://indexador:9117/api', torznabKey: 'test-secret',
    reader: () => JSON.stringify({ ['movie:tt12345']: [{ infoHash: HASH, title: 'Copia local' }] }),
    sourcePath: '/tmp/sources.json',
    fetcher: async (url) => {
      called.push(url);
      return new Response(XML, { status: 200, headers: { 'Content-Type': 'application/xml' } });
    },
  });
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch((error) => { response.writeHead(500); response.end(error.message); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const manifest = await fetch(base + '/' + TOKEN + '/manifest.json');
    assert.equal(manifest.status, 200);
    assert.equal((await manifest.json()).resources[0].name, 'stream');
    assert.equal((await fetch(base + '/bad/manifest.json')).status, 404);
    const response = await fetch(base + '/' + TOKEN + '/stream/movie/tt12345.json');
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.streams.length, 1);
    assert.equal(body.streams[0].infoHash, HASH);
    assert(!JSON.stringify(body).includes('test-secret'));
    assert.equal(called.length, 1);
    assert.equal(called[0].searchParams.get('imdbid'), 'tt12345');
    assert.equal(called[0].searchParams.get('t'), 'movie');
    assert.equal((await fetch(base + '/' + TOKEN + '/stream/movie/nope.json')).status, 400);
    const episode = await fetch(base + '/' + TOKEN + '/stream/series/tt76543:2:5.json');
    assert.equal(episode.status, 200);
    assert.equal(called[1].searchParams.get('t'), 'tvsearch');
    assert.equal(called[1].searchParams.get('season'), '2');
    assert.equal(called[1].searchParams.get('ep'), '5');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
test('la clave del addon es obligatoria y suficientemente larga', () => {
  assert.throws(() => createAddonHandler({ token: 'clave' }), /ADDON_TOKEN/);
});
