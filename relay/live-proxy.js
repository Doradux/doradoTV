import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';

const MAX_REDIRECTS = 4;
const MAX_URL_LENGTH = 4096;

function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; }
  catch { return false; }
}

/**
 * Resolve and pin EVERY upstream hop, including HTTPS redirects.
 * Never pass the unvalidated redirect to FFmpeg.
 */
export async function pinLiveTarget(value, resolver = lookup) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error('Dirección de vídeo inválida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > MAX_URL_LENGTH)
    throw new Error('El proveedor redirige a un protocolo o dirección no permitidos.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const records = ipaddr.isValid(host)
    ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6 }]
    : await Promise.race([
        resolver(host, { all: true }),
        new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('DNS timeout')), 3500);
          timer.unref();
        }),
      ]);
  if (!Array.isArray(records) || !records.length || records.some(({ address }) => !publicAddress(address)))
    throw new Error('El proveedor ha redirigido a una red privada o no permitida.');
  return { url, ip: records[0].address, family: records[0].family };
}

/**
 * A localhost-only, one-connection streaming bridge for Xtream MPEG-TS.
 * Unlike a preflight GET, it never consumes a second provider slot.
 * It follows bounded, DNS-pinned redirects in Node and sends no redirects to FFmpeg.
 */
export function proxyLiveStream(startUrl, downstream, {
  resolver = lookup, httpTransport = httpRequest, httpsTransport = httpsRequest,
  onFailure = () => {}, maxRedirects = MAX_REDIRECTS,
} = {}) {
  let upstream = null;
  const close = () => { if (upstream) upstream.destroy(); };
  downstream.once('close', close);
  const fail = (error) => {
    if (downstream.destroyed) return;
    // Only fixed, non-secret error strings are sent to the client or logged.
    const message = error?.safeMessage || 'No se pudo conectar con el servidor de vídeo del proveedor.';
    onFailure(message);
    if (!downstream.headersSent) {
      downstream.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      downstream.end('Upstream unavailable');
    } else downstream.destroy();
  };
  async function visit(value, depth) {
    if (downstream.destroyed) return;
    if (depth > maxRedirects) throw { safeMessage: 'Demasiadas redirecciones en el servidor de vídeo del proveedor.' };
    let target;
    try { target = await pinLiveTarget(value, resolver); }
    catch { throw { safeMessage: 'La redirección del proveedor no es segura o no se pudo resolver.' }; }
    if (downstream.destroyed) return;
    const { url, ip, family } = target;
    return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? httpsTransport : httpTransport;
      const req = transport(url, {
        headers: { 'User-Agent': 'VLC/3.0.18', Accept: '*/*', Connection: 'close' },
        lookup: (_host, options, callback) => options?.all
          ? callback(null, [{ address: ip, family }])
          : callback(null, ip, family),
      }, (response) => {
        const status = response.statusCode || 502;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) { reject({ safeMessage: 'Redirección del proveedor sin destino.' }); return; }
          try { resolve(new URL(location, url).href); }
          catch { reject({ safeMessage: 'Redirección inválida del proveedor.' }); }
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          reject({ safeMessage: `El proveedor rechazó la señal de vídeo (HTTP ${status}).` });
          return;
        }
        if (String(response.headers['content-type'] || '').toLowerCase().includes('text/html')) {
          response.destroy();
          reject({ safeMessage: 'El proveedor devolvió HTML en lugar del vídeo. Comprueba el formato TS/HLS.' });
          return;
        }
        downstream.writeHead(200, {
          'Content-Type': response.headers['content-type'] || 'video/mp2t',
          'Cache-Control': 'no-store',
        });
        response.on('error', reject);
        response.on('end', () => resolve(null));
        response.pipe(downstream);
      });
      upstream = req;
      req.setTimeout(15000, () => req.destroy(new Error('timeout')));
      req.on('error', () => reject({ safeMessage: 'Se interrumpió o agotó el tiempo de conexión con el proveedor.' }));
      if (downstream.destroyed) req.destroy();
      else req.end();
    }).then((next) => typeof next === 'string' ? visit(next, depth + 1) : null);
  }
  visit(startUrl, 0).catch(fail);
  return close;
}
