# Relay de Dorado TV

El relay se usa solo para canales `http://`. Convierte la señal a HLS HTTPS con FFmpeg para evitar mixed content. Las señales HTTPS siguen reproduciéndose directamente.

## Despliegue recomendado: Railway

El repo incluye `Dockerfile.relay` y `railway.toml`. Railway ejecuta el proceso en infraestructura gestionada, entrega un dominio `*.up.railway.app` con TLS automático y reinicia el servicio si falla.

1. Crea un proyecto en Railway desde este repositorio.
2. Genera un dominio público en **Networking → Generate Domain**.
3. Añade estas variables al servicio:

```text
DORADO_RELAY_SECRET=<secreto aleatorio largo>
DORADO_APP_ORIGIN=https://doradotv.netlify.app
DORADO_MAX_CONNECTIONS=3
```

No hace falta definir `PORT`, `HOST`, `DORADO_RELAY_DIR` ni `DORADO_RELAY_PUBLIC_URL` en Railway. El proceso usa `PORT` y `RAILWAY_PUBLIC_DOMAIN` automáticamente y guarda los segmentos temporales en `/tmp`.

En Netlify añade:

```text
DORADO_RELAY_URL=https://<tu-dominio>.up.railway.app
DORADO_RELAY_SECRET=<el mismo secreto>
```

`/health` es público únicamente para el health check de Railway. El resto del plano de control exige Bearer; el vídeo usa tokens temporales y CORS restringido a `DORADO_APP_ORIGIN`.

## Seguridad

Cada URL HTTP y cada redirección se resuelven antes de abrirse. Se rechazan loopback, redes privadas y link-local. FFmpeg recibe una IP pública fijada, conserva el `Host` original y usa `-max_redirects 0`.

Varias personas viendo el mismo canal comparten una sola entrada FFmpeg. Si no queda ningún espectador, la emisión se cierra automáticamente.

## Autohospedado opcional

También puede ejecutarse con `npm run relay` en un host Linux con Node 22 y FFmpeg. En ese caso configura además `DORADO_RELAY_DIR`, `DORADO_RELAY_PUBLIC_URL`, `HOST` y un reverse proxy HTTPS.
