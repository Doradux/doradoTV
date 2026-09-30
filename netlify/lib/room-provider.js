import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import ipaddr from 'ipaddr.js';
import { privateId } from './room-security.js';

export function providerAccount(value) {
  try {
    const url = new URL(value);
    const match = url.pathname.match(/^\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)\.(?:ts|m3u8)$/i);
    if (!match || !['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return { origin: url.origin, username: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]) };
  } catch { return null; }
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
export function channelProvider(channel, roomId, env = process.env) {
  const account = providerAccount(channel.url);
  return account ? privateId(JSON.stringify(account), env) : `room-${roomId}`;
}
