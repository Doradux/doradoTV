import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';

// Audio remux of direct HTTPS videos (such as TorBox download links).
// No arbitrary host headers, cookies or Authorization values are ever forwarded.
// DNS is resolved and pinned independently at EACH redirect, preventing SSRF.
const MAX_SESSIONS = 24;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 24 * 1024 ** 3;
const ACTIVE_MS = 2 * 60 * 60 * 1000;
const IDLE_MS = 3 * 60 * 1000;
const equals = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
const isPublic = (address) => {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
};
export function validateDirectMediaUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) throw Error('URL de vídeo demasiado larga.');
  let url;
  try { url = new URL(value); } catch { throw Error('URL de vídeo inválida.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username ||
      url.password || url.hash || !host.includes('.') || ipaddr.isValid(host) ||
      host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal'))
    throw Error('La fuente de vídeo debe usar un dominio HTTPS público sin credenciales de usuario.');
  return url;
}

export async function openDirectMedia(value, {
  resolver = lookup, transport = httpsRequest, redirects = 0, range = null,
} = {}) {
  const url = validateDirectMediaUrl(value);
  let records;
  try { records = await resolver(url.hostname, { all: true }); }
  catch { throw Error('No se pudo resolver la fuente de vídeo.'); }
  if (!Array.isArray(records) || !records.length || records.some((pin) => !isPublic(pin.address)))
    throw Error('La fuente de vídeo apunta a una red no permitida.');
  let lastError;
  for (const pin of records.slice(0, 2)) {
    try {
      const result = await new Promise((resolve, reject) => {
        const req = transport(url, {
          method: 'GET',
          timeout: 25000,
          headers: { Accept: 'video/*,application/octet-stream;q=0.9,*/*;q=0.2',
            'User-Agent': 'DoradoTV-Media/1.0', ...(range ? { Range: range } : {}) },
          lookup: (_hostname, options, callback) => callback(null,
            options?.all ? [pin] : pin.address, pin.family),
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            req.destroy();
            if (redirects >= MAX_REDIRECTS) { reject(Error('Demasiadas redirecciones del vídeo.')); return; }
            let target;
            try { target = new URL(res.headers.location, url).href; }
            catch { reject(Error('Redirección de vídeo inválida.')); return; }
            resolve({ redirect: target });
            return;
          }
          if (![200, 206].includes(res.statusCode)) {
            res.resume(); req.destroy();
            reject(Error('La fuente de vídeo ha respondido con HTTP ' + res.statusCode + '.'));
            return;
          }
          const length = Number(res.headers['content-length']);
          if (Number.isFinite(length) && length > MAX_BYTES) {
            res.destroy(); reject(Error('El archivo supera el límite de 24 GiB.')); return;
          }
          if (range && res.statusCode !== 206 && !/^bytes=0-?$/.test(range)) {
            res.destroy(); reject(Error('La fuente no admite saltos de tiempo por HTTP Range.')); return;
          }
          let total = 0;
          res.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BYTES) res.destroy(Error('Archivo demasiado grande.'));
          });
          resolve({ stream: res, status: res.statusCode, length: Number.isFinite(length) ? length : null,
            contentRange: res.headers['content-range'] || null,
            close: () => {res.destroy();req.destroy();} });
        });
        req.on('timeout', () => req.destroy(Error('La fuente tardó demasiado en responder.')));
        req.on('error', reject);
        req.end();
      });
      if (result.redirect) return openDirectMedia(result.redirect, { resolver, transport, redirects: redirects + 1, range });
      return result;
    } catch (error) { lastError = error; }
  }
  throw lastError || Error('No se pudo descargar el vídeo.');
}

export class DirectAudioSessions {
  constructor({ clock = () => Date.now(), opener = openDirectMedia } = {}) {
    this.clock = clock;
    this.opener = opener;
    this.entries = new Map();
  }
  start(url, userId, base) {
    validateDirectMediaUrl(url);
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(userId || '')) throw Error('Sesión de vídeo inválida.');
    this.sweep();
    if (this.entries.size >= MAX_SESSIONS) throw Error('Demasiadas conversiones pendientes.');
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    this.entries.set(id, { url, userId, token, expires: this.clock() + IDLE_MS,
      active: false, close: null });
    return { session_id: id, playback_url: base + '/direct-audio/' + id + '?token=' + token };
  }
  authenticate(id, token) {
    const entry = this.entries.get(id);
    if (!entry || !equals(entry.token, token) || entry.expires <= this.clock())
      throw Error('La sesión de audio ha caducado.');
    return entry;
  }
  async open(id, token) {
    const entry = this.authenticate(id, token);
    if (entry.active) throw Error('La conversión de audio ya está activa.');
    entry.active = true;
    entry.expires = this.clock() + ACTIVE_MS;
    try {
      const remote = await this.opener(entry.url);
      if (this.entries.get(id) !== entry) { remote.close(); throw Error('La sesión ha terminado.'); }
      entry.close = remote.close;
      return { stream: remote.stream, close: () => this.stop(id) };
    } catch (error) { this.stop(id); throw error; }
  }
  stop(id, userId) {
    const entry = this.entries.get(id);
    if (!entry || (userId && entry.userId !== userId)) return { ok: true };
    this.entries.delete(id);
    entry.close?.();
    return { ok: true };
  }
  sweep() {
    for (const [id, entry] of this.entries) if (entry.expires <= this.clock()) this.stop(id);
  }
  shutdown() {
    for (const id of this.entries.keys()) this.stop(id);
  }
}
