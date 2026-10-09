// WebTorrent 3 uses the ES2025 Uint8Array Base64/Hex APIs. They are not
// available in every browser version still capable of running WebRTC.
export function installUint8EncodingCompat() {
  if (!Uint8Array.prototype.toBase64) {
    Object.defineProperty(Uint8Array.prototype, 'toBase64', {
      configurable: true, writable: true,
      value() {
        let binary = '';
        for (let i = 0; i < this.length; i += 8192) {
          binary += String.fromCharCode(...this.subarray(i, i + 8192));
        }
        return btoa(binary);
      },
    });
  }
  if (!Uint8Array.prototype.toHex) {
    Object.defineProperty(Uint8Array.prototype, 'toHex', {
      configurable: true, writable: true,
      value() {
        return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('');
      },
    });
  }
  if (!Uint8Array.fromHex) {
    Object.defineProperty(Uint8Array, 'fromHex', {
      configurable: true, writable: true,
      value(input) {
        if (typeof input !== 'string' || input.length % 2 || !/^[0-9a-f]*$/i.test(input)) {
          throw new SyntaxError('Invalid hex string');
        }
        const data = new Uint8Array(input.length / 2);
        for (let i = 0; i < data.length; i++) data[i] = parseInt(input.slice(i * 2, i * 2 + 2), 16);
        return data;
      },
    });
  }
}
