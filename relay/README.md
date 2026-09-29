# Relay de Dorado TV

Este proceso Node 22 sirve HLS y mantiene una entrada FFmpeg por canal aunque haya varios espectadores. Necesita FFmpeg instalado, almacenamiento local privado y **una sola instancia** en un host Linux. Netlify Functions no puede ejecutar este proceso de forma permanente.

## Configuración

En el servidor, configura estas variables y ejecuta `npm run relay` bajo systemd o supervisord:

```text
PORT=5300
HOST=127.0.0.1
DORADO_RELAY_DIR=/var/lib/dorado-tv/relay
DORADO_RELAY_SECRET=<secreto aleatorio largo, el mismo que en Netlify>
DORADO_RELAY_PUBLIC_URL=https://relay.example.com
DORADO_APP_ORIGIN=https://tu-app.netlify.app
DORADO_MAX_CONNECTIONS=3
DORADO_FFMPEG=/usr/bin/ffmpeg
```

Publica el puerto con un proxy HTTPS que reenvíe `/media/`, `/start`, `/ping`, `/close` y `/status` al proceso local. El control exige el secreto Bearer; las listas HLS y los segmentos exigen un token de sesión temporal. En Netlify establece `DORADO_RELAY_URL=https://relay.example.com` y el mismo `DORADO_RELAY_SECRET`. Usa la URL pública exacta de la app en `DORADO_APP_ORIGIN` para permitir la reproducción desde el navegador.

El directorio contiene `registry.json`, URLs privadas de canales y segmentos de vídeo. No lo expongas como carpeta web ni lo incluyas en copias públicas. Al arrancar, el relay invalida sesiones anteriores y limpia emisiones huérfanas. Tras desplegar código nuevo, reinicia el servicio mediante su supervisor; evita iniciar instancias manuales adicionales.

`RelayRegistry.transaction()` compara el JSON nuevo con el contenido actual y escribe solo cuando cambia. Es la corrección trasladada de `hpr` `56af7a3`: en reposo el reloj del worker cambia una vez por segundo, mientras que las consultas sin cambios no reescriben el archivo. La protección frente a la fuga de `i360.so` del PHP de HPR no aplica a este proceso Node.

Para verificar el despliegue, abre el mismo canal en dos sesiones y comprueba que aparece una emisión con dos espectadores. Cierra ese canal y comprueba que ambas reproducciones terminan. Un canal distinto debe abrir otra entrada hasta el límite configurado.
