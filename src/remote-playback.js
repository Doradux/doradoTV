let castApiPromise = null;

function mediaType(url) {
  const path = new URL(url, location.href).pathname.toLowerCase();
  if (path.endsWith('.m3u8')) return 'application/x-mpegURL';
  if (path.endsWith('.ts')) return 'video/mp2t';
  return 'video/mp4';
}

function initializeCast() {
  const context = globalThis.cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: globalThis.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: globalThis.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });
  return context;
}

function loadCastApi() {
  if (globalThis.cast?.framework && globalThis.chrome?.cast) return Promise.resolve(true);
  if (castApiPromise) return castApiPromise;
  castApiPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const previous = globalThis.__onGCastApiAvailable;
    globalThis.__onGCastApiAvailable = (available, errorInfo) => {
      try { previous?.(available, errorInfo); } catch { /* Ignore third-party callback failures. */ }
      if (!available) { finish(false); return; }
      try { initializeCast(); finish(true); } catch { finish(false); }
    };

    let script = document.querySelector('script[data-dorado-cast-sdk]');
    if (!script) {
      script = document.createElement('script');
      script.dataset.doradoCastSdk = 'true';
      script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.async = true;
      script.onerror = () => finish(false);
      document.head.append(script);
    }
    setTimeout(() => finish(!!(globalThis.cast?.framework && globalThis.chrome?.cast)), 8000);
  });
  return castApiPromise;
}

function canceled(error) {
  return /cancel|user_cancel/i.test(String(error?.code || error || ''));
}

export function setupRemotePlayback({ video, button, getSource, getTitle, setStatus }) {
  const hasAirPlay = typeof video.webkitShowPlaybackTargetPicker === 'function';
  let castContext = null;
  let airPlayAvailable = hasAirPlay;
  const updateButton = () => {
    const airPlayActive = !!video.webkitCurrentPlaybackTargetIsWireless;
    const castActive = !!castContext?.getCurrentSession?.();
    const castAvailable = !!castContext
      && castContext.getCastState() !== globalThis.cast.framework.CastState.NO_DEVICES_AVAILABLE;
    button.disabled = !(airPlayAvailable || castAvailable || castActive);
    button.setAttribute('aria-pressed', String(airPlayActive || castActive));
    button.title = airPlayActive || castActive ? 'Transmitiendo a TV' : 'Transmitir a TV';
    button.setAttribute('aria-label', button.title);
  };

  if (hasAirPlay) {
    video.addEventListener('webkitplaybacktargetavailabilitychanged', (event) => {
      airPlayAvailable = event.availability === 'available';
      updateButton();
    });
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', updateButton);
  }

  if (!hasAirPlay) {
    loadCastApi().then((ready) => {
      if (!ready) { updateButton(); return; }
      castContext = initializeCast();
      castContext.addEventListener(globalThis.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, updateButton);
      castContext.addEventListener(globalThis.cast.framework.CastContextEventType.CAST_STATE_CHANGED, updateButton);
      updateButton();
    });
  }

  button.addEventListener('click', async () => {
    const source = getSource();
    if (!source) {
      setStatus('Reproduce un canal antes de transmitirlo a la TV.');
      return;
    }
    if (hasAirPlay) {
      try {
        video.webkitShowPlaybackTargetPicker();
      } catch {
        setStatus('No se pudo abrir el selector de AirPlay.', true);
      }
      return;
    }

    try {
      if (!castContext) {
        const ready = await loadCastApi();
        if (!ready) throw new Error('Google Cast no está disponible en este navegador.');
        castContext = initializeCast();
      }
      let session = castContext.getCurrentSession();
      if (!session) {
        await castContext.requestSession();
        session = castContext.getCurrentSession();
      }
      if (!session) return;

      const info = new globalThis.chrome.cast.media.MediaInfo(source, mediaType(source));
      info.streamType = globalThis.chrome.cast.media.StreamType.LIVE;
      const metadata = new globalThis.chrome.cast.media.GenericMediaMetadata();
      metadata.title = getTitle() || 'Dorado TV';
      metadata.subtitle = 'Dorado TV';
      info.metadata = metadata;
      const request = new globalThis.chrome.cast.media.LoadRequest(info);
      request.autoplay = true;
      await session.loadMedia(request);
      setStatus(`Retransmitiendo ${getTitle() || 'el canal'} en la TV.`);
      updateButton();
    } catch (error) {
      if (!canceled(error)) {
        setStatus(error?.message || 'No se pudo transmitir el canal a la TV.', true);
      }
    }
  });

  updateButton();

  return {
    refresh: updateButton,
  };
}
