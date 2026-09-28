export const CHUNK_SIZE = 512 * 1024;
export const MAX_CHUNKS = 64;
const BATCH = /^[a-z0-9-]{20,64}$/;

export function isAdmin(user) {
  return !!user && user.role === 'admin';
}

function validBatch(batch) {
  return typeof batch === 'string' && BATCH.test(batch);
}

export function validateEncryptedPlaylist(value) {
  if (!value || value.format !== 'dorado-tv-playlist' || value.version !== 2 ||
      value.cipher !== 'AES-256-GCM' || typeof value.salt !== 'undefined' ||
      typeof value.iv !== 'string' || typeof value.data !== 'string') {
    throw new Error('La lista cifrada no tiene el formato esperado.');
  }
}

export async function getManifest(store) {
  const raw = await store.get('active', { consistency: 'strong' });
  if (!raw) return null;
  const manifest = JSON.parse(raw);
  if (!validBatch(manifest.batch) || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > MAX_CHUNKS) {
    throw new Error('Manifiesto inválido.');
  }
  return manifest;
}

export async function saveChunk(store, batch, index, chunk) {
  if (!validBatch(batch) || !Number.isInteger(index) || index < 0 || index >= MAX_CHUNKS ||
      typeof chunk !== 'string' || !chunk.length || Buffer.byteLength(chunk, 'utf8') > CHUNK_SIZE) {
    throw new Error('Fragmento inválido.');
  }
  await store.set(`batch/${batch}/${index}`, chunk);
}

export async function commitPlaylist(store, batch, count) {
  if (!validBatch(batch) || !Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) {
    throw new Error('Subida inválida.');
  }
  const chunks = [];
  for (let index = 0; index < count; index += 1) {
    const chunk = await store.get(`batch/${batch}/${index}`, { consistency: 'strong' });
    if (!chunk) throw new Error('Faltan fragmentos de la lista.');
    chunks.push(chunk);
  }
  validateEncryptedPlaylist(JSON.parse(chunks.join('')));
  const previous = await getManifest(store);
  await store.set('active', JSON.stringify({ batch, count }));
  if (previous && previous.batch !== batch) {
    await Promise.allSettled(Array.from({ length: previous.count }, (_, index) => store.delete(`batch/${previous.batch}/${index}`)));
  }
  return { batch, count };
}

export async function getChunk(store, index) {
  const manifest = await getManifest(store);
  if (!manifest || !Number.isInteger(index) || index < 0 || index >= manifest.count) return null;
  return store.get(`batch/${manifest.batch}/${index}`, { consistency: 'strong' });
}
