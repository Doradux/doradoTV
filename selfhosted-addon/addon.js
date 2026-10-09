import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';

const HASH = /^[a-f0-9]{40}$/i;
const MEDIA_ID = /^tt[0-9]{5,12}(?::[0-9]{1,3}:[0-9]{1,3})?$/;
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  processEntities: false,
  trimValues: true,
});
const alwaysArray = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
const textValue = (value) => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
const cleanTitle = (value) => textValue(value).slice(0, 230);
const bodyJson = (response, status, data) => {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  response.end(JSON.stringify(data));
};
const tokenMatches = (given, expected) => {
  const a = Buffer.from(given || ''), b = Buffer.from(expected || '');
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
};
function base32ToHex(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, accumulator = 0, output = '';
  for (const letter of value.toUpperCase()) {
    const digit = alphabet.indexOf(letter);
    if (digit < 0) return '';
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output += ((accumulator >> bits) & 255).toString(16).padStart(2, '0');
      accumulator &= (1 << bits) - 1;
    }
  }
  return HASH.test(output) ? output.toLowerCase() : '';
}
export function torrentHash(value) {
  const text = textValue(value).trim();
  if (HASH.test(text)) return text.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(text)) return base32ToHex(text);
  const match = text.match(/(?:^|[?&])xt=urn:btih:([a-z0-9]{32}|[a-f0-9]{40})(?:&|$)/i);
  return match ? torrentHash(match[1]) : '';
}
export function parseTorznab(xml) {
  if (typeof xml !== 'string' || xml.length > 2 * 1024 * 1024) throw Error('Invalid indexer response');
  const rss = xmlParser.parse(xml);
  const items = alwaysArray(rss?.rss?.channel?.item);
  return items.slice(0, 80).map((item) => {
    const attrs = Object.fromEntries(alwaysArray(item?.['torznab:attr'])
      .filter((attr) => attr && typeof attr['@_name'] === 'string')
      .map((attr) => [attr['@_name'].toLowerCase(), attr['@_value']]));
    const link = textValue(item?.link);
    const enclosure = textValue(item?.enclosure?.['@_url']);
    const infoHash = [
      attrs.infohash, attrs.info_hash, attrs.magneturl, attrs.magnet,
      textValue(item?.guid?.['#text']), textValue(item?.guid), link, enclosure,
    ].map(torrentHash).find(Boolean);
    if (!infoHash) return null;
    return {
      infoHash,
      name: 'DoradoTV propio',
      title: cleanTitle(item.title) || 'Fuente BitTorrent',
      seeders: Number.isSafeInteger(Number(attrs.seeders)) && Number(attrs.seeders) >= 0 ? Number(attrs.seeders) : null,
    };
  }).filter(Boolean);
}
export function sourcesForMedia(contents, type, id) {
  if (typeof contents !== 'string' || contents.length > 1024 * 1024) return [];
  let data;
  try { data = JSON.parse(contents); } catch { return []; }
  const entry = data?.[type + ':' + id];
  return alwaysArray(entry).slice(0, 30).map((item) => {
    if (!item || typeof item !== 'object') return null;
    const infoHash = torrentHash(item.infoHash || item.magnet);
    if (!infoHash) return null;
    return {
      infoHash, name: 'DoradoTV propio',
      title: cleanTitle(item.title) || 'Fuente privada',
      ...(Number.isSafeInteger(item.fileIdx) && item.fileIdx >= 0 && item.fileIdx <= 10000 ? { fileIdx: item.fileIdx } : {}),
      ...(Number.isSafeInteger(item.seeders) && item.seeders >= 0 ? { seeders: item.seeders } : {}),
    };
  }).filter(Boolean);
}
export function validMedia(type, id) {
  if (!['movie', 'series'].includes(type) || !MEDIA_ID.test(id)) return false;
  return type === 'movie' ? !id.includes(':') : true;
}
export function createAddonHandler({
  token, torznabUrl = '', torznabKey = '', sourcePath = '',
  fetcher = fetch, reader = readFileSync, clock = () => Date.now(),
} = {}) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(token))
    throw Error('ADDON_TOKEN debe contener entre 32 y 128 caracteres alfanuméricos.');
  if (torznabUrl) {
    const target = new URL(torznabUrl);
    if (!['http:', 'https:'].includes(target.protocol)) throw Error('TORZNAB_URL debe usar HTTP(S).');
  }
  const cache = new Map();
  const manifest = {
    id: 'app.doradotv.selfhosted', version: '1.0.0', name: 'DoradoTV · Fuentes propias',
    description: 'Fuentes de un catálogo autorizado y/o indexador Torznab de confianza.',
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'], catalogs: [],
    behaviorHints: { configurable: false },
  };
  async function queryIndexer(type, id) {
    if (!torznabUrl) return [];
    const cached = cache.get(type + ':' + id);
    if (cached && cached.expire > clock()) return cached.items;
    const [imdb, season, episode] = id.split(':');
    const url = new URL(torznabUrl);
    url.searchParams.set('t', type === 'movie' ? 'movie' : 'tvsearch');
    url.searchParams.set('imdbid', imdb);
    if (season && episode) {
      url.searchParams.set('season', season);
      url.searchParams.set('ep', episode);
    }
    if (torznabKey) url.searchParams.set('apikey', torznabKey);
    const result = await fetcher(url, { signal: AbortSignal.timeout(8500), headers: { Accept: 'application/xml' }, redirect: 'error' });
    if (!result.ok) throw Error('Indexer HTTP ' + result.status);
    if (Number(result.headers.get('content-length')) > 2 * 1024 * 1024) throw Error('Indexer response too large');
    const xml = await result.text();
    const items = parseTorznab(xml);
    // Avoid unbounded caching from arbitrary catalog IDs.
    if (cache.size > 150) cache.clear();
    cache.set(type + ':' + id, { expire: clock() + 90000, items });
    return items;
  }
  return async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (request.method === 'GET' && url.pathname === '/health') {
      bodyJson(response, 200, { ok: true, torznabConfigured: !!torznabUrl, localCatalogConfigured: !!sourcePath });
      return;
    }
    if (request.method !== 'GET') return bodyJson(response, 405, { error: 'Método no permitido' });
    const match = /^\/([^/]+)\/(manifest\.json|stream\/(movie|series)\/([^/]+)\.json)$/.exec(url.pathname);
    if (!match || !tokenMatches(match[1], token)) return bodyJson(response, 404, { error: 'No encontrado' });
    if (match[2] === 'manifest.json') return bodyJson(response, 200, manifest);
    const type = match[3];
    let id;
    try { id = decodeURIComponent(match[4]); } catch { return bodyJson(response, 400, { error: 'ID inválido' }); }
    if (!validMedia(type, id)) return bodyJson(response, 400, { error: 'ID inválido' });
    let manual = [];
    if (sourcePath) {
      try { manual = sourcesForMedia(reader(sourcePath, 'utf8'), type, id); }
      catch (error) { if (error.code !== 'ENOENT') console.error('Error de catálogo propio', error.message); }
    }
    let indexed = [];
    try { indexed = await queryIndexer(type, id); }
    catch (error) { console.error('El indexador no está disponible:', error.message); }
    const distinct = new Map();
    for (const item of [...manual, ...indexed]) {
      const key = item.infoHash + ':' + (item.fileIdx ?? '');
      if (!distinct.has(key)) distinct.set(key, item);
    }
    const streams = [...distinct.values()].sort((a, b) => (b.seeders || 0) - (a.seeders || 0)).slice(0, 25);
    return bodyJson(response, 200, { streams });
  };
}
