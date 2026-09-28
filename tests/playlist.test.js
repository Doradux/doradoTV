import test from 'node:test';
import assert from 'node:assert/strict';
import { groupsFor, parsePlaylist, safeHttpUrl } from '../src/playlist.js';

test('parses names, groups and URLs from an M3U playlist', () => {
  const channels = parsePlaylist(`#EXTM3U
#EXTINF:-1 tvg-name="Reserva" group-title="Deportes" tvg-logo="https://example.com/logo.png",Partido HD
https://example.com/live/one.m3u8
#EXTINF:-1,Siguiente
#EXTGRP:Noticias
https://example.com/live/two.ts`);
  assert.equal(channels.length, 2);
  assert.deepEqual(channels.map(({ name, group }) => ({ name, group })), [
    { name: 'Partido HD', group: 'Deportes' },
    { name: 'Siguiente', group: 'Noticias' },
  ]);
  assert.deepEqual(groupsFor(channels), ['Deportes', 'Noticias']);
});

test('resolves remote relative URLs and ignores unsafe or incomplete entries', () => {
  const channels = parsePlaylist(`#EXTINF:-1,Uno
/live/one.m3u8
#EXTINF:-1,Dos
javascript:alert(1)
#EXTINF:-1,Tres`, 'https://example.com/list.m3u');
  assert.equal(channels.length, 1);
  assert.equal(channels[0].url, 'https://example.com/live/one.m3u8');
  assert.equal(safeHttpUrl('file:///etc/passwd'), null);
});
