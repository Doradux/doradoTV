# Relay de Dorado TV

El relay se usa solo para canales `http://`. Convierte la señal a HLS HTTPS con FFmpeg para evitar mixed content. Las señales HTTPS siguen reproduciéndose directamente.

## Northflank

Expón el puerto `5300` como HTTP público. Dorado TV detecta Northflank automáticamente y obtiene la URL HTTPS pública del propio reverse proxy (o de `NF_HOSTS` cuando ya está disponible), así que no hace falta definir `DORADO_RELAY_PUBLIC_URL` ni `HOST`.

Variables necesarias:

```text
DORADO_RELAY_SECRET=<secreto aleatorio largo>
DORADO_APP_ORIGIN=https://doradotv.netlify.app
DORADO_MAX_CONNECTIONS=3
```

En Crear sala o Ajustes de DoradoTV introduce el dominio `*.code.run` generado para ese servicio y la clave `DORADO_RELAY_SECRET` de **ese servicio de Northflank**. Cada sala necesita su propio servicio y dominio HTTPS.

## Despliegue alternativo: Railway

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

En la sala de DoradoTV, introduce el dominio HTTPS de Railway en el campo URL del relay y la misma clave que configuraste en el servicio. No son variables globales de Netlify.

`/health` es público únicamente para el health check de Railway. El resto del plano de control exige Bearer; el vídeo usa tokens temporales y CORS restringido a `DORADO_APP_ORIGIN`.

## Seguridad

Cada URL HTTP y cada redirección se resuelven antes de abrirse. Se rechazan loopback, redes privadas y link-local. FFmpeg recibe una IP pública fijada, conserva el `Host` original y usa `-max_redirects 0`.

**Este relay también distribuye emisiones compartidas:** cuando varias personas reproducen exactamente la misma URL HTTP, el servidor abre una sola conexión al origen y una sola entrada FFmpeg, y distribuye el HLS resultante a los espectadores mediante sesiones individuales. Diez espectadores de esa misma señal HTTP pueden compartir una emisión de origen, en lugar de crear diez conexiones al proveedor.

La agrupación utiliza un hash de la URL de origen completa. Dos URL distintas (por ejemplo, credenciales de proveedor o tokens diferentes) se tratan como emisiones independientes, aunque muestren el mismo canal. Los canales HTTPS que se reproducen directamente desde el navegador no atraviesan este relay y no tienen esa deduplicación. No se puede garantizar que el proveedor contabilice siempre una única conexión: depende de sus reglas, redirecciones y sesiones.

Si no queda ningún espectador, la emisión se cierra automáticamente. DORADO_MAX_CONNECTIONS limita las emisiones de origen simultáneas del relay, no el número total de espectadores de una misma emisión.

## Autohospedado opcional

También puede ejecutarse con `npm run relay` en un host Linux con Node 22 y FFmpeg. En ese caso configura además `DORADO_RELAY_DIR`, `DORADO_RELAY_PUBLIC_URL`, `HOST` y un reverse proxy HTTPS.

## Relays privados independientes

Cada sala necesita una instancia propia de este servidor, una URL HTTPS diferente y su propia clave DORADO_RELAY_SECRET en Northflank o Railway. El propietario introduce URL y clave al crear la sala o en Ajustes y pulsa Comprobar relay y clave. El backend comprueba el endpoint /health y la ruta /status con su clave; almacena los datos cifrados en la sala.

Netlify ya no necesita DORADO_RELAY_URL ni DORADO_RELAY_SECRET globales: esas variables antiguas dejan de funcionar como configuración por defecto. NO las elimines antes de recuperar los valores para tu sala.

Un relay admite múltiples espectadores de la misma URL HTTP usando una sola entrada FFmpeg. Las señales HTTPS directas no pasan por este relay.

## Torrents desde el relay

Cada instancia admite reproducción de torrents mediante WebTorrent en Node.js, con conexión a pares BitTorrent TCP/UDP y trackers públicos. DoradoTV comprueba que la fuente procede de un addon autorizado y que el usuario pertenece a la sala; el relay reutiliza el mismo torrent para todos los espectadores del mismo archivo. Sirve el vídeo mediante HTTP Range en el reproductor habitual. Los tokens de vídeo son temporales y cada torrent se elimina cuando ya no queda nadie viéndolo.

