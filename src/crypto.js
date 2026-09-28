const FORMAT = 'dorado-tv-playlist';
const ITERATIONS = 310_000;
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

async function deriveKey(password, salt, usages) {
  if (typeof password !== 'string' || !password) throw new Error('Introduce la clave.');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export async function encryptPlaylist(plaintext, password, { forceFallback = false } = {}) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let encrypted;
  if (!forceFallback && globalThis.crypto?.subtle) {
    const key = await deriveKey(password, salt, ['encrypt']);
    encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext)));
  } else {
    if (!password) throw new Error('Introduce la clave.');
    const [{ pbkdf2Async }, { sha256 }, { gcm }] = await Promise.all([
      import('@noble/hashes/pbkdf2.js'),
      import('@noble/hashes/sha2.js'),
      import('@noble/ciphers/aes.js'),
    ]);
    const key = await pbkdf2Async(sha256, encoder.encode(password), salt, { c: ITERATIONS, dkLen: 32 });
    encrypted = gcm(key, iv).encrypt(encoder.encode(plaintext));
  }
  return {
    format: FORMAT,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(encrypted),
  };
}

export async function decryptPlaylist(document, password, { forceFallback = false } = {}) {
  if (!document || document.format !== FORMAT || document.version !== 1 || document.kdf !== 'PBKDF2-SHA256' || document.iterations !== ITERATIONS || document.cipher !== 'AES-256-GCM') {
    throw new Error('Formato de lista cifrada no compatible.');
  }
  const salt = fromBase64(document.salt);
  const iv = fromBase64(document.iv);
  const data = fromBase64(document.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length < 16) throw new Error('Archivo cifrado inválido.');
  if (!forceFallback && globalThis.crypto?.subtle) {
    const key = await deriveKey(password, salt, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return decoder.decode(plaintext);
  }

  // Web Crypto is unavailable on HTTP LAN origins. This fallback keeps local previews usable.
  if (!password) throw new Error('Introduce la clave.');
  const [{ pbkdf2Async }, { sha256 }, { gcm }] = await Promise.all([
    import('@noble/hashes/pbkdf2.js'),
    import('@noble/hashes/sha2.js'),
    import('@noble/ciphers/aes.js'),
  ]);
  const key = await pbkdf2Async(sha256, encoder.encode(password), salt, { c: ITERATIONS, dkLen: 32 });
  return decoder.decode(gcm(key, iv).decrypt(data));
}
