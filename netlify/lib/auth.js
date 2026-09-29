import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getDatabase } from '@netlify/database';

const scrypt = promisify(scryptCallback);
const COOKIE = 'dorado_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const USERNAME = /^[a-zA-Z0-9_.-]{3,40}$/;

export function validUsername(value) {
  return typeof value === 'string' && USERNAME.test(value);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || !password || password.length > 1024) throw new Error('Contraseña inválida.');
  const salt = randomBytes(32);
  const hash = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 1024 || typeof encoded !== 'string') return false;
  const [algorithm, saltHex, hashHex] = encoded.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{64}$/.test(saltHex || '') || !/^[a-f0-9]{128}$/.test(hashHex || '')) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const match = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
  const token = match?.slice(COOKIE.length + 1);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function verifyRequestOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new Error('Origen no permitido.');
}

export function sessionCookie(token, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}${secure}`;
}

export function expiredCookie(request) {
  return sessionCookie('', request).replace(`Max-Age=${SESSION_SECONDS}`, 'Max-Age=0');
}

export async function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  await db.sql`INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (${tokenHash(token)}, ${userId}, now() + interval '7 days')`;
  return token;
}

export async function getSession(request, db = getDatabase()) {
  const token = cookieToken(request);
  if (!token) return null;
  const rows = await db.sql`SELECT u.id, u.username, u.role FROM app_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ${tokenHash(token)} AND s.expires_at > now()`;
  return rows[0] || null;
}

export async function deleteSession(request, db = getDatabase()) {
  const token = cookieToken(request);
  if (token) await db.sql`DELETE FROM app_sessions WHERE token_hash = ${tokenHash(token)}`;
}

export async function loginUser(username, password, db) {
  if (!validUsername(username) || typeof password !== 'string' || !password || password.length > 1024) return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  const database = db || getDatabase();
  const rows = await database.sql`SELECT id, username, role, password_hash, failed_logins, locked_until FROM app_users WHERE username = ${username}`;
  const user = rows[0];
  if (!user) return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  if (user.locked_until && new Date(user.locked_until) > new Date()) return { error: 'Demasiados intentos. Espera 15 minutos.', status: 429 };
  if (!(await verifyPassword(password, user.password_hash))) {
    await database.sql`UPDATE app_users SET failed_logins = CASE WHEN failed_logins >= 4 THEN 0 ELSE failed_logins + 1 END, locked_until = CASE WHEN failed_logins >= 4 THEN now() + interval '15 minutes' ELSE NULL END WHERE id = ${user.id}`;
    return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  }
  await database.sql`UPDATE app_users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`;
  const token = await createSession(database, user.id);
  return { user: { username: user.username, role: user.role }, token };
}

export async function listUsers(db) {
  const database = db || getDatabase();
  return await database.sql`SELECT id, username, role, failed_logins, locked_until, created_at FROM app_users ORDER BY id ASC`;
}

export async function createUser(username, password, db) {
  if (!validUsername(username)) return { error: 'Nombre de usuario inválido (3-40 caracteres alfanuméricos, guiones o puntos).', status: 400 };
  if (typeof password !== 'string' || password.length < 4 || password.length > 1024) {
    return { error: 'La contraseña debe tener al menos 4 caracteres.', status: 400 };
  }
  const database = db || getDatabase();
  const existing = await database.sql`SELECT id FROM app_users WHERE username = ${username}`;
  if (existing.length) return { error: 'El usuario ya existe.', status: 409 };
  const passwordHash = await hashPassword(password);
  await database.sql`INSERT INTO app_users (username, password_hash, role) VALUES (${username}, ${passwordHash}, 'admin')`;
  return { ok: true };
}

export async function updateUser(username, newPassword, newUsername, db) {
  if (!username) return { error: 'Usuario no especificado.', status: 400 };
  const targetUsername = newUsername && newUsername.trim() ? newUsername.trim() : username;
  if (targetUsername !== username && !validUsername(targetUsername)) {
    return { error: 'Nuevo nombre de usuario inválido.', status: 400 };
  }
  if (newPassword && (typeof newPassword !== 'string' || newPassword.length < 4 || newPassword.length > 1024)) {
    return { error: 'La nueva contraseña debe tener al menos 4 caracteres.', status: 400 };
  }
  const database = db || getDatabase();
  const existing = await database.sql`SELECT id, username FROM app_users WHERE username = ${username}`;
  if (!existing.length) return { error: 'Usuario no encontrado.', status: 404 };
  const user = existing[0];

  if (targetUsername !== username) {
    const clash = await database.sql`SELECT id FROM app_users WHERE username = ${targetUsername} AND id != ${user.id}`;
    if (clash.length) return { error: 'El nuevo nombre de usuario ya está en uso.', status: 409 };
  }

  if (newPassword) {
    const passwordHash = await hashPassword(newPassword);
    await database.sql`UPDATE app_users SET username = ${targetUsername}, password_hash = ${passwordHash}, failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`;
    await database.sql`DELETE FROM app_sessions WHERE user_id = ${user.id}`;
  } else if (targetUsername !== username) {
    await database.sql`UPDATE app_users SET username = ${targetUsername} WHERE id = ${user.id}`;
  }
  return { ok: true };
}

export async function deleteUser(username, currentAdminUsername, db) {
  if (!username) return { error: 'Usuario no especificado.', status: 400 };
  if (username === currentAdminUsername) return { error: 'No puedes eliminar tu propio usuario en uso.', status: 400 };
  const database = db || getDatabase();
  const total = await database.sql`SELECT count(*)::int as count FROM app_users`;
  if ((total[0]?.count || 0) <= 1) return { error: 'No se puede eliminar el único usuario del sistema.', status: 400 };
  const res = await database.sql`DELETE FROM app_users WHERE username = ${username} RETURNING id`;
  if (!res.length) return { error: 'Usuario no encontrado.', status: 404 };
  return { ok: true };
}

