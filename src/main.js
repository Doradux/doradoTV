import './main.css';
import { decryptPlaylist } from './crypto.js';
import { groupsFor, parsePlaylist } from './playlist.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="mx-auto flex min-h-screen max-w-[1800px] flex-col px-4 pb-8 pt-5 sm:px-6 lg:px-8">
    <header class="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-5">
      <div class="flex items-center gap-3">
        <div class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-2xl font-black text-slate-950 shadow-lg shadow-amber-500/20" aria-hidden="true">D</div>
        <div><p class="text-xs font-semibold uppercase tracking-[0.25em] text-amber-400">Tu pantalla</p><h1 class="text-2xl font-black tracking-tight text-white">Dorado TV</h1></div>
      </div>
      <span class="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-medium text-slate-300">Reproductor M3U</span>
    </header>

    <main class="grid flex-1 items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
      <section class="min-w-0 space-y-5" aria-label="Reproductor">
        <div class="overflow-hidden rounded-3xl border border-slate-800 bg-black shadow-2xl shadow-black/30">
          <div class="relative aspect-video bg-black">
            <video id="video" class="h-full w-full object-contain" playsinline preload="none" aria-label="Vídeo del canal seleccionado"></video>
            <div id="empty" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
              <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-3xl text-amber-300" aria-hidden="true">▶</div>
              <h2 class="text-lg font-bold text-white">Tu televisión, a tu manera</h2>
              <p class="max-w-md text-sm text-slate-400">Desbloquea tu lista cifrada para explorar los canales y empezar a verlos.</p>
            </div>
            <div id="loading" class="absolute inset-0 hidden items-center justify-center bg-black/70" role="status"><span class="rounded-full border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm text-white">Cargando emisión…</span></div>
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-slate-800 bg-slate-900/80 p-3 sm:p-4">
            <button id="prev" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-label="Canal anterior">⏮</button>
            <button id="play" type="button" class="min-w-24 rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Reproducir</button>
            <button id="next" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-label="Canal siguiente">⏭</button>
            <label class="ml-auto flex items-center gap-2 text-xs text-slate-300"><span>Volumen</span><input id="volume" class="w-20 accent-amber-400 sm:w-28" type="range" min="0" max="1" step="0.05" value="0.8" aria-label="Volumen" /></label>
            <button id="pip" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">Ventana</button>
            <button id="fullscreen" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">Pantalla completa</button>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <p class="text-xs font-semibold uppercase tracking-widest text-amber-400">En directo</p>
          <h2 id="now-name" class="mt-1 truncate text-xl font-bold text-white">Ningún canal seleccionado</h2>
          <p id="status" class="mt-2 text-sm text-slate-400" role="status" aria-live="polite">Introduce la clave de tu lista para comenzar.</p>
        </div>
        <section class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5" aria-labelledby="import-title">
          <div class="mb-4 flex flex-wrap items-center justify-between gap-2"><div><h2 id="import-title" class="text-lg font-bold text-white">Desbloquear lista</h2><p class="mt-1 text-sm text-slate-400">El archivo cifrado se descifra solo en este navegador.</p></div><span class="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">AES-256-GCM</span></div>
          <form id="unlock-form" class="flex flex-col gap-2 sm:flex-row"><label for="playlist-password" class="sr-only">Clave de la lista</label><input id="playlist-password" type="password" autocomplete="off" required placeholder="Clave de la lista" class="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" /><button id="unlock" type="submit" class="rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Desbloquear</button></form>
          <p class="mt-3 text-xs text-slate-500">La clave no se guarda. Si recargas la página, tendrás que introducirla de nuevo.</p>
        </section>
      </section>

      <aside class="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70" aria-label="Canales">
        <div class="border-b border-slate-800 p-4 sm:p-5"><div class="mb-4 flex items-center justify-between gap-2"><h2 class="text-lg font-bold text-white">Canales</h2><span id="count" class="text-xs text-slate-400">0 canales</span></div><label for="search" class="sr-only">Buscar canales</label><input id="search" type="search" placeholder="Buscar canal o categoría…" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" /><div class="mt-3 flex gap-2"><label for="category" class="sr-only">Filtrar categoría</label><select id="category" class="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-amber-400 focus:outline-none"><option value="">Todas las categorías</option></select><button id="favorites" type="button" class="rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-pressed="false">☆ Favoritos</button></div></div>
        <div id="channel-list" class="max-h-[580px] min-h-64 space-y-1 overflow-y-auto p-2" role="list"><p class="p-5 text-center text-sm text-slate-400">Los canales aparecerán aquí.</p></div>
        <div id="more-wrap" class="hidden border-t border-slate-800 p-3"><button id="more" type="button" class="w-full rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">Mostrar más canales</button></div>
      </aside>
    </main>
    <footer class="mt-8 text-center text-xs text-slate-500">Dorado TV · Utiliza listas y emisiones para las que tengas permiso.</footer>
  </div>`;

const $ = (selector) => app.querySelector(selector);
const video = $('#video');
let channels = [];
let filtered = [];
let active = null;
let hls = null;
let ts = null;
let visible = 80;
let onlyFavorites = false;
let playbackToken = 0;
let savedFavorites = [];
try {
  savedFavorites = JSON.parse(localStorage.getItem('dorado-tv:favorites') || '[]');
} catch {
  localStorage.removeItem('dorado-tv:favorites');
}
const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites : []);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function setStatus(message, error = false) {
  const target = $('#status');
  target.textContent = message;
  target.classList.toggle('text-red-300', error);
  target.classList.toggle('text-slate-400', !error);
}

function setLoading(isLoading) {
  $('#loading').classList.toggle('hidden', !isLoading);
  $('#loading').classList.toggle('flex', isLoading);
}

function keyOf(channel) {
  return `${channel.group}\u0000${channel.name}`;
}

function stop() {
  playbackToken += 1;
  video.pause();
  if (hls) { hls.destroy(); hls = null; }
  if (ts) { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); ts = null; }
  video.removeAttribute('src');
  video.load();
  setLoading(false);
  $('#play').textContent = 'Reproducir';
}

function renderChannels() {
  const query = $('#search').value.trim().toLocaleLowerCase('es');
  const category = $('#category').value;
  filtered = channels.filter((channel) =>
    (!category || channel.group === category) &&
    (!onlyFavorites || favorites.has(keyOf(channel))) &&
    (!query || `${channel.name} ${channel.group}`.toLocaleLowerCase('es').includes(query))
  );
  $('#count').textContent = `${filtered.length.toLocaleString('es')} canales`;
  const shown = filtered.slice(0, visible);
  $('#channel-list').innerHTML = shown.length ? shown.map((channel) => {
    const selected = channel === active;
    return `<div role="listitem" class="flex items-center gap-2 rounded-xl border ${selected ? 'border-amber-400/60 bg-amber-400/10' : 'border-transparent hover:bg-slate-800'} p-2 transition">
      <button type="button" data-channel="${channel.id}" class="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
        ${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="h-10 w-10 shrink-0 rounded-lg bg-slate-800 object-contain p-1" />` : '<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-lg text-slate-500" aria-hidden="true">▣</span>'}
        <span class="min-w-0"><span class="block truncate text-sm font-semibold text-white">${escapeHtml(channel.name)}</span><span class="block truncate text-xs text-slate-400">${escapeHtml(channel.group)}</span></span>
      </button>
      <button type="button" data-favorite="${channel.id}" class="rounded-lg px-2 py-1 text-xl ${favorites.has(keyOf(channel)) ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-label="${favorites.has(keyOf(channel)) ? 'Quitar de' : 'Añadir a'} favoritos" aria-pressed="${favorites.has(keyOf(channel))}">${favorites.has(keyOf(channel)) ? '★' : '☆'}</button>
    </div>`;
  }).join('') : '<p class="p-5 text-center text-sm text-slate-400">No hay canales para este filtro.</p>';
  $('#more-wrap').classList.toggle('hidden', filtered.length <= visible);
}

