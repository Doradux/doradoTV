import { Film, Puzzle, X, Search, Play, ArrowLeft, Trash2, Plus } from 'lucide';
import { iconSvg, escapeHtml } from './ui.js';
import './stremio.css';

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
  open.innerHTML = `${iconSvg(Film, 'h-4 w-4')}<span>Cine y series</span>`;
  header.prepend(open);

  const overlay = document.createElement('div');
  overlay.className = 'sa-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<section class="sa-dialog" role="dialog" aria-modal="true" aria-label="Cine y series">
    <header class="sa-heading">
      <div class="sa-heading-title">${iconSvg(Film)}<div><strong>Cine y series</strong><small>Addons compartidos por la sala</small></div></div>
      <button class="sa-icon" data-act="close" aria-label="Cerrar">${iconSvg(X)}</button>
    </header>
    <div class="sa-layout">
      <aside class="sa-sidebar">
        <div class="sa-side-title">${iconSvg(Puzzle, 'h-4 w-4')} Addons de la sala</div>
        <div id="sa-addons" class="sa-addon-list"></div>
        <form id="sa-install" class="sa-install" hidden>
          <label for="sa-url">Instalar addon</label>
          <input id="sa-url" type="text" inputmode="url" placeholder="https://ejemplo.com/manifest.json o stremio://..." maxlength="1500" required autocomplete="off" spellcheck="false">
          <button type="submit" class="sa-primary">${iconSvg(Plus, 'h-4 w-4')} Instalar</button>
          <small>Solo el propietario puede modificar los addons. Utiliza fuentes autorizadas y de confianza.</small>
        </form>
      </aside>
      <div class="sa-main">
        <div id="sa-browse">
          <div class="sa-toolbar">
            <select id="sa-catalog" aria-label="Elegir catálogo"></select>
            <form id="sa-search"><input id="sa-search-input" type="search" placeholder="Buscar películas o series…" maxlength="100" aria-label="Buscar películas o series"><button type="submit" class="sa-icon" aria-label="Buscar">${iconSvg(Search)}</button></form>
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
            <video id="sa-video" controls playsinline preload="none"></video>
            <div id="sa-subtitles"></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
  app.append(overlay);
  const $ = (selector) => overlay.querySelector(selector);
  const state = { addons: [], catalogs: [], metas: [], owner: false, selected: 0, skip: 0, search: '', current: null, streams: [], subtitles: [], lastVideo: '' };
  let hls = null, subtitleObjectUrl = '', browseNonce = 0, streamNonce = 0;
  const video = $('#sa-video');
  const tell = (message, detail = false) => { $(detail ? '#sa-stream-status' : '#sa-message').textContent = message; };
  const stopVideo = () => {
    video.pause();
    hls?.destroy(); hls = null;
    video.removeAttribute('src');
    video.querySelectorAll('track').forEach((t) => t.remove());
    video.load();
    if (subtitleObjectUrl) URL.revokeObjectURL(subtitleObjectUrl);
    subtitleObjectUrl = '';
  };
  const catalogLabel = (c) => `${c.addon.manifest.name} · ${c.catalog.name}`;
  const addOnMarkup = (addon) => `<div class="sa-addon"><div><strong>${e(addon.manifest.name)}</strong><small>${e(addon.manifest.description || addon.manifest.id)}</small></div>${state.owner ? `<button type="button" title="Eliminar addon" aria-label="Eliminar ${e(addon.manifest.name)}" data-remove="${e(addon.id)}">${iconSvg(Trash2, 'h-4 w-4')}</button>` : ''}</div>`;

  function renderAddons() {
    $('#sa-install').hidden = !state.owner;
    $('#sa-addons').innerHTML = state.addons.length ? state.addons.map(addOnMarkup).join('') : '<p class="sa-muted">Aún no hay addons instalados.</p>';
    state.catalogs = state.addons.flatMap((addon) => addon.manifest.catalogs.filter((c) => !c.required).map((catalog) => ({ addon, catalog })));
    $('#sa-catalog').innerHTML = state.catalogs.length
      ? state.catalogs.map((c, i) => `<option value="${i}">${e(catalogLabel(c))}</option>`).join('')
      : '<option value="">No hay catálogos disponibles</option>';
    state.selected = 0;
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
    const selection = state.catalogs[state.selected];
    if (!selection) {
      state.metas = [];
      $('#sa-grid').innerHTML = '<p class="sa-muted">El propietario puede instalar un addon con catálogo para comenzar.</p>';
      $('#sa-more').hidden = true; tell(''); return;
    }
    tell('Cargando catálogo…');
    try {
      const query = state.search.trim();
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

  async function detail(index) {
    const preview = state.metas[index];
    if (!preview) return;
    stopVideo(); ++streamNonce;
    state.current = preview;
    $('#sa-browse').hidden = true;
    $('#sa-detail').hidden = false;
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${poster(preview)}<div><h2>${e(preview.name)}</h2><p>${e(preview.description || '')}</p><small>${preview.type === 'series' ? 'Serie' : 'Película'} · ${e(preview.releaseInfo || '')}</small></div></div>`;
    $('#sa-episodes').innerHTML = '';
    $('#sa-streams').innerHTML = '';
    $('#sa-subtitles').innerHTML = '';
    tell('Cargando información…', true);
    let info = preview;
    try { info = (await api(room, 'meta', { addonId: preview.addonId, type: preview.type, id: preview.id })).meta; }
    catch { /* A stream-only addon can still offer a playable movie. */ }
    if (state.current !== preview) return;
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${poster(info)}<div><h2>${e(info.name || preview.name)}</h2><p>${e(info.description || preview.description || '')}</p><small>${info.type === 'series' ? 'Serie' : 'Película'} · ${e(info.releaseInfo || '')}</small></div></div>`;
    const episodes = info.type === 'series' ? (info.videos || []).filter((v) => v.id) : [];
    if (episodes.length) {
      $('#sa-episodes').innerHTML = `<label class="sa-episode-label">Episodio <select id="sa-episode">${episodes.map((ep) => `<option value="${e(ep.id)}">T${ep.season ?? '?'} E${ep.episode ?? '?'} — ${e(ep.title || ep.id)}</option>`).join('')}</select></label>`;
      $('#sa-episode').onchange = (event) => loadStreams(event.target.value);
      await loadStreams(episodes[0].id);
    } else if (info.type === 'movie') {
      await loadStreams(info.id);
    } else {
      tell('Este addon no proporciona la lista de episodios.', true);
    }
  }

  async function loadStreams(id) {
    const current = ++streamNonce;
    state.lastVideo = id;
    stopVideo();
    $('#sa-subtitles').innerHTML = '';
    $('#sa-streams').innerHTML = '';
    tell('Buscando fuentes de reproducción…', true);
    try {
      const { streams } = await api(room, 'streams', { type: state.current.type, id });
      if (current !== streamNonce) return;
      state.streams = streams;
      $('#sa-streams').innerHTML = streams.length ? streams.map((s, i) => `<button type="button" class="sa-source" data-source="${i}" ${s.supported ? '' : 'disabled'}>
        ${iconSvg(Play, 'h-4 w-4')}<span><strong>${e(s.name)}</strong><small>${e(s.title || (s.supported ? 'Reproducción directa' : `Formato ${s.kind} no compatible con el navegador`))}</small></span></button>`).join('') : '<p class="sa-muted">Ningún addon devolvió fuentes para este título.</p>';
      tell(streams.length ? 'Elige una fuente para reproducir.' : 'No hay fuentes disponibles.', true);
    } catch (error) { if (current === streamNonce) tell(error.message, true); }
  }

  async function playSource(index) {
    const source = state.streams[index];
    if (!source?.supported) return;
    const nonce = ++streamNonce;
    stopVideo();
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
    ++browseNonce; ++streamNonce; state.current = null; stopVideo();
    open.focus();
  };
  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay || event.target.closest('[data-act="close"]')) { close(); return; }
    if (event.target.closest('[data-act="back"]')) {
      ++streamNonce; stopVideo(); $('#sa-detail').hidden = true; $('#sa-browse').hidden = false; state.current = null; return;
    }
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
    try {
      const url = input.value.trim().replace(/^stremio:\/\//i, 'https://');
      const { addon } = await api(room, 'install', { url });
      input.value = '';
      await refresh();
      tell(addon.manifest.catalogs.length
        ? 'Addon instalado correctamente.'
        : 'Addon instalado. Solo proporciona fuentes de reproducción; instala también un catálogo como Cinemeta para buscar películas y series.');
    }
    catch (error) { tell(error.message); }
    finally { button.disabled = false; }
  };
  $('#sa-subtitles').onchange = (event) => { if (event.target.id === 'sa-subtitle') chooseSubtitle(event.target.value); };
}
