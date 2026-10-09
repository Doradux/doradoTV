// A blurred copy of the decoded frame surrounds the player. Match the video's
// presentation cadence instead of updating at a fixed 12 FPS (visible judder).
// Drawing never reads pixels back, so cross-origin sources remain supported.
export function createAmbientLight(video, canvas, stage) {
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const videoFrames = typeof video.requestVideoFrameCallback === 'function'
    && typeof video.cancelVideoFrameCallback === 'function';
  let frame = null;
  let lastMediaTime = -1;
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
    if (videoFrames) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = null;
  }

  function tick(_time, metadata) {
    frame = null;
    if (document.hidden || video.paused || video.ended || failed || reducedMotion.matches) return;
    // requestVideoFrameCallback fires for decoded/presented frames (24/30/60 FPS).
    // RAF is a fallback; avoid duplicate copies of an unchanged frame there.
    const mediaTime = metadata?.mediaTime ?? video.currentTime;
    if (videoFrames || mediaTime !== lastMediaTime) {
      paint();
      lastMediaTime = mediaTime;
    }
    if (!failed) schedule();
  }

  function schedule() {
    if (frame !== null || failed) return;
    frame = videoFrames ? video.requestVideoFrameCallback(tick) : requestAnimationFrame(tick);
  }

  function resume() {
    cancel();
    if (document.hidden) return;
    paint();
    lastMediaTime = video.currentTime;
    if (!video.paused && !video.ended && !failed && !reducedMotion.matches) schedule();
  }

  function reset() {
    cancel();
    failed = false;
    lastMediaTime = -1;
    canvas.classList.remove('is-visible');
    context?.clearRect(0, 0, canvas.width, canvas.height);
  }

  const observer = new ResizeObserver(fitVideo);
  observer.observe(stage);
  const events = { loadedmetadata: fitVideo, resize: fitVideo, loadeddata: resume,
    playing: resume, seeked: resume, pause: resume, ended: cancel, emptied: reset, error: reset };
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
