import { getSession, verifyRequestOrigin } from '../lib/auth.js';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const actions = { start: '/start', ping: '/ping', close: '/close' };

export default async function relay(request) {
  const user = await getSession(request);
  if (!user) return json({ error: 'Inicia sesión.' }, 401);
  const base = process.env.DORADO_RELAY_URL;
  const secret = process.env.DORADO_RELAY_SECRET;
  const action = new URL(request.url).searchParams.get('action');
  if (request.method === 'GET' && action === 'config') return json({ enabled: !!(base && secret) });
  if (user.role !== 'admin' && action === 'close') return json({ error: 'Acceso no autorizado.' }, 403);
  if (!base || !secret) return json({ error: 'El relay no está configurado.' }, 503);
  const path = request.method === 'GET' && action === 'status' ? '/status' : request.method === 'POST' && actions[action];
  if (!path) return json({ error: 'Ruta no encontrada.' }, 404);
  try {
    let body;
    if (request.method === 'POST') {
      verifyRequestOrigin(request);
      if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: 'Solicitud demasiado grande.' }, 413);
      const input = await request.json();
      body = JSON.stringify(action === 'start'
        ? { channel: input.channel, user_id: String(user.id), name: user.username, tab: input.tab }
        : action === 'ping'
          ? { session_id: input.session_id, is_playing: input.is_playing, user_id: String(user.id) }
          : { emission_id: input.emission_id, closed_by: user.username });
      if (body.length > 4096) return json({ error: 'Solicitud demasiado grande.' }, 413);
    }
    const response = await fetch(new URL(path, base), {
      method: request.method,
      headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    });
    return json(await response.json(), response.status);
  } catch (error) {
    if (error.message === 'Origen no permitido.') return json({ error: error.message }, 403);
    if (error instanceof SyntaxError) return json({ error: 'Solicitud inválida.' }, 400);
    return json({ error: 'No se pudo contactar con el relay.' }, 503);
  }
}