function setPlaylist(next, label) {
  stop();
  channels = next;
  active = null;
  visible = 80;
  $('#now-name').textContent = 'Ningún canal seleccionado';
  $('#empty').classList.remove('hidden');
  const options = groupsFor(channels).map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('');
  $('#category').innerHTML = `<option value="">Todas las categorías</option>${options}`;
  $('#search').value = '';
  onlyFavorites = false;
  $('#favorites').setAttribute('aria-pressed', 'false');
  $('#favorites').textContent = '☆ Favoritos';
  renderChannels();
  setStatus(channels.length ? `${channels.length.toLocaleString('es')} canales cargados desde ${label}. Selecciona uno para reproducir.` : 'La lista no contiene canales HTTP o HTTPS válidos.', !channels.length);
}

async function play(channel) {
  if (!channel) return;
  stop();
  const token = playbackToken;
  active = channel;
  $('#now-name').textContent = channel.name;
  document.title = `${channel.name} · Dorado TV`;
  $('#empty').classList.add('hidden');
  renderChannels();
  setLoading(true);
  setStatus(`Conectando con ${channel.name}…`);
  if (location.protocol === 'https:' && channel.url.startsWith('http:')) {
    setLoading(false);
    setStatus('Este canal usa HTTP y el navegador puede bloquearlo en una página HTTPS. Necesita una URL HTTPS o un relay externo.', true);
    return;
  }

  try {
    const path = new URL(channel.url).pathname.toLowerCase();
    if (path.endsWith('.m3u8')) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = channel.url;
      } else {
        const { default: Hls } = await import('hls.js');
        if (token !== playbackToken) return;
        if (!Hls.isSupported()) throw new Error('Este navegador no admite HLS.');
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal && token === playbackToken) {
            setLoading(false);
            setStatus('No se pudo reproducir el HLS. Comprueba la señal y los permisos CORS del servidor.', true);
          }
        });
        hls.loadSource(channel.url);
        hls.attachMedia(video);
      }
    } else if (path.endsWith('.ts')) {
      const { default: mpegts } = await import('mpegts.js');
      if (token !== playbackToken) return;
      if (!mpegts.getFeatureList().mseLivePlayback) throw new Error('Este navegador no admite MPEG-TS.');
      ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: channel.url });
      ts.attachMediaElement(video);
      ts.load();
    } else {
      video.src = channel.url;
    }
    await video.play();
    if (token !== playbackToken) return;
    setLoading(false);
    $('#play').textContent = 'Pausar';
    setStatus(`Reproduciendo ${channel.name}.`);
  } catch (error) {
    if (token !== playbackToken) return;
    setLoading(false);
    setStatus(error?.name === 'NotAllowedError' ? 'Pulsa Reproducir para iniciar el canal.' : 'No se pudo reproducir este canal. Comprueba la señal, HTTPS y CORS.', error?.name !== 'NotAllowedError');
  }
}

