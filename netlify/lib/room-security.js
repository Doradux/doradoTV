import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { RoomError, mutate, read } from './room-store.js';

const scrypt = promisify(scryptCallback);
export async function hashPassword(password) {
  if (typeof password !== 'string' || !password || password.length > 1024) throw new RoomError('Contraseña inválida.');
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
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const secretToken = () => randomBytes(32).toString('hex');
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const ACCOUNT_COOKIE = 'dorado_account';
export const GUEST_COOKIE = 'dorado_guest';
export const SESSION_TTL = 7 * 86400;

export function masterKey(env = process.env) {
  const key = Buffer.from(env.DORADO_ENCRYPTION_KEY || '', 'base64');
  if (key.length !== 32) throw new RoomError('El servicio de salas aún no está disponible.', 503);
  return key;
}
export function seal(value, purpose, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey(env), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { version: 1, iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function unseal(value, purpose, env = process.env) {
  const decipher = createDecipheriv('aes-256-gcm', masterKey(env), Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString('utf8');
}
export const privateId = (value, env = process.env) => createHmac('sha256', masterKey(env)).update(value).digest('hex');
export function cookieValue(request, name) {
  const value = (request.headers.get('cookie') || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
}
export function cookie(name, token, request, age = SESSION_TTL) {
  return `${name}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
export async function newSession(store, value, time = nowSeconds()) {
  const token = secretToken();
  await store.setJSON(`session/${digest(token)}`, { ...value, expires: time + SESSION_TTL });
  return token;
}
export async function identity(store, request, time = nowSeconds()) {
  const accountToken = cookieValue(request, ACCOUNT_COOKIE);
  const guestToken = cookieValue(request, GUEST_COOKIE);
  const [accountSession, guestSession] = await Promise.all([
    accountToken ? read(store, `session/${digest(accountToken)}`) : null,
    guestToken ? read(store, `session/${digest(guestToken)}`) : null,
  ]);
  let account = accountSession?.expires > time && accountSession.kind === 'account' ? await read(store, `account/${accountSession.accountId}`) : null;
  if (!account?.verified || account.version !== accountSession?.version) account = null;
  const guest = guestSession?.expires > time && guestSession.kind === 'guest' ? guestSession : null;
  return { account, guest, sessionId: account ? digest(accountToken) : guest ? digest(guestToken) : null };
}
export async function rateLimit(store, key, max, seconds, time = nowSeconds()) {
  await mutate(store, `rate/${digest(key)}`, (old) => {
    const state = old?.expires > time ? old : { count: 0, expires: time + seconds };
    if (state.count >= max) throw new RoomError('Demasiados intentos. Espera unos minutos.', 429);
    return { ...state, count: state.count + 1 };
  });
}
export function requireOrigin(request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new RoomError('Origen no permitido.', 403);
}
export async function boundedJson(request, max = 16_384) {
  if (Number(request.headers.get('content-length')) > max) throw new RoomError('Solicitud demasiado grande.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RoomError('Solicitud vacía.');
  const parts = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); throw new RoomError('Solicitud demasiado grande.', 413); }
    parts.push(Buffer.from(value));
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new RoomError('Solicitud inválida.'); }
}
export async function checkCaptcha(token, request, action, env = process.env, fetcher = fetch) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) throw new RoomError('El registro aún no está disponible.', 503);
  if (typeof token !== 'string' || !token || token.length > 2048) throw new RoomError('Completa la comprobación de seguridad.', 400, { captchaRequired: true });
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }), signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok || !result.success || result.hostname !== new URL(request.url).hostname || result.action !== action) {
    throw new RoomError('No se pudo verificar la comprobación. Inténtalo de nuevo.', 400, { captchaRequired: true });
  }
}
