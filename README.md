# Dorado TV

Reproductor web independiente para una lista M3U cifrada. Busca y filtra canales, guarda favoritos por nombre y reproduce HLS, MPEG-TS o vídeo nativo cuando el navegador admite la emisión.

## Desarrollo

```bash
npm ci
npm test
npm run dev
```

La app busca `/playlist.enc.json`. Para probar con tu lista en local, genera el archivo cifrado en `public/playlist.enc.json` y arranca Vite. Este archivo está excluido de Git.

```bash
npm run encrypt:playlist -- /ruta/a/tu-lista.m3u --out public/playlist.enc.json
npm run dev
```

El comando pide la clave dos veces sin mostrarla y exige al menos 12 caracteres. Usa una clave larga y única; perderla obliga a volver a cifrar la M3U. La app no guarda la clave. El archivo usa AES-256-GCM con una clave derivada mediante PBKDF2-SHA256 y sal aleatoria. El descifrado ocurre en el navegador.

## Subir a Netlify sin publicar la lista en GitHub

1. Ejecuta `npm run build`.
2. Cifra tu M3U en la carpeta de despliegue:

   ```bash
   npm run encrypt:playlist -- /ruta/a/tu-lista.m3u --out dist/playlist.enc.json
   ```

3. Sube **la carpeta `dist` completa** a tu sitio de Netlify mediante despliegue manual o `netlify deploy --prod --dir=dist`. Así se publican juntos la web y el archivo cifrado. La M3U original y la clave no se suben.

Si conectas Netlify a GitHub y se publica una nueva versión automáticamente desde Git, esa versión no incluirá `playlist.enc.json`, porque está excluido del repositorio. Después de cada despliegue desde Git tendrás que volver a desplegar `dist` con el archivo cifrado, o usar un almacenamiento externo persistente. `netlify.toml` define `npm run build` y `dist`; `public/_headers` evita que Netlify almacene en caché el archivo cifrado.

## Límites de reproducción

En Netlify la web se sirve por HTTPS. Los canales HTTP pueden quedar bloqueados por contenido mixto; los directos HLS y MPEG-TS también dependen del soporte del navegador y de CORS del proveedor. Las emisiones que requieran conversión o relay continuo necesitan un servicio externo.

El modo local por HTTP en la red usa una implementación JavaScript de descifrado cuando Web Crypto no está disponible. Úsalo solo para pruebas en una red de confianza; Netlify usa HTTPS.

Utiliza únicamente listas y emisiones para las que tengas autorización.
