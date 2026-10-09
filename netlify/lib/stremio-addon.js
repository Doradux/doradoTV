import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { RoomError } from './room-store.js';

const MAX_BYTES = 512 * 1024;
const TIMEOUT = 6500;
const clip = (v, n = 240) => typeof v === 'string' ? v.slice(0, n) : '';
const arr = (v, limit = 30) => Array.isArray(v) ? v.slice(0, limit) : [];
const publicIp = (ip) => {
  try { return ipaddr.process(ip).range() === 'unicast'; } catch { return false; }
};

export function manifestUrl(input) {
  if (typeof input !== 'string' || input.length > 1500) throw new RoomError('URL de addon inválida.');
  const raw = input.trim().replace(/^stremio:\/\//i, 'https://');
  let url;
  try { url = new URL(raw); } catch { throw new RoomError('Introduce una URL de manifest válida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new RoomError('El addon debe usar HTTPS público en el puerto 443.');
  }
  if (!url.hostname || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new RoomError('Host no permitido.');
  if (url.hash) throw new RoomError('La URL no debe incluir fragmentos.');
  if (!url.pathname.endsWith('/manifest.json')) {
    if (url.pathname.endsWith('/')) url.pathname += 'manifest.json';
    else url.pathname += '/manifest.json';
  }
  return url.href;
}

// Validate the hostname without ever requesting private-network endpoints.
// Browser-public manifests are supplied by the owner when Netlify is blocked,
// but must still satisfy the same DNS/SSRF constraints as server-side addons.
export async function validateAddonDestination(urlString, resolver = lookup) {
  const url = manifestUrl(urlString);
  let resolved;
  try { resolved = await resolver(new URL(url).hostname, { all: true }); }
  catch { throw new RoomError('No se pudo resolver el addon.', 502); }
  if (!resolved?.length || resolved.some(({ address }) => !publicIp(address)))
    throw new RoomError('El addon apunta a una red no permitida.', 403);
  return url;
}

export async function safeJson(urlString, { resolver = lookup, transport = httpsRequest, redirects = 0 } = {}) {
  let url;
  try { url = new URL(urlString); } catch { throw new RoomError('Solicitud a addon inválida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || url.href.length > 2000) throw new RoomError('Destino de addon no permitido.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let resolved;
  try { resolved = await resolver(hostname, { all: true }); }
  catch { throw new RoomError('No se pudo resolver el addon.', 502); }
  if (!resolved?.length || resolved.some(({ address }) => !publicIp(address))) throw new RoomError('El addon apunta a una red no permitida.', 403);
  // Retry one additional public IP on transient network or upstream 5xx errors.
  // Preserve SSRF protections and do not retry upstream 4xx rejections.
  const pins = [...resolved.filter((entry) => entry.family === 4), ...resolved.filter((entry) => entry.family === 6)].slice(0, 2);
  let lastError;
  for (const pin of pins) {
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => { if (!settled) { settled = true; reject(error instanceof RoomError ? error : new RoomError('El addon no responde.', 502)); } };
        const req = transport(url, {
          method: 'GET',
          timeout: TIMEOUT,
          maxRedirects: 0,
          headers: { Accept: 'application/json', 'User-Agent': 'DoradoTV/1.0 Stremio-Addon-Client' },
          lookup: (_hostname, options, callback) => callback(null, options?.all ? [pin] : pin.address, pin.family),
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (redirects >= 3) { fail(new RoomError('Demasiadas redirecciones del addon.', 502)); return; }
            let target;
            try { target = new URL(res.headers.location, url).href; } catch { fail(new RoomError('Redirección inválida del addon.', 502)); return; }
            safeJson(target, { resolver, transport, redirects: redirects + 1 }).then((value) => {
              if (!settled) { settled = true; resolve(value); }
            }, fail);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            const hint = res.statusCode === 404 ? ' Comprueba el enlace del manifiesto.'
              : res.statusCode === 403 ? ' El proveedor ha rechazado la solicitud de DoradoTV.'
              : res.statusCode >= 500 ? ' El servicio externo está fallando temporalmente.' : '';
            const error = new RoomError('El addon respondió con HTTP ' + res.statusCode + '.' + hint, 502);
            error.upstreamStatus = res.statusCode;
            fail(error);
            return;
          }
          if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); fail(new RoomError('Respuesta del addon demasiado grande.', 502)); return; }
          let length = 0;
          const chunks = [];
          res.on('data', (part) => {
            length += part.length;
            if (length > MAX_BYTES) { res.destroy(); fail(new RoomError('Respuesta del addon demasiado grande.', 502)); return; }
            chunks.push(part);
          });
          res.on('error', fail);
          res.on('end', () => {
            if (settled) return;
            try {
              const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (!json || typeof json !== 'object' || Array.isArray(json)) throw Error();
              settled = true; resolve(json);
            } catch { fail(new RoomError('El addon devolvió JSON inválido.', 502)); }
          });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', fail);
        req.end();
      });
    } catch (error) {
      lastError = error;
      if (error.upstreamStatus && error.upstreamStatus < 500) throw error;
    }
  }
  throw lastError || new RoomError('El addon no responde.', 502);
}

const allowedType = (type) => type === 'movie' || type === 'series';
export function normalizeManifest(data) {
  if (!clip(data.id, 140) || !clip(data.name, 140) || !Array.isArray(data.resources) || !Array.isArray(data.types) || !Array.isArray(data.catalogs)) {
    throw new RoomError('El manifest no cumple el protocolo de Stremio.');
  }
  const types = arr(data.types, 25).filter(allowedType);
  if (!types.length) throw new RoomError('Este addon no admite películas o series.');
  const resources = arr(data.resources, 40).map((r) => typeof r === 'string' ? { name: r } : r).filter((r) => r && ['catalog','meta','stream','subtitles'].includes(r.name))
    .map((r) => ({ name: r.name, types: Array.isArray(r.types) ? r.types.filter(allowedType) : types,
      idPrefixes: Array.isArray(r.idPrefixes) ? r.idPrefixes.filter((x) => typeof x === 'string').slice(0, 40) : Array.isArray(data.idPrefixes) ? data.idPrefixes.filter((x) => typeof x === 'string').slice(0, 40) : [] }));
  const catalogs = arr(data.catalogs, 30).filter((c) => allowedType(c?.type) && typeof c.id === 'string' && c.id.length <= 120)
    .map((c) => ({ id: c.id, type: c.type, name: clip(c.name, 120) || c.id,
      search: arr(c.extra, 20).some((e) => e?.name === 'search'), searchRequired: arr(c.extra, 20).some((e) => e?.name === 'search' && e.isRequired),
      paginated: arr(c.extra, 20).some((e) => e?.name === 'skip'), required: arr(c.extra, 20).some((e) => e?.isRequired && e.name !== 'search') }));
  return { id: clip(data.id, 140), name: clip(data.name, 140), description: clip(data.description, 500),
    version: clip(data.version, 30), types, resources, catalogs };
}

export function supports(manifest, resource, type, id = '') {
  if (!allowedType(type)) return false;
  return manifest.resources.some((r) => r.name === resource && r.types.includes(type)
    && (resource === 'catalog' || !r.idPrefixes.length || r.idPrefixes.some((p) => id.startsWith(p))));
}

export function resourceUrl(manifestLocation, resource, type, id, extra = {}) {
  if (!['catalog','meta','stream','subtitles'].includes(resource) || !allowedType(type)
    || typeof id !== 'string' || !id || id.length > 180) throw new RoomError('Recurso inválido.');
  const url = new URL(manifestLocation);
  url.pathname = url.pathname.slice(0, -'manifest.json'.length) +
    [resource, type, encodeURIComponent(id)].join('/') +
    (Object.keys(extra).length ? '/' + Object.entries(extra).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&') : '') + '.json';
  url.search = '';
  return url.href;
}

const mediaImage = (url) => {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.href.slice(0, 1500) : ''; } catch { return ''; }
};
export function metaPreview(item) {
  if (!item || !allowedType(item.type) || typeof item.id !== 'string' || !item.id || item.id.length > 180) return null;
  return { id: item.id, type: item.type, name: clip(item.name, 200), poster: mediaImage(item.poster), background: mediaImage(item.background),
    description: clip(item.description, 2500), releaseInfo: clip(item.releaseInfo, 100), imdbRating: clip(item.imdbRating, 20),
    videos: arr(item.videos, 300).filter((v) => v && typeof v.id === 'string' && v.id.length <= 180).map((v) => ({
      id: v.id, title: clip(v.title, 200), season: Number.isInteger(v.season) ? v.season : null, episode: Number.isInteger(v.episode) ? v.episode : null,
      released: clip(v.released, 40), thumbnail: mediaImage(v.thumbnail) })) };
}

export function streamView(item, addonName) {
  if (!item || typeof item !== 'object') return null;
  const url = typeof item.url === 'string' && /^https?:\/\//i.test(item.url) && item.url.length < 2000 ? item.url : '';
  const title = clip(item.title, 250);
  const match = title.match(/(?:👤|👥|seeders?)\s*[:=]?\s*(\d[\d.,]*)/i);
  const parsedSeeds = match ? Number(match[1].replace(/[.,]/g, '')) : null;
  const seeders = Number.isSafeInteger(item.seeders) && item.seeders >= 0 ? item.seeders
    : Number.isSafeInteger(parsedSeeds) && parsedSeeds >= 0 ? parsedSeeds : null;
  const infoHash = typeof item.infoHash === 'string' && /^[a-f\d]{40}$/i.test(item.infoHash) ? item.infoHash.toLowerCase() : '';
  const torrent = !!item.infoHash || /\.torrent(?:$|\?)/i.test(url);
  return { name: clip(item.name, 120) || addonName, title, url: torrent ? '' : url,
    supported: url.startsWith('https://') && !torrent,
    kind: torrent ? 'torrent' : item.ytId ? 'youtube' : url.startsWith('http:') ? 'http' : url ? 'https' : 'other',
    seeders, infoHash, fileIdx: Number.isSafeInteger(item.fileIdx) && item.fileIdx >= 0 ? item.fileIdx : null,
    subtitles: arr(item.subtitles, 25).map(subtitleView).filter(Boolean) };
}

export function subtitleView(item) {
  if (typeof item?.url !== 'string' || !item.url.startsWith('https://') || item.url.length > 1500) return null;
  return { id: clip(item.id, 100), lang: clip(item.lang, 20), url: item.url };
}
