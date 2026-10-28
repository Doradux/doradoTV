import { fetchProviderJson } from './room-provider.js';
import { safeHttpUrl } from '../../src/playlist.js';
import { RoomError } from './room-store.js';

const MAX_CHANNELS = 30000;
// Keep the returned room playlist below Netlify's buffered 6 MB response limit.
const MAX_M3U_BYTES = 5 * 1024 * 1024;

const safeLabel = (value, fallback = '') => String(value ?? '').replace(/[\r\n\x00-\x1f]+/g, ' ').trim().slice(0, 180) || fallback;
const m3uAttribute = (value) => safeLabel(value).replace(/"/g, '&quot;');

/** Fetch only live TV; never include on-demand movies or series. */
export async function fetchXtreamPlaylist(account, fetcher = fetchProviderJson, streamFormat = 'auto') {
  if (!['auto', 'ts', 'm3u8'].includes(streamFormat)) throw new RoomError('Formato Xtream inválido.', 400);
  const endpoint = (action) => {
    const url = new URL('/player_api.php', account.origin);
    url.search = new URLSearchParams({ username: account.username, password: account.password, action });
    return url;
  };
  // Both requests are independent. Providers without categories still work.
  const categoriesPending = fetcher(endpoint('get_live_categories'), { maxBytes: 1024 * 1024, timeoutMs: 10000 }).catch(() => []);
  const streamsPending = fetcher(endpoint('get_live_streams'), { maxBytes: 48 * 1024 * 1024, timeoutMs: 25000 });
  let streams;
  try {
    streams = await streamsPending;
  } catch (error) {
    // Map known transport failures to clear messages, without reflecting URLs or keys.
    const reason = error?.message;
    if (reason === 'Response too large') throw new RoomError('El catálogo de Xtream supera los 48 MB admitidos. El proveedor devuelve una respuesta demasiado grande.', 413);
    if (reason === 'Provider timeout' || reason === 'DNS timeout') throw new RoomError('Xtream tardó demasiado en responder al solicitar sus canales en directo.', 504);
    if (reason === 'Provider unavailable') throw new RoomError('El proveedor Xtream rechazó o no admitió la consulta de canales en directo.', 502);
    throw new RoomError('No se pudieron obtener los canales en directo de Xtream. Comprueba que el proveedor permite consultar su catálogo.', 502);
  }
  const groups = await categoriesPending;
  const categories = new Map((Array.isArray(groups) ? groups : []).slice(0, MAX_CHANNELS)
    .map((item) => [String(item?.category_id), safeLabel(item?.category_name, 'General')]));
  if (!Array.isArray(streams)) throw new RoomError('Xtream devolvió un catálogo de canales con un formato no reconocido.', 502);
  const allowedFormats = Array.isArray(account.formats) ? account.formats : [];
  const extension = streamFormat === 'auto'
    ? allowedFormats.length && !allowedFormats.includes('ts') && allowedFormats.includes('m3u8') ? 'm3u8' : 'ts'
    : streamFormat;
  if (allowedFormats.length && !allowedFormats.includes(extension))
    throw new RoomError('Tu proveedor Xtream no anuncia soporte para el formato de vídeo seleccionado.', 400);
  const output = ['#EXTM3U'];
  const seen = new Set();
  let count = 0;
  let truncated = false;
  let size = Buffer.byteLength(output[0]) + 1;
  for (const stream of streams) {
    if (count >= MAX_CHANNELS) { truncated = true; break; }
    const id = String(stream?.stream_id ?? '');
    if (!/^[1-9]\d{0,11}$/.test(id) || seen.has(id)) continue;
    const name = safeLabel(stream?.name, 'Canal sin nombre').replace(/,/g, ' ·');
    const group = categories.get(String(stream?.category_id)) || 'General';
    const icon = safeHttpUrl(stream?.stream_icon || '') || '';
    const url = new URL(`/live/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${id}.${extension}`, account.origin).href;
    const line = `#EXTINF:-1 tvg-logo="${m3uAttribute(icon)}" group-title="${m3uAttribute(group)}",${name}\n${url}`;
    const nextBytes = Buffer.byteLength(line) + 1;
    if (size + nextBytes > MAX_M3U_BYTES) { truncated = true; break; }
    size += nextBytes;
    output.push(line);
    seen.add(id);
    count += 1;
  }
  if (!count) throw new RoomError('Esta cuenta Xtream no contiene canales en directo válidos.', 422);
  return { source: output.join('\n'), count, total: streams.length, truncated };
}