$('#unlock-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const passwordInput = $('#playlist-password');
  const password = passwordInput.value;
  const button = $('#unlock');
  button.disabled = true;
  button.classList.add('opacity-60');
  setStatus('Descargando y descifrando la lista…');
  try {
    const response = await fetch('/playlist.enc.json', { cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('No está publicado el archivo playlist.enc.json.');
    }
    const plaintext = await decryptPlaylist(await response.json(), password);
    setPlaylist(parsePlaylist(plaintext), 'el archivo cifrado');
    passwordInput.value = '';
  } catch (error) {
    setStatus(error.message === 'No está publicado el archivo playlist.enc.json.' ? error.message : 'No se pudo desbloquear la lista. Comprueba el archivo cifrado y la clave.', true);
  } finally {
    button.disabled = false;
    button.classList.remove('opacity-60');
  }
});

$('#channel-list').addEventListener('click', (event) => {
  const favoriteButton = event.target.closest('[data-favorite]');
  const channelButton = event.target.closest('[data-channel]');
  const id = Number((favoriteButton || channelButton)?.dataset.favorite || channelButton?.dataset.channel);
  const channel = channels.find((item) => item.id === id);
  if (!channel) return;
  if (favoriteButton) {
    const key = keyOf(channel);
    if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
    localStorage.setItem('dorado-tv:favorites', JSON.stringify([...favorites]));
    renderChannels();
  } else {
    play(channel);
  }
});

$('#search').addEventListener('input', () => { visible = 80; renderChannels(); });
$('#category').addEventListener('change', () => { visible = 80; renderChannels(); });
$('#favorites').addEventListener('click', () => {
  onlyFavorites = !onlyFavorites;
  $('#favorites').setAttribute('aria-pressed', String(onlyFavorites));
  $('#favorites').textContent = onlyFavorites ? '★ Favoritos' : '☆ Favoritos';
  visible = 80;
  renderChannels();
});
$('#more').addEventListener('click', () => { visible += 80; renderChannels(); });
$('#play').addEventListener('click', () => {
  if (!active) { setStatus('Selecciona un canal de la lista.'); return; }
  if (video.paused && video.currentSrc) video.play().catch(() => play(active));
  else if (!video.paused) video.pause();
  else play(active);
});
$('#prev').addEventListener('click', () => {
  if (!channels.length) return;
  const current = channels.indexOf(active);
  play(channels[(current - 1 + channels.length) % channels.length]);
});
$('#next').addEventListener('click', () => {
  if (!channels.length) return;
  play(channels[(channels.indexOf(active) + 1) % channels.length]);
});
$('#volume').addEventListener('input', (event) => { video.volume = Number(event.target.value); });
$('#pip').addEventListener('click', async () => {
  if (!document.pictureInPictureEnabled || !video.currentSrc) { setStatus('La ventana flotante no está disponible en este navegador.'); return; }
  try { await (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()); }
  catch { setStatus('No se pudo abrir la ventana flotante.', true); }
});
$('#fullscreen').addEventListener('click', async () => {
  try { await (document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen()); }
  catch { setStatus('No se pudo activar la pantalla completa.', true); }
});
video.addEventListener('play', () => { $('#play').textContent = 'Pausar'; });
video.addEventListener('pause', () => { $('#play').textContent = 'Reproducir'; });
video.addEventListener('waiting', () => setLoading(true));
video.addEventListener('playing', () => setLoading(false));
video.addEventListener('error', () => { if (active) { setLoading(false); setStatus('El navegador no pudo abrir la emisión. Comprueba la señal, HTTPS y CORS.', true); } });
window.addEventListener('pagehide', stop);
