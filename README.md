# Dorado TV

Reproductor web independiente para listas M3U. Permite cargar un archivo local o una URL, buscar y filtrar canales, guardar favoritos por nombre, y reproducir HLS, MPEG-TS o vídeo nativo cuando el navegador admite la emisión.

## Desarrollo

```bash
npm ci
npm run dev
npm test
npm run build
```

## Despliegue en Netlify

Conecta este repositorio a Netlify. `netlify.toml` define `npm run build` como comando de compilación y `dist` como directorio publicado. No hacen falta variables de entorno para la app estática.

## Listas y privacidad

Importa una lista M3U desde el selector de archivos o mediante una URL. Los archivos se procesan en el navegador y no se suben al sitio. La app no incluye listas, enlaces de proveedores ni credenciales. Solo guarda en `localStorage` los nombres y categorías de favoritos, nunca las URLs de los canales.

Las listas remotas deben permitir solicitudes CORS desde el navegador. En un sitio HTTPS, los directos HTTP pueden ser bloqueados por contenido mixto. HLS y MPEG-TS también dependen de los formatos que admita el navegador y de las cabeceras CORS del proveedor. Para emisiones que necesiten conversión, autenticación del proveedor o relay continuo hace falta un servicio externo; una app estática en Netlify no lo sustituye.

Usa únicamente listas y emisiones para las que tengas autorización.
