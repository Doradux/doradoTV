import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmbientLight } from '../src/ambient.js';

test('ambient video glow paints every presented frame at the source frame rate', () => {
  const original = { doc: globalThis.document, media: globalThis.matchMedia,
    observer: globalThis.ResizeObserver };
  const doc = new EventTarget();
  doc.hidden = false;
  globalThis.document = doc;
  const media = new EventTarget();
  media.matches = false;
  globalThis.matchMedia = () => media;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const callbacks = new Map();
  let nextId = 0, draws = 0, removed = false;
  class Video extends EventTarget {
    readyState = 4;
    paused = true;
    ended = false;
    videoWidth = 1920;
    videoHeight = 1080;
    currentTime = 0;
    style = {};
    requestVideoFrameCallback(cb) {
      const id = ++nextId;
      callbacks.set(id, cb);
      return id;
    }
    cancelVideoFrameCallback(id) { callbacks.delete(id); }
    present(t) {
      const [id, callback] = callbacks.entries().next().value || [];
      assert.ok(callback, 'A decoded frame callback should be scheduled');
      callbacks.delete(id);
      this.currentTime = t;
      callback(performance.now(), { mediaTime: t });
    }
  }
  const video = new Video();
  const canvas = {
    width: 192, height: 108,
    getContext: () => ({ drawImage: () => { draws++; }, clearRect() {} }),
    classList: { add() {}, remove() { removed = true; } },
  };
  const stage = { clientWidth: 1200, clientHeight: 675 };
  let ambient;
  try {
    ambient = createAmbientLight(video, canvas, stage);
    video.paused = false;
    video.dispatchEvent(new Event('playing'));
    const before = draws;
    for (let i = 0; i < 30; i++) video.present((i + 1) / 30);
    assert.equal(draws - before, 30, 'No 12-FPS throttle: paint all 30 video frames');
    assert.equal(callbacks.size, 1, 'Only one video frame callback at once');
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    assert.equal(callbacks.size, 0, 'Stop drawing during pause');
    doc.hidden = true;
    video.dispatchEvent(new Event('playing'));
    assert.equal(callbacks.size, 0, 'Do not paint hidden tabs');
    ambient.destroy();
    assert.equal(callbacks.size, 0);
    assert.ok(removed);
  } finally {
    ambient?.destroy();
    globalThis.document = original.doc;
    globalThis.matchMedia = original.media;
    globalThis.ResizeObserver = original.observer;
  }
});
