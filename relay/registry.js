import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const empty = () => ({ emissions: {}, sessions: {}, revoked_sessions: {}, worker_seen: 0 });

// A single relay process owns this directory. Transactions are synchronous so
// HTTP requests and the worker cannot interleave a read and a write.
export class RelayRegistry {
  constructor(directory) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'registry.json');
  }

  transaction(callback) {
    let raw = null;
    try { raw = readFileSync(this.file, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const state = raw === null ? empty() : JSON.parse(raw);
    const result = callback(state);
    const json = JSON.stringify(state);
    // The old PHP relay rewrote the file on every tick (~8 times/s). Keep the
    // exact-byte comparison from 56af7a3 so idle reads do not cause writes.
    if (json !== raw) {
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, json, { mode: 0o600 });
      renameSync(temporary, this.file);
    }
    return result;
  }
}
