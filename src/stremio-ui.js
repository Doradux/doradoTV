import { Film, Puzzle, X, Search, Play, Pause, RotateCcw, RotateCw, Volume2, Maximize, ArrowLeft, Trash2, Plus } from 'lucide';
import { iconSvg, escapeHtml } from './ui.js';
import './stremio.css';
import { formatPlaybackTime, seasonGroups, seekTarget } from './vod-utils.js';

const e = escapeHtml;
const poster = (m) => m.poster ? `<img src="${e(m.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<div class="sa-no-poster">${iconSvg(Film)}</div>`;
const card = (m, i) => `<button type="button" class="sa-card" data-film="${i}">${poster(m)}<span>${e(m.name || 'Sin título')}</span><small>${m.type === 'series' ? 'Serie' : 'Película'} ${e(m.releaseInfo || '')}</small></button>`;

async function api(room, action, data) {
  const search = new URLSearchParams({ room, action });
  const response = await fetch(`/.netlify/functions/addons?${search}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, ...data }) }),
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result?.error || `Error consultando addons (${response.status}).`);
  return result;
}

export function mountRoomAddons(app, session, { stopLive = () => {} } = {}) {
  const room = session.slug;
  const header = app.querySelector('.header-actions');
  if (!header) return;
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'sa-open';
  open.innerHTML = `${iconSvg(Film, 'h-4 w-4')}<span>Películas y series</span>`;
  header.prepend(open);

  const overlay = document.createElement('div');
  overlay.className = 'sa-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<section class="sa-dialog" role="dialog" aria-modal="true" aria-label="Cine y series">
    <header class="sa-heading">
      <div class="sa-heading-title">${iconSvg(Film)}<div><strong>Cine y series</strong><small>Addons compartidos por la sala</small></div></div>
      <button class="sa-icon" data-act="close" aria-label="Volver a canales en directo" title="Volver a canales en directo">${iconSvg(X)}</button>
    </header>
    <div class="sa-layout">
      <aside class="sa-sidebar">
        <div class="sa-side-title">${iconSvg(Puzzle, 'h-4 w-4')} Addons de la sala</div>
        <div id="sa-addons" class="sa-addon-list"></div>
        <form id="sa-install" class="sa-install" hidden>
          <label for="sa-url">Instalar addon</label>
          <input id="sa-url" type="url" placeholder="https://ejemplo.com/manifest.json" maxlength="1500" required autocomplete="off">
          <button type="submit" class="sa-primary">${iconSvg(Plus, 'h-4 w-4')} Instalar</button>
          <small>Solo el propietario puede modificar los addons. Utiliza fuentes autorizadas y de confianza.</small>
        </form>
      </aside>
      <div class="sa-main">
        <div id="sa-browse">
          <div class="sa-content-switch" role="group" aria-label="Buscar por tipo de contenido"><button type="button" data-kind="movie" aria-pressed="true">Películas</button><button type="button" data-kind="series" aria-pressed="false">Series</button></div>
          <div class="sa-toolbar">
            <select id="sa-catalog" aria-label="Elegir catálogo"></select>
            <form id="sa-search"><input id="sa-search-input" type="search" placeholder="Buscar películas…" maxlength="100" aria-label="Buscar películas o series"><button type="submit" class="sa-icon" aria-label="Buscar">${iconSvg(Search)}</button></form>
          </div>
          <p id="sa-message" class="sa-message" role="status"></p>
          <div id="sa-grid" class="sa-grid"></div>
          <button id="sa-more" type="button" class="sa-secondary" hidden>Mostrar más</button>
        </div>
        <div id="sa-detail" hidden>
          <button class="sa-back" data-act="back">${iconSvg(ArrowLeft, 'h-4 w-4')} Volver al catálogo</button>
          <div id="sa-detail-meta"></div>
          <div class="sa-watch">
            <div id="sa-episodes"></div>
            <p id="sa-stream-status" class="sa-message" role="status"></p>
            <div id="sa-streams" class="sa-streams"></div>
            <div id="sa-player" class="sa-player" hidden>
              <video id="sa-video" playsinline preload="metadata" tabindex="0" aria-label="Reproductor de películas y series"></video>
              <div class="sa-playback-controls" aria-label="Controles de reproducción bajo demanda">
                <input id="sa-timeline" type="range" min="0" max="1000" step="1" value="0" disabled aria-label="Posición en la película o episodio">
                <div class="sa-playback-row">
                  <div class="sa-playback-buttons">
                    <button id="sa-play" type="button" data-act="toggle-play" disabled aria-label="Reproducir" title="Reproducir">${iconSvg(Play, 'h-5 w-5')}</button>
                    <button type="button" data-seek="-10" disabled aria-label="Retroceder 10 segundos" title="Retroceder 10 segundos">${iconSvg(RotateCcw, 'h-5 w-5')}<span>10</span></button>
                    <button type="button" data-seek="10" disabled aria-label="Avanzar 10 segundos" title="Avanzar 10 segundos">${iconSvg(RotateCw, 'h-5 w-5')}<span>10</span></button>
                  </div>
                  <output id="sa-time" for="sa-timeline">00:00 / --:--</output>
                  <div class="sa-playback-options"><label for="sa-volume" aria-label="Volumen">${iconSvg(Volume2, 'h-4 w-4')}</label><input id="sa-volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volumen"><button type="button" data-act="fullscreen" aria-label="Pantalla completa" title="Pantalla completa">${iconSvg(Maximize, 'h-5 w-5')}</button></div>
                </div>
              </div>
            </div>
            <div id="sa-subtitles"></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
  app.append(overlay);
  const $ = (selector) => overlay.querySelector(selector);
  const state = { addons: [], catalogs: [], metas: [], owner: false, kind: 'movie', selected: 0, skip: 0, search: '', current: null, seasons: [], seasonIndex: 0, episodeId: '', streams: [], subtitles: [], lastVideo: '', activeSource: -1 };
  let hls = null, subtitleObjectUrl = '', browseNonce = 0, streamNonce = 0, detailNonce = 0, scrubbing = false;
  const video = $('#sa-video');
  const tell = (message, detail = false) => { $(detail ? '#sa-stream-status' : '#sa-message').textContent = message; };
  const timeline = $('#sa-timeline');
  const player = $('#sa-player');
  video.volume = Number($('#sa-volume').value);

  function seekBounds() {
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.seekable.length) return null;
    const start = Math.max(0, video.seekable.start(0));
    const end = Math.min(video.duration, video.seekable.end(video.seekable.length - 1));
    return end > start ? { start, end } : null;
  }

  function updatePlaybackControls() {
    const hasSource = state.activeSource >= 0;
    const bounds = seekBounds();
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    $('#sa-play').disabled = !hasSource;
    $('#sa-play').innerHTML = video.paused ? iconSvg(Play, 'h-5 w-5') : iconSvg(Pause, 'h-5 w-5');
    $('#sa-play').title = video.paused ? 'Reproducir' : 'Pausar';
    $('#sa-play').setAttribute('aria-label', $('#sa-play').title);
    timeline.disabled = !hasSource || !bounds;
    overlay.querySelectorAll('[data-seek]').forEach((button) => { button.disabled = !hasSource || !bounds; });
    if (!scrubbing) timeline.value = duration ? String(Math.round(Math.min(video.currentTime / duration, 1) * 1000)) : '0';
    $('#sa-time').textContent = `${formatPlaybackTime(video.currentTime)} / ${duration ? formatPlaybackTime(duration) : '--:--'}`;
    timeline.style.setProperty('--seek-fill', `${timeline.value / 10}%`);
  }

  function seekBy(seconds) {
    const bounds = seekBounds();
    if (!bounds) return;
    const target = seekTarget(video.currentTime, seconds, bounds.start, bounds.end);
    if (target !== null) video.currentTime = target;
    updatePlaybackControls();
  }

  const stopVideo = () => {
    video.pause();
    hls?.destroy(); hls = null;
    video.removeAttribute('src');
    video.querySelectorAll('track').forEach((t) => t.remove());
    video.load();
    if (subtitleObjectUrl) URL.revokeObjectURL(subtitleObjectUrl);
    subtitleObjectUrl = '';
    scrubbing = false;
    player.hidden = true;
    state.activeSource = -1;
    updatePlaybackControls();
  };
  const catalogLabel = (c) => `${c.addon.manifest.name} · ${c.catalog.name}`;
  const addOnMarkup = (addon) => `<div class="sa-addon"><div><strong>${e(addon.manifest.name)}</strong><small>${e(addon.manifest.description || addon.manifest.id)}</small></div>${state.owner ? `<button type="button" title="Eliminar addon" aria-label="Eliminar ${e(addon.manifest.name)}" data-remove="${e(addon.id)}">${iconSvg(Trash2, 'h-4 w-4')}</button>` : ''}</div>`;

  function renderCatalogs() {
    state.catalogs = state.addons.flatMap((addon) => addon.manifest.catalogs
      .filter((catalog) => catalog.type === state.kind && !catalog.required)
      .map((catalog) => ({ addon, catalog })));
    $('#sa-catalog').innerHTML = state.catalogs.length
      ? state.catalogs.map((c, i) => `<option value="${i}">${e(catalogLabel(c))}</option>`).join('')
      : '<option value="">No hay catálogos de este tipo</option>';
    state.selected = 0;
    overlay.querySelectorAll('[data-kind]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.kind === state.kind)));
    const input = $('#sa-search-input');
    input.placeholder = state.kind === 'movie' ? 'Buscar películas…' : 'Buscar series…';
    input.setAttribute('aria-label', input.placeholder);
  }

  function renderAddons() {
    $('#sa-install').hidden = !state.owner;
    $('#sa-addons').innerHTML = state.addons.length
      ? state.addons.map(addOnMarkup).join('')
      : '<p class="sa-muted">Aún no hay addons instalados.</p>';
    renderCatalogs();
  }

  async function refresh() {
    const response = await api(room, 'list');
    state.addons = response.addons;
    state.owner = response.owner;
    renderAddons();
    await browse();
  }

  async function browse(append = false) {
    const current = ++browseNonce;
    let selection = state.catalogs[state.selected];
    const query = state.search.trim();
    // Los catálogos populares suelen ser distintos del catálogo de búsqueda.
    if (query && selection && !selection.catalog.search) {
      const searchable = state.catalogs.findIndex(({ catalog }) => catalog.search);
      if (searchable !== -1) {
        state.selected = searchable;
        $('#sa-catalog').value = String(searchable);
        selection = state.catalogs[searchable];
      }
    }
    if (!selection) {
      state.metas = [];
      $('#sa-grid').innerHTML = '<p class="sa-muted">Instala un addon con catálogo (por ejemplo Cinemeta). Los addons que solo ofrecen streams no sirven para buscar títulos.</p>';
      $('#sa-more').hidden = true; tell(''); return;
    }
    tell('Cargando catálogo…');
    try {
      if (!query && selection.catalog.searchRequired) {
        tell('Introduce un título en el buscador para consultar este catálogo.');
        $('#sa-grid').innerHTML = ''; $('#sa-more').hidden = true; return;
      }
      if (query && !selection.catalog.search) {
        tell('Este catálogo no admite búsquedas. Selecciona uno con búsqueda compatible.');
        $('#sa-grid').innerHTML = ''; $('#sa-more').hidden = true; return;
      }
      const data = await api(room, 'catalog', { addonId: selection.addon.id, type: selection.catalog.type, catalogId: selection.catalog.id,
        search: query, skip: append ? state.skip : 0 });
      if (current !== browseNonce) return;
      const metas = data.metas.map((m) => ({ ...m, addonId: selection.addon.id }));
      state.metas = append ? state.metas.concat(metas) : metas;
      state.skip = append ? state.skip + 100 : 100;
      $('#sa-grid').innerHTML = state.metas.length ? state.metas.map(card).join('') : '<p class="sa-muted">No hay títulos para mostrar.</p>';
      $('#sa-more').hidden = !selection.catalog.paginated || metas.length < 20;
      tell(`${state.metas.length} títulos mostrados`);
    } catch (err) {
      if (current !== browseNonce) return;
      tell(err.message); if (!append) $('#sa-grid').innerHTML = '';
      $('#sa-more').hidden = true;
    }
  }

  function renderEpisodes() {
    const group = state.seasons[state.seasonIndex];
    if (!group) return;
    $('#sa-season').value = String(group.season);
    $('#sa-episode-list').innerHTML = group.episodes.map((ep, index) => {
      const active = ep.id === state.episodeId;
      const number = Number.isInteger(ep.episode) ? `E${ep.episode}` : `${index + 1}`;
      return `<button type="button" class="sa-episode ${active ? 'is-active' : ''}" data-episode="${e(ep.id)}" aria-pressed="${active}">
        ${ep.thumbnail ? `<img src="${e(ep.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span><small>${e(number)}</small><strong>${e(ep.title || `Episodio ${index + 1}`)}</strong></span>
        ${active ? iconSvg(Play, 'h-4 w-4') : ''}
      </button>`;
    }).join('');
  }

  async function chooseEpisode(id) {
    if (!state.seasons[state.seasonIndex]?.episodes.some((ep) => ep.id === id)) return;
    state.episodeId = id;
    renderEpisodes();
    await loadStreams(id);
  }

  async function detail(index) {
    const ticket = ++detailNonce;
    const preview = state.metas[index];
    if (!preview) return;
    stopVideo(); ++streamNonce;
    state.current = preview;
    state.seasons = [];
    state.episodeId = '';
    $('#sa-browse').hidden = true;
    $('#sa-detail').hidden = false;
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${poster(preview)}<div><h2>${e(preview.name)}</h2><p>${e(preview.description || '')}</p><small>${preview.type === 'series' ? 'Serie' : 'Película'} · ${e(preview.releaseInfo || '')}</small></div></div>`;
    $('#sa-episodes').innerHTML = '';
    $('#sa-streams').innerHTML = '';
    $('#sa-subtitles').innerHTML = '';
    tell('Cargando información…', true);
    let info = preview;
    try { info = (await api(room, 'meta', { addonId: preview.addonId, type: preview.type, id: preview.id })).meta; }
    catch { /* Un addon sin metadatos aún puede ofrecer reproducción de películas. */ }
    if (ticket !== detailNonce || state.current !== preview || overlay.hidden) return;
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${poster(info)}<div><h2>${e(info.name || preview.name)}</h2><p>${e(info.description || preview.description || '')}</p><small>${preview.type === 'series' ? 'Serie' : 'Película'} · ${e(info.releaseInfo || '')}</small></div></div>`;
    state.seasons = preview.type === 'series' ? seasonGroups(info.videos) : [];
    if (state.seasons.length) {
      state.seasonIndex = 0;
      state.episodeId = state.seasons[0].episodes[0].id;
      $('#sa-episodes').innerHTML = `<div class="sa-seasons"><label for="sa-season">Temporada</label><select id="sa-season" aria-label="Seleccionar temporada">${state.seasons.map((group) => `<option value="${group.season}">${e(group.label)} · ${group.episodes.length} episodios</option>`).join('')}</select></div><div id="sa-episode-list" class="sa-episode-list" aria-label="Episodios de la temporada"></div>`;
      renderEpisodes();
      await loadStreams(state.episodeId);
    } else if (preview.type === 'movie') {
      await loadStreams(info.id || preview.id);
    } else {
      tell('Este addon no proporciona temporadas o episodios para la serie.', true);
    }
  }

  async function loadStreams(id) {
    const current = ++streamNonce;
    state.lastVideo = id;
    stopVideo();
    state.streams = [];
    $('#sa-subtitles').innerHTML = '';
    $('#sa-streams').innerHTML = '';
    tell('Buscando fuentes de reproducción…', true);
    try {
      const { streams, warnings = [] } = await api(room, 'streams', { type: state.current.type, id });
      if (current !== streamNonce) return;
      state.streams = streams;
      const hasStreamAddon = state.addons.some((addon) => addon.manifest.resources.some((resource) => resource.name === 'stream' && resource.types.includes(state.current.type)));
      $('#sa-streams').innerHTML = streams.length ? streams.map((s, i) => `<button type="button" class="sa-source" data-source="${i}" ${s.supported ? '' : 'disabled'}>
        ${iconSvg(Play, 'h-4 w-4')}<span><strong>${e(s.name)}</strong><small>${e(s.title || (s.supported ? 'Reproducción directa' : `Formato ${s.kind} no compatible con el navegador`))}</small></span></button>`).join('') : `<p class="sa-muted">${hasStreamAddon ? 'Los addons de reproducción instalados no devolvieron fuentes para este título.' : 'Cinemeta muestra fichas y episodios, pero no incluye vídeos. El propietario debe instalar un addon que proporcione fuentes de reproducción autorizadas.'}</p>`;
      if (warnings.length) $('#sa-streams').insertAdjacentHTML('beforeend', `<p class="sa-muted sa-addon-warnings">${warnings.map((warning) => `${e(warning.addon)}: ${e(warning.reason)}`).join(' · ')}</p>`);
      tell(streams.some((s) => s.supported) ? 'Elige una fuente para reproducir.' : streams.length ? 'Hay fuentes disponibles, pero ninguna es reproducible directamente en el navegador.' : warnings.length ? 'Algunos addons no responden. Revisa el detalle debajo.' : 'No hay fuentes reproducibles.', true);
    } catch (error) { if (current === streamNonce) tell(error.message, true); }
  }

  async function playSource(index) {
    const source = state.streams[index];
    if (!source?.supported) return;
    const nonce = ++streamNonce;
    stopVideo();
    state.activeSource = index;
    player.hidden = false;
    updatePlaybackControls();
    stopLive();
    const path = new URL(source.url).pathname.toLowerCase();
    try {
      if (path.endsWith('.m3u8') && !video.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (nonce !== streamNonce || overlay.hidden) return;
        if (!Hls.isSupported()) throw new Error('Este navegador no soporta HLS.');
        hls = new Hls();
        const instance = hls;
        await new Promise((resolve, reject) => {
          const onParsed = () => { instance.off(Hls.Events.ERROR, onError); resolve(); };
          const onError = (_event, data) => { if (data.fatal) { instance.off(Hls.Events.MANIFEST_PARSED, onParsed); reject(new Error('No se pudo cargar HLS.')); } };
          instance.once(Hls.Events.MANIFEST_PARSED, onParsed);
          instance.on(Hls.Events.ERROR, onError);
          instance.attachMedia(video);
          instance.loadSource(source.url);
        });
      } else video.src = source.url;
      if (nonce !== streamNonce || overlay.hidden) return;
      video.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      await video.play();
      if (nonce !== streamNonce || overlay.hidden) return;
      tell(`Reproduciendo ${source.name}`, true);
      const { subtitles } = await api(room, 'subtitles', { type: state.current.type, id: state.lastVideo });
      if (nonce !== streamNonce || overlay.hidden) return;
      state.subtitles = [...source.subtitles, ...subtitles];
      $('#sa-subtitles').innerHTML = state.subtitles.length ? `<label class="sa-episode-label">Subtítulos <select id="sa-subtitle"><option value="">Desactivados</option>${state.subtitles.map((s, i) => `<option value="${i}">${e(s.lang || 'Subtítulo')} · ${e(s.id || 'archivo')}</option>`).join('')}</select></label>` : '';
    } catch (error) {
      tell(`No se pudo iniciar la reproducción: ${error.message}`, true);
    }
  }

  async function chooseSubtitle(value) {
    video.querySelectorAll('track').forEach((t) => t.remove());
    if (subtitleObjectUrl) URL.revokeObjectURL(subtitleObjectUrl);
    subtitleObjectUrl = '';
    if (value === '') return;
    const sub = state.subtitles[Number(value)];
    if (!sub) return;
    try {
      const response = await fetch(sub.url, { mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error('descarga fallida');
      const text = await response.text();
      if (text.length > 350000) throw new Error('subtítulo demasiado grande');
      const vtt = /^WEBVTT/i.test(text.trimStart()) ? text : 'WEBVTT\n\n' + text.replace(/^(\d+)\s*$/gm, '').replace(/(\d\d:\d\d:\d\d),(\d{3})/g, '$1.$2');
      subtitleObjectUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }));
      const track = document.createElement('track');
      track.kind = 'subtitles'; track.label = sub.lang || 'Subtítulos'; track.src = subtitleObjectUrl;
      track.default = true;
      video.append(track);
      track.addEventListener('load', () => { if (track.track) track.track.mode = 'showing'; }, { once: true });
    } catch {
      tell('No se pudo cargar el subtítulo (el servidor externo puede bloquear CORS).', true);
    }
  }

  open.onclick = async () => {
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    $('#sa-message').textContent = 'Cargando addons de la sala…';
    try { await refresh(); } catch (error) { tell(error.message); }
  };
  const close = () => {
    overlay.hidden = true; document.body.style.overflow = '';
    ++browseNonce; ++streamNonce; ++detailNonce; state.current = null; stopVideo();
    open.focus();
  };
  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay || event.target.closest('[data-act="close"]')) { close(); return; }
    if (event.target.closest('[data-act="back"]')) {
      ++streamNonce; ++detailNonce; stopVideo(); $('#sa-detail').hidden = true; $('#sa-browse').hidden = false; state.current = null; return;
    }
    const switcher = event.target.closest('[data-kind]');
    if (switcher && state.kind !== switcher.dataset.kind) {
      state.kind = switcher.dataset.kind;
      state.search = '';
      $('#sa-search-input').value = '';
      renderCatalogs();
      browse();
      return;
    }
    const seek = event.target.closest('[data-seek]');
    if (seek) { seekBy(Number(seek.dataset.seek)); return; }
    const action = event.target.closest('[data-act]');
    if (action?.dataset.act === 'toggle-play') {
      if (!state.streams[state.activeSource]?.supported) return;
      if (video.paused) video.play().catch((error) => tell(`No se pudo reproducir: ${error.message}`, true));
      else video.pause();
      return;
    }
    if (action?.dataset.act === 'fullscreen') {
      if (document.fullscreenElement === player) document.exitFullscreen?.();
      else player.requestFullscreen?.().catch(() => tell('No se pudo activar pantalla completa.', true));
      return;
    }
    const episode = event.target.closest('[data-episode]');
    if (episode) { await chooseEpisode(episode.dataset.episode); return; }
    const film = event.target.closest('[data-film]');
    if (film) { await detail(Number(film.dataset.film)); return; }
    const source = event.target.closest('[data-source]');
    if (source) { await playSource(Number(source.dataset.source)); return; }
    const remove = event.target.closest('[data-remove]');
    if (remove && state.owner && confirm('¿Eliminar este addon de la sala?')) {
      try { await api(room, 'remove', { addonId: remove.dataset.remove }); await refresh(); }
      catch (error) { tell(error.message); }
    }
  });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });
  $('#sa-catalog').onchange = (event) => { state.selected = Number(event.target.value); state.search = ''; $('#sa-search-input').value = ''; browse(); };
  $('#sa-search').onsubmit = (event) => { event.preventDefault(); state.search = $('#sa-search-input').value; browse(); };
  $('#sa-more').onclick = () => browse(true);
  $('#sa-install').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'), input = $('#sa-url');
    button.disabled = true; tell('Comprobando e instalando addon…');
    try { await api(room, 'install', { url: input.value }); input.value = ''; await refresh(); tell('Addon instalado correctamente.'); }
    catch (error) { tell(error.message); }
    finally { button.disabled = false; }
  };
  $('#sa-subtitles').onchange = (event) => { if (event.target.id === 'sa-subtitle') chooseSubtitle(event.target.value); };
  $('#sa-episodes').addEventListener('change', (event) => {
    if (event.target.id !== 'sa-season') return;
    const index = state.seasons.findIndex((group) => String(group.season) === event.target.value);
    if (index === -1) return;
    state.seasonIndex = index;
    state.episodeId = state.seasons[index].episodes[0].id;
    renderEpisodes();
    loadStreams(state.episodeId);
  });
  ['timeupdate', 'durationchange', 'loadedmetadata', 'progress', 'seeking', 'seeked', 'play', 'pause', 'ended', 'emptied'].forEach((event) => {
    video.addEventListener(event, updatePlaybackControls);
  });
  $('#sa-volume').oninput = (event) => { video.volume = Number(event.target.value); video.muted = false; };
  timeline.addEventListener('input', () => {
    scrubbing = true;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    $('#sa-time').textContent = `${formatPlaybackTime(duration * Number(timeline.value) / 1000)} / ${duration ? formatPlaybackTime(duration) : '--:--'}`;
    timeline.style.setProperty('--seek-fill', `${timeline.value / 10}%`);
  });
  timeline.addEventListener('change', () => {
    const bounds = seekBounds();
    if (bounds) {
      const proposed = video.duration * Number(timeline.value) / 1000;
      video.currentTime = Math.min(bounds.end, Math.max(bounds.start, proposed));
    }
    scrubbing = false;
    updatePlaybackControls();
  });
  video.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      seekBy(event.key === 'ArrowLeft' ? -10 : 10);
    } else if (event.key === ' ' || event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (video.paused) video.play().catch(() => {});
      else video.pause();
    }
  });
}
