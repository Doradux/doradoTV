export function formatPlaybackTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remaining}` : `${minutes}:${remaining}`;
}

export function seasonGroups(videos = []) {
  const groups = new Map();
  for (const episode of videos) {
    if (!episode || typeof episode.id !== 'string' || !episode.id) continue;
    const season = Number.isInteger(episode.season) && episode.season >= 0 ? episode.season : -1;
    if (!groups.has(season)) groups.set(season, []);
    groups.get(season).push(episode);
  }
  const order = (season) => season === -1 ? Number.MAX_SAFE_INTEGER : season === 0 ? Number.MAX_SAFE_INTEGER - 1 : season;
  return [...groups.entries()]
    .sort(([a], [b]) => order(a) - order(b))
    .map(([season, episodes]) => ({
      season,
      label: season === -1 ? 'Sin temporada' : season === 0 ? 'Especiales' : `Temporada ${season}`,
      episodes: episodes.sort((a, b) => (a.episode ?? Infinity) - (b.episode ?? Infinity) || (a.title || '').localeCompare(b.title || '', 'es')),
    }));
}

export function seekTarget(current, offset, start, end) {
  if (![current, offset, start, end].every(Number.isFinite) || end < start) return null;
  return Math.min(end, Math.max(start, current + offset));
}
