// Generate preview addresses only from the relay-signed playlist URL; never
// persist URLs/tokens in localStorage, sessionStorage or browser history.
export const THUMBNAIL_INTERVAL_SECONDS = 20;

export function thumbnailSlot(time, duration) {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return null;
  return Math.max(0, Math.floor(Math.min(duration - 0.001, Math.max(0, time)) / THUMBNAIL_INTERVAL_SECONDS));
}
export function thumbnailUrl(playlist, time, duration) {
  const slot = thumbnailSlot(time, duration);
  if (slot === null || typeof playlist !== 'string') return null;
  try {
    const url = new URL(playlist);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!/^\/vod\/[0-9a-f-]{36}\/index\.m3u8$/.test(url.pathname) ||
      !/^[a-f0-9]{64}$/.test(url.searchParams.get('token') || '')) return null;
    url.pathname = url.pathname.replace(/index\.m3u8$/, 'thumb_' + slot + '.jpg');
    return url.href;
  } catch { return null; }
}
export function pointerTimeline(clientX, rect, range) {
  if (!range || !Number.isFinite(rect?.width) || rect.width <= 0) return null;
  const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return { percent, time: range.start + percent * (range.end - range.start) };
}
export function createVodTimelinePreview(input, preview, {
  getRange, getPlaylist, preparePlaylist, formatTime,
} = {}) {
  const thumb = preview.querySelector('img'), timeLabel = preview.querySelector('[data-preview-time]');
  const stateLabel = preview.querySelector('[data-preview-state]');
  let generation = 0, timer = null, lastImage = '', activeSlot = -1, isHovering = false;
  let pending = null;
  const show = () => { preview.hidden = false; };
  const hide = () => {
    isHovering = false;
    generation++;
    activeSlot = -1;
    preview.hidden = true;
    preview.classList.remove('has-image');
    clearTimeout(timer);
    timer = null;
  };
  const reset = () => {
    hide();
    generation++;
    lastImage = '';
    activeSlot = -1;
    thumb.removeAttribute('src');
    thumb.hidden = true;
    pending = null;
  };
  function position(clientX, rect, range) {
    const item = pointerTimeline(clientX, rect, range);
    if (!item) return;
    show();
    isHovering = true;
    timeLabel.textContent = formatTime(item.time);
    // Keep the tooltip inside the player even when the cursor is at the ends.
    const width = Math.min(192, rect.width);
    preview.style.left = Math.max(width / 2, Math.min(rect.width - width / 2,
      item.percent * rect.width)) + 'px';
    const slot = thumbnailSlot(item.time, range.duration);
    if (slot === activeSlot) return;
    activeSlot = slot;
    preview.classList.remove('has-image');
    thumb.hidden = true;
    stateLabel.hidden = false;
    stateLabel.textContent = 'Preparando miniatura…';
    clearTimeout(timer);
    const version = ++generation;
    timer = setTimeout(async () => {
      try {
        let playlist = getPlaylist();
        if (!playlist) {
          if (!pending) pending = Promise.resolve(preparePlaylist?.()).finally(() => { pending = null; });
          playlist = await pending;
        }
        if (version !== generation || !isHovering || !playlist) return;
        const url = thumbnailUrl(playlist, item.time, range.duration);
        if (!url) throw Error('Sin vista previa.');
        if (url === lastImage && thumb.complete && thumb.naturalWidth) {
          thumb.hidden = false;
          preview.classList.add('has-image');
          stateLabel.hidden = true;
          return;
        }
        thumb.onload = () => {
          if (version !== generation) return;
          lastImage = url;
          thumb.hidden = false;
          preview.classList.add('has-image');
          stateLabel.hidden = true;
        };
        thumb.onerror = () => {
          if (version !== generation) return;
          thumb.hidden = true;
          preview.classList.remove('has-image');
          stateLabel.hidden = false;
          stateLabel.textContent = 'Vista previa no disponible';
        };
        thumb.src = url;
      } catch {
        if (version !== generation) return;
        stateLabel.textContent = 'Vista previa no disponible';
      }
    }, 220);
  }
  const onPointer = (event) => {
    if (input.disabled) return hide();
    const range = getRange();
    if (!range) return hide();
    position(event.clientX, input.getBoundingClientRect(), range);
  };
  const onLeave = () => hide();
  const onKeyboard = () => {
    if (input.disabled || !getRange()) return;
    const range = getRange();
    const percent = Math.max(0, Math.min(1, Number(input.value) / 1000));
    const bounds = input.getBoundingClientRect();
    position(bounds.left + bounds.width * percent, bounds, range);
  };
  input.addEventListener('pointermove', onPointer);
  input.addEventListener('pointerdown', onPointer);
  input.addEventListener('pointerleave', onLeave);
  input.addEventListener('pointercancel', onLeave);
  input.addEventListener('blur', onLeave);
  input.addEventListener('input', onKeyboard);
  return {
    reset, hide, destroy() {
      reset();
      input.removeEventListener('pointermove', onPointer);
      input.removeEventListener('pointerdown', onPointer);
      input.removeEventListener('pointerleave', onLeave);
      input.removeEventListener('pointercancel', onLeave);
      input.removeEventListener('blur', onLeave);
      input.removeEventListener('input', onKeyboard);
    },
  };
}
