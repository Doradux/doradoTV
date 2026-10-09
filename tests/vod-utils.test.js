import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaybackTime, seasonGroups, seekTarget, vodSeekRange, timeFromSlider, sliderFromTime } from '../src/vod-utils.js';

test('playback clock formats minutes and hours', () => {
  assert.equal(formatPlaybackTime(0), '0:00');
  assert.equal(formatPlaybackTime(75), '1:15');
  assert.equal(formatPlaybackTime(3723), '1:02:03');
  assert.equal(formatPlaybackTime(Infinity), '00:00');
});

test('episodes are grouped by season and ordered; specials last', () => {
  const groups = seasonGroups([
    { id: 's2e2', season: 2, episode: 2, title: 'B' },
    { id: 'sp', season: 0, episode: 1, title: 'Special' },
    { id: 's1e2', season: 1, episode: 2, title: 'Two' },
    { id: 's1e1', season: 1, episode: 1, title: 'One' },
    { id: 's2e1', season: 2, episode: 1, title: 'A' },
    { id: 'unknown', title: 'Extra' },
    { id: '' },
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['Temporada 1', 'Temporada 2', 'Especiales', 'Sin temporada']);
  assert.deepEqual(groups[0].episodes.map((e) => e.id), ['s1e1', 's1e2']);
  assert.deepEqual(groups[1].episodes.map((e) => e.id), ['s2e1', 's2e2']);
});

test('seeking remains inside playable bounds', () => {
  assert.equal(seekTarget(50, -10, 0, 100), 40);
  assert.equal(seekTarget(4, -10, 0, 100), 0);
  assert.equal(seekTarget(98, 10, 0, 100), 100);
  assert.equal(seekTarget(50, 10, 30, 60), 60);
  assert.equal(seekTarget(4, 10, 0, Infinity), null);
});

test('VOD seeking starts as soon as duration is known even before seekable ranges appear', () => {
  const video = { duration: 120, currentTime: 20, seekable: { length: 0 } };
  const range = vodSeekRange(video);
  assert.deepEqual(range, { start: 0, end: 120, duration: 120 });
  assert.equal(seekTarget(video.currentTime, 10, range.start, range.end), 30);
  assert.equal(seekTarget(video.currentTime, -10, range.start, range.end), 10);
  assert.equal(timeFromSlider(500, range), 60);
  assert.equal(sliderFromTime(60, range), 500);
});

test('seeking clamps to the actual playable window, including HLS windows', () => {
  const video = { duration: 300, seekable: {
    length: 2, start: (i) => i === 0 ? 30 : 120, end: (i) => i === 0 ? 80 : 270,
  } };
  const range = vodSeekRange(video);
  assert.deepEqual(range, { start: 30, end: 270, duration: 300 });
  assert.equal(timeFromSlider(0, range), 30);
  assert.equal(timeFromSlider(1000, range), 270);
  assert.equal(sliderFromTime(150, range), 500);
  assert.equal(seekTarget(269, 10, range.start, range.end), 270);
  assert.equal(timeFromSlider(5000, range), 270);
});

test('live/unknown duration and forward-only remux cannot advertise random-access', () => {
  assert.equal(vodSeekRange({ duration: Infinity, seekable: { length: 0 } }), null);
  assert.equal(vodSeekRange({ duration: NaN, seekable: { length: 0 } }), null);
  assert.equal(vodSeekRange({ duration: 0, seekable: { length: 0 } }), null);
  assert.equal(vodSeekRange({ duration: 300, seekable: { length: 0 } }, true), null);
  assert.equal(timeFromSlider(100, null), null);
});
