import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const HASH = /^[0-9a-f]{40}$/i;
const VIDEO = /\.(mp4|m4v|webm|ogg)$/i;
const DEFAULT_MAX_BYTES = 700 * 1024 * 1024;
const VALID_USER = /^[a-zA-Z0-9._:-]{1,128}$/;
// Exclude local infrastructure addresses from untrusted tracker/DHT peer lists.
const PRIVATE_PEERS = [
  ['0.0.0.0','0.255.255.255'],['10.0.0.0','10.255.255.255'],
  ['100.64.0.0','100.127.255.255'],['127.0.0.0','127.255.255.255'],
  ['169.254.0.0','169.254.255.255'],['172.16.0.0','172.31.255.255'],
  ['192.168.0.0','192.168.255.255'],['198.18.0.0','198.19.255.255'],
  ['224.0.0.0','255.255.255.255'],
].map(([start,end])=>({start,end}));
const trackers = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'https://tracker.btorrent.xyz/announce',
];
const equals = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};
export class TorrentFault extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function rangeForTorrent(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) throw new TorrentFault('Rango no válido.', 416);
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new TorrentFault('Rango no válido.', 416);
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size ||
      end < start) throw new TorrentFault('Rango no válido.', 416);
  return { start, end: Math.min(end, size - 1), partial: true };
}

