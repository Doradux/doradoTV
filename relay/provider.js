const cache = new Map();

export function providerFromChannel(value) {
  try {
    const url = new URL(value);
    const [, kind, username, password, stream] = url.pathname.split('/');
    if (!['live', 'play'].includes(kind) || !username || !password || !/^\d+\.ts$/i.test(stream || '')) return null;
    return { api: new URL('/player_api.php', url), username, password, streamId: stream.slice(0, -3) };
  } catch { return null; }
}

async function requestProvider(provider, params, ttl, fetcher, now) {
  const url = new URL(provider.api);
  url.search = new URLSearchParams({ username: provider.username, password: provider.password, ...params });
  const key = url.href;
  const hit = cache.get(key);
  if (hit && hit.until > now()) return hit.value;
  try {
    const response = await fetcher(url, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return null;
    const value = await response.json();
    cache.set(key, { value, until: now() + ttl });
    return value;
  } catch { return null; }
}

export async function providerStatus(channelUrl, fetcher = fetch, now = () => Math.floor(Date.now() / 1000)) {
  const provider = providerFromChannel(channelUrl);
  if (!provider) return { connections: null, program: null };
  const [account, epg] = await Promise.all([
    requestProvider(provider, {}, 4, fetcher, now),
    requestProvider(provider, { action: 'get_short_epg', stream_id: provider.streamId, limit: '6' }, 60, fetcher, now),
  ]);
  const count = account?.user_info?.active_cons;
  const current = epg?.epg_listings?.find((item) => Number(item.start_timestamp) <= now() && Number(item.stop_timestamp) > now());
  let program = null;
  if (current?.title) {
    try { program = Buffer.from(current.title, 'base64').toString('utf8').trim(); }
    catch { program = String(current.title); }
  }
  return { connections: count !== null && count !== undefined && Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : null, program };
}
