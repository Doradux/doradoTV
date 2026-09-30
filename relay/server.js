import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import ipaddr from 'ipaddr.js';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RelayRegistry } from './registry.js';

const SESSION_TTL = 60;
const IDLE_GRACE = 7;
const STARTUP_TIMEOUT = 35;
const SEGMENT = /^segment_[0-9]{9,}\.ts$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sameSecret(given, expected) {
  const a = Buffer.from(given || '');
  const b = Buffer.from(expected || '');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function normalizeUserId(value) {
  const id = String(value || '');
  return /^[a-zA-Z0-9._:-]{1,128}$/.test(id) ? id : null;
}

function publicAddress(address) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}

async function pinHttpChannel(value, resolver = lookup) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Canal inválido.'); }
  if (url.protocol !== 'http:' || url.username || url.password) throw new Error('El relay solo acepta señales HTTP públicas.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await Promise.race([
    resolver(hostname, { all: true }),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS timeout')), 3000);
      timer.unref();
    }),
  ]);
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('El canal no apunta a una red pública.');
  const pinned = new URL(url.href);
  pinned.hostname = addresses[0].address;
  return { original: url.href, pinned: pinned.href, host: url.host };
}

async function inspectHttpTarget(target) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(target.pinned, {
      method: 'GET',
      headers: { Host: target.host, 'User-Agent': 'VLC/3.0.18', Range: 'bytes=0-0' },
    }, (res) => {
      const result = { status: res.statusCode || 0, location: res.headers.location || null };
      res.destroy();
      resolve(result);
    });
    req.setTimeout(5000, () => req.destroy(new Error('Provider timeout')));
    req.on('error', reject);
    req.end();
  });
}

export async function resolveHttpChannel(value, resolver = lookup, inspect = inspectHttpTarget) {
  let current = value;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const target = await pinHttpChannel(current, resolver);
    const response = await inspect(target);
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      if (redirects === 4) throw new Error('Demasiadas redirecciones del proveedor.');
      current = new URL(response.location, target.original).href;
      continue;
    }
    if (response.status >= 200 && response.status < 300) return target;
    throw new Error('El proveedor no acepta la conexión del relay.');
  }
  throw new Error('No se pudo resolver la emisión.');
}

function json(response, status, data, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(JSON.stringify(data));
}

async function body(request) {
  let content = '';
  for await (const chunk of request) {
    content += chunk;
    if (content.length > 16_384) throw new Error('Solicitud demasiado grande.');
  }
  return JSON.parse(content || '{}');
}