/** One swarm per unique hash, bounded storage, independent viewer tokens. */
export class TorrentRelay {
  constructor({ directory, createClient, maxBytes = DEFAULT_MAX_BYTES, maxActive = 1,
    maxPeers = 12, metadataTimeout = 45000, idleMs = 45000, clock = () => Date.now(),
    uploadLimit = 256 * 1024, downloadLimit = 4 * 1024 * 1024, blockPrivatePeers = true }) {
    if (!directory) throw Error('Missing torrent directory');
    this.directory = join(directory, 'torrent-cache');
    rmSync(this.directory, { recursive: true, force: true });
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.createClient = createClient || (async () => (await import('webtorrent')).default);
    this.maxBytes = maxBytes;
    this.maxActive = maxActive;
    this.maxPeers = maxPeers;
    this.uploadLimit = uploadLimit;
    this.downloadLimit = downloadLimit;
    this.blockPrivatePeers = blockPrivatePeers;
    this.metadataTimeout = metadataTimeout;
    this.idleMs = idleMs;
    this.clock = clock;
    this.swarms = new Map();
    this.viewers = new Map();
  }
  async start({ info_hash: hash, file_idx: fileIdx, user_id: userId }) {
    if (!HASH.test(hash || '') || !VALID_USER.test(userId || '') ||
      (fileIdx !== null && fileIdx !== undefined && (!Number.isSafeInteger(fileIdx) || fileIdx < 0 || fileIdx > 10000)))
      throw new TorrentFault('Torrent o sesión inválidos.');
    hash = hash.toLowerCase();
    if (this.viewers.size >= 64) throw new TorrentFault('Demasiados espectadores torrent simultáneos.', 429);
    let swarm = this.swarms.get(hash);
    if (!swarm) {
      if (this.swarms.size >= this.maxActive) throw new TorrentFault('El relay tiene una reproducción torrent activa. Prueba más tarde.', 409);
      swarm = { hash, state: 'loading', file: null, fileIdx: fileIdx ?? null,
        sessions: new Set(), lastUsed: this.clock(), path: join(this.directory, hash),
        error: null, bytes: 0, client: null, torrent: null };
      this.swarms.set(hash, swarm);
      this.connect(swarm).catch((error) => this.fail(swarm, error));
    } else if (swarm.fileIdx !== null && fileIdx !== null && fileIdx !== undefined && swarm.fileIdx !== fileIdx) {
      throw new TorrentFault('La fuente usa otro archivo torrent. Selecciona la misma versión.', 409);
    }
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    this.viewers.set(id, { id, token, hash, userId, expires: this.clock() + 90000 });
    swarm.sessions.add(id);
    swarm.lastUsed = this.clock();
    return { session_id: id };
  }
  async connect(swarm) {
    const Engine = await this.createClient();
    if (this.swarms.get(swarm.hash) !== swarm) return;
    const client = new Engine({
      dht: true, lsd: false, maxConns: this.maxPeers, natUpnp: false, natPmp: false, utp: false,
      uploadLimit: this.uploadLimit, downloadLimit: this.downloadLimit,
      ...(this.blockPrivatePeers ? { blocklist: PRIVATE_PEERS } : {}),
    });
    swarm.client = client;
    client.on('error', (error) => this.fail(swarm, error));
    mkdirSync(swarm.path, { recursive: true, mode: 0o700 });
    const magnet = 'magnet:?xt=urn:btih:' + swarm.hash + trackers.map((tr) => '&tr=' + encodeURIComponent(tr)).join('');
    const torrent = client.add(magnet, { path: swarm.path, deselect: true, destroyStoreOnDestroy: true });
    swarm.torrent = torrent;
    torrent.on('error', (error) => this.fail(swarm, error));
    const timer = setTimeout(() => {
      if (swarm.state === 'loading') this.fail(swarm, Error('No se encontraron metadatos del torrent por TCP/UDP. Prueba otra fuente.'));
    }, this.metadataTimeout);
    timer.unref?.();
    swarm.timer = timer;
    torrent.once('ready', () => {
      if (swarm.state !== 'loading') return;
      clearTimeout(timer);
      const candidates = torrent.files.filter((file) => VIDEO.test(file.name) && file.length > 0);
      const indexed = Number.isSafeInteger(swarm.fileIdx) ? torrent.files[swarm.fileIdx] : null;
      const file = swarm.fileIdx !== null
        ? (indexed && candidates.includes(indexed) ? indexed : null)
        : [...candidates].sort((a,b) => b.length - a.length)[0];
      if (!file) return this.fail(swarm, Error('Este torrent no contiene MP4/WebM/OGG reproducible en navegador.'));
      if (file.length > this.maxBytes) return this.fail(swarm, Error(
        'Este vídeo necesita ' + (file.length / 1048576).toFixed(0) +
        ' MB. El relay admite un máximo de ' + (this.maxBytes / 1048576).toFixed(0) + ' MB. Amplía el almacenamiento del servidor.'));
      swarm.file = file;
      swarm.state = 'ready';
      for (const other of torrent.files) if (other !== file) other.deselect();
      file.select(10);
    });
  }
  status(id, userId, base) {
    const viewer = this.auth(id, userId);
    const swarm = this.swarms.get(viewer.hash);
    if (!swarm) throw new TorrentFault('Torrent ya no disponible.', 410);
    if (swarm.state === 'failed') throw new TorrentFault(swarm.error || 'La descarga torrent falló.', 503);
    return { state: swarm.state, ...(swarm.state === 'ready' ? {
      playback_url: base + '/torrent-media/' + id + '/video?token=' + viewer.token,
      bytes: swarm.file.length,
      peers: swarm.torrent?.numPeers || 0,
    } : {}) };
  }
  auth(id, userId, token) {
    const viewer = this.viewers.get(id);
    if (!viewer || this.clock() > viewer.expires ||
      (userId !== undefined && viewer.userId !== userId) ||
      (token !== undefined && !equals(token, viewer.token)))
      throw new TorrentFault('La sesión de vídeo ha caducado.', 410);
    viewer.expires = this.clock() + 90000;
    const swarm = this.swarms.get(viewer.hash);
    if (swarm) swarm.lastUsed = this.clock();
    return viewer;
  }
  media(id, token, range) {
    const viewer = this.auth(id, undefined, token);
    const swarm = this.swarms.get(viewer.hash);
    if (!swarm || !swarm.file || swarm.state !== 'ready') throw new TorrentFault('Preparando vídeo torrent.', 503);
    const bounds = rangeForTorrent(range, swarm.file.length);
    return { ...bounds, length: swarm.file.length, name: swarm.file.name, stream: () => swarm.file.createReadStream({ start: bounds.start, end: bounds.end }) };
  }
  stop(id, userId) {
    const viewer = this.viewers.get(id);
    if (!viewer || viewer.userId !== userId) return { ok: true };
    this.viewers.delete(id);
    const swarm = this.swarms.get(viewer.hash);
    swarm?.sessions.delete(id);
    if (swarm) swarm.lastUsed = this.clock();
    return { ok: true };
  }
  fail(swarm, error) {
    if (this.swarms.get(swarm.hash) !== swarm || swarm.state === 'failed') return;
    swarm.error = error?.message || 'El torrent dejó de funcionar.';
    swarm.state = 'failed';
    clearTimeout(swarm.timer);
    if (swarm.client) {
      const client = swarm.client; swarm.client = null;
      client.destroy(() => {});
    }
  }
  tick() {
    const now = this.clock();
    for (const [id, viewer] of this.viewers) if (viewer.expires < now) this.stop(id, viewer.userId);
    for (const swarm of this.swarms.values()) {
      if (swarm.torrent && swarm.state === 'ready' && swarm.torrent.downloaded > this.maxBytes + Math.max(1048576, swarm.torrent.pieceLength || 0)) {
        this.fail(swarm, Error('Se alcanzó el límite de almacenamiento temporal del relay.'));
      }
      if (!swarm.sessions.size && now - swarm.lastUsed > this.idleMs) this.discard(swarm);
    }
  }
  discard(swarm) {
    if (this.swarms.get(swarm.hash) !== swarm) return;
    this.swarms.delete(swarm.hash);
    clearTimeout(swarm.timer);
    for (const id of swarm.sessions) this.viewers.delete(id);
    if (swarm.client) swarm.client.destroy(() => {});
    // Give pending fs operations time to finish after closing the client.
    setTimeout(() => { rmSync(swarm.path, { recursive: true, force: true }); }, 2000).unref?.();
  }
  close() {
    for (const swarm of [...this.swarms.values()]) this.discard(swarm);
  }
}
