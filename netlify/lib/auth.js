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

export async function loginUser(username, password, db = getDatabase()) {
  if (!validUsername(username) || typeof password !== 'string' || !password || password.length > 1024) return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  const rows = await db.sql`SELECT id, username, role, password_hash, failed_logins, locked_until FROM app_users WHERE username = ${username}`;
  const user = rows[0];
  if (!user) return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  if (user.locked_until && new Date(user.locked_until) > new Date()) return { error: 'Demasiados intentos. Espera 15 minutos.', status: 429 };
  if (!(await verifyPassword(password, user.password_hash))) {
    await db.sql`UPDATE app_users SET failed_logins = CASE WHEN failed_logins >= 4 THEN 0 ELSE failed_logins + 1 END, locked_until = CASE WHEN failed_logins >= 4 THEN now() + interval '15 minutes' ELSE NULL END WHERE id = ${user.id}`;
    return { error: 'Usuario o contraseña incorrectos.', status: 401 };
  }
  await db.sql`UPDATE app_users SET failed_logins = 0, locked_until = NULL WHERE id = ${user.id}`;
  const token = await createSession(db, user.id);
  return { user: { username: user.username, role: user.role }, token };
}
