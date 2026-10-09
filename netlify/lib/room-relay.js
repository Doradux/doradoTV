import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { RoomError } from './room-store.js';

const MAX_REPLY = 96 * 1024, TIMEOUT = 8000;
const publicIp = (address) => {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
};
// No global relay fallback, even if the Netlify environment still has legacy keys.
export function normalizeRelay(input) {
  if (!input || typeof input.url !== 'string' || typeof input.secret !== 'string')
    throw new RoomError('Indica la URL y la clave privada del relay de esta sala.', 400);
  let url;
  try { url = new URL(input.url.trim()); } catch { throw new RoomError('URL del relay inválida.', 400); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      url.pathname !== '/' || url.search || url.hash || url.href.length > 350)
    throw new RoomError('El relay necesita una URL HTTPS pública, sin rutas ni credenciales.', 400);
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (ipaddr.isValid(host) || !host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') ||
      host.endsWith('.internal') || host.endsWith('.test'))
    throw new RoomError('La dirección del relay no es un dominio público permitido.', 400);
  if (input.secret.length < 16 || input.secret.length > 256 || /[\r\n]/.test(input.secret))
    throw new RoomError('La clave del relay debe tener entre 16 y 256 caracteres.', 400);
  return { url: url.origin, secret: input.secret };
}
async function publicPins(host, resolver = lookup) {
  let records;
  try { records = await resolver(host, { all: true }); }
  catch { throw new RoomError('No se pudo resolver el dominio del relay.', 502); }
  if (!Array.isArray(records) || !records.length || records.some(({ address }) => !publicIp(address)))
    throw new RoomError('El relay apunta a una dirección de red no permitida.', 403);
  return [...records.filter((r) => r.family === 4), ...records.filter((r) => r.family === 6)].slice(0, 2);
}
// TLS is pinned to DNS-validated public IPs to reject rebinding, redirects and huge replies.
export async function relayFetch(url, options = {}, { resolver = lookup, transport = httpsRequest } = {}) {
  const target = url instanceof URL ? url : new URL(url);
  if (target.protocol !== 'https:' || (target.port && target.port !== '443') || target.username || target.password)
    throw new RoomError('Destino de relay no permitido.', 403);
  const pins = await publicPins(target.hostname, resolver);
  let lastError;
  for (const pin of pins) {
    try {
      return await new Promise((resolve, reject) => {
        let settled = false, length = 0;
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(error instanceof RoomError ? error : new RoomError('No se pudo contactar con el relay.', 503));
        };
        const req = transport(target, {
          method: options.method || 'GET', headers: options.headers || {}, timeout: TIMEOUT,
          lookup: (_host, lookupOptions, callback) => callback(null,
            lookupOptions?.all ? [pin] : pin.address, pin.family),
        }, (res) => {
          const status = res.statusCode || 503;
          if (status >= 300 && status < 400) {
            res.resume(); fail(new RoomError('El relay intentó redirigir la petición.', 502)); return;
          }
          if (Number(res.headers['content-length']) > MAX_REPLY) {
            res.destroy(); fail(new RoomError('Respuesta de relay demasiado grande.', 502)); return;
          }
          const parts = [];
          res.on('data', (part) => {
            length += part.length;
            if (length > MAX_REPLY) { res.destroy(); fail(new RoomError('Respuesta de relay demasiado grande.', 502)); return; }
            parts.push(part);
          });
          res.on('error', fail);
          res.on('end', () => {
            if (settled) return;
            let json;
            try { json = JSON.parse(Buffer.concat(parts).toString('utf8')); }
            catch { fail(new RoomError('Respuesta inválida del relay.', 502)); return; }
            settled = true;
            resolve({ ok: status >= 200 && status < 300, status, json: async () => json });
          });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', fail);
        if (options.body) req.write(options.body);
        req.end();
      });
    } catch (error) { lastError = error; }
  }
  throw lastError || new RoomError('El relay no responde.', 503);
}
export function createRelayClient(input = null, fetcher = relayFetch) {
  const cfg = input ? normalizeRelay(input) : null;
  async function call(path, method = 'GET', payload) {
    if (!cfg) throw new RoomError('Esta sala no tiene relay configurado.', 503);
    let res;
    try {
      res = await fetcher(new URL(path, cfg.url), {
        method, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT),
        headers: { Authorization: 'Bearer ' + cfg.secret, Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}) },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      });
    } catch (error) {
      if (error instanceof RoomError) throw error;
      throw new RoomError('No se pudo contactar con el relay.', 503);
    }
    let data = null;
    try { data = await res.json(); } catch { /* Never echo control-plane credentials */ }
    if (!res.ok) {
      const status = [401, 403].includes(res.status) ? 403 : [404, 409].includes(res.status) ? res.status : 503;
      throw new RoomError([401, 403].includes(res.status) ? 'La clave del relay no es válida.'
        : data?.error || 'El relay no pudo procesar la solicitud.', status);
    }
    return data;
  }
  return {
    configured: !!cfg,
    async verify() {
      if (!cfg) throw new RoomError('Configura el relay de la sala.', 400);
      if ((await call('/health'))?.ok !== true) throw new RoomError('El relay no respondió con OK.', 502);
      const status = await call('/status');
      if (!Number.isSafeInteger(status?.max_connections) || status.max_connections < 1 ||
          !Number.isSafeInteger(status?.active_count) || status.active_count < 0)
        throw new RoomError('El destino no parece un relay DoradoTV compatible.', 400);
      return { valid: true, host: new URL(cfg.url).hostname, maximum: status.max_connections };
    },
    async health() {
      if (!cfg) return { configured: false, ready: false };
      for (let i = 0; i < 2; i++) {
        try { if ((await call('/health'))?.ok === true) return { configured: true, ready: true }; }
        catch { /* Sleeping services can wake on a later request */ }
      }
      return { configured: true, ready: false };
    },
    async start(channel, identity, tab) {
      const result = await call('/start', 'POST', { channel: { name: channel.name, url: channel.url },
        user_id: identity, name: channel.viewerName, tab });
      let playlist;
      try { playlist = new URL(result?.playlist_url); }
      catch { throw new RoomError('El relay devolvió una emisión inválida.', 503); }
      if (playlist.protocol !== 'https:' || playlist.origin !== cfg.url ||
          !playlist.pathname.startsWith('/media/'))
        throw new RoomError('El relay devolvió una dirección de vídeo no permitida.', 503);
      return { sessionId: result.session_id, emissionId: result.emission_id, url: playlist.href };
    },
    async ping(sessionId, identity, playing = true) {
      return call('/ping', 'POST', { session_id: sessionId, user_id: identity, is_playing: playing });
    },
    async close(emissionId, closedBy) {
      try { return await call('/close', 'POST', { emission_id: emissionId, closed_by: closedBy }); }
      catch (error) { if (error.status === 404) return { ok: true }; throw error; }
    },
  };
}
