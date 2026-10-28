import { fetchProviderJson } from './room-provider.js';
import { safeHttpUrl } from '../../src/playlist.js';

const MAX_CHANNELS = 15000;
const MAX_M3U_BYTES = 10 * 1024 * 1024;

const safeLabel = (value, fallback = '') => String(value ?? '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, 180) || fallback;
const m3uAttribute = (value) => safeLabel(value).replace(/"/g, '&quot;');

/** Fetch only live TV; never include on-demand movies or series. */
export async function fetchXtreamPlaylist(account, fetcher = fetchProviderJson) {
  const endpoint = (action) => {
    const url = new URL('/player_api.php', account.origin);
    url.search = new URLSearchParams({ username: account.username, password: account.password, action });
    return url;
  };
  // Both requests are independent. Providers without categories still work.
  const categoriesPending = fetcher(endpoint('get_live_categories'), { maxBytes: 1024 * 1024, timeoutMs: 10000 }).catch(() => []);
  const streamsPending = fetcher(endpoint('get_live_streams'), { maxBytes: 16 * 1024 * 1024, timeoutMs: 15000 });
  let streams;
  try {
    streams = await streamsPending;
  } catch { throw new Error('No se pudieron obtener los canales en directo del servidor Xtream.'); }
  const groups = await categoriesPending;
  const categories = new Map((Array.isArray(groups) ? groups : []).slice(0, MAX_CHANNELS)
    .map((item) => [String(item?.category_id), safeLabel(item?.category_name, 'General')]));
  if (!Array.isArray(streams)) throw new Error('Xtream no devolvió una lista válida de canales en directo.');
  if (streams.length > MAX_CHANNELS) throw new Error('El proveedor devuelve demasiados canales para importar a esta sala.');
  const extension = Array.isArray(account.formats) && account.formats.length && !account.formats.includes('ts') && account.formats.includes('m3u8') ? 'm3u8' : 'ts';
  const output = ['#EXTM3U'];
  const seen = new Set();
  let count = 0;
  let size = Buffer.byteLength(output[0]) + 1;
  for (const stream of streams) {
    const id = String(stream?.stream_id ?? '');
    if (!/^[1-9]\d{0,11}$/.test(id) || seen.has(id)) continue;
    const name = safeLabel(stream?.name, 'Canal sin nombre').replace(/,/g, ' ·');
    const group = categories.get(String(stream?.category_id)) || 'General';
    const icon = safeHttpUrl(stream?.stream_icon || '') || '';
    const url = new URL(`/live/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${id}.${extension}`, account.origin).href;
    const line = `#EXTINF:-1 tvg-logo="${m3uAttribute(icon)}" group-title="${m3uAttribute(group)}",${name}\n${url}`;
    const nextBytes = Buffer.byteLength(line) + 1;
    if (size + nextBytes > MAX_M3U_BYTES) throw new Error('La lista Xtream supera el máximo de 10 MB permitido en la sala.');
    size += nextBytes;
    output.push(line);
    seen.add(id);
    count += 1;
  }
  if (!count) throw new Error('Esta cuenta Xtream no contiene canales en directo válidos.');
  return { source: output.join('\n'), count };
}
