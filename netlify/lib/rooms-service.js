import { randomUUID } from 'node:crypto';
import { parsePlaylist } from '../../src/playlist.js';
import { RoomError, mutate, read } from './room-store.js';
import { hashPassword, verifyPassword, digest, secretToken, seal, unseal, newSession, nowSeconds } from './room-security.js';
import { detectProviders, channelProvider, currentProgram, validateProviderCredentials, providerAccount } from './room-provider.js';
import { createRelayClient } from './room-relay.js';

export const MAX_PLAYLIST_BYTES = 10 * 1024 * 1024;
export const UPLOAD_CHUNK_CHARS = 512 * 1024;
export const MAX_UPLOAD_CHUNKS = 24;
export const UPLOAD_TTL_SECONDS = 10 * 60;
export const LEASE_SECONDS = 90;
export const normalizeRoom = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validRoom = (value) => /^[a-z0-9][a-z0-9-]{2,39}$/.test(value);
export const normalizeEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
export const validUsername = (value) => typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,30}$/.test(value);
export const validEmail = (value) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
export function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw new RoomError('La contraseña debe tener entre 10 y 128 caracteres.');
}
export const accountView = (account) => account ? { id: account.id, username: account.username || account.name, name: account.username || account.name, email: account.email, google: !!account.googleSub, needsUsername: !!account.googleSub && !validUsername(account.username) } : null;
export function roomView(room, account) {
  return { slug: room.slug, title: room.title, owner: room.ownerId === account?.id, hasPlaylist: !!room.playlist,
    channelCount: room.channelCount || 0, limit: room.limit, detectedMaximum: room.detectedMaximum,
    revision: room.revision, updated: room.updated, created: room.created,
    providerConfigured: !!room.providerCredentials, providerHost: room.ownerId === account?.id ? (room.providerHost || null) : null };
}
export class RoomsService {
  constructor(store, { env = process.env, clock = nowSeconds, detect = detectProviders, verifyProvider = validateProviderCredentials, program = currentProgram, sendMail, relay } = {}) {
    this.store = store; this.env = env; this.clock = clock; this.detect = detect; this.verifyProvider = verifyProvider; this.program = program; this.sendMail = sendMail;
    this.relay = relay ?? createRelayClient(env);
  }
  async googleLogin({ sub, email }) {
    // Google subjects are stable. Never merge accounts merely by matching email.
    const id = digest(`google:${sub}`);
    const account = await mutate(this.store, `account/${id}`, (current) => {
      if (current && current.googleSub !== sub) throw new RoomError('No se pudo iniciar sesión.', 401);
      return current ? { ...current, email } : { id, googleSub: sub, email, username: null, verified: true, version: 1, rooms: [], created: this.clock() };
    });
    const token = await newSession(this.store, { kind: 'account', accountId: id, version: account.version }, this.clock());
    return { token, account: accountView(account) };
  }
  async completeGoogleProfile(account, username) {
    if (!account?.verified || !account.googleSub) throw new RoomError('Inicia sesión con Google.', 401);
    if (!validUsername(username)) throw new RoomError('El nombre de usuario debe tener entre 3 y 30 letras, números, puntos o guiones.');
    const key = `account/${account.id}`;
    let current = await read(this.store, key);
    if (current?.username) return accountView(current);
    // Recover a successful username reservation if a previous request stopped
    // before updating the account. One reservation per account prevents orphans.
    if (current?.pendingUsername) {
      const pending = current.pendingUsername;
      const claim = await read(this.store, `username/${pending.username.toLowerCase()}`);
      if (claim?.verified && claim.accountId === account.id) {
        current = await mutate(this.store, key, (value) => value.pendingUsername?.operation === pending.operation ? { ...value, username: pending.username, pendingUsername: null } : value);
        if (current.username) return accountView(current);
      }
    }
    const operation = randomUUID();
    current = await mutate(this.store, key, (value) => {
      if (value.username) return value;
      if (value.pendingUsername?.expires > this.clock()) throw new RoomError('Se está guardando tu nombre. Vuelve a intentarlo en unos segundos.', 409);
      return { ...value, pendingUsername: { username, operation, expires: this.clock() + 60 } };
    });
    if (current.username) return accountView(current);
    let reserved = false;
    try {
      await mutate(this.store, `username/${username.toLowerCase()}`, (claim) => {
        if (claim && claim.accountId !== account.id && (claim.verified || claim.expires > this.clock())) throw new RoomError('Ese nombre de usuario ya está ocupado.', 409);
        return { accountId: account.id, verified: true, expires: null };
      });
      reserved = true;
      current = await mutate(this.store, key, (value) => {
        if (value.pendingUsername?.operation !== operation) throw new RoomError('Tu perfil ha cambiado. Actualiza la página.', 409);
        return { ...value, username, pendingUsername: null };
      });
      return accountView(current);
    } finally {
      if (!reserved) await mutate(this.store, key, (value) => value.pendingUsername?.operation === operation ? { ...value, pendingUsername: null } : value);
    }
  }
  async register({ email: raw, username, password, passwordConfirm }) {
    const email = normalizeEmail(raw);
    if (!validEmail(email)) throw new RoomError('Introduce un correo válido.');
    validatePassword(password);
    if (password !== passwordConfirm) throw new RoomError('Las contraseñas no coinciden.');
    if (!validUsername(username)) throw new RoomError('El nombre de usuario debe tener entre 3 y 30 letras, números, puntos o guiones.');
    const id = digest(email), key = `account/${id}`;
    const current = await read(this.store, key);
    if (current?.verified) return;
    const token = secretToken(), passwordHash = await hashPassword(password);
    const usernameKey = `username/${username.toLowerCase()}`;
    await mutate(this.store, usernameKey, (claim) => {
      if (claim && claim.accountId !== id && (claim.verified || claim.expires > this.clock())) throw new RoomError('Ese nombre de usuario ya está ocupado.', 409);
      return claim?.verified ? claim : { accountId: id, verified: false, expires: this.clock() + 1800 };
    });
    const account = await mutate(this.store, key, (old) => {
      if (old?.verified) return old;
      return { id, email, username, passwordHash, verified: false, version: 1, rooms: [], created: this.clock(), verification: digest(token), verificationExpires: this.clock() + 1800 };
    });
    if (account.verified) return;
    await this.store.setJSON(`token/${digest(token)}`, { accountId: id, kind: 'verify', expires: this.clock() + 1800 });
    await this.sendMail(email, token, 'verify');
  }
  async verify(token, password, passwordConfirm) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) throw new RoomError('El enlace no es válido o ha caducado.');
    const hash = digest(token), record = await read(this.store, `token/${hash}`);
    if (!record || record.expires <= this.clock()) throw new RoomError('El enlace no es válido o ha caducado.');
    if (record.kind === 'reset') { validatePassword(password); if (password !== passwordConfirm) throw new RoomError('Las contraseñas no coinciden.'); }
    const passwordHash = record.kind === 'reset' ? await hashPassword(password) : null;
    await mutate(this.store, `account/${record.accountId}`, async (account) => {
      const field = record.kind === 'reset' ? 'reset' : 'verification';
      if (!account || account[field] !== hash || account[`${field}Expires`] <= this.clock()) throw new RoomError('El enlace ya se ha utilizado o ha caducado.');
      const next = { ...account, [field]: null, [`${field}Expires`]: null };
      if (record.kind === 'reset') { next.passwordHash = passwordHash; next.version += 1; }
      else {
        await mutate(this.store, `username/${account.username.toLowerCase()}`, (claim) => {
          if (!claim || claim.accountId !== account.id) throw new RoomError('El nombre de usuario ya no está disponible. Regístrate de nuevo con otro.');
          return { accountId: account.id, verified: true, expires: null };
        });
        next.verified = true;
      }
      return next;
    });
    await this.store.delete(`token/${hash}`);
  }
  async requestReset(raw) {
    const email = normalizeEmail(raw);
    if (!validEmail(email)) throw new RoomError('Introduce un correo válido.');
    const id = digest(email), old = await read(this.store, `account/${id}`);
    if (!old?.verified) return;
    const token = secretToken();
    await mutate(this.store, `account/${id}`, (account) => ({ ...account, reset: digest(token), resetExpires: this.clock() + 1800 }));
    await this.store.setJSON(`token/${digest(token)}`, { accountId: id, kind: 'reset', expires: this.clock() + 1800 });
    await this.sendMail(email, token, 'reset');
  }
  async login(identifier, password) {
    const value = normalizeEmail(identifier);
    const claim = value.includes('@') ? null : await read(this.store, `username/${value}`);
    const id = value.includes('@') ? digest(value) : claim?.verified ? claim.accountId : null;
    const account = id ? await read(this.store, `account/${id}`) : null;
    // Constant scrypt work for unknown and known addresses.
    const fallback = `scrypt:${'0'.repeat(64)}:${'0'.repeat(128)}`;
    const valid = await verifyPassword(password, account?.passwordHash || fallback);
    if (!valid || !account?.verified || (!value.includes('@') && account.username?.toLowerCase() !== value)) throw new RoomError('Usuario o contraseña incorrectos, o correo pendiente de verificar.', 401);
    const token = await newSession(this.store, { kind: 'account', accountId: account.id, version: account.version }, this.clock());
    return { token, account: accountView(account) };
  }
  async access(slug, who, ownerOnly = false) {
    if (!validRoom(slug)) throw new RoomError('Sala no disponible.', 404);
    const room = await read(this.store, `room/${slug}`);
    const owner = !!room && room.ownerId === who.account?.id;
    const guest = !!room && who.guest?.roomId === slug && who.guest.version === room.version;
    if (!room || room.deleted || (!owner && (!guest || ownerOnly))) throw new RoomError('No tienes acceso a esta sala.', 403);
    return room;
  }
  async join(raw, password, account = null) {
    const slug = normalizeRoom(raw);
    const room = validRoom(slug) ? await read(this.store, `room/${slug}`) : null;
    const valid = await verifyPassword(password, room?.passwordHash || `scrypt:${'0'.repeat(64)}:${'0'.repeat(128)}`);
    if (!room || room.deleted || !valid) throw new RoomError('Sala o contraseña incorrectas.', 401);
    const token = await newSession(this.store, { kind: 'guest', roomId: slug, version: room.version }, this.clock());
    // A prior visit is not authorization: the room password and guest session remain mandatory.
    if (account?.verified && room.ownerId !== account.id) {
      await mutate(this.store, `account/${account.id}`, (current) => {
        if (!current?.verified) return current;
        const visits = (current.visitedRooms || []).filter((item) => item.slug !== slug && validRoom(item.slug));
        return { ...current, visitedRooms: [{ slug, visitedAt: this.clock() }, ...visits].slice(0, 40) };
      });
    }
    return { token, room: roomView(room) };
  }

  async reconcileRooms(account) {
    return mutate(this.store, `account/${account.id}`, async (current) => {
      const rooms = new Set(current.rooms || []), pending = [];
      for (const item of current.pendingRooms || []) {
        const room = item.slug ? await read(this.store, `room/${item.slug}`) : null;
        if (room && !room.deleted && room.ownerId === account.id && room.creationOperation === item.operation) rooms.add(room.slug);
        else if (item.expires > this.clock()) pending.push(item);
      }
      return { ...current, rooms: [...rooms], pendingRooms: pending };
    });
  }
  async mine(account) {
    if (!account) throw new RoomError('Inicia sesión para gestionar tus salas.', 401);
    if (account.pendingRooms?.length) account = await this.reconcileRooms(account);
    const rooms = await Promise.all((account.rooms || []).map((slug) => read(this.store, `room/${slug}`)));
    return rooms.filter((room) => room && !room.deleted && room.ownerId === account.id).map((room) => roomView(room, account));
  }
  async relayHealth(slug, who) {
    await this.access(slug, who);
    return typeof this.relay.health === 'function' ? this.relay.health() : { configured: !!this.relay.configured, ready: !!this.relay.configured };
  }
  async visited(account) {
    if (!account?.verified) throw new RoomError('Inicia sesión para ver tu historial.', 401);
    const visits = (account.visitedRooms || []).filter((item) => validRoom(item.slug)).slice(0, 40);
    const rooms = await Promise.all(visits.map((item) => read(this.store, `room/${item.slug}`)));
    return visits.flatMap((visit, i) => rooms[i] && !rooms[i].deleted && rooms[i].ownerId !== account.id
      ? [{ slug: rooms[i].slug, title: rooms[i].title, visitedAt: visit.visitedAt }] : []);
  }
  async forgetVisited(account, raw) {
    if (!account?.verified) throw new RoomError('Inicia sesión para modificar tu historial.', 401);
    const slug = normalizeRoom(raw);
    if (!validRoom(slug)) throw new RoomError('Sala no válida.', 400);
    await mutate(this.store, `account/${account.id}`, (current) => {
      if (!current?.verified) throw new RoomError('Inicia sesión.', 401);
      return { ...current, visitedRooms: (current.visitedRooms || []).filter((item) => item.slug !== slug) };
    });
    return { ok: true };
  }
  async testProvider(who, input, slug = null) {
    if (!who?.account?.verified) throw new RoomError('Inicia sesión.', 401);
    if (slug) await this.access(slug, who, true);
    const checked = await this.checkedProvider(input);
    return { valid: true, host: new URL(checked.origin).hostname, maximum: checked.maximum };
  }
  async checkedProvider(input) {
    try { return await this.verifyProvider(input); }
    catch (error) { throw new RoomError(error.message || 'No se pudieron verificar las credenciales.', 400); }
  }
  async create(account, { slug: raw, title, password, provider }) {
    if (!account?.verified) throw new RoomError('Inicia sesión para crear una sala.', 401);
    if (account.googleSub && !validUsername(account.username)) throw new RoomError('Elige primero tu nombre de usuario.', 403, { needsUsername: true });
    const slug = normalizeRoom(raw);
    if (!validRoom(slug)) throw new RoomError('Usa entre 3 y 40 letras minúsculas, números o guiones para el nombre único.');
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 60) throw new RoomError('Pon un título de hasta 60 caracteres.');
    validatePassword(password);
    const passwordHash = await hashPassword(password);
    const checkedProvider = provider ? await this.checkedProvider(provider) : null;
    if (account.pendingRooms?.length) await this.reconcileRooms(account);
    const operation = randomUUID();
    // Reserve the owner's quota before claiming a globally unique room name.
    await mutate(this.store, `account/${account.id}`, (current) => {
      if (!current?.verified) throw new RoomError('Inicia sesión.', 401);
      const pending = (current.pendingRooms || []).filter((item) => item.expires > this.clock());
      if (current.rooms.length + pending.length >= 3) throw new RoomError('Puedes tener hasta 3 salas.', 409);
      return { ...current, pendingRooms: [...pending, { operation, slug, expires: this.clock() + 120 }] };
    });
    let created = false;
    try {
      const room = { slug, creationOperation: operation, title: title.trim(), ownerId: account.id, passwordHash, version: 1, revision: 1, playlist: null, limit: null, detectedMaximum: null, providers: [], providerCredentials: checkedProvider ? seal(JSON.stringify(checkedProvider), 'provider:' + slug, this.env) : null,
        providerHost: checkedProvider ? new URL(checkedProvider.origin).hostname : null,
        created: this.clock(), updated: this.clock() };
      const result = await this.store.setJSON(`room/${slug}`, room, { onlyIfNew: true });
      if (!result.modified) throw new RoomError('Ese nombre de sala ya está ocupado.', 409);
      created = true;
      await mutate(this.store, `account/${account.id}`, (current) => ({ ...current, rooms: [...new Set([...current.rooms, slug])], pendingRooms: (current.pendingRooms || []).filter((item) => item.operation !== operation) }));
      return roomView(room, account);
    } finally {
      if (!created) await mutate(this.store, `account/${account.id}`, (current) => ({ ...current, pendingRooms: (current.pendingRooms || []).filter((item) => item.operation !== operation) }));
    }
  }
  async update(slug, who, input) {
    const old = await this.access(slug, who, true);
    const hash = input.password ? (validatePassword(input.password), await hashPassword(input.password)) : null;
    const checkedProvider = input.provider ? await this.checkedProvider(input.provider) : null;
    // Never leave an old provider's streaming account attached after changing credentials.
    const previousAccount = old.providerCredentials
      ? JSON.parse(unseal(old.providerCredentials, 'provider:' + slug, this.env)) : null;
    const changedAccount = !!checkedProvider && (!previousAccount ||
      previousAccount.origin !== checkedProvider.origin ||
      previousAccount.username !== checkedProvider.username ||
      previousAccount.password !== checkedProvider.password);
    const clearPlaylist = changedAccount && !!old.playlist && parsePlaylist(this.playlist(old)).some((channel) => {
      const linked = providerAccount(channel.url);
      return linked && (linked.origin !== checkedProvider.origin ||
        linked.username !== checkedProvider.username || linked.password !== checkedProvider.password);
    });
    const next = await mutate(this.store, `room/${slug}`, (room) => {
      if (room.deleted || room.ownerId !== who.account.id) throw new RoomError('Sala no disponible.', 403);
      if (input.revision !== room.revision) throw new RoomError('La sala ha cambiado. Actualiza la página antes de guardar.', 409);
      const title = input.title ?? room.title;
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 60) throw new RoomError('Pon un título de hasta 60 caracteres.');
      const limit = input.limit === null ? null : Number(input.limit);
      if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000)) throw new RoomError('El límite debe ser un entero entre 1 y 10000.');
      if (!clearPlaylist && room.detectedMaximum !== null && (limit === null || limit > room.detectedMaximum)) throw new RoomError(`Puedes habilitar entre 1 y ${room.detectedMaximum} conexiones.`);
      return { ...room, title: title.trim(), limit, passwordHash: hash || room.passwordHash,
        providerCredentials: checkedProvider ? seal(JSON.stringify(checkedProvider), 'provider:' + slug, this.env) : room.providerCredentials,
        providerHost: checkedProvider ? new URL(checkedProvider.origin).hostname : room.providerHost,
        playlist: clearPlaylist ? null : room.playlist,
        providers: clearPlaylist ? [] : room.providers,
        channelCount: clearPlaylist ? 0 : room.channelCount,
        detectedMaximum: clearPlaylist ? null : room.detectedMaximum,
        limit: clearPlaylist ? null : limit,
        version: hash || input.revoke || checkedProvider ? room.version + 1 : room.version, revision: room.revision + 1, updated: this.clock() };
    });
    if (next.version !== old.version) await this.clearRoomLeases(old);
    return roomView(next, who.account);
  }
  async beginUpload(slug, who, { filename, revision, bytes, totalChunks }) {
    const room = await this.access(slug, who, true);
    if (typeof filename !== 'string' || !/\.m3u$/i.test(filename)) throw new RoomError('Selecciona un archivo .m3u.');
    if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_PLAYLIST_BYTES) throw new RoomError('La lista debe ocupar como máximo 10 MB.');
    if (!Number.isInteger(totalChunks) || totalChunks < 1 || totalChunks > MAX_UPLOAD_CHUNKS) throw new RoomError('La lista necesita demasiados bloques.');
    if (room.revision !== revision) throw new RoomError('La sala ha cambiado. Actualiza antes de subir la lista.', 409);
    const id = randomUUID();
    await this.store.setJSON(`upload/${slug}`, {
      id, ownerId: who.account.id, filename, revision, bytes, totalChunks,
      expires: this.clock() + UPLOAD_TTL_SECONDS,
    });
    return { id };
  }
  async uploadChunk(slug, who, { id, index, chunk }) {
    await this.access(slug, who, true);
    const state = await read(this.store, `upload/${slug}`);
    if (!state || state.id !== id || state.ownerId !== who.account.id || state.expires <= this.clock()) {
      throw new RoomError('La subida ha caducado. Vuelve a seleccionar el archivo.', 409);
    }
    if (!Number.isInteger(index) || index < 0 || index >= state.totalChunks) throw new RoomError('Bloque de subida inválido.');
    if (typeof chunk !== 'string' || chunk.length > UPLOAD_CHUNK_CHARS) throw new RoomError('Bloque de subida demasiado grande.', 413);
    await this.store.setJSON(`upload/${slug}/${index}`, { id, chunk });
    return { ok: true };
  }
  async commitUpload(slug, who, { id }) {
    await this.access(slug, who, true);
    const state = await read(this.store, `upload/${slug}`);
    if (!state || state.id !== id || state.ownerId !== who.account.id || state.expires <= this.clock()) {
      throw new RoomError('La subida ha caducado. Vuelve a seleccionar el archivo.', 409);
    }
    const keys = Array.from({ length: state.totalChunks }, (_, index) => `upload/${slug}/${index}`);
    try {
      const chunks = await Promise.all(keys.map((key) => read(this.store, key)));
      if (chunks.some((item) => !item || item.id !== id || typeof item.chunk !== 'string')) {
        throw new RoomError('Falta una parte del archivo. Vuelve a intentar la subida.', 409);
      }
      const source = chunks.map((item) => item.chunk).join('');
      if (Buffer.byteLength(source) > MAX_PLAYLIST_BYTES) throw new RoomError('La lista debe ocupar como máximo 10 MB.');
      return await this.upload(slug, who, { filename: state.filename, source, revision: state.revision });
    } finally {
      await Promise.all([this.store.delete(`upload/${slug}`), ...keys.map((key) => this.store.delete(key))]);
    }
  }
  async upload(slug, who, { filename, source, revision }) {
    const old = await this.access(slug, who, true);
    if (typeof filename !== 'string' || !/\.m3u$/i.test(filename)) throw new RoomError('Selecciona un archivo .m3u.');
    if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_PLAYLIST_BYTES) throw new RoomError('La lista debe ocupar como máximo 10 MB.');
    if (!source.replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U')) throw new RoomError('El contenido no es una lista M3U válida.');
    const channels = parsePlaylist(source);
    if (!channels.length) throw new RoomError('El archivo no contiene canales válidos.');
    if (old.providerCredentials) {
      const allowed = JSON.parse(unseal(old.providerCredentials, 'provider:' + slug, this.env));
      for (const channel of channels) {
        const found = providerAccount(channel.url);
        if (found && (found.origin !== allowed.origin || found.username !== allowed.username || found.password !== allowed.password)) {
          throw new RoomError('La lista contiene credenciales de otro proveedor. Usa las credenciales configuradas para esta sala.', 400);
        }
      }
    }
    const detected = await this.detect(channels, this.env);
    const providers = await Promise.all(detected.map(async (provider) => {
      const global = await read(this.store, `leases/${provider.id}`);
      return { ...provider, maximum: provider.maximum ?? old.providers.find((item) => item.id === provider.id)?.maximum ?? global?.maximum ?? null };
    }));
    const known = providers.map((item) => item.maximum).filter((value) => value !== null);
    const maximum = known.length ? Math.min(...known) : null;
    const playlist = seal(source, `playlist:${slug}`, this.env);
    const room = await mutate(this.store, `room/${slug}`, (current) => {
      if (current.deleted || current.ownerId !== who.account.id) throw new RoomError('Sala no disponible.', 403);
      if (current.revision !== revision) throw new RoomError('La sala ha cambiado. Actualiza antes de subir la lista.', 409);
      return { ...current, playlist, providers, detectedMaximum: maximum, channelCount: channels.length,
        limit: maximum === null ? current.limit : Math.min(current.limit ?? maximum, maximum), revision: current.revision + 1, updated: this.clock() };
    });
    await Promise.all(providers.filter((item) => item.maximum !== null).map((item) => mutate(this.store, `leases/${item.id}`, (state) => ({ ...state, leases: state?.leases || [], maximum: item.maximum }))));
    return roomView(room, who.account);
  }
  playlist(room) { return room.playlist ? unseal(room.playlist, `playlist:${room.slug}`, this.env) : ''; }
  async clearRoomLeases(room) {
    const active = await read(this.store, `leases/room-${room.slug}`);
    const leases = active?.leases || [];
    const buckets = new Set([`room-${room.slug}`, ...room.providers.map((item) => item.id), ...leases.map((item) => item.provider)]);
    await Promise.all([...buckets].filter(Boolean).map((id) => mutate(this.store, `leases/${id}`, (state) => ({ ...state, leases: (state?.leases || []).filter((lease) => lease.room !== room.slug) }))));
    if (this.relay.configured) {
      const emissions = [...new Set(leases.map((lease) => lease.relayEmissionId).filter(Boolean))];
      await Promise.allSettled(emissions.map((id) => this.relay.close(id, 'Propietario')));
    }
  }
  async remove(slug, who, revision) {
    const room = await this.access(slug, who, true);
    await mutate(this.store, `room/${slug}`, (current) => {
      if (current.revision !== revision) throw new RoomError('La sala ha cambiado. Actualiza antes de eliminarla.', 409);
      return { slug, ownerId: current.ownerId, deleted: true, revision: current.revision + 1, version: current.version + 1 };
    });
    await this.clearRoomLeases(room);
    await this.store.delete(`addons/${slug}`);
    await mutate(this.store, `account/${who.account.id}`, (account) => ({ ...account, rooms: account.rooms.filter((value) => value !== slug) }));
  }
  async start(slug, who, { channelId, tab }) {
    const room = await this.access(slug, who);
    if (typeof tab !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(tab)) throw new RoomError('Sesión de reproducción inválida.');
    const channel = parsePlaylist(this.playlist(room)).find((item) => item.id === Number(channelId));
    if (!channel) throw new RoomError('El canal ya no está disponible.', 404);
    const protocol = new URL(channel.url).protocol;
    const needsRelay = protocol === 'http:';
    if (needsRelay && !this.relay.configured) throw new RoomError('Este canal usa HTTP y necesita configurar el relay HTTPS.', 503);
    const provider = channelProvider(channel, slug, this.env);
    const maximum = room.providers.find((item) => item.id === provider)?.maximum ?? null;
    const id = randomUUID();
    const viewerName = who.account?.username || who.account?.name || 'Invitado';
    const lease = { id, provider, room: slug, version: room.version, sessionId: who.sessionId, tab, channelId: channel.id, channelName: channel.name,
      name: viewerName, expires: this.clock() + LEASE_SECONDS };
    // Room budget and provider budget are independent; rollback if the second is full.
    const roomBucket = `room-${slug}`;
    const keys = [...new Set([roomBucket, provider])];
    const reserve = (bucket, cap) => mutate(this.store, `leases/${bucket}`, (state) => {
      const leases = (state?.leases || []).filter((item) => item.expires > this.clock() && !(item.sessionId === who.sessionId && item.tab === tab));
      const capacity = bucket === roomBucket ? cap : state?.maximum ?? cap;
      if (capacity !== null && leases.length >= capacity) throw new RoomError('No quedan conexiones disponibles. Espera a que se libere una plaza.', 409, { full: true });
      return { ...state, leases: [...leases, lease] };
    });
    await reserve(roomBucket, room.limit);
    try { if (provider !== roomBucket) await reserve(provider, maximum); }
    catch (error) { await this.releaseBucket(roomBucket, id, who.sessionId); throw error; }

    let relaySession = null;
    try {
      if (needsRelay) {
        relaySession = await this.relay.start({ ...channel, viewerName }, who.sessionId, tab);
        await Promise.all(keys.map((key) => mutate(this.store, `leases/${key}`, (state) => ({
          ...state,
          leases: (state?.leases || []).map((item) => item.id === id
            ? { ...item, relaySessionId: relaySession.sessionId, relayEmissionId: relaySession.emissionId }
            : item),
        }))));
      }
      // A simultaneous room edit or a newer start in this tab must win.
      const latestRoom = await this.access(slug, who).catch(() => null);
      const latestSlots = await read(this.store, `leases/${roomBucket}`);
      if (!latestRoom || latestRoom.revision !== room.revision || !latestSlots?.leases.some((item) => item.id === id)) {
        throw new RoomError('La sala o la reproducción han cambiado. Vuelve a intentarlo.', 409);
      }
      return { id, provider, url: relaySession?.url || channel.url, expires: lease.expires };
    } catch (error) {
      await Promise.all(keys.map((key) => this.releaseBucket(key, id, who.sessionId)));
      if (relaySession?.sessionId) await this.relay.ping(relaySession.sessionId, who.sessionId, false).catch(() => {});
      throw error;
    }
  }
  async releaseBucket(bucket, id, sessionId, ownerRoom) {
    await mutate(this.store, `leases/${bucket}`, (state) => ({ ...state, leases: (state?.leases || []).filter((lease) => !(lease.id === id && (lease.sessionId === sessionId || lease.room === ownerRoom))) }));
  }
  async playback(slug, who, input, action) {
    const room = await this.access(slug, who, action === 'close');
    const bucket = `room-${slug}`;
    const state = await read(this.store, `leases/${bucket}`);
    const lease = state?.leases.find((item) => item.id === input.id && (item.sessionId === who.sessionId || action === 'close'));
    if (!lease) return { kicked: true };
    const provider = lease.provider || bucket;
    const keys = [...new Set([bucket, provider])];
    if (action !== 'ping') {
      await Promise.all(keys.map((key) => this.releaseBucket(key, lease.id, who.sessionId, action === 'close' ? slug : undefined)));
      if (lease.relaySessionId && this.relay.configured) {
        if (action === 'close' && lease.relayEmissionId) {
          await this.relay.close(lease.relayEmissionId, who.account?.username || who.account?.name || 'Propietario').catch(() => {});
        } else {
          await this.relay.ping(lease.relaySessionId, lease.sessionId, false).catch(() => {});
        }
      }
      return { ok: true };
    }
    let alive = lease.expires > this.clock() && lease.version === room.version;
    if (alive) {
      for (const key of keys) {
        await mutate(this.store, `leases/${key}`, (current) => {
          const present = current?.leases.find((item) => item.id === lease.id && item.expires > this.clock());
          if (!present) { alive = false; return current || { leases: [] }; }
          return { ...current, leases: current.leases.filter((item) => item.expires > this.clock()).map((item) => item.id === lease.id ? { ...item, expires: this.clock() + LEASE_SECONDS } : item) };
        });
      }
    }
    if (alive && lease.relaySessionId && this.relay.configured) {
      try {
        const relay = await this.relay.ping(lease.relaySessionId, lease.sessionId, true);
        if (relay?.kicked) {
          alive = false;
          await Promise.all(keys.map((key) => this.releaseBucket(key, lease.id, lease.sessionId)));
        }
      } catch { /* A transient control-plane error must not immediately kill a working media stream. */ }
    }
    return { kicked: !alive, expires: this.clock() + LEASE_SECONDS };
  }
  async status(slug, who) {
    const room = await this.access(slug, who, true);
    const state = await read(this.store, `leases/room-${slug}`);
    const active = (state?.leases || []).filter((lease) => lease.expires > this.clock() && lease.version === room.version);
    const channels = new Map(parsePlaylist(this.playlist(room)).map((channel) => [channel.id, channel]));
    const programmeByChannel = new Map();
    await Promise.all([...new Set(active.map((lease) => lease.channelId))].map(async (channelId) => {
      const channel = channels.get(channelId);
      programmeByChannel.set(channelId, channel ? await this.program(channel.url) : null);
    }));
    return {
      active: active.length,
      limit: room.limit,
      connections: active.map(({ id, name, channelId, channelName }) => {
        const channel = channels.get(channelId);
        return {
          id,
          name,
          channelId,
          channelName,
          channelLogo: channel?.logo || '',
          program: programmeByChannel.get(channelId) || null,
        };
      }),
    };
  }
}
