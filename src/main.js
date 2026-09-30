import './main.css';
import './rooms.css';
import { createMorph } from 'morphicons/dom';
import {
  Play, Pause, Volume, Volume1, Volume2, VolumeX, PictureInPicture2, PictureInPicture,
  RectangleHorizontal, PanelRightClose, ChevronDown, Radio,
  Maximize, Minimize, Bookmark, TvMinimal, Upload, Check,
  LogOut, LockKeyhole, X, FileUp, Search,
  Settings2, DoorOpen,
} from 'lucide';
import { groupsFor, parsePlaylist } from './playlist.js';
import { createAmbientLight } from './ambient.js';
import { createCustomSelect } from './custom-select.js';
import { createDialog, reveal } from './motion.js';
import { iconSvg, morphSvg, escapeHtml } from './ui.js';
import { roomApi, navigateRoom } from './room-api.js';
import { mountPortal, mountDashboard, mountRoomSettings } from './rooms-ui.js';

const app = document.querySelector('#app');
window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
window.addEventListener('hashchange', () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('verify') || hash.has('reset')) location.reload();
});
function mountPlayer(session, account) {
  const inRoom = (action, options = {}) => roomApi(action, { ...options, room: session.slug });
  app.innerHTML = `
  <div class="app-shell">
    <header class="app-header">
      <a href="#" class="brand">
        <div>
          <span class="brand-title">DORADOTV</span><span id="current-room-title" class="brand-caption">${escapeHtml(session.title)}</span>
        </div>
      </a>
      <div class="header-actions"><button id="leave-room" class="text-link">${iconSvg(DoorOpen, 'h-4 w-4')}<span>${account ? 'Mis salas' : 'Salir de la sala'}</span></button>
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
              <h2>Selecciona un canal</h2>
            </div>
            <div id="loading" class="absolute inset-0 z-10 hidden items-center justify-center bg-black/60" role="status"><span class="loading-label"><span class="loading-dot"></span>Conectando con la emisión…</span></div>
          </div>
          <div class="player-controls">
            <button id="play" type="button" title="Reproducir" aria-label="Reproducir" class="icon-button play-button">${morphSvg(Play, 'play-icon')}</button>
            <div class="volume-control"><button id="mute" type="button" title="Silenciar" aria-label="Silenciar" aria-pressed="false" class="icon-button">${morphSvg(Volume2, 'volume-icon')}</button><input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volumen" /><output id="volume-value" for="volume" class="volume-value" aria-hidden="true">80%</output></div>
            <span id="playback-badge" class="playback-badge">EN DIRECTO</span>
            <div class="view-controls">
              <button id="pip" type="button" title="Ventana flotante" aria-label="Ventana flotante" aria-pressed="false" class="icon-button">${morphSvg(PictureInPicture2, 'pip-icon')}</button>
              <button id="theater" type="button" title="Modo cine" aria-label="Modo cine" aria-pressed="false" aria-controls="watch-layout" class="icon-button">${morphSvg(RectangleHorizontal, 'theater-icon')}</button>
              <button id="fullscreen" type="button" title="Pantalla completa" aria-label="Pantalla completa" aria-pressed="false" class="icon-button">${morphSvg(Maximize, 'fullscreen-icon')}</button>
            </div>
          </div>
        </div>
        <div class="now-playing"><div class="now-symbol">${iconSvg(Radio, 'h-5 w-5')}</div><div class="min-w-0"><p class="eyebrow">REPRODUCCIÓN</p><h2 id="now-name">Ningún canal seleccionado</h2><p id="status" role="status" aria-live="polite"></p></div></div>
        <section id="relay-panel" class="relay-panel" aria-label="Conexiones de la sala"><div class="relay-heading"><div><p class="eyebrow">EMISIONES ACTIVAS</p><h2>Conexiones de la sala</h2></div><span id="relay-count" class="channel-count"></span></div><div id="relay-connections" class="relay-connections"></div></section>
      </section>
      <aside class="channel-panel" aria-label="Canales">
        <div class="channel-filters"><div class="channel-heading"><div><p class="eyebrow">LISTA DE CANALES</p><h2>Canales</h2></div><span id="count" class="channel-count">0 canales</span></div>
          <label for="search" class="sr-only">Buscar canales</label><div class="search-field">${iconSvg(Search, 'h-4 w-4')}<input id="search" type="search" placeholder="Buscar canal o categoría…" /></div>
          <div class="filter-row"><div class="category-field"><select id="category" hidden aria-hidden="true" tabindex="-1"><option value="">Todas las categorías</option></select><button id="category-trigger" type="button" class="select-trigger" role="combobox" aria-label="Filtrar categoría" aria-haspopup="listbox" aria-expanded="false" aria-controls="category-options"><span id="category-label">Todas las categorías</span>${morphSvg(ChevronDown, 'category-chevron', 'h-4 w-4')}</button><div id="category-options" class="select-menu" role="listbox" aria-label="Categorías" aria-hidden="true"></div></div><button id="favorites" type="button" class="favorites-filter" title="Mostrar favoritos" aria-label="Mostrar favoritos" aria-pressed="false">${iconSvg(Bookmark, 'h-4 w-4 favorite-icon')}<span>Favoritos</span></button></div>
        </div>
        <div id="channel-list" class="channel-list" role="list"><p class="list-empty">Los canales aparecerán aquí.</p></div><div id="more-wrap" class="hidden border-t border-slate-800 p-3"><button id="more" type="button" class="more-button">Mostrar más canales</button></div>
      </aside>
    </main>
    <div class="${session.owner ? 'flex' : 'hidden'} fixed bottom-5 left-5 z-40 items-center gap-3">
      <div class="group relative">
        <button id="upload-open" type="button" aria-label="Subir lista de canales" aria-haspopup="dialog" title="Subir lista de canales" class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-amber-300 bg-amber-400 text-slate-950 shadow-xl shadow-black/40 transition hover:bg-amber-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><span class="pointer-events-none flex items-center justify-center">${morphSvg(Upload, 'upload-icon')}</span></button>
        <span role="tooltip" class="pointer-events-none absolute bottom-14 left-0 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">Subir lista de canales</span>
      </div>
      <div class="group relative">
        <button id="settings-open" type="button" aria-label="Ajustes de la sala" aria-haspopup="dialog" title="Ajustes de la sala" class="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-amber-400 shadow-xl shadow-black/40 transition hover:border-amber-400 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"><span class="pointer-events-none flex items-center justify-center">${iconSvg(Settings2, 'h-5 w-5')}</span></button>
        <span role="tooltip" class="pointer-events-none absolute bottom-14 left-0 hidden whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-white shadow-lg group-hover:block group-focus-within:block">Ajustes de la sala</span>
      </div>
    </div>
    <div id="upload-modal" class="fixed inset-0 z-50 hidden items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title"><div class="w-full max-w-lg rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7"><div class="flex items-center justify-between gap-4"><div class="flex items-center gap-3 text-amber-400">${iconSvg(FileUp, 'h-6 w-6')}<h2 id="upload-title" class="text-xl font-bold text-white">Subir lista</h2></div><button id="upload-close" type="button" title="Cerrar" aria-label="Cerrar" class="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white">${iconSvg(X)}</button></div><p class="mt-3 text-sm text-slate-400">Sube un archivo .m3u de hasta 10 MB. Se guardará cifrado para esta sala; la lista actual se conserva si la subida falla.</p><form id="upload-form" class="mt-5 space-y-4"><div><label for="upload-file" class="mb-1.5 block text-sm font-medium text-slate-200">Archivo de canales</label><input id="upload-file" type="file" accept=".m3u" required class="block w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-600" /></div><p id="upload-status" class="min-h-5 text-sm text-slate-400" role="status" aria-live="polite"></p><button id="upload-submit" type="submit" class="w-full rounded-xl bg-amber-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60">Guardar lista</button></form></div></div>
  </div>`;

  const $ = (selector) => app.querySelector(selector);
  const categorySelect = createCustomSelect($('#category'), $('#category-trigger'), $('#category-options'), $('#category-label'), $('#category-chevron'));
  const video = $('#video');
  const ambient = createAmbientLight(video, $('#ambient'), $('#video-stage'));
  const theaterMorph = createMorph($('#theater-icon'), RectangleHorizontal, { reducedMotion: 'user' });
  const volumeMorph = createMorph($('#volume-icon'), Volume2, { reducedMotion: 'user' });
  const pipMorph = createMorph($('#pip-icon'), PictureInPicture2, { reducedMotion: 'user' });
  const playMorph = createMorph($('#play-icon'), Play, { reducedMotion: 'user' });
  const fullscreenMorph = createMorph($('#fullscreen-icon'), Maximize, { reducedMotion: 'user' });
  const uploadMorph = createMorph($('#upload-icon'), Upload, { reducedMotion: 'user' });
  let channels = [];
  let filtered = [];
  let active = null;
  let hls = null;
  let hlsRecoveryAttempts = 0;
  let ts = null;
  let visible = 80;
  let onlyFavorites = false;
  let playbackToken = 0;
  let playbackLease = null;
  let releasePending = Promise.resolve();
  let heartbeatPending = false;
  let pageUnloading = false;
  let connectionsRefreshPromise = null;
  let connectionsRefreshTimer = null;
  let retryTimer = null;
  const tabKey = `dorado-tv:tab:${session.slug}`;
  const playbackKey = `dorado-tv:playback:${session.slug}`;
  const isReload = performance.getEntriesByType('navigation')[0]?.type === 'reload';
  let tabId = isReload ? sessionStorage.getItem(tabKey) : null;
  if (!tabId) {
    tabId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(tabKey, tabId);
  }
  const favoritesKey = `dorado-tv:favorites:${session.slug}`;
  let savedFavorites = [];
  try { savedFavorites = JSON.parse(localStorage.getItem(favoritesKey) || '[]'); } catch { localStorage.removeItem(favoritesKey); }
  const favorites = new Set(Array.isArray(savedFavorites) ? savedFavorites : []);

  function setStatus(message, error = false) {
    const target = $('#status');
    if (target.textContent !== message) reveal(target);
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
  function rememberPlayback(channel) {
    sessionStorage.setItem(playbackKey, JSON.stringify({ id: channel.id, key: keyOf(channel) }));
  }
  function clearRememberedPlayback() {
    sessionStorage.removeItem(playbackKey);
  }
  function rememberedChannel() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(playbackKey) || 'null');
      if (!saved) return null;
      return channels.find((channel) => channel.id === saved.id && keyOf(channel) === saved.key)
        || channels.find((channel) => keyOf(channel) === saved.key)
        || null;
    } catch {
      clearRememberedPlayback();
      return null;
    }
  }
  function stop() {
    playbackToken += 1;
    clearTimeout(retryTimer);
    retryTimer = null;
    if (playbackLease) {
      const id = playbackLease.id;
      playbackLease = null;
      releasePending = inRoom('release', { data: { id }, keepalive: true }).catch(() => {});
    }
    ambient.reset();
    video.pause();
    if (hls) { hls.destroy(); hls = null; }
    hlsRecoveryAttempts = 0;
    if (ts) { ts.pause(); ts.unload(); ts.detachMediaElement(); ts.destroy(); ts = null; }
    video.removeAttribute('src');
    video.load();
    setLoading(false);
    setPlayIcon(false);
  }
  function connectionInitial(name) {
    return String(name || 'Invitado').trim().charAt(0).toLocaleUpperCase('es') || 'I';
  }
  function refreshConnections() {
    if (document.hidden) return Promise.resolve();
    if (connectionsRefreshPromise) return connectionsRefreshPromise;
    connectionsRefreshPromise = (async () => {
      try {
        const data = await inRoom('status');
        $('#relay-count').textContent = `${data.active} / ${data.limit ?? '∞'} conexiones`;
        const grouped = new Map();
        for (const connection of data.connections) {
          const key = String(connection.channelId ?? connection.channelName);
          if (!grouped.has(key)) grouped.set(key, { ...connection, users: [] });
          grouped.get(key).users.push(connection);
        }
        $('#relay-connections').innerHTML = grouped.size ? [...grouped.values()].map((connection) => {
          const closeIds = connection.users.map((user) => user.id).filter(Boolean);
          const avatars = connection.users.map((user, index) => `
            <span class="connection-avatar" style="--avatar-index: ${index}" data-user="${escapeHtml(user.name || 'Invitado')}" aria-label="${escapeHtml(user.name || 'Invitado')}" tabindex="0">
              ${escapeHtml(connectionInitial(user.name))}
            </span>
          `).join('');
          return `
            <div class="connection-row">
              <div class="connection-channel-icon">
                ${connection.channelLogo ? `<img src="${escapeHtml(connection.channelLogo)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : iconSvg(TvMinimal, 'h-5 w-5')}
              </div>
              <div class="connection-info">
                <span class="connection-channel">${escapeHtml(connection.channelName)}</span>
                <span class="connection-program">${escapeHtml(connection.program || 'En directo')}</span>
              </div>
              <div class="connection-users" aria-label="${connection.users.length} usuarios viendo este canal">${avatars}</div>
              ${session.owner && closeIds.length ? `<button type="button" data-close-emissions="${closeIds.join(',')}" class="connection-close">Cerrar</button>` : ''}
            </div>
          `;
        }).join('') : `<div class="connection-empty">${iconSvg(Radio, 'h-4 w-4')}<span>Nadie está reproduciendo ahora.</span></div>`;
      } catch {
        $('#relay-count').textContent = 'Sin conexión';
      } finally {
        connectionsRefreshPromise = null;
      }
    })();
    return connectionsRefreshPromise;
  }
  function stopConnectionsPolling() {
    clearTimeout(connectionsRefreshTimer);
    connectionsRefreshTimer = null;
  }
  function startConnectionsPolling() {
    stopConnectionsPolling();
    if (document.hidden) return;
    connectionsRefreshTimer = setTimeout(async () => {
      await refreshConnections();
      startConnectionsPolling();
    }, 5000);
  }
  function renderChannels() {
    const query = $('#search').value.trim().toLocaleLowerCase('es');
    const category = $('#category').value;
    filtered = channels.filter((channel) => (!category || channel.group === category) && (!onlyFavorites || favorites.has(keyOf(channel))) && (!query || `${channel.name} ${channel.group}`.toLocaleLowerCase('es').includes(query)));
    $('#count').textContent = `${filtered.length.toLocaleString('es')} canales`;
    const shown = filtered.slice(0, visible);
    $('#channel-list').innerHTML = shown.length ? shown.map((channel, index) => {
      const selected = channel === active;
      const favorite = favorites.has(keyOf(channel));
      return `<div role="listitem" style="--row-delay: ${Math.min(index, 9) * 22}ms" class="channel-row ${selected ? 'is-selected' : ''}"><button type="button" data-channel="${channel.id}" aria-current="${selected ? 'true' : 'false'}" class="channel-select">${channel.logo ? `<img src="${escapeHtml(channel.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="channel-logo" />` : `<span class="channel-logo" aria-hidden="true">${iconSvg(TvMinimal)}</span>`}<span class="channel-copy"><span class="channel-name">${escapeHtml(channel.name)}</span><span class="channel-group">${escapeHtml(channel.group)}</span></span>${selected ? `<span class="selected-indicator" aria-hidden="true">${iconSvg(Radio, 'h-4 w-4')}</span>` : ''}</button><button type="button" data-favorite="${channel.id}" title="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}" aria-label="${favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'}: ${escapeHtml(channel.name)}" aria-pressed="${favorite}" class="channel-favorite">${iconSvg(Bookmark, 'h-4 w-4 favorite-icon')}</button></div>`;
    }).join('') : `<div class="list-empty">${iconSvg(Search, 'h-6 w-6')}<p>${channels.length ? 'No hay canales para este filtro.' : 'No hay canales.'}</p><span>${channels.length ? 'Prueba con otro nombre o categoría.' : 'Sube una lista para empezar a ver tus canales.'}</span></div>`;
    $('#more-wrap').classList.toggle('hidden', filtered.length <= visible);
  }
  function setPlaylist(next, { resume = false } = {}) {
    stop();
    channels = next;
    active = null;
    visible = 80;
    $('#now-name').textContent = 'Ningún canal seleccionado';
    $('#empty').classList.remove('hidden');
    $('#category').innerHTML = `<option value="">Todas las categorías</option>${groupsFor(channels).map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join('')}`;
    categorySelect.refresh();
    $('#search').value = '';
    onlyFavorites = false;
    $('#favorites').setAttribute('aria-pressed', 'false');
    renderChannels();
    setStatus('');
    if (!resume) {
      clearRememberedPlayback();
      return;
    }
    const previous = rememberedChannel();
    if (previous) play(previous, { resume: true });
    else clearRememberedPlayback();
  }
  async function play(channel, { resume = false } = {}) {
    if (!channel) return;
    stop();
    const token = playbackToken;
    active = channel;
    rememberPlayback(channel);
    $('#now-name').textContent = channel.name;
    reveal($('#now-name'));
    document.title = `${channel.name} · Dorado TV`;
    $('#empty').classList.add('hidden');
    renderChannels();
    setLoading(true);
    setStatus(`Conectando con ${channel.name}…`);
    try {
      await releasePending;
      if (token !== playbackToken) return;
      const started = await inRoom('start', { data: { channelId: channel.id, tab: tabId } });
      if (token !== playbackToken) { inRoom('release', { data: { id: started.id } }).catch(() => {}); return; }
      playbackLease = started;
      const source = started.url;
      refreshConnections();
      const path = new URL(source).pathname.toLowerCase();
      if (path.endsWith('.m3u8')) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = source;
        else {
          const { default: Hls } = await import('hls.js');
          if (token !== playbackToken) return;
          if (!Hls.isSupported()) throw new Error('HLS no disponible');
          hls = new Hls({ enableWorker: true, lowLatencyMode: true });
          const instance = hls;
          await new Promise((resolve, reject) => {
            const onError = (_event, data) => {
              if (!data.fatal) return;
              instance.off(Hls.Events.ERROR, onError);
              instance.off(Hls.Events.MANIFEST_PARSED, onParsed);
              reject(new Error('No se pudo cargar la señal HLS.'));
            };
            const onParsed = () => {
              instance.off(Hls.Events.ERROR, onError);
              instance.off(Hls.Events.MANIFEST_PARSED, onParsed);
              resolve();
            };
            instance.on(Hls.Events.ERROR, onError);
            instance.on(Hls.Events.MANIFEST_PARSED, onParsed);
            instance.attachMedia(video);
            instance.loadSource(source);
          });
          if (token !== playbackToken || hls !== instance) return;
          instance.on(Hls.Events.FRAG_BUFFERED, () => { hlsRecoveryAttempts = 0; });
          instance.on(Hls.Events.ERROR, (_event, data) => {
            if (pageUnloading || !data.fatal || token !== playbackToken || hls !== instance) return;
            if (hlsRecoveryAttempts < 2 && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hlsRecoveryAttempts += 1;
              setLoading(true);
              setStatus('Recuperando la señal…');
              instance.recoverMediaError();
              return;
            }
            if (hlsRecoveryAttempts < 2 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hlsRecoveryAttempts += 1;
              setLoading(true);
              setStatus('Reconectando con la señal…');
              instance.startLoad();
              return;
            }
            clearRememberedPlayback();
            stop();
            setStatus('No se pudo reproducir el canal. Comprueba la señal.', true);
          });
        }
      } else if (path.endsWith('.ts')) {
        const { default: mpegts } = await import('mpegts.js');
        if (token !== playbackToken) return;
        if (!mpegts.getFeatureList().mseLivePlayback) throw new Error('MPEG-TS no disponible');
        ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: source });
        ts.attachMediaElement(video);
        ts.load();
      } else video.src = source;
      try {
        await video.play();
      } catch (error) {
        if (!resume || error?.name !== 'NotAllowedError' || token !== playbackToken) throw error;
        video.muted = true;
        await video.play();
      }
      if (token !== playbackToken) return;
      setLoading(false);
      setStatus(`Reproduciendo ${channel.name}.`);
    } catch (error) {
      if (token !== playbackToken) return;
      if (playbackLease) stop();
      setLoading(false);
      if (error.full) retryTimer = setTimeout(() => { if (active === channel && !document.hidden) play(channel); }, 30000);
      setStatus(error?.name === 'NotAllowedError' ? 'Pulsa Reproducir para iniciar el canal.' : error.message || 'No se pudo reproducir este canal. Comprueba la señal.', error?.name !== 'NotAllowedError');
    }
  }

  $('#leave-room').addEventListener('click', async () => { clearRememberedPlayback(); stop(); await releasePending; navigateRoom(); });
  $('#logout').addEventListener('click', async () => { clearRememberedPlayback(); stop(); await releasePending; await roomApi('logout', { data: {} }); navigateRoom(); });
  async function loadPlaylist() {
    setStatus('Cargando canales…');
    try { const { source } = await inRoom('playlist'); setPlaylist(parsePlaylist(source), { resume: isReload }); }
    catch (error) { setStatus(error.message, true); }
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
      localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
      const favorite = favorites.has(key);
      favoriteButton.setAttribute('aria-pressed', String(favorite));
      favoriteButton.title = favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
      favoriteButton.setAttribute('aria-label', `${favoriteButton.title}: ${channel.name}`);
      if (onlyFavorites) setTimeout(renderChannels, 250);
    } else play(channel);
  });
  $('#search').addEventListener('input', () => { visible = 80; renderChannels(); });
  $('#category').addEventListener('change', () => { visible = 80; renderChannels(); });
  $('#favorites').addEventListener('click', () => { onlyFavorites = !onlyFavorites; $('#favorites').setAttribute('aria-pressed', String(onlyFavorites)); visible = 80; renderChannels(); });
  $('#more').addEventListener('click', () => { visible += 80; renderChannels(); });
  $('#play').addEventListener('click', () => { if (!active) { setStatus('Selecciona un canal.'); return; } if (!video.paused || retryTimer) { clearRememberedPlayback(); stop(); setStatus('Emisión pausada.'); } else play(active); });
  $('#relay-connections').addEventListener('click', async (event) => {
    const button = event.target.closest('[data-close-emissions]');
    if (!button) return;
    button.disabled = true;
    try {
      const ids = button.dataset.closeEmissions.split(',').filter(Boolean);
      await Promise.all(ids.map((id) => inRoom('close', { data: { id } })));
      await refreshConnections();
    } catch (error) { setStatus(error.message, true); button.disabled = false; }
  });
  $('#theater').addEventListener('click', () => {
    const layout = $('#watch-layout');
    const shell = $('#player-shell');
    const panel = $('.channel-panel');
    const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      const enabled = layout.classList.toggle('is-theater');
      $('#theater').setAttribute('aria-pressed', String(enabled));
      $('#theater').title = enabled ? 'Vista normal' : 'Modo cine';
      $('#theater').setAttribute('aria-label', $('#theater').title);
      theaterMorph.morphTo(enabled ? PanelRightClose : RectangleHorizontal, 'snappy');
      return;
    }

    const firstShell = shell.getBoundingClientRect();
    const belowElements = [...shell.parentElement.children].filter((el) => el !== shell && !el.classList.contains('hidden'));
    const firstBelow = belowElements.map((el) => el.getBoundingClientRect());

    const enabled = layout.classList.toggle('is-theater');
    $('#theater').setAttribute('aria-pressed', String(enabled));
    $('#theater').title = enabled ? 'Vista normal' : 'Modo cine';
    $('#theater').setAttribute('aria-label', $('#theater').title);
    theaterMorph.morphTo(enabled ? PanelRightClose : RectangleHorizontal, 'snappy');

    const lastShell = shell.getBoundingClientRect();
    if (!firstShell.width || !lastShell.width || !firstShell.height || !lastShell.height) return;

    const dx = firstShell.left - lastShell.left;
    const dy = firstShell.top - lastShell.top;
    const sw = firstShell.width / lastShell.width;
    const sh = firstShell.height / lastShell.height;

    const duration = 400;
    const easing = 'cubic-bezier(.2, .8, .2, 1)';

    shell.getAnimations().forEach((a) => a.cancel());
    shell.animate([
      {
        transformOrigin: 'top left',
        transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`,
        borderRadius: enabled ? '20px' : '0px',
      },
      {
        transformOrigin: 'top left',
        transform: 'translate(0, 0) scale(1, 1)',
        borderRadius: enabled ? '0px' : '20px',
      },
    ], {
      duration,
      easing,
    });

    belowElements.forEach((el, index) => {
      const last = el.getBoundingClientRect();
      const first = firstBelow[index];
      if (!first) return;
      const elDy = first.top - last.top;
      const elDx = first.left - last.left;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([
        { transform: `translate(${elDx}px, ${elDy}px)` },
        { transform: 'translate(0, 0)' },
      ], {
        duration,
        easing,
      });
    });

    if (panel) {
      panel.getAnimations().forEach((a) => a.cancel());
      panel.animate([
        { opacity: 0.3, transform: enabled ? 'translateY(24px)' : 'translateX(24px)' },
        { opacity: 1, transform: 'translate(0, 0)' },
      ], {
        duration: duration * 1.05,
        easing,
      });
    }
  });
  video.volume = Number($('#volume').value);
  let volumeState = 'high';
  let audibleVolume = video.volume;
  const updateVolume = () => {
    const muted = video.muted || video.volume === 0;
    const level = muted ? 0 : video.volume;
    const state = muted ? 'muted' : level < .25 ? 'low' : level < .6 ? 'medium' : 'high';
    if (state !== volumeState) {
      volumeMorph.morphTo({ muted: VolumeX, low: Volume, medium: Volume1, high: Volume2 }[state], 'snappy');
      volumeState = state;
    }
    if (level > 0) audibleVolume = level;
    const percent = Math.round(level * 100);
    $('#mute').dataset.volumeState = state;
    $('#mute').setAttribute('aria-pressed', String(muted));
    $('#mute').title = muted ? 'Activar sonido' : 'Silenciar';
    $('#mute').setAttribute('aria-label', $('#mute').title);
    $('#volume').value = level;
    $('#volume').setAttribute('aria-valuetext', muted ? 'Silenciado' : `${percent} por ciento`);
    $('#volume').style.setProperty('--volume', `${percent}%`);
    $('.volume-control').style.setProperty('--volume-strength', level);
    $('#volume-value').value = `${percent}%`;
  };
  $('#mute').addEventListener('click', () => {
    if (video.volume === 0) { video.volume = audibleVolume || .8; video.muted = false; }
    else video.muted = !video.muted;
    updateVolume();
  });
  $('#volume').addEventListener('input', (event) => { video.volume = Number(event.target.value); video.muted = false; updateVolume(); });
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
  video.addEventListener('error', () => {
    if (!active || pageUnloading) return;
    if (hls) return;
    clearRememberedPlayback();
    stop();
    setStatus('El navegador no pudo abrir la emisión.', true);
  });
  window.addEventListener('pagehide', () => { pageUnloading = true; stop(); ambient.destroy(); categorySelect.destroy(); }, { once: true });
  async function heartbeat() {
    if (heartbeatPending) return;
    heartbeatPending = true;
    const lease = playbackLease;
    try {
      if (lease) {
        const state = await inRoom('ping', { data: { id: lease.id } });
        if (playbackLease?.id === lease.id) {
          if (state.kicked) { stop(); setStatus('Esta reproducción ha terminado. Vuelve a entrar en la sala si el acceso ha cambiado.', true); }
          else playbackLease.expires = state.expires;
        }
      }
    } catch (error) {
      if (lease && playbackLease?.id === lease.id && (error.status === 403 || error.status === 401 || Date.now() / 1000 >= lease.expires)) {
        stop(); setStatus('No se pudo renovar el acceso. Vuelve a entrar en la sala.', true);
      }
    } finally { heartbeatPending = false; }
  }
  const heartbeatInterval = setInterval(heartbeat, 25000);
  const handleVisibilityChange = () => {
    if (document.hidden) {
      stopConnectionsPolling();
      return;
    }
    heartbeat();
    refreshConnections();
    startConnectionsPolling();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', () => {
    clearInterval(heartbeatInterval);
    stopConnectionsPolling();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, { once: true });
  video.addEventListener('ended', () => { clearRememberedPlayback(); stop(); setStatus('La emisión ha terminado.'); });
  refreshConnections();
  startConnectionsPolling();

  const modal = $('#upload-modal');
  const uploadDialog = createDialog(modal, $('#upload-open'), $('#upload-file'));
  const openUpload = (event) => {
    event?.preventDefault?.();
    uploadDialog.show();
  };
  const closeUpload = async (event) => {
    event?.preventDefault?.();
    await uploadDialog.hide();
    $('#upload-form').reset();
    $('#upload-status').textContent = '';
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
    if (!file || !/\.m3u$/i.test(file.name) || file.size > 10 * 1024 * 1024) { status.textContent = 'Selecciona un archivo .m3u de hasta 10 MB.'; return; }
    button.disabled = true;
    try {
      status.textContent = 'Preparando lista…';
      const source = await file.text();
      const parsed = parsePlaylist(source);
      if (!parsed.length) throw new Error('El archivo no contiene canales válidos.');
      const chunkChars = 512 * 1024;
      const totalChunks = Math.max(1, Math.ceil(source.length / chunkChars));
      status.textContent = 'Iniciando subida…';
      const upload = await inRoom('upload-begin', { data: { filename: file.name, revision: session.revision, bytes: file.size, totalChunks } });
      for (let index = 0; index < totalChunks; index += 1) {
        status.textContent = `Subiendo lista… ${index + 1}/${totalChunks}`;
        await inRoom('upload-chunk', { data: { id: upload.id, index, chunk: source.slice(index * chunkChars, (index + 1) * chunkChars) } });
      }
      status.textContent = 'Validando lista y comprobando el límite de conexiones…';
      const next = await inRoom('upload-commit', { data: { id: upload.id } });
      Object.assign(session, next);
      settings?.refresh(next);
      setPlaylist(parsed);
      status.textContent = 'Lista guardada.';
      uploadMorph.morphTo(Check, 'snappy');
      setTimeout(() => { closeUpload(); uploadMorph.morphTo(Upload, 'snappy'); }, 900);
    } catch (error) { status.textContent = error.message || 'No se pudo subir la lista.'; }
    finally { button.disabled = false; }
  });

  const settings = session.owner ? mountRoomSettings($('.app-shell'), session, $('#settings-open'), {
    onUpdate(next) { Object.assign(session, next); $('#current-room-title').textContent = next.title; refreshConnections(); },
    onRevoke() { stop(); refreshConnections(); },
  }) : null;
  window.addEventListener('pagehide', () => settings?.destroy(), { once: true });

  if (session.hasPlaylist) loadPlaylist();
  else setStatus(session.owner ? 'Sube un archivo .m3u para añadir canales.' : 'El propietario todavía no ha subido la lista de esta sala.');
}

app.innerHTML = '<main class="app-boot"><span class="loading-dot"></span><p>Cargando…</p></main>';
(async () => {
  let config;
  try {
    config = await roomApi('config');
    if (!config.ready || location.hash.includes('verify=') || location.hash.includes('reset=')) { mountPortal(app, config); return; }
    const identity = await roomApi('session');
    const query = new URLSearchParams(location.search);
    if (identity.account?.needsUsername && !query.has('join')) { mountPortal(app, config, { mode: 'profile' }); return; }
    const slug = query.get('room');
    if (slug) {
      try { const room = await roomApi('room', { room: slug }); mountPlayer(room, identity.account); }
      catch (error) { if (error.status === 403 || error.status === 404) mountPortal(app, config); else throw error; }
    } else if (identity.account && !query.has('join')) mountDashboard(app, identity.account);
    else mountPortal(app, config);
  } catch {
    app.innerHTML = '<main class="app-boot"><p>No se pudo conectar con Dorado TV.</p><button class="secondary-button" id="retry-boot">Volver a intentar</button></main>';
    app.querySelector('#retry-boot').onclick = () => location.reload();
  }
})();
