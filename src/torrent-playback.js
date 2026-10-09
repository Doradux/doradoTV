import { installUint8EncodingCompat } from './uint8-compat.js';

// The vendored WebTorrent 3 browser bundle is ES module code with a default export.
// Loading it as a classic script does not expose any browser-global constructor.
let enginePromise;
export function loadTorrentEngine(importEngine = () => {
  const moduleUrl = new URL('/webtorrent.min.js', window.location.origin).href;
  return import(/* @vite-ignore */ moduleUrl);
}) {
  if (!enginePromise) {
    installUint8EncodingCompat();
    enginePromise = importEngine().then((module) => {
      if (typeof module?.default !== 'function') throw Error('El archivo del motor torrent no es compatible.');
      return module.default;
    }).catch((error) => {
      enginePromise = null; // Let Retry load again after a temporary network problem.
      console.warn('WebTorrent module loading failed:', error);
      throw Error('No se pudo cargar WebTorrent. Comprueba la conexión y vuelve a intentarlo.');
    });
  }
  return enginePromise;
}

// WebTorrent uses WebRTC-compatible peers; traditional BitTorrent peers are unavailable in browsers.
export async function startBrowserTorrent(video, source, { onStatus, isCurrent }) {
  if (!/^[a-f0-9]{40}$/i.test(source?.infoHash || '')) throw Error('Hash torrent no válido.');
  const WebTorrent = await loadTorrentEngine();
  if (!isCurrent()) throw Error('Reproducción cancelada.');
  if (!WebTorrent.WEBRTC_SUPPORT) throw Error('Este navegador no admite torrents mediante WebRTC.');
  if (!('serviceWorker' in navigator)) throw Error('Este navegador no admite reproducción torrent.');
  const registration = await navigator.serviceWorker.register('/torrent-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const client = new WebTorrent({ dht: false, lsd: false });
  try {
    client.createServer({ controller: registration });
  } catch (error) {
    client.destroy(() => {});
    throw error;
  }
  const trackers = ['wss://tracker.openwebtorrent.com', 'wss://tracker.btorrent.xyz', 'wss://tracker.webtorrent.dev'];
  const magnet = 'magnet:?xt=urn:btih:' + source.infoHash + '&tr=' + trackers.map(encodeURIComponent).join('&tr=');
  const ready = new Promise((resolve, reject) => {
    let finished = false;
    const settle = (err) => {
      if (finished) return false;
      finished = true;
      clearTimeout(timer);
      if (err) reject(err);
      return true;
    };
    const timer = setTimeout(() => settle(Error('No se encontraron pares WebRTC compatibles. Prueba otra fuente.')), 30000);
    client.on('error', (error) => settle(error));
    client.add(magnet, { destroyStoreOnDestroy: true }, (torrent) => {
      if (!isCurrent()) return settle(Error('Conexión cancelada.'));
      const candidates = torrent.files.filter((file) => /\.(mp4|webm|m4v|ogg)$/i.test(file.name));
      const preferred = Number.isInteger(source.fileIdx) ? torrent.files[source.fileIdx] : null;
      const file = preferred && candidates.includes(preferred) ? preferred : candidates.sort((a, b) => b.length - a.length)[0];
      if (!file) return settle(Error('El torrent no contiene un vídeo MP4/WebM compatible.'));
      onStatus('Preparando vídeo…');
      try { file.streamTo(video); if (settle()) resolve(); }
      catch (error) { settle(error); }
    });
  });
  return { client, ready };
}
