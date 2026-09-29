import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { RelayRegistry } from '../relay/registry.js';
import { createRelay } from '../relay/server.js';
import { providerFromChannel, providerStatus } from '../relay/provider.js';

test('provider status decodes the current programme and estimates external connections', async () => {
  const channel = 'http://provider.test/live/viewer/password/123.ts';
  assert.equal(providerFromChannel(channel).streamId, '123');
  const fetcher = async (url) => Response.json(url.searchParams.get('action') === 'get_short_epg'
    ? { epg_listings: [{ start_timestamp: 90, stop_timestamp: 110, title: Buffer.from('Noticias').toString('base64') }] }
    : { user_info: { active_cons: '2' } });
  assert.deepEqual(await providerStatus(channel, fetcher, () => 100), { connections: 2, program: 'Noticias' });
});

test('registry keeps registry.json untouched when a transaction does not change state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dorado-registry-'));
  try {
    const registry = new RelayRegistry(directory);
    registry.transaction((state) => { state.worker_seen = 100; });
    const file = join(directory, 'registry.json');
    const first = statSync(file);
    registry.transaction((state) => { state.worker_seen = 100; });
    const second = statSync(file);
    assert.equal(second.ino, first.ino);
    assert.equal(second.mtimeMs, first.mtimeMs);
    registry.transaction((state) => { state.worker_seen = 101; });
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).worker_seen, 101);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('one upstream serves two viewers and closing it revokes both media tokens', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dorado-relay-'));
  let launches = 0;
  const spawnProcess = (_command, args) => {
    launches += 1;
    const playlist = args.at(-1);
    mkdirSync(dirname(playlist), { recursive: true });
    writeFileSync(playlist, '#EXTM3U\n#EXTINF:4,\nsegment_000000001.ts\n');
    writeFileSync(join(dirname(playlist), 'segment_000000001.ts'), 'video');
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => { child.exitCode = 0; };
    return child;
  };
  let now = 100;
  const relay = createRelay({ directory, secret: 'testing-secret', publicUrl: 'http://127.0.0.1:5300', appOrigin: 'http://127.0.0.1:5199', spawnProcess, clock: () => now });
  await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${relay.server.address().port}`;
  const control = (path, data) => fetch(base + path, { method: 'POST', headers: { Authorization: 'Bearer testing-secret', 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  try {
    const channel = { name: 'Prueba', url: 'http://example.test/live.ts' };
    const first = await (await control('/start', { channel, user_id: 1, name: 'Ana', tab: 'one' })).json();
    const second = await (await control('/start', { channel, user_id: '2', name: 'Luis', tab: 'two' })).json();
    assert.equal(first.emission_id, second.emission_id);
    assert.equal(launches, 1);
    const forbidden = await fetch(`${base}/media/${first.session_id}/index.m3u8`);
    assert.equal(forbidden.status, 410);
    const media = await fetch(first.playlist_url.replace('127.0.0.1:5300', `127.0.0.1:${relay.server.address().port}`));
    assert.equal(media.status, 200);
    assert.match(await media.text(), /segment_000000001\.ts\?token=/);
    const status = await (await fetch(base + '/status', { headers: { Authorization: 'Bearer testing-secret' } })).json();
    assert.equal(status.connections[0].users.length, 2);
    assert.equal(JSON.stringify(status).includes(channel.url), false);
    await control('/close', { emission_id: first.emission_id, closed_by: 'Ana' });
    const ping = await (await control('/ping', { session_id: second.session_id, user_id: '2', is_playing: true })).json();
    assert.equal(ping.kicked, true);
    assert.match(ping.message, /Ana ha cerrado/);
    now += 121;
    relay.tick();
    assert.equal((await (await fetch(base + '/status', { headers: { Authorization: 'Bearer testing-secret' } })).json()).active_count, 0);
    const third = await (await control('/start', { channel, user_id: 1, name: 'Ana', tab: 'one' })).json();
    const thirdMedia = third.playlist_url.replace('127.0.0.1:5300', `127.0.0.1:${relay.server.address().port}`);
    assert.equal((await fetch(thirdMedia)).status, 200);
    now += 26;
    assert.equal((await fetch(thirdMedia)).status, 410, 'the media token needs an authenticated heartbeat');
  } finally {
    relay.stop();
    await new Promise((resolve) => relay.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
