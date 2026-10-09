// WebTorrent uses WebRTC-compatible peers; traditional BitTorrent peers are unavailable in browsers.
export async function startBrowserTorrent(video, source, { onStatus, isCurrent }) {
  if (!/^[a-f0-9]{40}$/i.test(source?.infoHash || '')) throw Error('Hash torrent no válido.');
  if (!window.WebTorrent) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/webtorrent.min.js'; script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(Error('No se pudo cargar el reproductor torrent.'));
      document.head.append(script);
    });
  }
  const WebTorrent = window.WebTorrent;
  if (!WebTorrent) throw Error('No se pudo iniciar el motor torrent.');
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
