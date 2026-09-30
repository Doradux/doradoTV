import { roomStore, read, RoomError } from '../lib/room-store.js';
import { RoomsService, accountView, roomView, normalizeRoom, normalizeEmail } from '../lib/rooms-service.js';
import { ACCOUNT_COOKIE, GUEST_COOKIE, masterKey, cookieValue, cookie, digest, identity, rateLimit, requireOrigin, boundedJson, checkCaptcha } from '../lib/room-security.js';
import { mailReady, sendAccountMail } from '../lib/room-mail.js';
import { googleClientId, beginGoogleSignIn, consumeGoogleSignIn, verifyGoogleAccessToken, GOOGLE_COOKIE, verifyGoogleCredential } from '../lib/room-google.js';

const json = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
export function createRoomsHandler({ getStore = roomStore, env = process.env, sendMail = (email, token, kind) => sendAccountMail(email, token, kind, env), captcha = checkCaptcha, googleVerify = verifyGoogleCredential, detect, clock } = {}) {
  return async (request, context = {}) => {
    try {
      const url = new URL(request.url), action = url.searchParams.get('action');
      if (request.method === 'GET' && action === 'config') {
        let ready = true; try { masterKey(env); } catch { ready = false; }
        return json({ ready, registration: ready && mailReady(env) && !!env.TURNSTILE_SITE_KEY && !!env.TURNSTILE_SECRET_KEY,
          googleClientId: ready ? googleClientId(env) : null,
          siteKey: env.TURNSTILE_SITE_KEY || null, maxFileBytes: 10 * 1024 * 1024 });
      }
      masterKey(env);
      const store = getStore();
      const service = new RoomsService(store, { env, sendMail, detect, clock });
      const who = await identity(store, request, clock?.());
      if (request.method === 'GET') {
        const slug = normalizeRoom(url.searchParams.get('room'));
        if (action === 'session') return json({ account: accountView(who.account), guestRoom: who.guest?.roomId || null });
        if (action === 'mine') return json({ rooms: await service.mine(who.account) });
        if (action === 'room') return json(roomView(await service.access(slug, who), who.account));
        if (action === 'playlist') return json({ source: service.playlist(await service.access(slug, who)) });
        if (action === 'status') return json(await service.status(slug, who));
        if (action === 'export') {
          const room = await service.access(slug, who, true);
          return json({ format: 'dorado-room-backup', version: 1, title: room.title, slug: room.slug, limit: room.limit, source: service.playlist(room) });
        }
        throw new RoomError('Ruta no encontrada.', 404);
      }
      if (request.method !== 'POST') throw new RoomError('Método no permitido.', 405);
      requireOrigin(request);
      const input = await boundedJson(request, action === 'upload-chunk' ? 4 * 1024 * 1024 : 16_384);
      const slug = normalizeRoom(input.room);
      const ip = context.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
      if (['register', 'recover', 'login', 'join', 'verify', 'google-login'].includes(action)) {
        await rateLimit(store, `entry:${ip}`, 40, 900, clock?.());
      }
      if (action === 'google-start') {
        await rateLimit(store, `google-start:${ip}`, 60, 900, clock?.());
        const challenge = await beginGoogleSignIn(store, request, env, clock?.());
        return json({ nonce: challenge.nonce }, 200, { 'Set-Cookie': challenge.cookie });
      }
      if (action === 'google-login') {
        const google = input.accessToken
          ? await verifyGoogleAccessToken(input.accessToken, env)
          : await consumeGoogleSignIn(store, request, input.credential, env, googleVerify, clock?.());
        const result = await service.googleLogin(google);
        const response = json({ account: result.account });
        response.headers.append('Set-Cookie', cookie(ACCOUNT_COOKIE, result.token, request));
        if (cookieValue(request, GOOGLE_COOKIE)) response.headers.append('Set-Cookie', cookie(GOOGLE_COOKIE, '', request, 0));
        return response;
      }
      if (action === 'username') {
        await rateLimit(store, `username:${who.account?.id || ip}`, 20, 900, clock?.());
        return json({ account: await service.completeGoogleProfile(who.account, input.username) });
      }
      if (action === 'register' || action === 'recover') {
        if (!mailReady(env)) throw new RoomError('El registro y la recuperación por correo están desactivados.', 503);
        await captcha(input.captcha, request, 'account', env);
        await rateLimit(store, `mail:${normalizeEmail(input.email)}`, 3, 900, clock?.());
        await rateLimit(store, 'mail:global', 50, 86400, clock?.());
        if (action === 'register') await service.register(input); else await service.requestReset(input.email);
        return json({ message: action === 'register' ? 'Si el correo necesita verificación, recibirás un enlace. Revisa también spam. Si ya tienes cuenta, inicia sesión.' : 'Si existe una cuenta verificada con ese correo, recibirás un enlace de recuperación.' });
      }
      if (action === 'verify') { await service.verify(input.token, input.password, input.passwordConfirm); return json({ ok: true }); }
      if (action === 'login') {
        throw new RoomError('El inicio de sesión con correo y contraseña está desactivado. Usa Continuar con Google.', 400);
      }
      if (action === 'join') {
        const target = slug;
        await rateLimit(store, `${action}:${ip}:${target}`, 10, 900, clock?.());
        // Challenge repeated attempts without adding friction to the first room entry.
        const guardKey = `rate/${digest(`challenge:${action}:${ip}`)}`;
        const guard = await read(store, guardKey);
        if (guard?.expires > (clock ? clock() : Math.floor(Date.now() / 1000)) && guard.count >= 3) {
          if (env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) await captcha(input.captcha, request, 'access', env);
        }
        try {
          const result = await service.join(slug, input.password);
          return json({ room: result.room }, 200, { 'Set-Cookie': cookie(GUEST_COOKIE, result.token, request) });
        } catch (error) {
          if (error.status === 401) {
            await rateLimit(store, `challenge:${action}:${ip}`, 20, 900, clock?.());
            error.details = { ...error.details, captchaRequired: !!env.TURNSTILE_SITE_KEY && (guard?.count || 0) >= 2 };
          }
          throw error;
        }
      }
      if (action === 'logout') {
        for (const name of [ACCOUNT_COOKIE, GUEST_COOKIE]) {
          const token = cookieValue(request, name);
          if (token) await store.delete(`session/${digest(token)}`);
        }
        const response = json({ ok: true });
        response.headers.append('Set-Cookie', cookie(ACCOUNT_COOKIE, '', request, 0));
        response.headers.append('Set-Cookie', cookie(GUEST_COOKIE, '', request, 0));
        response.headers.append('Set-Cookie', cookie(GOOGLE_COOKIE, '', request, 0));
        return response;
      }
      if (action === 'create') { await rateLimit(store, `create:${who.account?.id || ip}`, 8, 3600, clock?.()); return json(await service.create(who.account, input), 201); }
      if (action === 'update') return json(await service.update(slug, who, input));
      if (action === 'delete') { await service.remove(slug, who, input.revision); return json({ ok: true }); }
      if (action === 'upload-begin') {
        await rateLimit(store, `upload:${who.account?.id || ip}`, 12, 3600, clock?.());
        return json(await service.beginUpload(slug, who, input));
      }
      if (action === 'upload-chunk') return json(await service.uploadChunk(slug, who, input));
      if (action === 'upload-commit') return json(await service.commitUpload(slug, who, input));
      if (action === 'start') { await rateLimit(store, `start:${who.sessionId || ip}`, 120, 300, clock?.()); return json(await service.start(slug, who, input)); }
      if (['ping', 'release', 'close'].includes(action)) return json(await service.playback(slug, who, input, action));
      throw new RoomError('Ruta no encontrada.', 404);
    } catch (error) {
      if (error instanceof RoomError) return json({ error: error.message, ...error.details }, error.status);
      // Never return SMTP credentials or provider URLs to the browser.
      return json({ error: 'No se pudo completar la operación. Inténtalo de nuevo en unos minutos.' }, 503);
    }
  };
}
export default createRoomsHandler();
