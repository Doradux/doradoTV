import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import ipaddr from 'ipaddr.js';
import { privateId } from './room-security.js';

function providerStream(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)\.(?:ts|m3u8)$/i);
    if (!match || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return { origin: url.origin, username: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]), streamId: match[3] };
  } catch { return null; }
}
export function providerAccount(value) {
  const provider = providerStream(value);
  return provider ? { origin: provider.origin, username: provider.username, password: provider.password } : null;
}
export function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
// Pin the validated DNS result to the actual connection. Do not follow redirects.
export async function fetchProviderJson(url) {
  if (!['https:', 'http:'].includes(url.protocol) || (url.port && !['80', '443'].includes(url.port))) throw new Error('Unsupported provider');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await Promise.race([lookup(hostname, { all: true }), new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), 3000); timer.unref();
  })]);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Private provider');
  const pinned = addresses[0];
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { lookup: (_host, options, callback) => options.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family) }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('Provider unavailable')); return; }
      let bytes = 0; const chunks = [];
      res.on('data', (chunk) => { bytes += chunk.length; if (bytes > 256 * 1024) req.destroy(new Error('Response too large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    });
    const timer = setTimeout(() => req.destroy(new Error('Provider timeout')), 4000);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject); req.end();
  });
}
export async function detectProviders(channels, env = process.env, fetcher = fetchProviderJson) {
  const accounts = new Map();
  for (const channel of channels) {
    const account = providerAccount(channel.url);
    if (!account) continue;
    const id = privateId(JSON.stringify(account), env);
    if (!accounts.has(id)) accounts.set(id, account);
  }
  // Bound external work even for maliciously crafted lists.
  const entries = [...accounts].slice(0, 8);
  return Promise.all(entries.map(async ([id, account]) => {
    let maximum = null;
    try {
      const url = new URL('/player_api.php', account.origin);
      url.search = new URLSearchParams({ username: account.username, password: account.password });
      const result = await fetcher(url);
      const value = Number(result?.user_info?.max_connections);
      if (Number.isSafeInteger(value) && value > 0) maximum = value;
    } catch { /* Unknown must not be advertised as unlimited at the provider. */ }
    return { id, maximum };
  }));
}
const programmeCache = new Map();
function decodeProgramme(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text || !/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4) return text || null;
  try {
    const decoded = Buffer.from(text, 'base64').toString('utf8').trim();
    const roundTrip = Buffer.from(decoded, 'utf8').toString('base64').replace(/=+$/, '');
    return decoded && roundTrip === text.replace(/=+$/, '') ? decoded : text;
  } catch { return text; }
}
export async function currentProgram(channelUrl, fetcher = fetchProviderJson, clock = () => Math.floor(Date.now() / 1000)) {
  const provider = providerStream(channelUrl);
  if (!provider) return null;
  const key = `${provider.origin}\u0000${provider.username}\u0000${provider.password}\u0000${provider.streamId}`;
  const hit = programmeCache.get(key);
  if (hit?.expires > clock()) return hit.value;
  if (hit?.pending) return hit.pending;
  const pending = (async () => {
    try {
      const url = new URL('/player_api.php', provider.origin);
      url.search = new URLSearchParams({ username: provider.username, password: provider.password, action: 'get_short_epg', stream_id: provider.streamId, limit: '6' });
      const result = await fetcher(url);
      const now = clock();
      const current = result?.epg_listings?.find((item) => Number(item.start_timestamp) <= now && Number(item.stop_timestamp) > now);
      const value = decodeProgramme(current?.title);
      programmeCache.set(key, { value, expires: now + 45 });
      return value;
    } catch {
      programmeCache.set(key, { value: null, expires: clock() + 20 });
      return null;
    }
  })();
  programmeCache.set(key, { value: null, expires: 0, pending });
  return pending;
}
export function channelProvider(channel, roomId, env = process.env) {
  const account = providerAccount(channel.url);
  return account ? privateId(JSON.stringify(account), env) : `room-${roomId}`;
}
