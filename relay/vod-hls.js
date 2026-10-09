import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { openDirectMedia, validateDirectMediaUrl } from './direct-audio.js';

export const VOD_SEGMENT_SECONDS = 8;
const SESSION_AGE = 4 * 60 * 60 * 1000;
const SESSION_IDLE = 12 * 60 * 1000;
const SOURCE_IDLE = 3 * 60 * 1000;
const MAX_DURATION = 6 * 3600;
const MAX_SEGMENTS = Math.ceil(MAX_DURATION / VOD_SEGMENT_SECONDS);
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
const hashKey = (key) => createHash('sha256').update(key).digest('hex');
const validUser = (s) => /^[a-zA-Z0-9._:-]{1,128}$/.test(s || '');

export function hlsVodPlaylist(duration, token) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION) throw Error('Duración de vídeo inválida.');
  const count = Math.ceil(duration / VOD_SEGMENT_SECONDS);
  const parts = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-TARGETDURATION:' + VOD_SEGMENT_SECONDS, '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-INDEPENDENT-SEGMENTS'];
  for (let i = 0; i < count; i++) {
    parts.push('#EXTINF:' + Math.min(VOD_SEGMENT_SECONDS, duration - i * VOD_SEGMENT_SECONDS).toFixed(3) + ',');
    parts.push('segment_' + i + '.ts?token=' + encodeURIComponent(token));
  }
  parts.push('#EXT-X-ENDLIST');
  return parts.join('\n') + '\n';
}
export function mediaRange(input, size) {
  if (!input) return { start: 0, end: size - 1, partial: false };
  const m = /^bytes=(\d*)-(\d*)$/.exec(input);
  if (!m || (!m[1] && !m[2])) return null;
  let start, end;
  if (!m[1]) {
    const n = Number(m[2]);
    if (!Number.isSafeInteger(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]); end = m[2] ? Number(m[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size ||
        start < 0 || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

export class VodHls {
  constructor({ directory, torrentRelay, publicUrl, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe',
    spawnProcess = spawn, opener = openDirectMedia, clock = () => Date.now(),
    maxConcurrent = 2, maxCacheBytes = 12 * 1024 ** 3 } = {}) {
    this.directory = join(directory, 'vod-hls');
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(this.directory)) {
      if (name.endsWith('.part')) rmSync(join(this.directory, name), { force: true });
    }
    this.torrentRelay = torrentRelay;
    this.publicUrl = publicUrl;
    this.ffmpeg = ffmpeg;
    this.ffprobe = ffprobe;
    this.spawnProcess = spawnProcess;
    this.opener = opener;
    this.clock = clock;
    this.maxConcurrent = maxConcurrent;
    this.maxCacheBytes = maxCacheBytes;
    this.sources = new Map();
    this.sessions = new Map();
    this.queue = [];
    this.active = 0;
    this.closed = false;
  }
  async start({ url, torrentHash, fileIdx, userId, origin }) {
    if (!validUser(userId)) throw Error('Usuario de vídeo inválido.');
    if (this.sessions.size >= 100) throw Error('Demasiadas sesiones VOD.');
    const direct = typeof url === 'string';
    if (direct) validateDirectMediaUrl(url);
    else if (!/^[a-f0-9]{40}$/.test(torrentHash || '') || (fileIdx != null &&
      (!Number.isSafeInteger(fileIdx) || fileIdx < 0 || fileIdx > 10000))) throw Error('Torrent inválido.');
    const sourceKey = direct ? 'url:' + url : 'torrent:' + torrentHash + ':' + (fileIdx ?? 'auto');
    const key = hashKey(sourceKey);
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    let source = this.sources.get(key);
    if (!source) {
      source = { key, url: direct ? url : null, torrentHash: direct ? null : torrentHash,
        fileIdx, state: 'preparing', duration: 0, error: null, peers: 0, lastUse: this.clock(),
        sessions: new Set(), secret: randomBytes(24).toString('hex'),
        torrentId: null, torrentUser: null, torrentToken: null, length: 0,
        initialize: null, touched: new Map() };
      this.sources.set(key, source);
      source.initialize = this.initialize(source);
    }
    this.sessions.set(id, { id, token, userId, key, expires: this.clock() + SESSION_AGE,
      lastUse: this.clock() });
    source.sessions.add(id); source.lastUse = this.clock();
    return { session_id: id };
  }
  session(id, token, userId) {
    const s = this.sessions.get(id);
    if (!s || (token !== undefined && !safeEqual(token, s.token)) ||
        (userId !== undefined && s.userId !== userId) || s.expires <= this.clock())
      throw Error('Sesión de vídeo caducada.');
    const source = this.sources.get(s.key);
    if (!source) throw Error('Vídeo no disponible.');
    s.lastUse = source.lastUse = this.clock();
    return { s, source };
  }
  status(id, userId, origin) {
    const { s, source } = this.session(id, undefined, userId);
    return { state: source.state, ...(source.state === 'ready'
      ? { playlist_url: origin + '/vod/' + id + '/index.m3u8?token=' + s.token,
          duration: source.duration } : {}),
      ...(source.state === 'failed' ? { error: source.error } : {}),
      peers: source.peers };
  }
  async initialize(source) {
    try {
      if (source.torrentHash) {
        const internal = 'vod-' + randomUUID();
        const started = await this.torrentRelay.start({ info_hash: source.torrentHash,
          file_idx: source.fileIdx, user_id: internal });
        source.torrentId = started.session_id;
        source.torrentUser = internal;
        const deadline = this.clock() + 85000;
        let status;
        while (!this.closed && this.clock() < deadline) {
          status = this.torrentRelay.status(started.session_id, internal, this.publicUrl);
          if (status.state === 'ready') break;
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        if (status?.state !== 'ready') throw Error('No se encontraron seeders o metadatos.');
        source.peers = status.peers;
        source.torrentToken = this.torrentRelay.viewers.get(source.torrentId)?.token;
        source.length = status.bytes;
      }
      const proxy = this.proxyUrl(source);
      const { stdout } = await this.exec(this.ffprobe, ['-v','error',
        '-show_entries','format=duration:stream=codec_name,codec_type,width,height',
        '-of','json', proxy], 40000);
      const probe = JSON.parse(stdout);
      const duration = Number(probe?.format?.duration);
      if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION ||
        !probe?.streams?.some((stream) => stream.codec_type === 'video')) throw Error('Duración o vídeo no reconocidos.');
      source.duration = duration;
      source.state = 'ready';
    } catch (err) {
      source.state = 'failed';
      const upstream = source.upstreamError || '';
      source.error = /HTTP 403|HTTP 401/.test(upstream)
        ? 'El proveedor ha rechazado la conexión del servidor Ubuntu. Prueba otra fuente o un torrent directo.'
        : /HTTP 429/.test(upstream)
          ? 'El proveedor está limitando las descargas desde el servidor. Espera o prueba otra fuente.'
          : /HTTP 404|HTTP 410/.test(upstream)
            ? 'El enlace de descarga ha caducado. Actualiza las fuentes.'
            : /salto|rangos|Range/.test(upstream)
              ? 'Esta fuente no admite búsqueda por rangos. Prueba otra fuente.'
              : /timeout|seed|metadata|torrent/i.test(err.message)
                ? 'No se pudo obtener el vídeo desde los seeders.'
                : 'No se pudo leer la duración o el formato del vídeo. Prueba otra fuente.';
      const diagnostic = String(err?.message || 'unknown')
        .replace(/https?:\/\/\S+/g, '[redacted-url]').slice(0, 200);
      console.warn('[vod] probe failed', source.key.slice(0, 8), diagnostic);
    }
  }
  proxyUrl(source) {
    const port = this.port?.();
    if (!port) throw Error('El relay todavía no escucha conexiones.');
    return 'http://127.0.0.1:' + port + '/vod-input/' + source.key + '?auth=' + source.secret;
  }
  exec(bin, args, timeout) {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(bin, args, { stdio: ['ignore','pipe','pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
      timer.unref?.();
      child.stdout.on('data', (c) => { stdout += c; if (stdout.length > 256 * 1024) child.kill('SIGKILL'); });
      child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-2048); });
      child.once('error', reject);
      child.once('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve({ stdout }) : reject(Error(bin + ': ' + stderr.slice(-400)));
      });
    });
  }
  async proxyInput(source, request, response) {
    if (source.url) {
      const remote = await this.opener(source.url, { range: request.headers.range });
      response.writeHead(remote.status || 200, {
        'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
        ...(remote.contentRange ? { 'Content-Range': remote.contentRange } : {}),
        ...(remote.length != null ? { 'Content-Length': String(remote.length) } : {}) });
      remote.stream.on('error', () => response.destroy());
      response.once('close', remote.close);
      remote.stream.pipe(response);
    } else {
      const file = this.torrentRelay.rawMedia(source.torrentId, source.torrentToken,
        request.headers.range);
      response.writeHead(file.partial ? 206 : 200, {
        'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes',
        'Content-Length': String(file.end - file.start + 1),
        ...(file.partial ? { 'Content-Range': 'bytes ' + file.start + '-' + file.end + '/' + file.length } : {}) });
      const stream = file.stream();
      stream.on('error', () => response.destroy());
      response.once('close', () => stream.destroy());
      stream.pipe(response);
    }
  }
  playlist(id, token) {
    const { source } = this.session(id, token);
    if (source.state !== 'ready') throw Error('Vídeo todavía no preparado.');
    return hlsVodPlaylist(source.duration, token);
  }
  segment(id, token, index) {
    const { source } = this.session(id, token);
    if (source.state !== 'ready' || !Number.isSafeInteger(index) || index < 0 ||
        index >= Math.ceil(source.duration / VOD_SEGMENT_SECONDS) || index > MAX_SEGMENTS)
      throw Error('Segmento de vídeo no disponible.');
    return this.ensureSegment(source, index);
  }
  ensureSegment(source, index) {
    const path = join(this.directory, source.key + '_' + index + '.ts');
    if (existsSync(path) && statSync(path).size > 100) {
      source.touched.set(index, this.clock());
      return Promise.resolve(path);
    }
    if (!source.pending) source.pending = new Map();
    if (source.pending.has(index)) return source.pending.get(index);
    const job = new Promise((resolve, reject) => {
      if (this.queue.length > 60) { reject(Error('Cola de transcodificación llena.')); return; }
      this.queue.push({ source, index, path, resolve, reject });
      this.drain();
    });
    source.pending.set(index, job);
    job.finally(() => source.pending.delete(index)).catch(() => {});
    return job;
  }
  drain() {
    while (!this.closed && this.active < this.maxConcurrent && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this.transcode(job.source, job.index, job.path).then(job.resolve, job.reject)
        .finally(() => { this.active--; this.drain(); });
    }
  }
  async transcode(source, index, path) {
    const offset = index * VOD_SEGMENT_SECONDS;
    const duration = Math.min(VOD_SEGMENT_SECONDS, source.duration - offset);
    const temp = path + '.' + randomUUID() + '.part';
    try {
      // Each segment is an independent random-access decode, not a shared live cursor.
      const args = ['-hide_banner','-nostdin','-loglevel','error',
        '-ss', String(offset), '-i', this.proxyUrl(source), '-t', String(duration),
        '-map','0:v:0','-map','0:a:0?', '-sn','-dn',
        '-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p',
        '-vf','scale=w=min(1280\\,iw):h=min(720\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-threads','2','-c:a','aac','-ac','2','-b:a','128k',
        '-output_ts_offset',String(offset),'-f','mpegts','-y',temp];
      await this.exec(this.ffmpeg, args, 85000);
      if (!existsSync(temp) || statSync(temp).size < 500) throw Error('Segmento vacío.');
      renameSync(temp, path);
      source.touched.set(index, this.clock());
      this.evict();
      return path;
    } finally { rmSync(temp, { force: true }); }
  }
  evict() {
    const files = readdirSync(this.directory).filter((name) => /^[a-f0-9]{64}_[0-9]+\.ts$/.test(name))
      .map((name) => {
        const path = join(this.directory, name);
        const stat = statSync(path);
        return { path, size: stat.size, time: stat.mtimeMs };
      });
    let total = files.reduce((s, file) => s + file.size, 0);
    if (total <= this.maxCacheBytes) return;
    for (const file of files.sort((a, b) => a.time - b.time)) {
      if (total <= this.maxCacheBytes) break;
      rmSync(file.path, { force: true });
      total -= file.size;
    }
  }
  stop(id, userId) {
    const s = this.sessions.get(id);
    if (!s || s.userId !== userId) return { ok: true };
    this.sessions.delete(id);
    this.sources.get(s.key)?.sessions.delete(id);
    return { ok: true };
  }
  sweep() {
    const now = this.clock();
    for (const [id, s] of this.sessions)
      if (s.expires <= now || now - s.lastUse > SESSION_IDLE) this.stop(id, s.userId);
    for (const [key, source] of this.sources) {
      if (!source.sessions.size && now - source.lastUse > SOURCE_IDLE) {
        if (source.torrentId) this.torrentRelay.stop(source.torrentId, source.torrentUser);
        this.sources.delete(key);
      } else if (source.torrentId) {
        try { this.torrentRelay.auth(source.torrentId, source.torrentUser); } catch { /* reconnect on new session */ }
      }
    }
  }
  shutdown() {
    this.closed = true;
    for (const { reject } of this.queue) reject(Error('Relay apagado.'));
    this.queue.length = 0;
    for (const source of this.sources.values())
      if (source.torrentId) this.torrentRelay.stop(source.torrentId, source.torrentUser);
    this.sessions.clear();
  }
}
