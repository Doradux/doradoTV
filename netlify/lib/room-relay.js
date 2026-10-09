import { RoomError } from './room-store.js';

function config(env) {
  const base = env.DORADO_RELAY_URL;
  const secret = env.DORADO_RELAY_SECRET;
  if (!base || !secret) return null;
  let url;
  try { url = new URL(base); } catch { throw new RoomError('La configuración del relay no es válida.', 503); }
  const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new RoomError('El relay debe publicarse mediante HTTPS.', 503);
  }
  return { url, secret };
}

async function relayRequest(path, data, env, fetcher = fetch) {
  const relay = config(env);
  if (!relay) throw new RoomError('Este canal usa HTTP y necesita configurar el relay HTTPS.', 503);
  const url = new URL(path, relay.url);
  let response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${relay.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
  } catch {
    throw new RoomError('No se pudo contactar con el relay de vídeo.', 503);
  }
  let result = null;
  try { result = await response.json(); } catch { /* Keep relay internals private. */ }
  if (!response.ok) {
    const status = [404, 409].includes(response.status) ? response.status : 503;
    throw new RoomError(result?.error || 'El relay no pudo abrir la emisión.', status);
  }
  return result;
}

export function relayConfigured(env = process.env) {
  return !!config(env);
}

export function createRelayClient(env = process.env, fetcher = fetch) {
  return {
    configured: relayConfigured(env),
    async health() {
      const configValue = config(env);
      if (!configValue) return { configured: false, ready: false };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const target = new URL('/health', configValue.url);
          const response = await fetcher(target, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(6000) });
          if (response.ok && (await response.json()).ok === true) return { configured: true, ready: true };
        } catch { /* Sleeping containers may wake up on subsequent requests. */ }
      }
      return { configured: true, ready: false };
    },
    async start(channel, identity, tab) {
      const result = await relayRequest('/start', {
        channel: { name: channel.name, url: channel.url },
        user_id: identity,
        name: channel.viewerName,
        tab,
      }, env, fetcher);
      let playlist;
      try { playlist = new URL(result?.playlist_url); } catch { throw new RoomError('El relay devolvió una emisión inválida.', 503); }
      if (playlist.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(playlist.hostname)) {
        throw new RoomError('El relay no está publicando la emisión mediante HTTPS.', 503);
      }
      return {
        sessionId: result.session_id,
        emissionId: result.emission_id,
        url: playlist.href,
      };
    },
    async ping(sessionId, identity, playing = true) {
      return relayRequest('/ping', { session_id: sessionId, user_id: identity, is_playing: playing }, env, fetcher);
    },
    async close(emissionId, closedBy) {
      try { return await relayRequest('/close', { emission_id: emissionId, closed_by: closedBy }, env, fetcher); }
      catch (error) {
        if (error.status === 404) return { ok: true };
        throw error;
      }
    },
  };
}
