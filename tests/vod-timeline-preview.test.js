import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { thumbnailSlot, thumbnailUrl, pointerTimeline } from '../src/vod-timeline-preview.js';

const playlist='https://relay.example.org/vod/11111111-2222-3333-4444-555555555555/index.m3u8?token='+'a'.repeat(64);
test('timeline thumbnail slots are bounded, rounded to 20-second cached frames', () => {
  assert.equal(thumbnailSlot(0,120),0);
  assert.equal(thumbnailSlot(19.99,120),0);
  assert.equal(thumbnailSlot(20,120),1);
  assert.equal(thumbnailSlot(119.99,120),5);
  assert.equal(thumbnailSlot(120,120),5);
  assert.equal(thumbnailSlot(-2,120),0);
  assert.equal(thumbnailSlot(Infinity,120),null);
  assert.equal(thumbnailSlot(10,NaN),null);
});
test('preview URL inherits session authorization without permitting arbitrary URL origins', () => {
  assert.equal(thumbnailUrl(playlist,64,120),
    playlist.replace('index.m3u8','thumb_3.jpg'));
  assert.equal(thumbnailUrl('https://other.example.org/stream/movie?token='+'a'.repeat(64),20,120),null);
  assert.equal(thumbnailUrl(playlist.replace('a'.repeat(64),'bad'),20,120),null);
  assert.equal(thumbnailUrl(playlist.replace('https:','javascript:'),20,120),null);
});
test('hover time is calculated by pointer position independently from playback position', () => {
  const timeline={start:0,end:3600,duration:3600};
  assert.deepEqual(pointerTimeline(200,{left:100,width:400},timeline),{percent:0.25,time:900});
  assert.equal(pointerTimeline(-10,{left:100,width:400},timeline).time,0);
  assert.equal(pointerTimeline(900,{left:100,width:400},timeline).time,3600);
  assert.equal(pointerTimeline(200,{left:100,width:0},timeline),null);
});
test('player exposes a floating timeline thumbnail with no separate seek on hover', () => {
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const css=readFileSync(new URL('../src/stremio.css',import.meta.url),'utf8');
  assert.match(main,/id="vod-seek-preview"/);
  assert.match(main,/createVodTimelinePreview/);
  assert.match(main,/vodPreviewPlaylist = ready.url/);
  assert.match(css,/\.vod-seek-preview-frame/);
  assert.match(css,/\.vod-seek-preview\[hidden\]/);
});
