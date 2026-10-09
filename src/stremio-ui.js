import { Film, Puzzle, Search, Play, ArrowLeft, Trash2, Plus, X } from 'lucide';
import { iconSvg, escapeHtml } from './ui.js';
import { seasonGroups } from './vod-utils.js';
import './stremio.css';
const e = escapeHtml;
const cover = (m) => m.poster ? `<img src="${e(m.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="sa-no-poster">${iconSvg(Film)}</span>`;
async function api(room, action, data) {
  const query = new URLSearchParams({ room, action });
  const response = await fetch(`/.netlify/functions/addons?${query}`, {
    method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store',
    ...(data === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, ...data }) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(result.error || `Error al consultar contenido (${response.status}).`);
  return result;
}
export function mountRoomAddons(app, session, { player }) {
  const room = session.slug;
  const open = document.createElement('button');
  open.type = 'button'; open.className = 'sa-open';
  open.innerHTML = `${iconSvg(Puzzle, 'h-4 w-4')}<span>Gestión de addons</span>`;
  if (session.owner) app.querySelector('.header-actions').prepend(open);
  const cinema = document.createElement('section');
  cinema.id = 'sa-cinema-page'; cinema.className = 'sa-cinema-page'; cinema.hidden = true;
  cinema.innerHTML = `<div class="sa-cinema-head">
    <form id="sa-search" role="search" class="sa-search">
      <label class="sr-only" for="sa-search-input">Buscar títulos</label>
      <input id="sa-search-input" type="search" placeholder="Buscar películas y series…" minlength="2" maxlength="100" autocomplete="off">
      <button type="submit" title="Buscar" aria-label="Buscar">${iconSvg(Search, 'h-4 w-4')}</button>
    </form></div>
    <div id="sa-browse" class="sa-browser-stage">
      <p id="sa-message" class="sa-message" role="status"></p><div id="sa-grid" class="sa-grid"></div>
    </div>
    <div id="sa-detail" class="sa-browser-stage" hidden>
      <button type="button" class="sa-back" data-act="back">${iconSvg(ArrowLeft, 'h-4 w-4')} Resultados</button>
      <div id="sa-detail-meta"></div><div id="sa-episodes"></div>
      <p id="sa-stream-status" class="sa-message" role="status"></p>
      <div id="sa-streams" class="sa-streams"></div>
    </div>`;
  app.querySelector('.channel-panel').append(cinema);
  const manage = document.createElement('div');
  manage.className = 'sa-overlay'; manage.hidden = true;
  manage.innerHTML = `<section class="sa-manage-dialog" role="dialog" aria-modal="true" aria-label="Gestión de addons">
    <header class="sa-heading"><div class="sa-heading-title">${iconSvg(Puzzle)}<div><strong>Gestión de addons</strong></div></div>
      <button class="sa-icon" data-manage-close aria-label="Cerrar">${iconSvg(X)}</button></header>
    <div class="sa-sidebar"><div id="sa-addons" class="sa-addon-list"></div>
      <form id="sa-install" class="sa-install" hidden>
        <label for="sa-url">Instalar addon</label>
        <input id="sa-url" type="text" inputmode="url" placeholder="https://.../manifest.json o stremio://..." maxlength="1500" required>
        <button type="submit" class="sa-primary">${iconSvg(Plus, 'h-4 w-4')} Instalar</button>
        <small>Utiliza únicamente fuentes autorizadas.</small>
      </form></div><p id="sa-manage-status" class="sa-message" role="status"></p></section>`;
  app.append(manage);
  const $ = (sel) => cinema.querySelector(sel) || manage.querySelector(sel);
  const state = { addons: [], owner: false, query: '', metas: [], current: null,
    seasons: [], episodeId: '', streams: [], searchToken: 0, detailToken: 0, streamToken: 0, loaded: false };
  const visible = () => !cinema.hidden;
  const say = (message, detail = false) => { $(detail ? '#sa-stream-status' : '#sa-message').textContent = message; };
  const cards = (metas) => metas.map((m, i) => `<button class="sa-card" type="button" data-film="${i}" style="--card-index:${Math.min(i, 24)}">
    ${cover(m)}<span>${e(m.name || 'Sin título')}</span>
    <small>${m.type === 'series' ? 'Serie' : 'Película'}</small></button>`).join('');
  function renderAddons() {
    $('#sa-install').hidden = !state.owner;
    $('#sa-addons').innerHTML = state.addons.length ? state.addons.map((a) =>
      `<div class="sa-addon"><div><strong>${e(a.manifest.name)}</strong><small>${e(a.manifest.description || '')}</small></div>
      ${state.owner ? `<button type="button" data-remove="${e(a.id)}" aria-label="Eliminar ${e(a.manifest.name)}">${iconSvg(Trash2, 'h-4 w-4')}</button>` : ''}</div>`
    ).join('') : '<p class="sa-muted">No hay addons instalados.</p>';
  }
  async function refresh() {
    const response = await api(room, 'list');
    state.addons = response.addons; state.owner = response.owner; state.loaded = true; renderAddons();
  }
  async function browse() {
    const token = ++state.searchToken, query = state.query.trim();
    if (query.length < 2) {
      say(query ? 'Escribe al menos dos caracteres.' : '');
      $('#sa-grid').innerHTML = '<p class="sa-muted">Busca una película o serie.</p>';
      return;
    }
    say('Buscando…');
    $('#sa-grid').classList.add('is-loading');
    try {
      const data = await api(room, 'search', { type: 'all', search: query });
      if (token !== state.searchToken || !visible()) return;
      state.metas = data.metas;
      $('#sa-grid').innerHTML = cards(state.metas) || '<p class="sa-muted">No hay resultados.</p>';
      say(state.metas.length ? '' : 'No se encontraron títulos.');
    } catch (error) {
      if (token === state.searchToken) say(error.message);
    } finally { if (token === state.searchToken) $('#sa-grid').classList.remove('is-loading'); }
  }
  function swap(detail) {
    $('#sa-browse').hidden = detail; $('#sa-detail').hidden = !detail;
    const target = detail ? $('#sa-detail') : $('#sa-browse');
    target.classList.remove('is-entering'); void target.offsetWidth; target.classList.add('is-entering');
  }
  const episodes = () => state.seasons.flatMap((group) => group.episodes);
  const navigation = () => {
    const list = episodes(), i = list.findIndex((ep) => ep.id === state.episodeId);
    return { previous: i > 0 ? () => chooseEpisode(list[i - 1].id, { autoplay: true }) : null,
      next: i >= 0 && i < list.length - 1 ? () => chooseEpisode(list[i + 1].id, { autoplay: true }) : null };
  };
  function drawEpisodes() {
    if (!state.seasons.length) { $('#sa-episodes').replaceChildren(); player.setNavigation({}); return; }
    const group = state.seasons.find((s) => s.episodes.some((ep) => ep.id === state.episodeId)) || state.seasons[0];
    $('#sa-episodes').innerHTML = `<label class="sa-seasons" for="sa-season"><span>Temporada</span>
      <select id="sa-season">${state.seasons.map((s) =>
        `<option value="${s.season}" ${s === group ? 'selected' : ''}>${e(s.label)}</option>`).join('')}</select></label>
      <div class="sa-episode-list">${group.episodes.map((ep) =>
        `<button type="button" class="sa-episode ${ep.id === state.episodeId ? 'is-active' : ''}" data-episode="${e(ep.id)}" aria-pressed="${ep.id === state.episodeId}">
          <span><small>${Number.isInteger(ep.episode) ? `E${ep.episode}` : ''}</small><strong>${e(ep.title || 'Episodio')}</strong></span></button>`).join('')}</div>`;
    player.setNavigation(navigation());
  }
  async function chooseEpisode(id, { autoplay = false } = {}) {
    if (!episodes().some((ep) => ep.id === id)) return;
    state.episodeId = id;
    drawEpisodes();
    await loadStreams(id);
    if (autoplay) {
      const index = state.streams.findIndex((source) => source.supported || (source.kind === 'torrent' && source.infoHash));
      if (index >= 0) await playSource(index);
    }
  }
  async function detail(index) {
    const preview = state.metas[index];
    if (!preview) return;
    const token = ++state.detailToken; ++state.streamToken;
    state.current = preview; state.seasons = []; state.episodeId = '';
    player.setNavigation({});
    swap(true);
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${cover(preview)}<div><h2>${e(preview.name)}</h2></div></div>`;
    $('#sa-episodes').replaceChildren(); $('#sa-streams').replaceChildren(); say('Cargando…', true);
    let info = preview;
    try { info = (await api(room, 'meta', { addonId: preview.addonId, type: preview.type, id: preview.id })).meta || preview; }
    catch { /* Partial metadata is still useful. */ }
    if (token !== state.detailToken || !visible()) return;
    $('#sa-detail-meta').innerHTML = `<div class="sa-feature">${cover(info)}<div><h2>${e(info.name || preview.name)}</h2>
      <small>${e(info.releaseInfo || '')}</small><p>${e(info.description || '')}</p></div></div>`;
    state.seasons = preview.type === 'series' ? seasonGroups(info.videos) : [];
    if (preview.type === 'series' && !state.seasons.length) { say('No hay episodios disponibles.', true); return; }
    if (state.seasons.length) {
      state.episodeId = state.seasons[0].episodes[0].id;
      drawEpisodes();
      await loadStreams(state.episodeId);
    } else await loadStreams(info.id || preview.id);
  }
  async function loadStreams(id) {
    const token = ++state.streamToken;
    $('#sa-streams').replaceChildren(); say('Buscando fuentes…', true);
    try {
      const response = await api(room, 'streams', { type: state.current.type, id });
      if (token !== state.streamToken || !visible()) return;
      state.streams = response.streams.sort((a, b) => (b.seeders ?? -1) - (a.seeders ?? -1));
      $('#sa-streams').innerHTML = state.streams.map((s, i) =>
        `<button class="sa-source" type="button" data-source="${i}" style="--card-index:${Math.min(i, 24)}">
          ${iconSvg(Play, 'h-4 w-4')}<span><strong>${e(s.name)}</strong>
          <small>${e(s.title || (s.kind === 'torrent' ? 'Torrent' : 'Vídeo'))}</small>
          ${s.seeders == null ? '' : `<small>${s.seeders.toLocaleString('es')} seeders</small>`}</span></button>`).join('') ||
          '<p class="sa-muted">No hay fuentes disponibles.</p>';
      say(!state.streams.length && response.warnings?.length ? 'No se han podido cargar las fuentes.' : '', true);
    } catch (error) { if (token === state.streamToken) say(error.message, true); }
  }
  async function playSource(index) {
    const source = state.streams[index];
    if (!source || !state.current) return;
    if (source.kind !== 'torrent' && !source.supported) { say('Formato no reproducible en el navegador.', true); return; }
    if (source.kind === 'torrent' && !source.infoHash) { say('La fuente torrent no contiene un identificador válido.', true); return; }
    $('#sa-streams').querySelectorAll('[data-source]').forEach((b) =>
      b.setAttribute('aria-pressed', String(Number(b.dataset.source) === index)));
    const title = state.current.type === 'series'
      ? `${state.current.name} · ${episodes().find((ep) => ep.id === state.episodeId)?.title || 'Episodio'}`
      : state.current.name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try { await player.play({ source, title, navigation: state.current.type === 'series' ? navigation() : {} }); say('', true); }
    catch (err) { say(err.message, true); }
  }
  function show() {
    cinema.hidden = false;
    if (!state.loaded) refresh().catch((err) => say(err.message));
    if (!state.query) $('#sa-grid').innerHTML = '<p class="sa-muted">Busca una película o serie.</p>';
  }
  function hide() { cinema.hidden = true; ++state.searchToken; ++state.detailToken; ++state.streamToken; }
  $('#sa-search').onsubmit = (event) => { event.preventDefault(); state.query = $('#sa-search-input').value; browse(); };
  cinema.addEventListener('click', async (event) => {
    if (event.target.closest('[data-act="back"]')) { ++state.detailToken; ++state.streamToken; swap(false); return; }
    const film = event.target.closest('[data-film]');
    if (film) return detail(Number(film.dataset.film));
    const episode = event.target.closest('[data-episode]');
    if (episode) return chooseEpisode(episode.dataset.episode);
    const source = event.target.closest('[data-source]');
    if (source) return playSource(Number(source.dataset.source));
  });
  cinema.addEventListener('change', (event) => {
    if (event.target.id === 'sa-season') {
      const group = state.seasons.find((s) => String(s.season) === event.target.value);
      if (group?.episodes.length) chooseEpisode(group.episodes[0].id);
    }
  });
  const closeManage = () => { manage.hidden = true; document.body.style.overflow = ''; open.focus(); };
  open.onclick = async () => {
    manage.hidden = false; document.body.style.overflow = 'hidden'; $('#sa-manage-status').textContent = '';
    try { await refresh(); } catch (err) { $('#sa-manage-status').textContent = err.message; }
  };
  manage.addEventListener('click', async (event) => {
    if (event.target === manage || event.target.closest('[data-manage-close]')) return closeManage();
    const button = event.target.closest('[data-remove]');
    if (button && state.owner && confirm('¿Eliminar este addon?')) {
      try {
        await api(room, 'remove', { addonId: button.dataset.remove });
        await refresh(); $('#sa-manage-status').textContent = 'Addon eliminado.';
      } catch (err) { $('#sa-manage-status').textContent = err.message; }
    }
  });
  manage.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeManage(); });
  $('#sa-install').onsubmit = async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button'), input = $('#sa-url');
    button.disabled = true; $('#sa-manage-status').textContent = 'Instalando…';
    try {
      await api(room, 'install', { url: input.value.trim().replace(/^stremio:\/\//i, 'https://') });
      input.value = ''; await refresh(); $('#sa-manage-status').textContent = 'Addon instalado.';
    } catch (err) { $('#sa-manage-status').textContent = err.message; }
    finally { button.disabled = false; }
  };
  return { show, hide };
}
