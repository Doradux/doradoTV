// Implements the conditional write contract, including immutable read snapshots.
export function memoryBlobStore() {
  const values = new Map(); let revision = 0;
  return {
    values,
    async get(key, options = {}) { const item = values.get(key); if (!item) return null; return options.type === 'json' ? structuredClone(item.value) : JSON.stringify(item.value); },
    async getWithMetadata(key) { const item = values.get(key); return item ? { data: structuredClone(item.value), etag: item.etag, metadata: {} } : null; },
    async setJSON(key, value, options = {}) {
      const item = values.get(key);
      if (options.onlyIfNew && item || options.onlyIfMatch && item?.etag !== options.onlyIfMatch) return { modified: false };
      const etag = String(++revision); values.set(key, { value: structuredClone(value), etag }); return { modified: true, etag };
    },
    async delete(key) { values.delete(key); },
  };
}
