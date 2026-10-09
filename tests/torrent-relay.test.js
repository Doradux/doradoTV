import assert from 'node:assert/strict';
import test from 'node:test';
import WebTorrent from 'webtorrent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { TorrentRelay, rangeForTorrent } from '../relay/torrent-service.js';

test('torrent media byte ranges enforce valid seek boundaries', () => {
  assert.deepEqual(rangeForTorrent(null, 100), { start: 0, end: 99, partial: false });
  assert.deepEqual(rangeForTorrent('bytes=10-25', 100), { start: 10, end: 25, partial: true });
  assert.deepEqual(rangeForTorrent('bytes=90-', 100), { start: 90, end: 99, partial: true });
  assert.deepEqual(rangeForTorrent('bytes=-10', 100), { start: 90, end: 99, partial: true });
  for (const invalid of ['bytes=101-', 'bytes=15-4', 'bytes=1-2,5-10', 'bytes=a-b', 'bytes=-0'])
    assert.throws(() => rangeForTorrent(invalid, 100), { status: 416 });
});

test('actual native TCP BitTorrent peer streams media through authenticated relay HTTP Range', { timeout: 35000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dorado-torrent-test-'));
  const owner = new WebTorrent({ dht: false, lsd: false, tracker: false, maxConns: 8, natUpnp: false });
  let relay, base;
  try {
    const bytes = Buffer.from('LEGAL-PUBLIC-DOMAIN-TEST-FILE'.repeat(600));
    const seeded = await new Promise((resolve, reject) => owner.seed(bytes, { name: 'sample.mp4' }, resolve));
    const torrents = new TorrentRelay({
      directory, createClient: async () => WebTorrent, maxBytes: 200000,
      metadataTimeout: 18000, idleMs: 0, blockPrivatePeers: false,
    });
    relay = createRelay({
      directory, secret: 'relay-secret-for-test', appOrigin: 'http://127.0.0.1:5199',
      torrentFactory: torrents,
    });
    await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
    base = 'http://127.0.0.1:' + relay.server.address().port;
    const auth = { authorization: 'Bearer relay-secret-for-test', 'content-type': 'application/json' };
    const post = async (path, data, headers=auth) => fetch(base + path, {
      method: 'POST', headers, body: JSON.stringify(data),
    });
    assert.equal((await post('/torrent/start', { info_hash: seeded.infoHash, user_id: 'x' }, {})).status, 401);
    const opened = await post('/torrent/start', {
      info_hash: seeded.infoHash, file_idx: 0, user_id: 'room-session-123',
    });
    assert.equal(opened.status, 200);
    const { session_id: id } = await opened.json();
    const target = torrents.swarms.get(seeded.infoHash);
    assert(target, 'Peer swarm has started');
    if (!target.torrent.infoHash) await new Promise((resolve) => target.torrent.once('infoHash', resolve));
    target.torrent.addPeer('127.0.0.1:' + owner.torrentPort);
    let status = null;
    for (let i = 0; i < 80; i++) {
      const response = await post('/torrent/status', { session_id: id, user_id: 'room-session-123' });
      assert.equal(response.status, 200);
      status = await response.json();
      if (status.state === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 140));
    }
    assert.equal(status.state, 'ready');
    assert.equal(new URL(status.playback_url).host, new URL(base).host);
    const origin = 'http://127.0.0.1:5199';
    const mediaHeaders = { origin, range: 'bytes=10-120' };
    const partial = await fetch(status.playback_url, { headers: mediaHeaders });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 10-120/' + bytes.length);
    assert.equal(partial.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(10, 121));
    const tail = await fetch(status.playback_url, { headers: { origin, range: 'bytes=-20' } });
    assert.equal(tail.status, 206);
    assert.deepEqual(Buffer.from(await tail.arrayBuffer()), bytes.subarray(-20));
    // Two viewers of the same torrent reuse the same real TCP swarm.
    const secondResponse = await post('/torrent/start', {
      info_hash: seeded.infoHash, file_idx: 0, user_id: 'another-viewer',
    });
    assert.equal(secondResponse.status, 200);
    const second = await secondResponse.json();
    assert.notEqual(second.session_id, id);
    assert.equal(torrents.swarms.size, 1);
    const secondStatus = await (await post('/torrent/status', {
      session_id: second.session_id, user_id: 'another-viewer',
    })).json();
    assert.equal(secondStatus.state, 'ready');
    assert.notEqual(secondStatus.playback_url, status.playback_url);
    const otherMedia = await fetch(secondStatus.playback_url, { headers: { origin, range: 'bytes=0-15' } });
    assert.equal(otherMedia.status, 206);
    assert.deepEqual(Buffer.from(await otherMedia.arrayBuffer()), bytes.subarray(0, 16));
    const head = await fetch(status.playback_url, { method:'HEAD', headers:{ origin } });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    assert.equal((await fetch(status.playback_url.replace(/token=[^&]+/, 'token=invalid'),
      {headers:{origin}})).status, 410);
    assert.equal((await fetch(status.playback_url, {headers:{origin:'https://evil.example'}})).status, 403);
    assert.equal((await post('/torrent/ping', {session_id:id, user_id:'not-the-viewer'})).status, 410);
    assert.equal((await post('/torrent/stop', {session_id:id,user_id:'room-session-123'})).status, 200);
    assert.equal((await fetch(status.playback_url,{headers:{origin}})).status, 410);
    const stillPlaying = await fetch(secondStatus.playback_url, {headers:{origin,range:'bytes=5-15'}});
    assert.equal(stillPlaying.status, 206);
    assert.deepEqual(Buffer.from(await stillPlaying.arrayBuffer()), bytes.subarray(5,16));
    assert.equal((await post('/torrent/stop', {session_id:second.session_id,user_id:'another-viewer'})).status, 200);
  } finally {
    if (relay) {
      relay.stop();
      await new Promise((resolve) => relay.server.close(resolve));
    }
    await new Promise((resolve) => owner.destroy(resolve));
    rmSync(directory, {recursive:true,force:true});
  }
});
