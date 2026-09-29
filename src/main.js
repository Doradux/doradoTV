import './main.css';
import { createMorph, canonicalD } from 'morphicons/dom';
import {
  Play, Pause, Volume2, VolumeX, PictureInPicture2, PictureInPicture,
  RectangleHorizontal, PanelRightClose, ChevronDown, Radio,
  Maximize, Minimize, Star, StarOff, TvMinimal, Upload, Check,
  LogOut, LockKeyhole, X, FileUp, Search,
  Users, UserPlus, Trash2, Pencil, Shield,
} from 'lucide';
import { encryptPlaylist, decryptPlaylist } from './crypto.js';
import { groupsFor, parsePlaylist } from './playlist.js';
import { createAmbientLight } from './ambient.js';

const app = document.querySelector('#app');
const API = '/.netlify/functions/playlist';
const AUTH_API = '/.netlify/functions/auth';
const RELAY_API = '/.netlify/functions/relay';
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
  const response = await fetch(`${options.auth ? AUTH_API : options.relay ? RELAY_API : API}?action=${encodeURIComponent(action)}${options.query || ''}`, {
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
    <main class="login-screen flex min-h-screen items-center justify-center bg-slate-950 px-4 py-8 text-slate-100">
      <section class="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 shadow-2xl shadow-black/30 sm:p-9" aria-labelledby="login-title">
        <div class="mb-7 flex items-center gap-3"><span class="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400 text-2xl font-black text-slate-950" aria-hidden="true">${iconSvg(TvMinimal, 'h-6 w-6')}</span><span class="text-xl font-black tracking-tight text-white">Dorado TV</span></div>
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
      const authSession = await api('session', { auth: true });
      const playlistSession = await api('session');
      mountPlayer({ ...playlistSession, username: authSession.username });
    } catch (cause) {
      error.textContent = cause.message || 'No se pudo iniciar sesión.';
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
}

function mountPlayer(session) {
  app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <a href="#" class="brand">
        <div>
          <span>Dorado<span class="brand-tv">TV</span></span>
        </div>
      </a>
      <div class="header-actions">
        <button id="logout" type="button" title="Cerrar sesión" aria-label="Cerrar sesión" class="rounded-xl border border-slate-700 p-2.5 text-slate-300 transition hover:border-amber-400 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">${iconSvg(LogOut)}</button>
      </div>
    </header>
    <main id="watch-layout" class="watch-layout">
      <section class="player-column" aria-label="Reproductor">
        <div id="player-shell" class="player-shell">
          <div id="video-stage" class="video-stage">
            <canvas id="ambient" width="96" height="54" aria-hidden="true"></canvas>
            <video id="video" playsinline preload="none" aria-label="Vídeo del canal seleccionado"></video>
            <div id="empty" class="empty-player">
              <div class="empty-icon">${iconSvg(TvMinimal, 'h-9 w-9')}</div>
              <span class="eyebrow">TU MOMENTO, TU CANAL</span>
              <h2>¿Qué te apetece ver?</h2>
              <p>Elige un canal y ponte cómodo.</p>
            </div>
            <div id="loading" class="absolute inset-0 z-10 hidden items-center justify-center bg-black/60" role="status"><span class="loading-label"><span class="loading-dot"></span>Conectando con la emisión…</span></div>
          </div>
          <div class="player-controls">
            <button id="play" type="button" title="Reproducir" aria-label="Reproducir" class="icon-button play-button">${morphSvg(Play, 'play-icon')}</button>
            <div class="volume-control"><button id="mute" type="button" title="Silenciar" aria-label="Silenciar" aria-pressed="false" class="icon-button">${morphSvg(Volume2, 'volume-icon')}</button><input id="volume" type="range" min="0" max="1" step="0.05" value="0.8" aria-label="Volumen" /></div>
            <span id="playback-badge" class="playback-badge">EN DIRECTO</span>
            <div class="view-controls">
              <button id="pip" type="button" title="Ventana flotante" aria-label="Ventana flotante" aria-pressed="false" class="icon-button">${morphSvg(PictureInPicture2, 'pip-icon')}</button>
              <button id="theater" type="button" title="Modo cine" aria-label="Modo cine" aria-pressed="false" aria-controls="watch-layout" class="icon-button">${morphSvg(RectangleHorizontal, 'theater-icon')}</button>
              <button id="fullscreen" type="button" title="Pantalla completa" aria-label="Pantalla completa" aria-pressed="false" class="icon-button">${morphSvg(Maximize, 'fullscreen-icon')}</button>
            </div>
          </div>
        </div>
        <div class="now-playing"><div class="now-symbol">${iconSvg(Radio, 'h-5 w-5')}</div><div class="min-w-0"><p class="eyebrow">AHORA EN TU PANTALLA</p><h2 id="now-name">Ningún canal seleccionado</h2><p id="status" role="status" aria-live="polite"></p></div></div>
        <section id="relay-panel" class="hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5" aria-label="Conexiones compartidas"><div class="flex items-center justify-between gap-3"><h2 class="font-bold text-white">Conexiones compartidas</h2><span id="relay-count" class="text-xs text-slate-400"></span></div><div id="relay-connections" class="mt-3 space-y-2 text-sm text-slate-300"></div></section>
      </section>
      <aside class="channel-panel" aria-label="Canales">
        <div class="channel-filters"><div class="channel-heading"><div><p class="eyebrow">EXPLORA TU LISTA</p><h2>Canales</h2></div><span id="count" class="channel-count">0 canales</span></div>
          <label for="search" class="sr-only">Buscar canales</label><div class="search-field">${iconSvg(Search, 'h-4 w-4')}<input id="search" type="search" placeholder="Buscar canal o categoría…" /></div>
          <div class="filter-row"><div class="category-field"><label for="category" class="sr-only">Filtrar categoría</label><select id="category"><option value="">Todas las categorías</option></select>${iconSvg(ChevronDown, 'h-4 w-4')}</div><button id="favorites" type="button" class="favorites-filter" title="Mostrar favoritos" aria-label="Mostrar favoritos" aria-pressed="false">${morphSvg(StarOff, 'favorites-icon', 'h-4 w-4')}<span>Favoritos</span></button></div>
        </div>
        <div id="channel-list" class="channel-list" role="list"><p class="list-empty">Los canales aparecerán aquí.</p></div><div id="more-wrap" class="hidden border-t border-slate-800 p-3"><button id="more" type="button" class="more-button">Mostrar más canales</button></div>
      </aside>
    </main>
    <div class="fixed bottom-5 left-5 z-40 flex items-center gap-3">
      <div class="group relative">
        <button id="upload-open" type="button" aria-label="Subir lista de canales" aria-haspopup="dialog" title="Subir lista de canales" class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-slate-950 shadow-xl shadow-black/40 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><span class="pointer-events-none flex items-center justify-center">${morphSvg(Upload, 'upload-icon')}</span></button>
        <span role="tooltip" class="pointer-events-none absolute bottom-14 left-0 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">Subir lista de canales</span>
      </div>
      <div class="group relative">
        <button id="users-open" type="button" aria-label="Gestionar accesos" aria-haspopup="dialog" title="Gestionar accesos" class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-amber-400 shadow-xl shadow-black/40 transition hover:border-amber-400 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><span class="pointer-events-none flex items-center justify-center">${iconSvg(Users, 'h-5 w-5')}</span></button>
        <span role="tooltip" class="pointer-events-none absolute bottom-14 left-0 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">Gestionar accesos</span>
      </div>
    </div>
    <div id="upload-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div class="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7"><div class="flex items-center justify-between gap-4"><div class="flex items-center gap-3 text-amber-400">${iconSvg(FileUp, 'h-6 w-6')}<h2 id="upload-title" class="text-xl font-bold text-white">Subir lista</h2></div><button id="upload-close" type="button" title="Cerrar" aria-label="Cerrar" class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">${iconSvg(X)}</button></div><p class="mt-3 text-sm text-slate-400">Selecciona el archivo. Se guardará cifrado y quedará disponible al iniciar sesión.</p><form id="upload-form" class="mt-5 space-y-4"><div><label for="upload-file" class="mb-1.5 block text-sm font-medium text-slate-200">Archivo de canales</label><input id="upload-file" type="file" accept=".m3u,.m3u8,text/plain" required class="block w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-600" /></div><p id="upload-status" class="min-h-5 text-sm text-slate-400" role="status" aria-live="polite"></p><button id="upload-submit" type="submit" class="w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60">Guardar lista</button></form></div></div>
    <div id="users-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="users-title">
      <div class="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div class="flex items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div class="flex items-center gap-3 text-amber-400">
            ${iconSvg(Users, 'h-6 w-6')}
            <h2 id="users-title" class="text-xl font-bold text-white">Gestionar accesos</h2>
          </div>
          <button id="users-close" type="button" title="Cerrar" aria-label="Cerrar" class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">${iconSvg(X)}</button>
        </div>
        <div class="my-4 flex-1 space-y-4 overflow-y-auto pr-1">
          <div>
            <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Accesos configurados</h3>
            <div id="users-list" class="space-y-2">
              <p class="py-3 text-center text-sm text-slate-400">Cargando accesos…</p>
            </div>
          </div>
          <div class="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
            <h3 class="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <span id="user-form-icon">${iconSvg(UserPlus, 'h-4 w-4 text-amber-400')}</span>
              <span id="user-form-heading">Crear nuevo acceso</span>
            </h3>
            <form id="user-form" class="space-y-3">
              <input type="hidden" id="user-edit-orig" value="" />
              <div>
                <label for="user-username" class="mb-1 block text-xs font-medium text-slate-300">Usuario</label>
                <input id="user-username" type="text" required autocomplete="off" placeholder="Nombre de usuario" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" />
              </div>
              <div>
                <label for="user-password" id="user-password-label" class="mb-1 block text-xs font-medium text-slate-300">Contraseña</label>
                <input id="user-password" type="password" required autocomplete="new-password" placeholder="Contraseña (mínimo 4 caracteres)" class="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none" />
              </div>
              <p id="users-status" class="min-h-5 text-xs text-slate-400" role="status" aria-live="polite"></p>
              <div class="flex gap-2">
                <button id="user-submit" type="submit" class="flex-1 rounded-xl bg-amber-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60">Crear acceso</button>
                <button id="user-cancel-edit" type="button" class="hidden rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-500 hover:text-white">Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  const $ = (selector) => app.querySelector(selector);
  const video = $('#video');
  const ambient = createAmbientLight(video, $('#ambient'), $('#video-stage'));
  const channelMorphs = new Map();
  const theaterMorph = createMorph($('#theater-icon'), RectangleHorizontal, { reducedMotion: 'user' });
  const volumeMorph = createMorph($('#volume-icon'), Volume2, { reducedMotion: 'user' });
  const pipMorph = createMorph($('#pip-icon'), PictureInPicture2, { reducedMotion: 'user' });
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
  let relayEnabled = false;
  let relaySession = null;
  const tabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const relayApi = (action, options = {}) => api(action, { ...options, relay: true });
  const relayReady = relayApi('config').then(({ enabled }) => {
    relayEnabled = enabled;
    $('#relay-panel').classList.toggle('hidden', !enabled);
    if (enabled) refreshConnections();
  }).catch(() => {});
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
    $('#playback-badge').classList.toggle('is-playing', isPlaying);
    $('#play').setAttribute('aria-label', isPlaying ? 'Pausar' : 'Reproducir');
    $('#play').title = isPlaying ? 'Pausar' : 'Reproducir';
  }
  function keyOf(channel) { return `${channel.group}\u0000${channel.name}`; }
  function stop() {
    playbackToken += 1;
    if (relaySession) {
      const sessionId = relaySession;
      relaySession = null;
      relayApi('ping', { method: 'POST', body: JSON.stringify({ session_id: sessionId, is_playing: false }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    }
    ambient.reset();
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    if (ts) { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); ts = null; }
    video.removeAttribute('src');
    video.load();
    setLoading(false);
    setPlayIcon(false);
  }
  const AVATAR_BG = [
    'bg-amber-400 text-slate-950',
    'bg-sky-400 text-slate-950',
    'bg-emerald-400 text-slate-950',
    'bg-violet-400 text-white',
    'bg-rose-400 text-white',
    'bg-indigo-400 text-white',
  ];
  function avatarColor(name = '') {
    let hash = 0;
    for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return AVATAR_BG[hash % AVATAR_BG.length];
  }
  function renderUserAvatars(users = []) {
    if (!users.length) return '';
    const list = users.slice(0, 3);
    const remaining = users.length - list.length;
    const styles = [
      'z-30 opacity-100 scale-100',
      'z-20 opacity-[0.85] scale-[0.90]',
      'z-10 opacity-[0.70] scale-[0.80]',
    ];
    const items = list.map((user, idx) => {
      const initial = escapeHtml((user.name || '?')[0].toUpperCase());
      const name = escapeHtml(user.name || 'Usuario');
      const posStyle = styles[idx] || styles[2];
      const color = avatarColor(user.name || '');
      return `<span class="group/avatar relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-900 font-bold text-xs uppercase shadow-sm transition-all duration-200 ${posStyle} group-hover/stack:opacity-100 group-hover/stack:scale-100 hover:!opacity-100 hover:!scale-105 hover:!z-40 ${color}"><span class="pointer-events-none select-none">${initial}</span><span role="tooltip" class="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white shadow-xl opacity-0 transition-opacity duration-150 group-hover/avatar:opacity-100 z-50">${name}</span></span>`;
    });
    if (remaining > 0) {
      items.push(`<span class="group/avatar relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-slate-900 bg-slate-800 text-[10px] font-bold text-slate-300 shadow-sm transition-all duration-200 z-0 opacity-[0.60] scale-[0.75] group-hover/stack:opacity-100 group-hover/stack:scale-100 hover:!opacity-100 hover:!scale-105 hover:!z-40"><span class="pointer-events-none select-none">+${remaining}</span><span role="tooltip" class="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white shadow-xl opacity-0 transition-opacity duration-150 group-hover/avatar:opacity-100 z-50">+${remaining} más</span></span>`);
    }
    return `<div class="group/stack flex items-center -space-x-2 py-0.5">${items.join('')}</div>`;
  }
  async function refreshConnections() {
    if (!relayEnabled) return;
    try {
      const data = await relayApi('status');
      $('#relay-count').textContent = `${data.active_count}/${data.max_connections} canales`;
      $('#relay-connections').innerHTML = data.connections.length ? data.connections.map((connection) => `<div class="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5"><div class="flex min-w-0 items-center gap-2 truncate"><strong class="truncate text-sm font-semibold text-white">${escapeHtml(connection.channel_name)}</strong>${connection.program ? `<span class="truncate text-xs text-slate-400">· ${escapeHtml(connection.program)}</span>` : ''}</div><div class="flex shrink-0 items-center gap-3">${renderUserAvatars(connection.users)}${connection.emission_id ? `<button type="button" data-close-emission="${escapeHtml(connection.emission_id)}" class="rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-300 transition hover:bg-rose-600 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-rose-300">Cerrar canal</button>` : ''}</div></div>`).join('') : '<p class="text-slate-400">No hay emisiones activas.</p>';
    } catch { $('#relay-count').textContent = 'Sin conexión'; }
  }
  function renderChannels() {
    const query = $('#search').value.trim().toLocaleLowerCase('es');
    const category = $('#category').value;
    filtered = channels.filter((channel) => (!category || channel.group === category) && (!onlyFavorites || favorites.has(keyOf(channel))) && (!query || `${channel.name} ${channel.group}`.toLocaleLowerCase('es').includes(query)));
    $('#count').textContent = `${filtered.length.toLocaleString('es')} canales`;
    const shown = filtered.slice(0, visible);
    channelMorphs.forEach((morph) => morph.destroy());
    channelMorphs.clear();
    $('#channel-list').innerHTML = shown.length ? shown.map((channel) => {
      const selected = channel === active;
      const favorite = favorites.has(keyOf(channel));
      return `<div role="listitem" class="channel-row ${selected ? 'is-selected' : ''}"><button type="button" data-channel="${channel.id}" aria-current="${selected ? 'true' : 'false'}" class="channel-select">${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="channel-logo" />` : `<span class="channel-logo" aria-hidden="true">${iconSvg(TvMinimal)}</span>`}<span class="channel-copy"><span class="channel-name">${escapeHtml(channel.name)}</span><span class="channel-group">${escapeHtml(channel.group)}</span></span>${selected ? `<span class="selected-indicator" aria-hidden="true">${iconSvg(Radio, 'h-4 w-4')}</span>` : ''}</button><button type="button" data-favorite="${channel.id}" title="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-label="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${escapeHtml(channel.name)}" aria-pressed="${favorite}" class="channel-favorite">${morphSvg(favorite ? Star : StarOff, `favorite-${channel.id}`, 'h-4 w-4')}</button></div>`;
    }).join('') : `<div class="list-empty">${iconSvg(Search, 'h-6 w-6')}<p>${channels.length ? 'No hay canales para este filtro.' : 'Tu lista empieza aquí.'}</p><span>${channels.length ? 'Prueba con otro nombre o categoría.' : 'Sube una lista para empezar a ver tus canales.'}</span></div>`;
    shown.forEach((channel) => channelMorphs.set(channel.id, createMorph($(`#favorite-${channel.id}`), favorites.has(keyOf(channel)) ? Star : StarOff, { reducedMotion: 'user' })));
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
    try {
      await relayReady;
      if (token !== playbackToken) return;
      let source = channel.url;
      if (relayEnabled) {
        const started = await relayApi('start', { method: 'POST', body: JSON.stringify({ channel: { url: channel.url, name: channel.name }, tab: tabId }), headers: { 'Content-Type': 'application/json' } });
        if (token !== playbackToken) {
          relayApi('ping', { method: 'POST', body: JSON.stringify({ session_id: started.session_id, is_playing: false }), headers: { 'Content-Type': 'application/json' } }).catch(() => {});
          return;
        }
        relaySession = started.session_id;
        source = started.playlist_url;
        refreshConnections();
        let ready = false;
        for (let attempt = 0; attempt < 36; attempt += 1) {
          if (token !== playbackToken) return;
          const state = await relayApi('ping', { method: 'POST', body: JSON.stringify({ session_id: started.session_id, is_playing: true }), headers: { 'Content-Type': 'application/json' } });
          if (state.status === 'running') { ready = true; break; }
          if (state.kicked || state.status === 'failed' || state.status === 'closed') throw new Error('El proveedor no está emitiendo este canal.');
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!ready) throw new Error('La señal no estuvo disponible a tiempo.');
      } else if (location.protocol === 'https:' && source.startsWith('http:')) throw new Error('Este canal necesita una señal HTTPS para reproducirse aquí.');
      const path = new URL(source).pathname.toLowerCase();
      if (path.endsWith('.m3u8')) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = source;
        else {
          const { default: Hls } = await import('hls.js');
          if (token !== playbackToken) return;
          if (!Hls.isSupported()) throw new Error('HLS no disponible');
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal && token === playbackToken) { setLoading(false); setStatus('No se pudo reproducir el canal. Comprueba la señal.', true); } });
          hls.loadSource(source);
          hls.attachMedia(video);
        }
      } else if (path.endsWith('.ts')) {
        const { default: mpegts } = await import('mpegts.js');
        if (token !== playbackToken) return;
        if (!mpegts.getFeatureList().mseLivePlayback) throw new Error('MPEG-TS no disponible');
        ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: source });
        ts.attachMediaElement(video);
        ts.load();
      } else video.src = source;
      await video.play();
      if (token !== playbackToken) return;
      setLoading(false);
      setStatus(`Reproduciendo ${channel.name}.`);
    } catch (error) {
      if (token !== playbackToken) return;
      if (relaySession) stop();
      setLoading(false);
      setStatus(error?.name === 'NotAllowedError' ? 'Pulsa Reproducir para iniciar el canal.' : error.message || 'No se pudo reproducir este canal. Comprueba la señal.', error?.name !== 'NotAllowedError');
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
      const favorite = favorites.has(key);
      favoriteButton.setAttribute('aria-pressed', String(favorite));
      favoriteButton.title = favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
      favoriteButton.setAttribute('aria-label', `${favoriteButton.title}: ${channel.name}`);
      channelMorphs.get(channel.id)?.morphTo(favorite ? Star : StarOff, 'snappy');
      if (onlyFavorites) setTimeout(renderChannels, 250);
    } else play(channel);
  });
  $('#search').addEventListener('input', () => { visible = 80; renderChannels(); });
  $('#category').addEventListener('change', () => { visible = 80; renderChannels(); });
  $('#favorites').addEventListener('click', () => { onlyFavorites = !onlyFavorites; $('#favorites').setAttribute('aria-pressed', String(onlyFavorites)); favoritesMorph.morphTo(onlyFavorites ? Star : StarOff, 'snappy'); visible = 80; renderChannels(); });
  $('#more').addEventListener('click', () => { visible += 80; renderChannels(); });
  $('#play').addEventListener('click', () => { if (!active) { setStatus('Selecciona un canal.'); return; } if (!video.paused) { stop(); setStatus('Emisión pausada.'); } else if (relayEnabled) play(active); else if (video.currentSrc) video.play().catch(() => play(active)); else play(active); });
  $('#relay-connections').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-close-emission]');
    if (!button) return;
    button.disabled = true;
    try {
      await relayApi('close', { method: 'POST', body: JSON.stringify({ emission_id: button.dataset.closeEmission }), headers: { 'Content-Type': 'application/json' } });
      await refreshConnections();
    } catch (error) { setStatus(error.message, true); button.disabled = false; }
  });
  $('#theater').addEventListener('click', () => {
    const enabled = $('#watch-layout').classList.toggle('is-theater');
    $('#theater').setAttribute('aria-pressed', String(enabled));
    $('#theater').title = enabled ? 'Vista normal' : 'Modo cine';
    $('#theater').setAttribute('aria-label', $('#theater').title);
    theaterMorph.morphTo(enabled ? PanelRightClose : RectangleHorizontal, 'snappy');
  });
  video.volume = Number($('#volume').value);
  const updateVolume = () => {
    const muted = video.muted || video.volume === 0;
    volumeMorph.morphTo(muted ? VolumeX : Volume2, 'snappy');
    $('#mute').setAttribute('aria-pressed', String(muted));
    $('#mute').title = muted ? 'Activar sonido' : 'Silenciar';
    $('#mute').setAttribute('aria-label', $('#mute').title);
    $('#volume').value = video.muted ? 0 : video.volume;
    $('#volume').style.setProperty('--volume', `${Number($('#volume').value) * 100}%`);
  };
  $('#mute').addEventListener('click', () => { if (video.volume === 0) { video.volume = 0.8; video.muted = false; } else video.muted = !video.muted; });
  $('#volume').addEventListener('input', (event) => { video.volume = Number(event.target.value); video.muted = false; });
  video.addEventListener('volumechange', updateVolume);
  updateVolume();
  $('#pip').disabled = !document.pictureInPictureEnabled;
  $('#pip').addEventListener('click', async () => { if (!video.currentSrc) { setStatus('Selecciona un canal para abrir la ventana flotante.'); return; } try { await (document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture()); } catch { setStatus('No se pudo abrir la ventana flotante.', true); } });
  const updatePip = () => {
    const enabled = document.pictureInPictureElement === video;
    pipMorph.morphTo(enabled ? PictureInPicture : PictureInPicture2, 'snappy');
    $('#pip').setAttribute('aria-pressed', String(enabled));
    $('#pip').title = enabled ? 'Cerrar ventana flotante' : 'Ventana flotante';
    $('#pip').setAttribute('aria-label', $('#pip').title);
  };
  video.addEventListener('enterpictureinpicture', updatePip);
  video.addEventListener('leavepictureinpicture', updatePip);
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if ($('#player-shell').requestFullscreen) await $('#player-shell').requestFullscreen();
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
      else setStatus('La pantalla completa no está disponible.');
    } catch { setStatus('No se pudo activar la pantalla completa.', true); }
  });
  document.addEventListener('fullscreenchange', () => {
    const enabled = document.fullscreenElement === $('#player-shell');
    fullscreenMorph.morphTo(enabled ? Minimize : Maximize, 'snappy');
    $('#fullscreen').setAttribute('aria-pressed', String(enabled));
    $('#fullscreen').title = enabled ? 'Salir de pantalla completa' : 'Pantalla completa';
    $('#fullscreen').setAttribute('aria-label', $('#fullscreen').title);
  });
  video.addEventListener('play', () => setPlayIcon(true));
  video.addEventListener('pause', () => setPlayIcon(false));
  video.addEventListener('waiting', () => setLoading(true));
  video.addEventListener('playing', () => setLoading(false));
  video.addEventListener('error', () => { if (active) { setLoading(false); setStatus('El navegador no pudo abrir la emisión.', true); } });
  window.addEventListener('pagehide', () => { stop(); ambient.destroy(); }, { once: true });
  const relayInterval = setInterval(async () => {
    if (relaySession) {
      const sessionId = relaySession;
      try {
        const state = await relayApi('ping', { method: 'POST', body: JSON.stringify({ session_id: sessionId, is_playing: true }), headers: { 'Content-Type': 'application/json' } });
        if (state.kicked && relaySession === sessionId) { stop(); setStatus(state.message || 'La emisión ha terminado. Puedes volver a abrir el canal.', true); }
      } catch { /* A brief network failure does not end playback. */ }
    }
    refreshConnections();
  }, 5000);
  window.addEventListener('pagehide', () => clearInterval(relayInterval), { once: true });

  const modal = $('#upload-modal');
  const openUpload = (event) => {
    event?.preventDefault?.();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    try { $('#upload-file')?.focus(); } catch {}
  };
  const closeUpload = (event) => {
    event?.preventDefault?.();
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    $('#upload-form').reset();
    $('#upload-status').textContent = '';
    try { $('#upload-open')?.focus(); } catch {}
  };
  $('#upload-open').addEventListener('click', openUpload);
  $('#upload-close').addEventListener('click', closeUpload);
  modal.addEventListener('click', (event) => { if (event.target === modal) closeUpload(event); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeUpload(event);
  });
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

  const usersModal = $('#users-modal');
  const resetUserForm = () => {
    $('#user-edit-orig').value = '';
    $('#user-username').value = '';
    $('#user-username').disabled = false;
    $('#user-password').value = '';
    $('#user-password').required = true;
    $('#user-password').placeholder = 'Contraseña (mínimo 4 caracteres)';
    $('#user-password-label').textContent = 'Contraseña';
    $('#user-form-heading').textContent = 'Crear nuevo acceso';
    $('#user-submit').textContent = 'Crear acceso';
    $('#user-cancel-edit').classList.add('hidden');
    $('#users-status').textContent = '';
  };
  const startEditUser = (username) => {
    $('#user-edit-orig').value = username;
    $('#user-username').value = username;
    $('#user-password').value = '';
    $('#user-password').required = false;
    $('#user-password').placeholder = 'Nueva contraseña (vacío para no cambiar)';
    $('#user-password-label').textContent = 'Nueva contraseña (opcional)';
    $('#user-form-heading').textContent = `Modificar acceso: ${username}`;
    $('#user-submit').textContent = 'Guardar cambios';
    $('#user-cancel-edit').classList.remove('hidden');
    $('#users-status').textContent = '';
    $('#user-password').focus();
  };
  const renderUsers = (users) => {
    const listEl = $('#users-list');
    if (!users.length) {
      listEl.innerHTML = '<p class="py-3 text-center text-sm text-slate-400">No hay accesos registrados.</p>';
      return;
    }
    listEl.innerHTML = users.map((u) => {
      const isCurrent = u.username === session.username;
      return `<div class="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
        <div class="flex min-w-0 items-center gap-3">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-amber-400">${iconSvg(Shield, 'h-4 w-4')}</div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-semibold text-white">${escapeHtml(u.username)}</span>
              ${isCurrent ? '<span class="rounded bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">Tú</span>' : ''}
            </div>
            <span class="text-xs text-slate-500">${u.created_at ? new Date(u.created_at).toLocaleDateString() : 'Activo'}</span>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <button type="button" data-edit-user="${escapeHtml(u.username)}" title="Modificar contraseña" aria-label="Modificar acceso de ${escapeHtml(u.username)}" class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-amber-400">${iconSvg(Pencil, 'h-4 w-4')}</button>
          ${isCurrent ? '' : `<button type="button" data-delete-user="${escapeHtml(u.username)}" title="Eliminar usuario" aria-label="Eliminar acceso de ${escapeHtml(u.username)}" class="rounded-lg p-2 text-slate-400 transition hover:bg-red-950/50 hover:text-red-400">${iconSvg(Trash2, 'h-4 w-4')}</button>`}
        </div>
      </div>`;
    }).join('');
  };
  const loadUsers = async () => {
    const listEl = $('#users-list');
    listEl.innerHTML = '<p class="py-3 text-center text-sm text-slate-400">Cargando accesos…</p>';
    try {
      const users = await api('users', { auth: true });
      renderUsers(users);
    } catch (err) {
      listEl.innerHTML = `<p class="py-3 text-center text-sm text-red-400">${escapeHtml(err.message || 'Error al cargar accesos.')}</p>`;
    }
  };
  const openUsers = (event) => {
    event?.preventDefault?.();
    usersModal.classList.remove('hidden');
    usersModal.classList.add('flex');
    resetUserForm();
    loadUsers();
  };
  const closeUsers = (event) => {
    event?.preventDefault?.();
    usersModal.classList.add('hidden');
    usersModal.classList.remove('flex');
    resetUserForm();
    $('#users-status').textContent = '';
    try { $('#users-open')?.focus(); } catch {}
  };
  $('#users-open').addEventListener('click', openUsers);
  $('#users-close').addEventListener('click', closeUsers);
  usersModal.addEventListener('click', (event) => { if (event.target === usersModal) closeUsers(event); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !usersModal.classList.contains('hidden')) closeUsers(event);
  });
  app.addEventListener('click', (event) => {
    if (event.target.closest('#upload-open')) { openUpload(event); return; }
    if (event.target.closest('#users-open')) { openUsers(event); return; }
    if (event.target.closest('#upload-close')) { closeUpload(event); return; }
    if (event.target.closest('#users-close')) { closeUsers(event); return; }
  });
  $('#user-cancel-edit').addEventListener('click', resetUserForm);
  $('#users-list').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-user]');
    if (editBtn) {
      startEditUser(editBtn.dataset.editUser);
      return;
    }
    const deleteBtn = event.target.closest('[data-delete-user]');
    if (deleteBtn) {
      const username = deleteBtn.dataset.deleteUser;
      if (!confirm(`¿Seguro que deseas eliminar el acceso "${username}"?`)) return;
      deleteBtn.disabled = true;
      try {
        await api('delete-user', {
          auth: true,
          method: 'POST',
          body: JSON.stringify({ username }),
          headers: { 'Content-Type': 'application/json' },
        });
        $('#users-status').textContent = `Acceso "${username}" eliminado.`;
        $('#users-status').className = 'min-h-5 text-xs text-amber-400';
        await loadUsers();
      } catch (err) {
        $('#users-status').textContent = err.message || 'No se pudo eliminar el acceso.';
        $('#users-status').className = 'min-h-5 text-xs text-red-400';
        deleteBtn.disabled = false;
      }
    }
  });
  $('#user-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const origUsername = $('#user-edit-orig').value;
    const username = $('#user-username').value.trim();
    const password = $('#user-password').value;
    const submitBtn = $('#user-submit');
    const status = $('#users-status');

    submitBtn.disabled = true;
    status.textContent = 'Guardando…';
    status.className = 'min-h-5 text-xs text-slate-400';

    try {
      if (origUsername) {
        await api('update-user', {
          auth: true,
          method: 'POST',
          body: JSON.stringify({
            username: origUsername,
            newUsername: username !== origUsername ? username : undefined,
            password: password || undefined,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        status.textContent = 'Acceso actualizado con éxito.';
        status.className = 'min-h-5 text-xs text-emerald-400';
        resetUserForm();
        await loadUsers();
      } else {
        await api('create-user', {
          auth: true,
          method: 'POST',
          body: JSON.stringify({ username, password }),
          headers: { 'Content-Type': 'application/json' },
        });
        status.textContent = 'Nuevo acceso creado con éxito.';
        status.className = 'min-h-5 text-xs text-emerald-400';
        resetUserForm();
        await loadUsers();
      }
    } catch (err) {
      status.textContent = err.message || 'Error al guardar el acceso.';
      status.className = 'min-h-5 text-xs text-red-400';
    } finally {
      submitBtn.disabled = false;
    }
  });

  if (session.hasPlaylist) loadPlaylist();
  else setStatus('Aún no hay canales. Puedes subir tu lista con el botón inferior.');
}

showLogin();
(async () => {
  try {
    const authSession = await api('session', { auth: true });
    const playlistSession = await api('session');
    mountPlayer({ ...playlistSession, username: authSession.username });
  } catch (error) {
    if (error.status !== 401) showLogin('No se pudo comprobar la sesión.');
  }
})();
