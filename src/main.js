import './main.css';
import { createMorph, canonicalD } from 'morphicons/dom';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, PictureInPicture2,
  Maximize, Minimize, Star, StarOff, TvMinimal, Upload, Check,
  LogOut, LockKeyhole, X, FileUp, Search,
} from 'lucide';
import { encryptPlaylist, decryptPlaylist } from './crypto.js';
import { groupsFor, parsePlaylist } from './playlist.js';

const app = document.querySelector('#app');
const API = '/.netlify/functions/playlist';
const AUTH_API = '/.netlify/functions/auth';
const CHUNK_SIZE = 512 * 1024;

function iconSvg(icon, classes = 'h-5 w-5') {
  const body = icon.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([key, value]) => `${key}="${value}"`).join(' ')} />`).join('');
  return `<svg class="${classes}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

function morphSvg(icon, id, classes = 'h-5 w-5') {
  return `<svg class="${classes}" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path id="${id}" d="${canonicalD(icon)}" /></svg>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function api(action, options = {}) {
  const response = await fetch(`${options.auth ? AUTH_API : API}?action=${encodeURIComponent(action)}${options.query || ''}`, {
    method: options.method || 'GET',
    body: options.body,
    headers: options.headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const error = new Error(detail.error || 'No se pudo completar la operación.');
    error.status = response.status;
    throw error;
  }
  return options.text ? response.text() : response.json();
}

function showLogin(message = '') {
  app.innerHTML = `
    <main class="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <section class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl shadow-black/30 sm:p-9" aria-labelledby="login-title">
        <div class="mb-7 flex items-center gap-3"><span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-2xl font-black text-slate-950" aria-hidden="true">D</span><span class="text-xl font-black tracking-tight text-white">Dorado TV</span></div>
        <div class="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 text-amber-400">${iconSvg(LockKeyhole, 'h-6 w-6')}</div>
        <h1 id="login-title" class="text-2xl font-bold text-white">Iniciar sesión</h1>
        <p class="mt-2 text-sm text-slate-400">Accede a tus canales con tu cuenta.</p>
        <form id="login-form" class="mt-7 space-y-4">
          <div><label for="username" class="mb-1.5 block text-sm font-medium text-slate-200">Usuario</label><input id="username" name="username" type="text" required autocomplete="username" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white focus:border-amber-400 focus:outline-none" /></div>
          <div><label for="password" class="mb-1.5 block text-sm font-medium text-slate-200">Contraseña</label><input id="password" name="password" type="password" required autocomplete="current-password" class="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white focus:border-amber-400 focus:outline-none" /></div>
          <button id="login-submit" type="submit" class="w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">Entrar</button>
        </form>
        <p id="login-error" class="mt-4 min-h-5 text-sm text-red-300" role="alert">${escapeHtml(message)}</p>
      </section>
    </main>`;
  app.querySelector('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = app.querySelector('#login-submit');
    const error = app.querySelector('#login-error');
    button.disabled = true;
    button.textContent = 'Entrando…';
    error.textContent = '';
    try {
      await api('login', { auth: true, method: 'POST', body: JSON.stringify({ username: app.querySelector('#username').value.trim(), password: app.querySelector('#password').value }), headers: { 'Content-Type': 'application/json' } });
      const session = await api('session');
      mountPlayer(session);
    } catch (cause) {
      error.textContent = cause.message || 'No se pudo iniciar sesión.';
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
}

function mountPlayer(session) {
  app.innerHTML = `
  <div class="mx-auto flex min-h-screen w-full flex-col px-4 pb-8 pt-5 text-slate-100 sm:px-6 lg:px-8">
    <header class="mb-6 flex items-center justify-between gap-4 border-b border-slate-800 pb-5">
      <div class="flex items-center gap-3"><span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-2xl font-black text-slate-950 shadow-lg shadow-amber-500/20" aria-hidden="true">D</span><h1 class="text-2xl font-black tracking-tight text-white">Dorado TV</h1></div>
      <button id="logout" type="button" title="Cerrar sesión" aria-label="Cerrar sesión" class="rounded-xl border border-slate-700 p-2.5 text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(LogOut)}</button>
    </header>
    <main class="flex flex-1 flex-col gap-5">
      <section class="min-w-0 space-y-5" aria-label="Reproductor">
        <div class="overflow-hidden rounded-3xl border border-slate-800 bg-black shadow-2xl shadow-black/30">
          <div class="relative aspect-video bg-black">
            <video id="video" class="h-full w-full object-contain" playsinline preload="none" aria-label="Vídeo del canal seleccionado"></video>
            <div id="empty" class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center">
              <div class="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10 text-amber-300">${iconSvg(TvMinimal, 'h-8 w-8')}</div>
              <h2 class="text-lg font-bold text-white">Selecciona un canal</h2>
              <p class="max-w-md text-sm text-slate-400">Elige qué quieres ver.</p>
            </div>
            <div id="loading" class="absolute inset-0 hidden items-center justify-center bg-black/70" role="status"><span class="rounded-full border border-slate-600 bg-slate-900/90 px-4 py-2 text-sm text-white">Cargando emisión…</span></div>
          </div>
          <div class="flex flex-wrap items-center gap-2 border-t border-slate-800 bg-slate-900/80 p-3 sm:p-4">
            <button id="prev" type="button" title="Canal anterior" aria-label="Canal anterior" class="rounded-xl border border-slate-700 p-2.5 text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(SkipBack)}</button>
            <button id="play" type="button" title="Reproducir" aria-label="Reproducir" class="rounded-xl bg-amber-400 p-2.5 text-slate-950 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">${morphSvg(Play, 'play-icon')}</button>
            <button id="next" type="button" title="Canal siguiente" aria-label="Canal siguiente" class="rounded-xl border border-slate-700 p-2.5 text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(SkipForward)}</button>
            <label class="ml-auto flex items-center gap-2 text-slate-300">${iconSvg(Volume2, 'h-4 w-4')}<span class="sr-only">Volumen</span><input id="volume" class="w-20 accent-amber-400 sm:w-28" type="range" min="0" max="1" step="0.05" value="0.8" aria-label="Volumen" /></label>
            <button id="pip" type="button" title="Ventana flotante" aria-label="Ventana flotante" class="rounded-xl border border-slate-700 p-2.5 text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(PictureInPicture2)}</button>
            <button id="fullscreen" type="button" title="Pantalla completa" aria-label="Pantalla completa" class="rounded-xl border border-slate-700 p-2.5 text-slate-200 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${morphSvg(Maximize, 'fullscreen-icon')}</button>
          </div>
        </div>
        <div class="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5"><p class="text-xs font-semibold uppercase tracking-widest text-amber-400">En directo</p><h2 id="now-name" class="mt-1 truncate text-xl font-bold text-white">Ningún canal seleccionado</h2><p id="status" class="mt-2 text-sm text-slate-400" role="status" aria-live="polite"></p></div>
      </section>
      <aside class="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70" aria-label="Canales">
        <div class="border-b border-slate-800 p-4 sm:p-5"><div class="mb-4 flex items-center justify-between gap-2"><h2 class="text-lg font-bold text-white">Canales</h2><span id="count" class="text-xs text-slate-400">0 canales</span></div><label for="search" class="sr-only">Buscar canales</label><div class="relative text-slate-400"><span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">${iconSvg(Search, 'h-4 w-4')}</span><input id="search" type="search" placeholder="Buscar canal o categoría…" class="w-full rounded-xl border border-slate-700 bg-slate-950 py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" /></div><div class="mt-3 flex gap-2"><label for="category" class="sr-only">Filtrar categoría</label><select id="category" class="min-w-0 flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-amber-400 focus:outline-none"><option value="">Todas las categorías</option></select><button id="favorites" type="button" class="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm font-medium text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400" aria-pressed="false">${morphSvg(StarOff, 'favorites-icon', 'h-4 w-4')}<span>Favoritos</span></button></div></div>
        <div id="channel-list" class="grid min-h-64 grid-cols-1 content-start gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="list"><p class="p-5 text-center text-sm text-slate-400">Los canales aparecerán aquí.</p></div><div id="more-wrap" class="hidden border-t border-slate-800 p-3"><button id="more" type="button" class="w-full rounded-xl border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">Mostrar más canales</button></div>
      </aside>
    </main>
    <div class="group fixed bottom-5 left-5 z-40"><button id="upload-open" type="button" aria-label="Subir lista de canales" aria-haspopup="dialog" title="Subir lista de canales" class="flex h-12 w-12 items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-slate-950 shadow-xl shadow-black/40 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">${morphSvg(Upload, 'upload-icon')}</button><span role="tooltip" class="pointer-events-none absolute bottom-14 left-0 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">Subir lista de canales</span></div>
    <div id="upload-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div class="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7"><div class="flex items-center justify-between gap-4"><div class="flex items-center gap-3 text-amber-400">${iconSvg(FileUp, 'h-6 w-6')}<h2 id="upload-title" class="text-xl font-bold text-white">Subir lista</h2></div><button id="upload-close" type="button" title="Cerrar" aria-label="Cerrar" class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">${iconSvg(X)}</button></div><p class="mt-3 text-sm text-slate-400">Selecciona el archivo. Se guardará cifrado y quedará disponible al iniciar sesión.</p><form id="upload-form" class="mt-5 space-y-4"><div><label for="upload-file" class="mb-1.5 block text-sm font-medium text-slate-200">Archivo de canales</label><input id="upload-file" type="file" accept=".m3u,.m3u8,text/plain" required class="block w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-600" /></div><p id="upload-status" class="min-h-5 text-sm text-slate-400" role="status" aria-live="polite"></p><button id="upload-submit" type="submit" class="w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60">Guardar lista</button></form></div></div>
  </div>`;

  const $ = (selector) => app.querySelector(selector);
  const video = $('#video');
  const playMorph = createMorph($('#play-icon'), Play, { reducedMotion: 'user' });
  const fullscreenMorph = createMorph($('#fullscreen-icon'), Maximize, { reducedMotion: 'user' });
  const favoritesMorph = createMorph($('#favorites-icon'), StarOff, { reducedMotion: 'user' });
  const uploadMorph = createMorph($('#upload-icon'), Upload, { reducedMotion: 'user' });
  let channels = [];
  let filtered = [];
  let active = null;
  let hls = null;
  let ts = null;
  let visible = 80;
  let onlyFavorites = false;
  let playbackToken = 0;
  let playlistKey = null;
  let savedFavorites = [];
  try { savedFavorites = JSON.parse(localStorage.getItem('dorado-tv:favorites') || '[]'); } catch { localStorage.removeItem('dorado-tv:favorites'); }
  const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites : []);

  function setStatus(message, error = false) {
    const target = $('#status');
    target.textContent = message;
    target.classList.toggle('text-red-300', error);
    target.classList.toggle('text-slate-400', !error);
  }
  function setLoading(loading) {
    $('#loading').classList.toggle('hidden', !loading);
    $('#loading').classList.toggle('flex', loading);
  }
  function setPlayIcon(isPlaying) {
    playMorph.morphTo(isPlaying ? Pause : Play, 'snappy');
    $('#play').setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    $('#play').title = isPlaying ? 'Pausar' : 'Reproducir';
  }
  function keyOf(channel) { return `${channel.group}\u0000${channel.name}`; }
  function stop() {
    playbackToken += 1;
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    if (ts) { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); ts = null; }
    video.removeAttribute('src');
    video.load();
    setLoading(false);
    setPlayIcon(false);
  }
  function renderChannels() {
    const query = $('#search').value.trim().toLocaleLowerCase('es');
    const category = $('#category').value;
    filtered = channels.filter((channel) => (!category || channel.group === category) && (!onlyFavorites || favorites.has(keyOf(channel))) && (!query || `${channel.name} ${channel.group}`.toLocaleLowerCase('es').includes(query)));
    $('#count').textContent = `${filtered.length.toLocaleString('es')} canales`;
    const shown = filtered.slice(0, visible);
    $('#channel-list').innerHTML = shown.length ? shown.map((channel) => {
      const selected = channel === active;
      const favorite = favorites.has(keyOf(channel));
      return `<div role="listitem" class="flex items-center gap-2 rounded-xl border ${selected ? 'border-amber-400/60 bg-amber-400/10' : 'border-transparent hover:bg-slate-800'} p-2 transition"><button type="button" data-channel="${channel.id}" class="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="h-10 w-10 shrink-0 rounded-lg bg-slate-800 object-contain p-1" />` : `<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-slate-500" aria-hidden="true">${iconSvg(TvMinimal, 'h-5 w-5')}</span>`}<span class="min-w-0"><span class="block truncate text-sm font-semibold text-white">${escapeHtml(channel.name)}</span><span class="block truncate text-xs text-slate-400">${escapeHtml(channel.group)}</span></span></button><button type="button" data-favorite="${channel.id}" title="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-label="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-pressed="${favorite}" class="rounded-lg p-2 ${favorite ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(favorite ? Star : StarOff, 'h-5 w-5')}</button></div>`;
    }).join('') : '<p class="p-5 text-center text-sm text-slate-400">No hay canales para este filtro.</p>';
    $('#more-wrap').classList.toggle('hidden', filtered.length <= visible);
  }
  function setPlaylist(next) {
    stop();
    channels = next;
    active = null;
    visible = 80;
    $('#now-name').textContent = 'Ningún canal seleccionado';
    $('#empty').classList.remove('hidden');
    $('#category').innerHTML = `<option value="">Todas las categorías</option>${groupsFor(channels).map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('')}`;
    $('#search').value = '';
    onlyFavorites = false;
    $('#favorites').setAttribute('aria-pressed', 'false');
    favoritesMorph.morphTo(StarOff, 'snappy');
    renderChannels();
    setStatus(channels.length ? `${channels.length.toLocaleString('es')} canales disponibles. Selecciona uno para reproducir.` : 'La lista no contiene canales válidos.', !channels.length);
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
    if (location.protocol === 'https:' && channel.url.startsWith('http:')) { setLoading(false); setStatus('Este canal necesita una señal HTTPS para reproducirse aquí.', true); return; }
    try {
      const path = new URL(channel.url).pathname.toLowerCase();
      if (path.endsWith('.m3u8')) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = channel.url;
        else {
          const { default: Hls } = await import('hls.js');
          if (token !== playbackToken) return;
          if (!Hls.isSupported()) throw new Error('HLS no disponible');
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal && token === playbackToken) { setLoading(false); setStatus('No se pudo reproducir el canal. Comprueba la señal.', true); } });
          hls.loadSource(channel.url);
          hls.attachMedia(video);
        }
      } else if (path.endsWith('.ts')) {
        const { default: mpegts } = await import('mpegts.js');
        if (token !== playbackToken) return;
        if (!mpegts.getFeatureList().mseLivePlayback) throw new Error('MPEG-TS no disponible');
        ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: channel.url });
        ts.attachMediaElement(video);
        ts.load();
      } else video.src = channel.url;
      await video.play();
      if (token !== playbackToken) return;
      setLoading(false);
      setStatus(`Reproduciendo ${channel.name}.`);
    } catch (error) {
      if (token !== playbackToken) return;
      setLoading(false);
      setStatus(error?.name === 'NotAllowedError' ? 'Pulsa Reproducir para iniciar el canal.' : 'No se pudo reproducir este canal. Comprueba la señal.', error?.name !== 'NotAllowedError');
    }
  }

  $('#logout').addEventListener('click', async () => { stop(); await api('logout', { auth: true, method: 'POST' }).catch(() => {}); location.reload(); });
  async function getKey() {
    if (!playlistKey) playlistKey = (await api('key')).key;
    return playlistKey;
  }
  async function loadPlaylist() {
    setStatus('Cargando canales…');
    try {
      const manifest = await api('manifest');
      const parts = [];
      for (let index = 0; index < manifest.count; index += 1) parts.push(await api('chunk', { query: `&index=${index}`, text: true }));
      const plaintext = await decryptPlaylist(JSON.parse(parts.join('')), await getKey());
      setPlaylist(parsePlaylist(plaintext));
    } catch (error) {
      setStatus(error.status === 404 ? 'Aún no hay una lista de canales.' : error.message?.includes('no compatible') ? 'Vuelve a subir la lista para activar el acceso automático.' : 'No se pudo cargar la lista de canales.', true);
    }
  }
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
    } else play(channel);
  });
  $('#search').addEventListener('input', () => { visible = 80; renderChannels(); });
  $('#category').addEventListener('change', () => { visible = 80; renderChannels(); });
  $('#favorites').addEventListener('click', () => { onlyFavorites = !onlyFavorites; $('#favorites').setAttribute('aria-pressed', String(onlyFavorites)); favoritesMorph.morphTo(onlyFavorites ? Star : StarOff, 'snappy'); visible = 80; renderChannels(); });
  $('#more').addEventListener('click', () => { visible += 80; renderChannels(); });
  $('#play').addEventListener('click', () => { if (!active) { setStatus('Selecciona un canal.'); return; } if (video.paused && video.currentSrc) video.play().catch(() => play(active)); else if (!video.paused) video.pause(); else play(active); });
  $('#prev').addEventListener('click', () => { if (channels.length) play(channels[(channels.indexOf(active) - 1 + channels.length) % channels.length]); });
  $('#next').addEventListener('click', () => { if (channels.length) play(channels[(channels.indexOf(active) + 1) % channels.length]); });
  $('#volume').addEventListener('input', (event) => { video.volume = Number(event.target.value); });
  $('#pip').addEventListener('click', async () => { if (!document.pictureInPictureEnabled || !video.currentSrc) { setStatus('La ventana flotante no está disponible.'); return; } try { await (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()); } catch { setStatus('No se pudo abrir la ventana flotante.', true); } });
  $('#fullscreen').addEventListener('click', async () => { try { await (document.fullscreenElement ? document.exitFullscreen() : video.requestFullscreen()); } catch { setStatus('No se pudo activar la pantalla completa.', true); } });
  document.addEventListener('fullscreenchange', () => fullscreenMorph.morphTo(document.fullscreenElement ? Minimize : Maximize, 'snappy'));
  video.addEventListener('play', () => setPlayIcon(true));
  video.addEventListener('pause', () => setPlayIcon(false));
  video.addEventListener('waiting', () => setLoading(true));
  video.addEventListener('playing', () => setLoading(false));
  video.addEventListener('error', () => { if (active) { setLoading(false); setStatus('El navegador no pudo abrir la emisión.', true); } });
  window.addEventListener('pagehide', stop, { once: true });

  const modal = $('#upload-modal');
  const closeUpload = () => { modal.classList.add('hidden'); modal.classList.remove('flex'); $('#upload-form').reset(); $('#upload-status').textContent = ''; $('#upload-open').focus(); };
  $('#upload-open').addEventListener('click', () => { modal.classList.remove('hidden'); modal.classList.add('flex'); $('#upload-file').focus(); });
  $('#upload-close').addEventListener('click', closeUpload);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeUpload(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeUpload(); });
  $('#upload-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = $('#upload-file').files?.[0];
    const status = $('#upload-status');
    const button = $('#upload-submit');
    if (!file || file.size > 24 * 1024 * 1024) { status.textContent = 'Selecciona un archivo de hasta 24 MB.'; return; }
    button.disabled = true;
    try {
      status.textContent = 'Preparando lista…';
      const source = await file.text();
      const parsed = parsePlaylist(source);
      if (!parsed.length) throw new Error('El archivo no contiene canales válidos.');
      const encrypted = JSON.stringify(await encryptPlaylist(source, await getKey()));
      const count = Math.ceil(encrypted.length / CHUNK_SIZE);
      if (count > 64) throw new Error('La lista es demasiado grande.');
      const batch = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-upload`;
      for (let index = 0; index < count; index += 1) {
        status.textContent = `Subiendo lista: ${index + 1} de ${count}…`;
        await api('chunk', { method: 'POST', query: `&batch=${encodeURIComponent(batch)}&index=${index}`, body: encrypted.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE), headers: { 'Content-Type': 'text/plain' } });
      }
      await api('commit', { method: 'POST', body: JSON.stringify({ batch, count }), headers: { 'Content-Type': 'application/json' } });
      setPlaylist(parsed);
      status.textContent = 'Lista guardada.';
      uploadMorph.morphTo(Check, 'snappy');
      setTimeout(() => { closeUpload(); uploadMorph.morphTo(Upload, 'snappy'); }, 900);
    } catch (error) { status.textContent = error.message || 'No se pudo subir la lista.'; }
    finally { button.disabled = false; }
  });
  if (session.hasPlaylist) loadPlaylist();
  else setStatus('Aún no hay canales. Puedes subir tu lista con el botón inferior.');
}

showLogin();
(async () => {
  try {
    await api('session', { auth: true });
    mountPlayer(await api('session'));
  } catch (error) {
    if (error.status !== 401) showLogin('No se pudo comprobar la sesión.');
  }
})();