export function createRelay({ directory, secret, publicUrl, appOrigin, maxConnections = 3, ffmpeg = 'ffmpeg', spawnProcess = spawn, resolveChannel = resolveHttpChannel, clock = () => Math.floor(Date.now() / 1000) }) {
  const missing = [];
  if (!directory) missing.push('DORADO_RELAY_DIR');
  if (!secret) missing.push('DORADO_RELAY_SECRET');
  if (!appOrigin) missing.push('DORADO_APP_ORIGIN');
  if (!Number.isInteger(maxConnections) || maxConnections < 1) missing.push('DORADO_MAX_CONNECTIONS');
  if (missing.length) throw new Error(`Falta configurar: ${missing.join(', ')}.`);
  const registry = new RelayRegistry(directory);
  const lockFile = join(directory, 'worker.lock');
  try {
    const previous = Number(readFileSync(lockFile, 'utf8'));
    if (Number.isInteger(previous) && previous > 0) {
      try { process.kill(previous, 0); throw new Error('Ya hay un relay activo en este host.'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    rmSync(lockFile, { force: true });
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const lock = openSync(lockFile, 'wx', 0o600);
  writeFileSync(lock, String(process.pid));
  closeSync(lock);
  const processes = new Map();
  const now = clock;
  let configuredOrigin = null;
  if (publicUrl) {
    const publicBase = new URL(publicUrl);
    const publicIsLocal = ['localhost', '127.0.0.1', '::1'].includes(publicBase.hostname);
    if (publicBase.protocol !== 'https:' && !(publicIsLocal && publicBase.protocol === 'http:')) throw new Error('DORADO_RELAY_PUBLIC_URL debe usar HTTPS.');
    configuredOrigin = publicBase.origin;
  }
  const mediaOrigin = configuredOrigin || 'http://relay.invalid';
  const allowedOrigin = new URL(appOrigin).origin;
  const requestOrigin = (request) => {
    if (configuredOrigin) return configuredOrigin;
    const forwardedHost = String(request.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || String(request.headers.host || '').trim();
    if (!host || /[\\/\s]/.test(host)) throw new Error('Northflank aún no ha asignado un dominio público al puerto 5300.');
    const forwardedProto = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
    const hostname = host.replace(/^\[|\](?::\d+)?$/g, '').split(':')[0];
    const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
    const protocol = forwardedProto || (local ? 'http' : 'https');
    if (protocol !== 'https' && !(local && protocol === 'http')) throw new Error('El relay público debe usar HTTPS.');
    return new URL(`${protocol}://${host}`).origin;
  };
  const getCors = () => ({ 'Access-Control-Allow-Origin': allowedOrigin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin', 'Referrer-Policy': 'no-referrer' });

  // A restart invalidates all browser sessions and removes stale HLS output.
  registry.transaction((state) => {
    for (const emission of Object.values(state.emissions)) {
      if (emission.pid && Number.isInteger(emission.pid) && process.platform === 'linux') {
        try {
          const command = readFileSync(`/proc/${emission.pid}/cmdline`, 'utf8');
          if (command.includes(join(directory, emission.id, 'index.m3u8'))) process.kill(emission.pid, 'SIGKILL');
        } catch { /* Process already ended. */ }
      }
      rmSync(join(directory, emission.id), { recursive: true, force: true });
    }
    state.emissions = {};
    state.sessions = {};
    state.revoked_sessions = {};
    state.worker_seen = now();
  });

  function touch(id, token, userId, playing = true, refresh = true) {
    return registry.transaction((state) => {
      const session = state.sessions[id];
      if (!session || !sameSecret(token, session.token) || (userId !== undefined && session.user_id !== userId)) return null;
      const emission = state.emissions[session.emission_id];
      if (!playing || now() - session.last_seen > SESSION_TTL || !emission || !['starting', 'running'].includes(emission.status)) {
        delete state.sessions[id];
        return null;
      }
      if (refresh) {
        session.last_seen = now();
        emission.last_viewer = now();
      }
      return emission;
    });
  }

  function tick() {
    registry.transaction((state) => {
      state.worker_seen = now();
      for (const [id, session] of Object.entries(state.sessions)) if (now() - session.last_seen > SESSION_TTL) delete state.sessions[id];
      for (const [id, revoked] of Object.entries(state.revoked_sessions || {})) if (now() - revoked.closed_at > 120) delete state.revoked_sessions[id];
      for (const [id, emission] of Object.entries(state.emissions)) {
        if (!['starting', 'running'].includes(emission.status)) continue;
        if (Object.values(state.sessions).some((session) => session.emission_id === id)) emission.last_viewer = now();
        else if (now() - emission.last_viewer >= IDLE_GRACE) emission.status = 'closed';
      }
    });
    const state = registry.transaction((value) => value);
    for (const [id, emission] of Object.entries(state.emissions)) {
      if (!['starting', 'running'].includes(emission.status)) {
        const child = processes.get(id);
        if (child) { child.kill('SIGTERM'); processes.delete(id); }
        rmSync(join(directory, id), { recursive: true, force: true });
        if (now() - emission.last_viewer > 120) registry.transaction((value) => { delete value.emissions[id]; });
        continue;
      }
      const output = join(directory, id);
      const playlist = join(output, 'index.m3u8');
      if (!processes.has(id)) {
        mkdirSync(output, { recursive: true, mode: 0o700 });
        const child = spawnProcess(ffmpeg, [
          '-nostdin', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '15000000', '-user_agent', 'VLC/3.0.18',
          '-max_redirects', '0', '-headers', `Host: ${emission.host_header}\r\n`, '-i', emission.input_url,
          '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
          '-f', 'hls', '-hls_time', '4', '-hls_list_size', '6', '-hls_delete_threshold', '2',
          '-hls_flags', 'delete_segments+temp_file', '-hls_segment_filename', join(output, 'segment_%09d.ts'), playlist,
        ], { stdio: 'ignore' });
        child.on('error', () => { registry.transaction((value) => { if (value.emissions[id]) value.emissions[id].status = 'failed'; }); });
        processes.set(id, child);
        registry.transaction((value) => { if (value.emissions[id]) value.emissions[id].pid = child.pid || null; });
      }
      const child = processes.get(id);
      const ready = existsSync(playlist);
      const stale = ready && now() - Math.floor(statSync(playlist).mtimeMs / 1000) > 35;
      if (child.exitCode !== null || (!ready && now() - emission.created_at > STARTUP_TIMEOUT) || stale) {
        child.kill('SIGTERM');
        processes.delete(id);
        registry.transaction((value) => { if (value.emissions[id]) value.emissions[id].status = 'failed'; });
      } else if (ready && emission.status !== 'running') {
        registry.transaction((value) => { if (value.emissions[id]) value.emissions[id].status = 'running'; });
      }
    }
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, mediaOrigin);
    const cors = getCors(request);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/media/')) {
      response.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET' }); response.end(); return;
    }
    const match = url.pathname.match(/^\/media\/([0-9a-f-]{36})\/(index\.m3u8|segment_[0-9]{9,}\.ts)$/);
    if (request.method === 'GET' && match) {
      if (request.headers.origin && request.headers.origin !== allowedOrigin) { json(response, 403, { error: 'Origen no permitido.' }); return; }
      const [, sessionId, file] = match;
      const emission = touch(sessionId, url.searchParams.get('token'), undefined, true, false);
      if (!emission) { json(response, 410, { error: 'Esta emisión ha terminado.' }, cors); return; }
      const path = join(directory, emission.id, file);
      if (!existsSync(path)) { json(response, 503, { error: 'Preparando emisión.' }, { ...cors, 'Retry-After': '1' }); return; }
      const headers = { ...cors, 'Content-Type': file === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
      if (file === 'index.m3u8') {
        try {
          const playlist = readFileSync(path, 'utf8').split('\n').map((line) => SEGMENT.test(line.trim()) ? `${line.trim()}?token=${encodeURIComponent(url.searchParams.get('token'))}` : line).join('\n');
          response.writeHead(200, headers); response.end(playlist);
        } catch { json(response, 503, { error: 'Preparando emisión.' }, { ...cors, 'Retry-After': '1' }); }
      } else {
        const stream = createReadStream(path);
        stream.on('error', () => { if (!response.headersSent) json(response, 503, { error: 'Preparando emisión.' }, { ...cors, 'Retry-After': '1' }); else response.destroy(); });
        stream.on('open', () => { response.writeHead(200, headers); stream.pipe(response); });
      }
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health') { json(response, 200, { ok: true }); return; }
    if (!sameSecret(request.headers.authorization?.replace(/^Bearer /, ''), secret)) { json(response, 401, { error: 'No autorizado.' }); return; }
    try {
      if (request.method === 'GET' && url.pathname === '/status') {
        const state = registry.transaction((value) => value);
        const active = Object.values(state.emissions).filter((emission) => ['starting', 'running'].includes(emission.status));
        const connections = active.map((emission) => ({
          emission_id: emission.id, channel_name: emission.name, status: emission.status,
          users: Object.values(state.sessions).filter((session) => session.emission_id === emission.id).map((session) => ({ name: session.name, user_id: session.user_id })),
        }));
        json(response, 200, { max_connections: maxConnections, active_count: active.length, local_count: active.length, viewer_count: Object.keys(state.sessions).length, connections }); return;
      }
      if (request.method === 'POST' && url.pathname === '/start') {
        const { channel, user_id: rawUserId, name, tab } = await body(request);
        const userId = normalizeUserId(rawUserId);
        if (typeof channel?.name !== 'string' || channel.name.length > 200 || !userId || typeof name !== 'string' || name.length > 80 || typeof tab !== 'string' || tab.length > 100) throw new Error('Canal o sesión inválidos.');
        const target = await resolveChannel(channel.url);
        const result = registry.transaction((state) => {
          for (const [id, session] of Object.entries(state.sessions)) if (session.user_id === userId && session.tab === tab) delete state.sessions[id];
          const key = createHash('sha256').update(target.original).digest('hex');
          let emission = Object.values(state.emissions).find((value) => value.key === key && ['starting', 'running'].includes(value.status));
          if (!emission) {
            if (Object.values(state.emissions).filter((value) => ['starting', 'running'].includes(value.status)).length >= maxConnections) return null;
            emission = { id: randomUUID(), key, url: target.original, input_url: target.pinned, host_header: target.host, name: channel.name, status: 'starting', created_at: now(), last_viewer: now() };
            state.emissions[emission.id] = emission;
          }
          const session = { id: randomUUID(), token: randomBytes(32).toString('hex'), emission_id: emission.id, user_id: userId, name, tab, last_seen: now() };
          state.sessions[session.id] = session;
          return session;
        });
        if (!result) { json(response, 409, { error: 'Cierra un canal para liberar una conexión.' }); return; }
        tick();
        json(response, 200, { session_id: result.id, emission_id: result.emission_id, playlist_url: `${requestOrigin(request)}/media/${result.id}/index.m3u8?token=${result.token}` }); return;
      }
      if (request.method === 'POST' && url.pathname === '/ping') {
        const { session_id: id, user_id: rawUserId, is_playing: playing } = await body(request);
        const userId = normalizeUserId(rawUserId);
        if (!UUID.test(id || '') || !userId || typeof playing !== 'boolean') throw new Error('Sesión inválida.');
        const state = registry.transaction((value) => value);
        const session = state.sessions[id];
        const emission = session?.user_id === userId ? touch(id, session.token, userId, playing) : null;
        const revoked = state.revoked_sessions?.[id];
        const message = revoked?.user_id === userId && revoked.closed_by ? `El usuario ${revoked.closed_by} ha cerrado el canal.` : 'La emisión ha terminado. Puedes volver a abrir el canal.';
        json(response, 200, { kicked: playing && !emission, status: emission?.status || 'closed', message: emission ? null : message }); return;
      }
      if (request.method === 'POST' && url.pathname === '/close') {
        const { emission_id: id, closed_by: closedBy } = await body(request);
        if (!UUID.test(id || '')) throw new Error('Emisión inválida.');
        const found = registry.transaction((state) => {
          if (!state.emissions[id]) return false;
          state.emissions[id].status = 'closed';
          state.revoked_sessions ||= {};
          for (const [sessionId, session] of Object.entries(state.sessions)) if (session.emission_id === id) {
            state.revoked_sessions[sessionId] = { user_id: session.user_id, closed_by: typeof closedBy === 'string' ? closedBy.slice(0, 80) : null, closed_at: now() };
            delete state.sessions[sessionId];
          }
          return true;
        });
        if (!found) { json(response, 404, { error: 'Emisión no encontrada.' }); return; }
        tick(); json(response, 200, { ok: true }); return;
      }
      json(response, 404, { error: 'Ruta no encontrada.' });
    } catch (error) {
      json(response, error instanceof SyntaxError || /inválid|demasiado grande/.test(error.message) ? 400 : 503, { error: error.message });
    }
  });
  return { server, registry, tick, stop() { for (const child of processes.values()) child.kill('SIGTERM'); processes.clear(); rmSync(lockFile, { force: true }); } };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const northflankHost = process.env.NF_HOSTS?.split(',').map((value) => value.trim()).find(Boolean) || null;
  const managedPublicUrl =
    process.env.RENDER_EXTERNAL_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null)
    || (northflankHost ? `https://${northflankHost}` : null);
  const managedRuntime = !!(northflankHost || process.env.NF_PROJECT_ID || process.env.NF_OBJECT_ID || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT_ID);
  const relay = createRelay({
    directory: process.env.DORADO_RELAY_DIR || '/tmp/dorado-tv-relay',
    secret: process.env.DORADO_RELAY_SECRET,
    publicUrl: process.env.DORADO_RELAY_PUBLIC_URL || managedPublicUrl,
    appOrigin: process.env.DORADO_APP_ORIGIN,
    maxConnections: Number(process.env.DORADO_MAX_CONNECTIONS || 3),
    ffmpeg: process.env.DORADO_FFMPEG || 'ffmpeg',
  });
  const interval = setInterval(relay.tick, 1000);
  const host = process.env.HOST || (managedRuntime ? '0.0.0.0' : '127.0.0.1');
  relay.server.listen(Number(process.env.PORT || 5300), host);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(interval); relay.stop(); relay.server.close(); });
}
