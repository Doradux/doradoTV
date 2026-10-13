// Persist only navigation/identifiers in the current browser tab. Never persist
// Stremio stream URLs, TorBox signed links, relay tokens or source tickets.
export const CINEMA_SNAPSHOT_VERSION = 1;
export const CINEMA_SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const short = (value, limit = 220) => typeof value === 'string' ? value.slice(0, limit) : '';
const validType = type => type === 'movie' || type === 'series';
const validProviderKind = kind => ['torrent','https','hls','mp4','file'].includes(kind);
export function snapshotFilm(film) {
  if (!film || !validType(film.type) || !short(film.id, 200) || !short(film.addonId, 200)) return null;
  return { type: film.type, id: short(film.id, 200), name: short(film.name, 240),
    addonId: short(film.addonId, 200) };
}
// Fingerprint source labels instead of persisting display titles, info hashes,
// or any media URLs. This identifier is only a UI match, never authorization.
export function providerFingerprint(source) {
  const hash = source?.kind === 'torrent' && /^[a-f0-9]{40}$/i.test(source.infoHash || '')
    ? String(source.infoHash).toLowerCase() : null;
  const text = hash ? 'torrent:' + hash : String(source?.kind || '') + '\\0' +
    String(source?.name || '') + '\\0' + String(source?.title || '');
  let a = 0x811c9dc5, b = 0x165667b1;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8,'0') +
    (b >>> 0).toString(16).padStart(8,'0');
}
export function snapshotProvider(source, index) {
  if (!source || !validProviderKind(source.kind)) return null;
  return { kind: source.kind,
    fingerprint: typeof source.fingerprint === 'string' && /^[a-f0-9]{16}$/.test(source.fingerprint)
      ? source.fingerprint : providerFingerprint(source),
    index: Number.isSafeInteger(index) && index >= 0 && index < 500 ? index : -1 };
}
export function findRestoredProvider(streams, saved) {
  if (!saved || !Array.isArray(streams)) return -1;
  const equal = (source) => source?.kind === saved.kind &&
    providerFingerprint(source) === saved.fingerprint;
  if (saved.index >= 0 && equal(streams[saved.index])) return saved.index;
  const matches = streams.map((stream, index) => equal(stream) ? index : -1).filter(index => index >= 0);
  // Two near-identical sources can refer to different files. Never auto-select
  // ambiguously: let the user choose one from the freshly authorized list.
  return matches.length === 1 ? matches[0] : -1;
}
export function sanitizeCinemaSnapshot(snapshot, now = Date.now()) {
  if (!snapshot || snapshot.version !== CINEMA_SNAPSHOT_VERSION ||
    !Number.isFinite(snapshot.savedAt) ||
    snapshot.savedAt > now + 60000 || now - snapshot.savedAt > CINEMA_SNAPSHOT_MAX_AGE_MS) return null;
  const current = snapshotFilm(snapshot.current);
  const metas = Array.isArray(snapshot.metas)
    ? snapshot.metas.slice(0, 70).map(snapshotFilm).filter(Boolean) : [];
  const position = Number(snapshot.position);
  return {
    version: CINEMA_SNAPSHOT_VERSION, savedAt: snapshot.savedAt,
    mode: snapshot.mode === 'cinema' ? 'cinema' : 'channels',
    view: current && snapshot.view === 'detail' ? 'detail' : 'browse',
    query: short(snapshot.query, 100),
    metas, current,
    episodeId: short(snapshot.episodeId, 200),
    provider: snapshotProvider(snapshot.provider, snapshot.provider?.index),
    playing: !!snapshot.playing && !!current && !!snapshot.provider,
    position: Number.isFinite(position) && position >= 0 ? Math.min(position, 21600) : 0,
    paused: !!snapshot.paused, compatibleAudio: !!snapshot.compatibleAudio,
    panelScroll: Number.isFinite(snapshot.panelScroll) && snapshot.panelScroll >= 0
      ? Math.min(Math.round(snapshot.panelScroll), 100000) : 0,
  };
}
export function readCinemaSnapshot(storage, key, now = Date.now()) {
  try {
    const data = JSON.parse(storage?.getItem(key) || 'null');
    const snapshot = sanitizeCinemaSnapshot(data, now);
    if (!snapshot && data) storage?.removeItem(key);
    return snapshot;
  } catch { return null; }
}
export function writeCinemaSnapshot(storage, key, state, now = Date.now()) {
  const safe = sanitizeCinemaSnapshot({ ...state, version: CINEMA_SNAPSHOT_VERSION, savedAt: now }, now);
  if (!safe) return;
  try { storage?.setItem(key, JSON.stringify(safe)); } catch { /* private mode / quota */ }
}
