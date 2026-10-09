// Public, owner-opted-in Stremio addons may be queried directly when their
// server allows browser CORS. No credentials, cookies or private URLs are sent.
export function browserManifestUrl(input) {
  const raw = String(input || '').trim().replace(/^stremio:\/\//i, 'https://');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || url.hash || url.search)
    throw Error('Usa una URL HTTPS pública sin credenciales ni parámetros privados.');
  if (!url.pathname.endsWith('/manifest.json'))
    url.pathname += (url.pathname.endsWith('/') ? '' : '/') + 'manifest.json';
  return url.href;
}

export function browserResourceUrl(manifestUrl, resource, type, id, extra = {}) {
  if (!['catalog', 'meta', 'stream', 'subtitles'].includes(resource) ||
      !['movie', 'series'].includes(type) || !id || String(id).length > 180)
    throw Error('Recurso del addon no válido.');
  const url = new URL(browserManifestUrl(manifestUrl));
  url.pathname = url.pathname.slice(0, -'manifest.json'.length) +
    [resource, type, encodeURIComponent(id)].join('/') +
    (Object.keys(extra).length ? '/' + Object.entries(extra)
      .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') : '') +
    '.json';
  return url.href;
}

export async function browserAddonJson(url, { fetcher = fetch, timeoutMs = 8000 } = {}) {
  let response;
  try {
    response = await fetcher(url, { method: 'GET', mode: 'cors', credentials: 'omit',
      redirect: 'follow', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw Error('El addon no permite solicitudes CORS desde este navegador o no responde.');
  }
  if (!response.ok) throw Error('El addon respondió con HTTP ' + response.status + '.');
  const limit = 512 * 1024;
  if (Number(response.headers.get('content-length')) > limit)
    throw Error('La respuesta del addon es demasiado grande.');
  let text;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    text = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw Error('La respuesta del addon es demasiado grande.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } else {
    text = await response.text();
    if (new TextEncoder().encode(text).length > limit)
      throw Error('La respuesta del addon es demasiado grande.');
  }
  try {
    const json = JSON.parse(text);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw Error();
    return json;
  } catch { throw Error('El addon devolvió JSON inválido.'); }
}

export function browserSupports(manifest, resource, type, id = '') {
  return (manifest?.resources || []).some((r) => r.name === resource &&
    r.types.includes(type) && (resource === 'catalog' || !r.idPrefixes?.length || r.idPrefixes.some((prefix) => id.startsWith(prefix))));
}
