// Static, safe loading state while server-side and browser-CORS addons respond.
// The result UI replaces it atomically when the current search finishes.
export function sourcesLoadingMarkup(providerCount = 1) {
  const count = Math.max(1, Math.min(99, Number(providerCount) || 1));
  return `<div class="sa-sources-loading" role="status" aria-live="polite" aria-label="Buscando fuentes de vídeo">
    <div class="sa-sources-loading-head">
      <span class="sa-sources-loading-icon" aria-hidden="true">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="10.8" cy="10.8" r="6.3"></circle><path d="m15.4 15.4 4.2 4.2"></path>
        </svg>
      </span>
      <span class="sa-sources-loading-copy">
        <strong>Buscando fuentes</strong>
        <small>Consultando ${count} ${count === 1 ? 'origen' : 'orígenes'} de vídeo…</small>
      </span>
      <span class="sa-sources-loading-pulse" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>
    <div class="sa-sources-loading-progress" aria-hidden="true"><span></span></div>
    <div class="sa-sources-loading-items" aria-hidden="true">
      ${[0, 1, 2].map((index) => `<div class="sa-source-skeleton" style="--skeleton-index:${index}">
        <span class="sa-skeleton-play"></span>
        <span class="sa-skeleton-content"><span class="sa-skeleton-line sa-skeleton-title"></span>
          <span class="sa-skeleton-line sa-skeleton-subtitle"></span>
          <span class="sa-skeleton-line sa-skeleton-caption"></span></span>
      </div>`).join('')}
    </div>
    <p class="sa-sources-loading-footnote">Las opciones aparecerán aquí cuando respondan los addons.</p>
  </div>`;
}
// These placeholders reuse the cinema palette, and never contain private addon URLs.
export function searchLoadingMarkup() {
  return `<div class="sa-search-loading" role="status" aria-live="polite" aria-label="Buscando películas y series">
    <div class="sa-search-loading-head"><span class="sa-search-loading-indicator" aria-hidden="true"></span>
      <span>Buscando en tus catálogos…</span></div>
    <div class="sa-search-loading-grid" aria-hidden="true">
      ${Array.from({length: 6}, (_, index) => `<div class="sa-search-placeholder" style="--skeleton-index:${index}">
        <div class="sa-search-poster-shimmer"></div><span class="sa-skeleton-line sa-skeleton-title"></span>
        <span class="sa-skeleton-line sa-skeleton-subtitle"></span>
      </div>`).join('')}
    </div>
  </div>`;
}

export function detailLoadingMarkup(title = '') {
  // The caller supplies a pre-escaped title from escapeHtml().
  return `<div class="sa-detail-loading" role="status" aria-live="polite" aria-label="Cargando información del título">
    <div class="sa-detail-loading-poster" aria-hidden="true"></div>
    <div class="sa-detail-loading-info">
      <span class="sa-detail-loading-eyebrow">CINE Y SERIES</span>
      <strong>${title}</strong>
      <span class="sa-detail-loading-label"><span class="sa-search-loading-indicator" aria-hidden="true"></span>
        Preparando ficha y fuentes…</span>
      <div class="sa-detail-loading-lines" aria-hidden="true">
        <span class="sa-skeleton-line sa-skeleton-title"></span>
        <span class="sa-skeleton-line"></span>
        <span class="sa-skeleton-line sa-skeleton-subtitle"></span>
      </div>
    </div>
  </div>`;
}
