# Relay de Dorado TV

El relay se usa únicamente para canales cuya URL de origen es `http://` cuando Dorado TV está servido por HTTPS. Convierte la emisión a HLS, la publica mediante HTTPS y mantiene una sola entrada FFmpeg por canal aunque haya varios espectadores.

Necesita Node 22, FFmpeg, almacenamiento local privado y **una sola instancia** en un host Linux permanente. Netlify Functions no puede ejecutar vídeo continuo.

## Configuración del servidor

Ejecuta `npm run relay` bajo systemd, supervisord o un servicio equivalente:

```text
PORT=5300
HOST=127.0.0.1
DORADO_RELAY_DIR=/var/lib/dorado-tv/relay
DORADO_RELAY_SECRET=<secreto aleatorio largo>
DORADO_RELAY_PUBLIC_URL=https://relay.example.com
DORADO_APP_ORIGIN=https://doradotv.netlify.app
DORADO_MAX_CONNECTIONS=3
DORADO_FFMPEG=/usr/bin/ffmpeg
```

Publica `127.0.0.1:5300` detrás de un reverse proxy HTTPS. Con Caddy, por ejemplo:

```text
relay.example.com {
    reverse_proxy 127.0.0.1:5300
}
```

En Netlify configura las mismas credenciales de control:

```text
DORADO_RELAY_URL=https://relay.example.com
DORADO_RELAY_SECRET=<el mismo secreto del servidor>
```

El navegador nunca recibe el secreto. `/start`, `/ping`, `/close`, `/status` y `/health` requieren Bearer; `/media/.../index.m3u8` y los segmentos usan un token temporal asociado a la sesión. El media solo habilita CORS para `DORADO_APP_ORIGIN`.

## Seguridad de las URLs

Antes de abrir una señal, el relay resuelve DNS y rechaza loopback, redes privadas, link-local y otros rangos no públicos. Las redirecciones HTTP se siguen manualmente, con un máximo de cuatro saltos, y cada destino vuelve a validarse. FFmpeg recibe la IP pública ya fijada, conserva el `Host` original y arranca con `-max_redirects 0`, evitando DNS rebinding y redirecciones posteriores hacia redes internas.

Solo se aceptan señales HTTP en el relay; las HTTPS se reproducen directamente desde el navegador.

El directorio de estado contiene `registry.json`, URLs privadas y segmentos HLS. No lo expongas como carpeta web ni lo incluyas en copias públicas. Al arrancar, el relay invalida sesiones anteriores y limpia emisiones huérfanas.

Para verificar el despliegue, abre el mismo canal HTTP en dos sesiones y comprueba que aparece una sola emisión con dos espectadores. Al cerrar la reproducción, la sesión del relay también se libera.