En instancias pequeñas de Northflank (512 MB RAM y 1 GB de almacenamiento) se recomienda esta configuración conservadora:

- DORADO_TORRENT_MAX_BYTES=734003200 (700 MiB por vídeo)
- DORADO_TORRENT_MAX_ACTIVE=1 (un torrent simultáneo por relay)
- 12 conexiones BitTorrent, 4 MiB/s de descarga y 256 KiB/s de subida (límites internos)

Para películas mayores primero amplía el almacenamiento y la RAM y después sube DORADO_TORRENT_MAX_BYTES. Los vídeos MKV, AVI, MOV, TS y M2TS se remultiplexan a MP4 fragmentado usando FFmpeg y audio AAC, sin recodificar el vídeo. No se guarda un segundo archivo completo. El remux no permite aún saltos temporales; los códecs de vídeo no compatibles siguen necesitando un servidor con más CPU para su transcodificación. La descarga torrent no se inicia hasta que un espectador elige una fuente.

## Contenedores MKV, AVI, MOV y TS

El relay reconoce estos contenedores y puede servirlos mediante una ruta temporal de remux, verificada con el token individual. FFmpeg recibe bytes del torrent por su entrada estándar y entrega un MP4 fragmentado por la salida estándar. Copia el vídeo sin recodificar y convierte el audio a AAC estéreo para compatibilidad. El consumo de CPU es mucho menor que convertir el vídeo entero, y se evitan archivos MP4 duplicados en el almacenamiento limitado. Se admiten como máximo dos procesos de remux simultáneos por relay. No se permiten saltos temporales en esta ruta: el progreso sigue siendo progresivo. Un códec de vídeo incompatible con HTML5 seguirá sin reproducirse, y el límite de tamaño por archivo no cambia.

## Caché circular para torrents grandes

Para MKV/AVI/MOV/TS/M2TS grandes, WebTorrent selecciona ventanas pequeñas y consecutivas del vídeo y guarda piezas verificadas en un almacén circular limitado a **256 MiB**. De esta manera un vídeo de 8 GiB no necesita 8 GiB de disco; el límite de tamaño progresivo es **12 GiB** por archivo. Los torrents menores de 700 MiB mantienen almacenamiento convencional y peticiones de acceso aleatorio. Los MP4 grandes siguen requiriendo almacenamiento suficiente, porque el navegador y sus índices pueden pedir rangos lejanos.

Limitaciones actuales: un solo espectador de un torrent grande simultáneamente, sin adelantar/rebobinar, reinicio de swarm al parar para re-descargar los fragmentos ya descartados. El tráfico de datos BitTorrent y la retransmisión al espectador continúan; vigila las cuotas de Northflank. Se mantiene un torrent simultáneo por defecto y el bloqueo de IPs privadas recibido de los trackers.

## Audio compatible para vídeos HTTPS directos

Las fuentes HTTPS de addons como TorBox se reproducen directamente en el navegador por defecto.
Si la imagen funciona pero no hay sonido (pistas AC-3, E-AC-3 o DTS), el espectador puede
activar **Audio compatible** desde los controles del reproductor.
DoradoTV abre una sesión temporal en su relay de sala y FFmpeg convierte la primera pista
de audio a AAC estéreo mientras copia el vídeo al contenedor MP4 fragmentado. No escribe una
segunda película completa en disco y no envía al navegador la clave privada del relay.

Limitaciones: es reproducción **progresiva, sin avance/retroceso**; cambiar de modo reinicia
la película desde el principio. Depende de que el origen HTTPS proporcione un flujo de
vídeo válido que FFmpeg pueda leer secuencialmente, y no convierte un códec de vídeo
incompatible con el navegador. URLs que requieran cabeceras de autenticación específicas
(no incluidas en enlaces de descarga firmados) o MP4 con su índice exclusivamente al final
pueden necesitar un método distinto. El relay valida las IP públicas en DNS y en cada
redirección HTTPS, impide acceder a direcciones privadas, usa tokens de sesión temporales
y permite como máximo **dos** procesos de remux simultáneos (sumando BitTorrent y HTTPS).
Al terminar se revoca la sesión y se cierra la conexión de descarga remota.
