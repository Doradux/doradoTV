import { getStore } from '@netlify/blobs';

export function roomStore() {
  const context = process.env.CONTEXT;
  // Preview deployments must never read or mutate production accounts.
  const suffix = context && context !== 'production' ? `-${context}-${process.env.BRANCH || 'local'}`.replace(/[^a-zA-Z0-9_-]/g, '-') : '';
  return getStore({ name: `dorado-rooms-v1${suffix}`, consistency: 'strong' });
}

export class RoomError extends Error {
  constructor(message, status = 400, details = {}) { super(message); this.status = status; this.details = details; }
}
export const read = (store, key) => store.get(key, { type: 'json', consistency: 'strong' });

// Compare-and-swap protects uniqueness and the last playback slot across instances.
export async function mutate(store, key, change) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    const next = await change(current?.data ?? null);
    const result = await store.setJSON(key, next, current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
    if (result.modified) return next;
  }
  throw new RoomError('Hay otra operación en curso. Vuelve a intentarlo.', 409);
}
