import { createRemoteJWKSet, jwtVerify } from 'jose';
import { RoomError, mutate, read } from './room-store.js';
import { cookie, cookieValue, digest, secretToken, nowSeconds } from './room-security.js';

export const GOOGLE_COOKIE = 'dorado_google';
const MAX_AGE = 600;
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { timeoutDuration: 5000 });
export const googleClientId = (env = process.env) => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || '') ? env.GOOGLE_CLIENT_ID : null;

export async function verifyGoogleCredential(credential, nonceHash, env = process.env, keys = googleKeys, time = nowSeconds()) {
  if (!googleClientId(env)) throw new RoomError('El acceso con Google no está configurado.', 503);
  if (typeof credential !== 'string' || credential.length > 12000 || !nonceHash) throw new RoomError('Vuelve a iniciar sesión con Google.', 401);
  try {
    const { payload } = await jwtVerify(credential, keys, {
      algorithms: ['RS256'], audience: env.GOOGLE_CLIENT_ID,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      requiredClaims: ['sub', 'iat', 'exp', 'nonce', 'email', 'email_verified'],
      maxTokenAge: '1h', clockTolerance: 5, currentDate: new Date(time * 1000),
    });
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
      typeof payload.nonce !== 'string' || digest(payload.nonce) !== nonceHash ||
      payload.email_verified !== true || typeof payload.email !== 'string' || payload.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      (payload.azp !== undefined && payload.azp !== env.GOOGLE_CLIENT_ID)) throw new Error('Invalid identity');
    return { sub: payload.sub, email: payload.email.trim().toLowerCase() };
  } catch {
    throw new RoomError('No se pudo validar tu acceso con Google. Vuelve a intentarlo.', 401);
  }
}

export async function beginGoogleSignIn(store, request, env = process.env, time = nowSeconds()) {
  if (!googleClientId(env)) throw new RoomError('El acceso con Google no está configurado.', 503);
  const token = secretToken(), nonce = secretToken();
  await store.setJSON(`google-challenge/${digest(token)}`, { nonceHash: digest(nonce), expires: time + MAX_AGE, used: false });
  return { nonce, cookie: cookie(GOOGLE_COOKIE, token, request, MAX_AGE) };
}

export async function consumeGoogleSignIn(store, request, credential, env = process.env, verify = verifyGoogleCredential, time = nowSeconds()) {
  const token = cookieValue(request, GOOGLE_COOKIE);
  if (!token) throw new RoomError('La conexión con Google ha caducado. Vuelve a intentarlo.', 401);
  const key = `google-challenge/${digest(token)}`, challenge = await read(store, key);
  if (!challenge || challenge.used || challenge.expires <= time) throw new RoomError('La conexión con Google ha caducado. Vuelve a intentarlo.', 401);
  const account = await verify(credential, challenge.nonceHash, env);
  // Bind the signed credential to this browser and consume it exactly once.
  await mutate(store, key, (current) => {
    if (!current || current.used || current.expires <= time || current.nonceHash !== challenge.nonceHash) throw new RoomError('Vuelve a iniciar sesión con Google.', 401);
    return { ...current, used: true };
  });
  return account;
}

export async function verifyGoogleAccessToken(accessToken, env = process.env, fetchImpl = fetch) {
  if (!googleClientId(env)) throw new RoomError('El acceso con Google no está configurado.', 503);
  if (typeof accessToken !== 'string' || !accessToken || accessToken.length > 4096) throw new RoomError('Token de Google no válido.', 401);
  try {
    const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`);
    if (!response.ok) throw new Error('Token verification failed');
    const data = await response.json();
    if (data.aud !== env.GOOGLE_CLIENT_ID && data.azp !== env.GOOGLE_CLIENT_ID) {
      throw new Error('Audience mismatch');
    }
    if (data.email_verified !== 'true' && data.email_verified !== true) {
      throw new Error('Unverified email');
    }
    if (!data.sub || !data.email) throw new Error('Incomplete claims');
    return { sub: data.sub, email: data.email.trim().toLowerCase() };
  } catch {
    throw new RoomError('No se pudo validar tu acceso con Google. Vuelve a intentarlo.', 401);
  }
}
