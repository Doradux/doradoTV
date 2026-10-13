import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  snapshotFilm, snapshotProvider, findRestoredProvider,
  readCinemaSnapshot, writeCinemaSnapshot, CINEMA_SNAPSHOT_MAX_AGE_MS,
} from '../src/cinema-session.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}
const source = (name) => readFileSync(new URL('../src/' + name, import.meta.url), 'utf8');
const film = { id: 'tt0414853', type: 'movie', name: 'El corral', addonId: 'cinemeta',
  poster: 'https://signed.example.org/poster?token=PRIVATE', description: 'A'.repeat(5000) };
const provider = { kind: 'https', name: 'TorBox 2K', title: '1080p/Barnyard',
  url: 'https://torbox.example.org/download?token=TOP_SECRET',
  audioTicket: { data: 'ENCRYPTED_TICKET' }, ticket: { data: 'OTHER_TICKET' } };

test('reload snapshot retains movie, catalog search, provider, timeline and paused state', () => {
  const storage = fakeStorage();
  const selected = snapshotProvider(provider, 3);
  writeCinemaSnapshot(storage, 'cinema:room-a', {
    mode: 'cinema', view: 'detail', query: 'el corral', metas: [film],
    current: film, episodeId: '', provider: selected,
    playing: true, position: 1878.35, paused: true, compatibleAudio: true,
    panelScroll: 920,
  }, 1000000);
  const saved = readCinemaSnapshot(storage, 'cinema:room-a', 1000500);
  assert.equal(saved.mode, 'cinema');
  assert.equal(saved.view, 'detail');
  assert.equal(saved.query, 'el corral');
  assert.deepEqual(saved.current, snapshotFilm(film));
  assert.equal(saved.playing, true);
  assert.equal(saved.position, 1878.35);
  assert.equal(saved.paused, true);
  assert.equal(saved.compatibleAudio, true);
  assert.equal(saved.panelScroll, 920);
  assert.equal(saved.provider.index, 3);
  const serialized = storage.getItem('cinema:room-a');
  for (const privatePart of ['TOP_SECRET','ENCRYPTED_TICKET','OTHER_TICKET',
    'signed.example.org', '1080p/Barnyard', 'torbox.example.org']) {
    assert(!serialized.includes(privatePart), 'No persisted private source data: ' + privatePart);
  }
  assert.equal(readCinemaSnapshot(storage, 'cinema:room-b', 1000500), null);
});

test('freshly authorized sources are matched without stored signed URLs or arbitrary fallback', () => {
  const old = snapshotProvider(provider, 1);
  const updated = { ...provider, url: 'https://torbox.example.org/new?token=NEW_SECRET',
    audioTicket: { data: 'FRESH_TICKET' } };
  assert.equal(findRestoredProvider([
    { kind: 'torrent', name: 'Other', title: 'Seeder' }, updated,
  ], old), 1);
  assert.equal(findRestoredProvider([
    updated, { kind: 'torrent', name: 'Other', title: 'Seeder' },
  ], old), 0, 'Reordering still matches the original provider');
  assert.equal(findRestoredProvider([{ ...provider, name: 'Changed provider' }], old), -1);
  assert.equal(findRestoredProvider([updated, updated], { ...old, index: -1 }), -1,
    'Identical ambiguous entries never silently select a different stream');
});

test('expired, invalid and corrupted snapshots never resume', () => {
  const storage = fakeStorage();
  const key = 'cinema:test';
  writeCinemaSnapshot(storage, key, { current: film, playing: true,
    provider: snapshotProvider(provider, 0), mode: 'cinema', view: 'detail', position: 250 }, 1000);
  assert.equal(readCinemaSnapshot(storage, key, 1000 + CINEMA_SNAPSHOT_MAX_AGE_MS + 1), null);
  assert.equal(storage.getItem(key), null);
  storage.setItem(key, '{ invalid json');
  assert.equal(readCinemaSnapshot(storage, key, 2000), null);
  storage.setItem(key, JSON.stringify({ version: 17, savedAt: 2000 }));
  assert.equal(readCinemaSnapshot(storage, key, 2000), null);
});

test('browsing with a selected movie can persist independently of the video state', () => {
  const storage = fakeStorage();
  writeCinemaSnapshot(storage, 'cinema:test', {
    mode: 'cinema', view: 'browse', query: 'scary movie', metas: [film], current: film,
    playing: true, provider: snapshotProvider(provider, 2), paused: false, position: 85,
  }, 8000);
  const saved = readCinemaSnapshot(storage, 'cinema:test', 8500);
  assert.equal(saved.view, 'browse');
  assert.equal(saved.position, 85);
  assert.equal(saved.playing, true);
});

test('the player persists before unloading and recovers movie after channel initialization', () => {
  const main = source('main.js'), ui = source('stremio-ui.js');
  assert.match(main, /pagehide', \(\) => cinema\.persist\(true\)/);
  assert.match(main, /playlistLoaded\.then\(\(\) => cinema\.restore\(savedCinema\)\)/);
  assert.match(main, /resume: isReload && savedCinema\?\.mode !== 'cinema'/);
  assert.match(main, /resumeAt = 0, startPaused = false/);
  assert.match(main, /video\.currentTime = target/);
  assert.match(main, /Película restaurada\. Pulsa Play/);
  assert.match(ui, /findRestoredProvider\(state\.streams, restoredProvider\)/);
  assert.match(ui, /if \(saved\.view === 'browse'\) swap\(false\)/);
  assert.match(ui, /const sessionKey = 'dorado-tv:cinema:' \+ room/);
});

test('torrent source selection is stable when seeder counts and source titles change', () => {
  const hash = 'd'.repeat(40);
  const old = snapshotProvider({
    kind: 'torrent', infoHash: hash, name: 'Torrentio 22 seeders', title: '720p 22 seeders',
  }, 0);
  const newer = { kind: 'torrent', infoHash: hash, name: 'Torrentio 24 seeders',
    title: '720p 24 seeders', ticket: { fresh: 'SIGNED' } };
  assert.equal(findRestoredProvider([newer], old), 0);
  assert.equal(JSON.stringify(old).includes(hash), false, 'Info hashes remain out of browser storage');
});
test('explicit logout/leave cannot recreate a removed playback snapshot on pagehide', () => {
  const main = source('main.js'), ui = source('stremio-ui.js');
  assert.match(ui, /if \(restoring \|\| cleared\) return/);
  assert.match(ui, /clearSavedState\(\) \{ cleared = true/);
  assert.match(main, /cinema\.clearSavedState\(\); clearRememberedPlayback\(\); stop\(\)/);
  assert.match(main, /showSection\('cinema', \{ restoringView: true \}\)/);
});
