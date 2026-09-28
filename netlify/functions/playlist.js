import { getStore } from '@netlify/blobs';
import { getSession, verifyRequestOrigin } from '../lib/auth.js';
import { commitPlaylist, getChunk, getManifest, isAdmin, saveChunk } from '../lib/playlist-store.js';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
});

export default async function playlist(request) {
  const user = await getSession(request);
  if (!user) return json({ error: 'Inicia sesión.' }, 401);
  if (!isAdmin(user)) return json({ error: 'Acceso no autorizado.' }, 403);

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  try {
    const store = getStore({ name: 'dorado-tv', consistency: 'strong' });
    if (request.method === 'GET' && action === 'session') {
      return json({ username: user.username, hasPlaylist: !!(await getManifest(store)) });
    }
    if (request.method === 'GET' && action === 'manifest') {
      const manifest = await getManifest(store);
      return manifest ? json(manifest) : json({ error: 'Todavía no hay lista.' }, 404);
    }
    if (request.method === 'GET' && action === 'chunk') {
      const chunk = await getChunk(store, Number(url.searchParams.get('index')));
      return chunk === null ? json({ error: 'Fragmento no encontrado.' }, 404) : new Response(chunk, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    }
    if (request.method === 'POST') {
      verifyRequestOrigin(request);
      if (action === 'chunk') {
        await saveChunk(store, url.searchParams.get('batch'), Number(url.searchParams.get('index')), await request.text());
        return json({ ok: true });
      }
      if (action === 'commit') {
        const { batch, count } = await request.json();
        return json(await commitPlaylist(store, batch, count));
      }
    }
    return json({ error: 'Ruta no encontrada.' }, 404);
  } catch (error) {
    if (error.message === 'Origen no permitido.') return json({ error: error.message }, 403);
    if (/inválid|Faltan fragmentos|formato esperado/.test(error.message || '')) {
      return json({ error: error.message }, 400);
    }
    return json({ error: 'No se pudo completar la operación.' }, 503);
  }
}
