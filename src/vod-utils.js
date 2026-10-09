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


/**
 * A finite VOD duration is enough to make a seek attempt: some browsers do
 * not populate HTMLMediaElement.seekable until after the first Range request.
 * Prefer a reported seekable window when one exists (e.g. HLS DVR).
 * A remuxed MKV delivered through a sequential pipe is never random-access.
 */
export function vodSeekRange(video, remux = false) {
  const duration = video?.duration;
  if (remux || !Number.isFinite(duration) || duration <= 0) return null;
  let start = 0, end = duration;
  try {
    if (video.seekable?.length) {
      start = Math.max(0, video.seekable.start(0));
      end = Math.min(duration, video.seekable.end(video.seekable.length - 1));
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    }
  } catch {
    return { start: 0, end: duration };
  }
  return { start, end, duration };
}

export function timeFromSlider(value, range) {
  if (!range) return null;
  const fraction = Math.max(0, Math.min(1000, Number(value))) / 1000;
  if (!Number.isFinite(fraction)) return null;
  return range.start + (range.end - range.start) * fraction;
}

export function sliderFromTime(time, range) {
  if (!range || !Number.isFinite(time)) return 0;
  return Math.round(1000 * Math.max(0, Math.min(1,
    (time - range.start) / (range.end - range.start))));
}

export function seekTarget(current, offset, start, end) {
  if (![current, offset, start, end].every(Number.isFinite) || end < start) return null;
  return Math.min(end, Math.max(start, current + offset));
}
