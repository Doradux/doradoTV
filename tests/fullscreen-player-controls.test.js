import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupFullscreenControls } from '../src/fullscreen-controls.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class FakeClassList {
  values = new Set();
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}
class PlayerShell extends EventTarget {
  classList = new FakeClassList();
  querySelector(selector) { return selector === '.player-controls' ? { contains: (node) => !!node?.inControls } : null; }
}
class FakeDoc extends EventTarget {
  fullscreenElement = null;
  activeElement = null;
  hidden = false;
}
test('fullscreen controls hide after inactivity and reappear for pointer and keyboard, never outside fullscreen', async () => {
  const shell = new PlayerShell(), doc = new FakeDoc();
  const controller = setupFullscreenControls(shell, { doc, idleMs: 35 });
  try {
    shell.dispatchEvent(new Event('pointermove'));
    await sleep(48);
    assert.equal(shell.classList.contains('fs-controls-idle'), false);
    doc.fullscreenElement = shell;
    doc.dispatchEvent(new Event('fullscreenchange'));
    await sleep(48);
    assert(shell.classList.contains('fs-controls-idle'), 'Full-screen should auto-hide');
    shell.dispatchEvent(new Event('pointermove'));
    assert(!shell.classList.contains('fs-controls-idle'), 'Moving the mouse should reveal controls');
    await sleep(48);
    assert(shell.classList.contains('fs-controls-idle'), 'Idle should hide again');
    doc.dispatchEvent(new Event('keydown'));
    assert(!shell.classList.contains('fs-controls-idle'), 'Keyboard activity should reveal controls');
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
    await sleep(48);
    assert(!shell.classList.contains('fs-controls-idle'), 'Exit restores normal controls');
  } finally { controller.dispose(); }
});

test('dragging controls and focus-visible keyboard navigation prevent disappearing', async () => {
  const shell = new PlayerShell(), doc = new FakeDoc();
  const controller = setupFullscreenControls(shell, { doc, idleMs: 35 });
  try {
    doc.fullscreenElement = shell;
    doc.dispatchEvent(new Event('fullscreenchange'));
    shell.dispatchEvent(new Event('pointerdown'));
    await sleep(55);
    assert(!shell.classList.contains('fs-controls-idle'), 'Pointer held on seek bar must stay visible');
    doc.dispatchEvent(new Event('pointerup'));
    await sleep(48);
    assert(shell.classList.contains('fs-controls-idle'), 'After release controls should hide');

    doc.activeElement = { inControls: true, matches: (selector) => selector === ':focus-visible' };
    doc.dispatchEvent(new Event('keydown'));
    await sleep(100);
    assert(!shell.classList.contains('fs-controls-idle'), 'Focused keyboard element is visible');
    doc.activeElement = null;
    shell.dispatchEvent(new Event('focusout'));
    await sleep(48);
    assert(shell.classList.contains('fs-controls-idle'));
  } finally { controller.dispose(); }
});

test('VOD timeline and transport are contained by the same M3U player control surface', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/main.css', import.meta.url), 'utf8');
  const stremioCss = readFileSync(new URL('../src/stremio.css', import.meta.url), 'utf8');
  const start = main.indexOf('<div class="player-controls"');
  const end = main.indexOf('<div class="now-playing">', start);
  const markup = main.slice(start, end);
  assert(start !== -1 && end > start);
  for (const id of ['vod-tools', 'vod-seek', 'vod-clock', 'vod-transport',
    'vod-prev', 'vod-back', 'vod-forward', 'vod-next', 'play', 'volume', 'fullscreen']) {
    assert(markup.includes('id="'+id+'"'), 'Missing shared player control '+id);
    assert.equal((main.match(new RegExp('id="'+id+'"','g')) || []).length, 1);
  }
  assert(markup.indexOf('id="vod-tools"') < markup.indexOf('class="player-actions"'),
    'Timeline row must share panel directly above playback buttons');
  assert(markup.indexOf('id="vod-transport"') > markup.indexOf('class="player-actions"'));
  assert.match(main, /setupFullscreenControls\(\$\('#player-shell'\)\)/);
  assert.match(main, /fullscreenControls\.dispose\(\)/);
  assert.match(css, /\.player-shell:fullscreen \.player-controls\s*\{\s*position:\s*absolute/);
  assert.match(css, /\.player-shell:fullscreen\.fs-controls-idle \.player-controls/);
  assert.match(stremioCss, /#vod-transport\[hidden\]/);
});
