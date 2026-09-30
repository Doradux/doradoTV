// Read-only bridge for existing installations. New accounts and rooms use Blobs.
import { digest, newSession, verifyPassword } from './room-security.js';
import { read, RoomError } from './room-store.js';
import { accountView } from './rooms-service.js';

export async function legacyLogin(store, username, password) {
  if (process.env.DORADO_ENABLE_LEGACY_LOGIN !== 'true' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(username || '')) throw new RoomError('Correo o contraseña incorrectos.', 401);
  const id = digest(`legacy:${username}`);
  let account = await read(store, `account/${id}`);
  if (!account) {
    const { getDatabase } = await import('@netlify/database');
    const db = getDatabase();
    const [old] = await db.sql`SELECT username, password_hash FROM app_users WHERE username = ${username} AND role = 'admin'`;
    if (!old || !await verifyPassword(password, old.password_hash)) throw new RoomError('Correo o contraseña incorrectos.', 401);
    await store.setJSON(`account/${id}`, { id, name: old.username, email: null, passwordHash: old.password_hash, verified: true, version: 1, rooms: [], legacy: true, created: Math.floor(Date.now() / 1000) }, { onlyIfNew: true });
    account = await read(store, `account/${id}`);
  }
  if (!await verifyPassword(password, account.passwordHash)) throw new RoomError('Correo o contraseña incorrectos.', 401);
  return { account: accountView(account), token: await newSession(store, { kind: 'account', accountId: account.id, version: account.version }) };
}
export async function legacyPlaylist() {
  const [{ getStore }, { getDatabase }, { getManifest, getChunk }, { decryptPlaylist }] = await Promise.all([
    import('@netlify/blobs'), import('@netlify/database'), import('./playlist-store.js'), import('../../src/crypto.js'),
  ]);
  const store = getStore({ name: 'dorado-tv', consistency: 'strong' });
  const manifest = await getManifest(store);
  if (!manifest) throw new RoomError('No hay una lista antigua que importar.', 404);
  const db = getDatabase();
  const [key] = await db.sql`SELECT value FROM app_settings WHERE name = 'playlist_key'`;
  if (!key) throw new RoomError('No se encuentra la clave de la lista anterior.', 409);
  const chunks = await Promise.all(Array.from({ length: manifest.count }, (_, index) => getChunk(store, index)));
  return decryptPlaylist(JSON.parse(chunks.join('')), key.value);
}
