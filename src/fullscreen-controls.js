/**
 * Auto-hide the unified video controls after mouse/touch/keyboard inactivity
 * while the player shell is in browser fullscreen. Outside fullscreen the
 * controls stay in the regular layout, including paused/live streams.
 */
export function setupFullscreenControls(shell, {
  doc = document,
  idleMs = 2800,
  scheduler = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let timer = null;
  let isPointerDown = false;
  const controls = shell.querySelector('.player-controls');
  const active = () => doc.fullscreenElement === shell;

  const clearIdle = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const show = () => {
    clearIdle();
    shell.classList.remove('fs-controls-idle');
  };
  const hideIfIdle = () => {
    timer = null;
    if (!active() || isPointerDown) return;
    if (controls?.contains(doc.activeElement) && doc.activeElement?.matches?.(':focus-visible')) {
      // Keyboard users must never lose the currently focused control.
      timer = scheduler(hideIfIdle, idleMs);
      return;
    }
    shell.classList.add('fs-controls-idle');
  };
  const reveal = () => {
    if (!active()) return;
    show();
    if (!isPointerDown) timer = scheduler(hideIfIdle, idleMs);
  };
  const onFullscreenChange = () => {
    show();
    if (active()) reveal();
  };
  const onPointerDown = () => {
    if (!active()) return;
    isPointerDown = true;
    show();
  };
  const onPointerUp = () => {
    isPointerDown = false;
    reveal();
  };
  const onFocusOut = () => {
    if (active()) reveal();
  };
  const onVisibility = () => {
    if (doc.hidden) show();
    else reveal();
  };
  shell.addEventListener('pointermove', reveal);
  shell.addEventListener('pointerdown', onPointerDown);
  doc.addEventListener('pointerup', onPointerUp);
  doc.addEventListener('pointercancel', onPointerUp);
  shell.addEventListener('focusin', reveal);
  shell.addEventListener('focusout', onFocusOut);
  doc.addEventListener('keydown', reveal);
  doc.addEventListener('fullscreenchange', onFullscreenChange);
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    reveal,
    dispose() {
      show();
      shell.removeEventListener('pointermove', reveal);
      shell.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('pointerup', onPointerUp);
      doc.removeEventListener('pointercancel', onPointerUp);
      shell.removeEventListener('focusin', reveal);
      shell.removeEventListener('focusout', onFocusOut);
      doc.removeEventListener('keydown', reveal);
      doc.removeEventListener('fullscreenchange', onFullscreenChange);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}
