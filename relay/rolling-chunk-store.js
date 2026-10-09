import { mkdirSync, rmSync } from 'node:fs';
import { open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import FsChunkStore from 'fs-chunk-store';

const DEFAULT_MAX = 256 * 1024 * 1024;

/** A best-effort sliding cache for strictly forward-only streaming.
 * The storage bound is hard, but previously evicted pieces are unavailable for
 * backwards seek or BitTorrent upload. Do not use this as a full-file store.
 */
export class RollingChunkStore {
  constructor(pieceLength, opts = {}) {
    this.chunkLength = pieceLength;
    this.length = opts.length;
    this.maxBytes = Math.max(pieceLength * 4, opts.maxBytes ?? DEFAULT_MAX);
    this.path = join(opts.path, '.rolling');
    rmSync(this.path, { recursive: true, force: true });
    mkdirSync(this.path, { recursive: true, mode: 0o700 });
    this.items = new Map();
    this.totalBytes = 0;
    this.closed = false;
    this.pending = Promise.resolve();
    this.highWaterBytes = 0;
  }
  filename(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index * this.chunkLength >= this.length)
      throw new RangeError('Invalid torrent piece');
    return join(this.path, String(index));
  }
  put(index, chunk, cb = () => {}) {
    this.pending = this.pending.then(async () => {
      if (this.closed) throw new Error('Chunk store closed');
      const file = this.filename(index);
      if (chunk.length > this.maxBytes) throw new Error('Torrent piece exceeds cache capacity');
      if (this.items.has(index)) {
        const size = this.items.get(index);
        this.items.delete(index); this.totalBytes -= size;
      }
      while (this.totalBytes + chunk.length > this.maxBytes && this.items.size) {
        const oldest = this.items.keys().next().value;
        const size = this.items.get(oldest);
        this.items.delete(oldest);
        await rm(this.filename(oldest), { force: true });
        this.totalBytes -= size;
      }
      const temp = file + '.tmp';
      await writeFile(temp, chunk, { mode: 0o600 });
      await rename(temp, file);
      this.items.set(index, chunk.length);
      this.totalBytes += chunk.length;
      this.highWaterBytes = Math.max(this.highWaterBytes, this.totalBytes);
    });
    this.pending.then(() => cb(null), cb);
  }
  get(index, options, cb) {
    if (typeof options === 'function') { cb = options; options = {}; }
    options ||= {};
    this.pending.then(async () => {
      if (this.closed) throw new Error('Chunk store closed');
      const size = this.items.get(index);
      if (size === undefined) throw new Error('Torrent piece has been evicted');
      const offset = options.offset || 0;
      const length = options.length ?? size - offset;
      if (offset < 0 || length < 0 || offset + length > size)
        throw new RangeError('Invalid read range');
      const fd = await open(this.filename(index), 'r');
      const buf = Buffer.allocUnsafe(length);
      try {
        let read = 0;
        while (read < length) {
          const { bytesRead } = await fd.read(buf, read, length - read, offset + read);
          if (!bytesRead) throw new Error('Unexpected end of torrent piece');
          read += bytesRead;
        }
      } finally { await fd.close(); }
      // LRU: reading keeps the near-future stream chunks available.
      this.items.delete(index);
      this.items.set(index, size);
      return buf;
    }).then((buf) => cb(null, buf), cb);
  }
  close(cb = () => {}) {
    this.pending.then(() => { this.closed = true; cb(null); }, cb);
  }
  destroy(cb = () => {}) {
    this.pending.then(async () => {
      this.closed = true;
      this.items.clear(); this.totalBytes = 0;
      await rm(this.path, { recursive: true, force: true });
    }).then(() => cb(null), cb);
  }
}

/** Keep ordinary files on existing seekable disk storage;
 * select rolling cache only when metadata advertises a large torrent.
 */
export class HybridTorrentStore {
  constructor(pieceLength, opts = {}) {
    this.inner = opts.length > (opts.fullThreshold ?? 700 * 1024 * 1024)
      ? new RollingChunkStore(pieceLength, opts)
      : new FsChunkStore(pieceLength, opts);
    this.chunkLength = pieceLength;
    this.rolling = this.inner instanceof RollingChunkStore;
  }
  put(...args) { return this.inner.put(...args); }
  get(...args) { return this.inner.get(...args); }
  close(...args) { return this.inner.close(...args); }
  destroy(...args) { return this.inner.destroy(...args); }
}
