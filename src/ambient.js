// A small, blurred copy of the current frame fills the unused player space.
// No pixel readback is needed, so direct cross-origin video remains playable.
export function createAmbientLight(video, canvas, stage) {
  const context = canvas.getContext('2d', { alpha: false });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = null;
  let lastPaint = 0;
  let failed = false;

  function fitVideo() {
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
    const width = Math.min(stage.clientWidth, stage.clientHeight * ratio);
    video.style.width = `${width}px`;
    video.style.height = `${width / ratio}px`;
  }

  function paint() {
    if (!context || failed || video.readyState < 2) return;
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.classList.add('is-visible');
    } catch {
      failed = true;
      canvas.classList.remove('is-visible');
    }
  }

  function cancel() {
    if (frame === null) return;
    if (video.requestVideoFrameCallback) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = null;
  }

  function tick(time) {
    frame = null;
    if (document.hidden || video.paused || video.ended || failed || reducedMotion.matches) return;
    // Cap drawing at 12 fps; the 96 × 54 buffer keeps the effect inexpensive.
    if (time - lastPaint >= 1000 / 12) { paint(); lastPaint = time; }
    if (!failed) schedule();
  }

  function schedule() {
    frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  function resume() {
    cancel();
    if (document.hidden) return;
    paint();
    if (!video.paused && !video.ended && !failed && !reducedMotion.matches) schedule();
  }

  function reset() {
    cancel();
    failed = false;
    lastPaint = 0;
    canvas.classList.remove('is-visible');
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }

  const observer = new ResizeObserver(fitVideo);
  observer.observe(stage);
  const events = { loadedmetadata: fitVideo, resize: fitVideo, loadeddata: resume, playing: resume, seeked: resume, pause: cancel, ended: cancel, emptied: reset, error: reset };
  Object.entries(events).forEach(([event, listener]) => video.addEventListener(event, listener));
  document.addEventListener('visibilitychange', resume);
  reducedMotion.addEventListener('change', resume);
  return {
    reset,
    destroy() {
      reset();
      observer.disconnect();
      Object.entries(events).forEach(([event, listener]) => video.removeEventListener(event, listener));
      document.removeEventListener('visibilitychange', resume);
      reducedMotion.removeEventListener('change', resume);
    },
  };
}
