import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRelay } from '../relay/server.js';
import { DirectAudioSessions, validateDirectMediaUrl, openDirectMedia } from '../relay/direct-audio.js';

test('direct audio URL validation rejects private hosts, credentials and non-HTTPS', async () => {
  assert.equal(validateDirectMediaUrl('https://cdn.example.org/video.mkv?token=example').hostname, 'cdn.example.org');
  for (const url of [
    'http://cdn.example.org/movie.mkv', 'https://127.0.0.1/video.mkv',
    'https://[::1]/video.mkv', 'https://localhost/video.mkv',
    'https://cdn.example.org:9000/video.mkv', 'https://admin:password@cdn.example.org/movie.mkv',
    'https://192.168.1.175/video.mkv', 'https://foo.internal/file.mkv',
  ]) assert.throws(() => validateDirectMediaUrl(url));
  for (const address of ['127.0.0.1','192.168.1.10','169.254.169.254','10.10.1.2']) {
    await assert.rejects(openDirectMedia('https://cdn.example.org/video.mkv', {
      resolver: async () => [{ address, family: 4 }],
      transport: () => { throw Error('Private destination was contacted!'); },
    }), /red no permitida/);
  }
});

test('direct audio sessions have temporary random tokens, owner-bound revocation and expiry', async () => {
  let now = 10000, opened = false, closed = false;
  const sessions = new DirectAudioSessions({
    clock: () => now,
    opener: async () => { opened = true; return { stream: Readable.from([Buffer.from('test')]), close: () => { closed = true; } }; },
  });
  const result = sessions.start('https://cdn.example.org/movie.mkv', 'user1', 'https://relay.example.org');
  assert.match(result.playback_url, /^https:\/\/relay\.example\.org\/direct-audio\//);
  const token = new URL(result.playback_url).searchParams.get('token');
  assert.equal(token.length, 64);
  assert.throws(() => sessions.authenticate(result.session_id, 'bad'));
  assert.equal(sessions.stop(result.session_id, 'wrong-user').ok, true);
  assert.equal(sessions.entries.size, 1);
  const stream = await sessions.open(result.session_id, token);
  assert(opened);
  stream.close();
  assert(closed);
  assert.equal(sessions.entries.size, 0);
  assert.throws(() => sessions.authenticate(result.session_id, token));
  const expiring = sessions.start('https://cdn.example.org/video.mkv', 'user1', 'https://relay.example.org');
  now += 4 * 60 * 1000;
  sessions.sweep();
  assert.throws(() => sessions.authenticate(expiring.session_id, new URL(expiring.playback_url).searchParams.get('token')));
});

test('relay converts direct MKV AC3 audio to AAC while copying video, with access checks', { timeout: 40000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'dorado-direct-audio-'));
  let relay;
  try {
    const input = join(directory, 'input.mkv');
    try {
      execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-y',
        '-f','lavfi','-i','testsrc=size=160x90:rate=25',
        '-f','lavfi','-i','sine=frequency=500:sample_rate=48000',
        '-t','1.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',
        '-c:a','ac3','-b:a','192k',input], { timeout: 20000 });
    } catch (error) {
      if (error.code === 'ENOENT') return t.skip('FFmpeg is not available on this test host.');
      throw error;
    }
    const original = readFileSync(input);
    relay = createRelay({ directory, secret: 'secure-test-audio-relay',
      appOrigin: 'http://127.0.0.1:5199' });
    relay.directAudio.opener = async () => ({
      stream: Readable.from([original]), close: () => {},
    });
    await new Promise((resolve) => relay.server.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + relay.server.address().port;
    const res = await fetch(base + '/direct-audio/start', {
      method: 'POST', headers: {
        Authorization: 'Bearer secure-test-audio-relay',
        'Content-Type': 'application/json',
        'X-Forwarded-Host': 'relay-test.example.org',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ url: 'https://cdn.example.org/example.mkv', user_id: 'user1' }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    const started = await res.json();
    const url = started.playback_url.replace('https://relay-test.example.org', base);
    assert.equal((await fetch(url.replace(/token=[a-f0-9]+/, 'token=invalid'), {
      headers: { Origin: 'http://127.0.0.1:5199' },
    })).status, 410);
    assert.equal((await fetch(url, { headers: { Origin: 'https://evil.example.com' } })).status, 403);
    const head = await fetch(url, { method: 'HEAD', headers: { Origin: 'http://127.0.0.1:5199' } });
    assert.equal(head.status, 200);
    const playback = await fetch(url, { headers: { Origin: 'http://127.0.0.1:5199' },
      signal: AbortSignal.timeout(25000) });
    assert.equal(playback.status, 200);
    assert.equal(playback.headers.get('content-type'), 'video/mp4');
    const output = Buffer.from(await playback.arrayBuffer());
    assert(output.length > 5000);
    const movie = join(directory, 'result.mp4');
    writeFileSync(movie, output);
    const probe = spawnSync('ffmpeg', ['-hide_banner', '-i', movie, '-f', 'null', '-'],
      { encoding: 'utf8', timeout: 14000 });
    assert.equal(probe.status, 0, probe.stderr?.slice(-1000));
    assert.match(probe.stderr, /Audio: aac/);
    assert.match(probe.stderr, /Video: h264/);
    assert.equal(relay.torrents.activeRemux, 0);
    assert.equal(relay.directAudio.entries.size, 0);
  } finally {
    if (relay) {
      relay.stop();
      await new Promise(resolve => relay.server.close(resolve));
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
