// Display helpers only. Never put signed stream URLs or addon secrets into search UI.
export function normalizeFilmQuery(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
export function filmScore(meta, query) {
  const title = normalizeFilmQuery(meta?.name), needle = normalizeFilmQuery(query);
  if (!needle || !title) return 0;
  const words = needle.split(' ');
  const all = words.every(w => title.split(' ').some(t => t.startsWith(w)));
  let score = title === needle ? 1000 : title.startsWith(needle) ? 750
    : title.includes(' ' + needle) ? 550 : title.includes(needle) ? 400
      : all ? 250 : 0;
  if (!score) score = Math.round(words.filter(w => title.includes(w)).length / words.length * 90);
  if (meta.poster) score += 12;
  if (String(meta.id || '').startsWith('tt')) score += 4;
  return score;
}
export function rankFilmResults(results, query, limit = 100) {
  const distinct = new Map();
  for (const meta of results) {
    if (!meta || (meta.type !== 'movie' && meta.type !== 'series') ||
      typeof meta.id !== 'string' || typeof meta.name !== 'string' ||
      !meta.id || !meta.name) continue;
    const key = meta.type + ':' + meta.id.toLowerCase();
    const old = distinct.get(key);
    if (!old || (!old.poster && meta.poster) || (old.poster === meta.poster &&
      filmScore(meta, query) > filmScore(old, query))) distinct.set(key, meta);
  }
  return [...distinct.values()].sort((a, b) => filmScore(b, query) - filmScore(a, query)
    || a.name.localeCompare(b.name, 'es')).slice(0, Math.max(1, Math.min(100, limit)));
}
