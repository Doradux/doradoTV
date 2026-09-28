const FORMAT = 'dorado-tv-playlist';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

function fromBase64(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Archivo cifrado inválido.');
  }
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function keyBytes(key) {
  const bytes = fromBase64(key);
  if (bytes.length !== 32) throw new Error('Clave de cifrado inválida.');
  return bytes;
}

export async function encryptPlaylist(plaintext, key, { forceFallback = false } = {}) {
  const bytes = keyBytes(key);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let encrypted;
  if (!forceFallback && globalThis.crypto?.subtle) {
    const imported = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt']);
    encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, imported, encoder.encode(plaintext)));
  } else {
    const { gcm } = await import('@noble/ciphers/aes.js');
    encrypted = gcm(bytes, iv).encrypt(encoder.encode(plaintext));
  }
  return { format: FORMAT, version: 2, cipher: 'AES-256-GCM', iv: toBase64(iv), data: toBase64(encrypted) };
}

export async function decryptPlaylist(document, key, { forceFallback = false } = {}) {
  if (!document || document.format !== FORMAT || document.version !== 2 || document.cipher !== 'AES-256-GCM') {
    throw new Error('Formato de lista cifrada no compatible. Vuelve a subir la lista.');
  }
  const bytes = keyBytes(key);
  const iv = fromBase64(document.iv);
  const data = fromBase64(document.data);
  if (iv.length !== 12 || data.length < 16) throw new Error('Archivo cifrado inválido.');
  if (!forceFallback && globalThis.crypto?.subtle) {
    const imported = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['decrypt']);
    return decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, imported, data));
  }
  const { gcm } = await import('@noble/ciphers/aes.js');
  return decoder.decode(gcm(bytes, iv).decrypt(data));
}
