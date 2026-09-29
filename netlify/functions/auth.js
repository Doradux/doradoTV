import { getDatabase } from '@netlify/database';
import {
  createUser,
  deleteSession,
  deleteUser,
  expiredCookie,
  getSession,
  listUsers,
  loginUser,
  sessionCookie,
  updateUser,
  verifyRequestOrigin,
} from '../lib/auth.js';

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

export default async function auth(request) {
  const action = new URL(request.url).searchParams.get('action');
  try {
    const db = getDatabase();
    if (request.method === 'GET' && action === 'session') {
      const user = await getSession(request, db);
      return user?.role === 'admin' ? json({ username: user.username, role: user.role }) : json({ error: 'Inicia sesión.' }, 401);
    }
    if (request.method === 'POST' && action === 'login') {
      verifyRequestOrigin(request);
      if (Number(request.headers.get('content-length') || 0) > 4096) return json({ error: 'Solicitud demasiado grande.' }, 413);
      const { username, password } = await request.json();
      const result = await loginUser(username, password, db);
      if (result.error) return json({ error: result.error }, result.status);
      return json(result.user, 200, { 'Set-Cookie': sessionCookie(result.token, request) });
    }
    if (request.method === 'POST' && action === 'logout') {
      verifyRequestOrigin(request);
      await deleteSession(request, db);
      return json({ ok: true }, 200, { 'Set-Cookie': expiredCookie(request) });
    }
    if (request.method === 'GET' && action === 'users') {
      const user = await getSession(request, db);
      if (user?.role !== 'admin') return json({ error: 'No autorizado.' }, 403);
      const users = await listUsers(db);
      return json(users);
    }
    if (request.method === 'POST' && action === 'create-user') {
      verifyRequestOrigin(request);
      const user = await getSession(request, db);
      if (user?.role !== 'admin') return json({ error: 'No autorizado.' }, 403);
      const { username, password } = await request.json();
      const result = await createUser(username, password, db);
      if (result.error) return json({ error: result.error }, result.status);
      return json({ ok: true });
    }
    if (request.method === 'POST' && action === 'update-user') {
      verifyRequestOrigin(request);
      const user = await getSession(request, db);
      if (user?.role !== 'admin') return json({ error: 'No autorizado.' }, 403);
      const { username, password, newUsername } = await request.json();
      const result = await updateUser(username, password, newUsername, db);
      if (result.error) return json({ error: result.error }, result.status);
      return json({ ok: true });
    }
    if (request.method === 'POST' && action === 'delete-user') {
      verifyRequestOrigin(request);
      const user = await getSession(request, db);
      if (user?.role !== 'admin') return json({ error: 'No autorizado.' }, 403);
      const { username } = await request.json();
      const result = await deleteUser(username, user.username, db);
      if (result.error) return json({ error: result.error }, result.status);
      return json({ ok: true });
    }
    return json({ error: 'Ruta no encontrada.' }, 404);
  } catch (error) {
    if (error.message === 'Origen no permitido.') return json({ error: error.message }, 403);
    if (error instanceof SyntaxError) return json({ error: 'Solicitud inválida.' }, 400);
    return json({ error: 'No se pudo completar la operación.' }, 503);
  }
}
