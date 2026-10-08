import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPlaybackTime, seasonGroups, seekTarget } from '../src/vod-utils.js';

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
