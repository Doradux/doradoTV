# DoradoTV — fuentes autoalojadas (sin Debrid)

Este pequeño addon Stremio devuelve hashes BitTorrent desde **un catálogo privado** y/o un indexador Torznab propio (Jackett o Prowlarr), para obras que tengas derecho a reproducir.

**Cómo funciona:** Cinemeta (u otro addon) aporta la ficha con IMDb ID → este addon devuelve `infoHash` → el backend de DoradoTV genera un ticket de sala → el relay de DoradoTV descarga y retransmite desde BitTorrent. No usa TorBox ni AllDebrid. No es un fork de PeLis: sus enlaces de hosters no se convierten automáticamente en torrents.

## Configuración

1. Instala Node 22+ y Docker (opcional). `cd selfhosted-addon`; `cp .env.example .env`.
2. Genera un valor único y secreto de `ADDON_TOKEN` con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Usa otra clave distinta para `DORADO_RELAY_SECRET`.
3. Configura `TORZNAB_URL` y `TORZNAB_API_KEY` con la URL **Torznab** y la clave de tu Jackett/Prowlarr de confianza, en tu red. Si aún no tienes Jackett, ejecuta `docker compose --profile indexer up -d`, abre `http://localhost:9117` **en el host**, configura los indexadores permitidos y copia la API key de su panel. En Docker, la URL del feed conjunto suele ser `http://jackett:9117/api/v2.0/indexers/all/results/torznab/api` (nunca `127.0.0.1` desde dentro del contenedor). Después actualiza `.env` y reinicia el addon. Los resultados deben incluir un magnet o un hash; no admite únicamente enlaces `.torrent`. Algunos indexadores no admiten búsqueda por IMDb ID.
4. Opcional: copia `config/sources.example.json` a `config/sources.json`. El ejemplo contiene **Big Buck Bunny** (Blender Foundation, CC BY 3.0), con torrent de muestra publicado como contenido autorizado, IMDb `tt1254207` y `fileIdx: 1` (el primer archivo es un póster). Para películas usa `movie:tt1254207` y para episodios `series:tt1234567:1:2`. La disponibilidad depende de los pares.
5. `npm ci && npm test && npm start`, o `docker compose up -d --build`. Con Docker el puerto se abre **solo en localhost:5310**, no en Internet.
6. Publica la URL del addon en un dominio **HTTPS** a través de un proxy inverso hacia localhost:5310. Ni Prowlarr ni su API key deben quedar expuestos.
7. En DoradoTV, el propietario de la sala abre **Addons > Añadir**, e introduce `https://DOMINIO/ADDON_TOKEN/manifest.json`. **Mantén desactivada la consulta directa del navegador**: DoradoTV guardará la URL privada cifrada.
8. Añade Cinemeta u otro addon de catálogo a la sala. En la lista de fuentes se mostrará **DoradoTV propio** para los títulos con resultados BitTorrent.

## Relay en tu Ubuntu

Este addon solo **encuentra hashes**: el relay de DoradoTV sigue siendo quien descarga. Para vídeo de varios GB, hospeda también el relay en un servidor con espacio de disco y FFmpeg; consulta `relay/README.md`. En una instalación propia puedes establecer `DORADO_TORRENT_MAX_BYTES` (hasta el límite actual de 8 GiB de configuración) y `DORADO_TORRENT_MAX_ACTIVE`. El streaming de MKV grandes puede utilizar la caché circular existente, pero aún no permite saltos de tiempo cuando hay remux.

El archivo `compose.full.yaml` puede levantar **relay + addon** en el mismo Ubuntu. Necesitarás dos dominios HTTPS (o rutas de proxy adaptadas), uno para cada servicio, y configurar la URL y la clave privada del relay en la sala.

## Variables

- `ADDON_TOKEN` (obligatoria): controla el acceso a las rutas de Stremio.
- `TORZNAB_URL`, `TORZNAB_API_KEY`: indexador opcional; nunca salen en las respuestas.
- `SOURCES_FILE`: ruta al JSON local opcional.
- `PORT`: 5310 por defecto.
- `DORADO_APP_ORIGIN`, `DORADO_RELAY_SECRET`: necesarios para el relay si usas `compose.full.yaml`.

El addon no almacena ni retransmite películas por sí mismo, no aporta indexadores y no promete la caché instantánea de un servicio Debrid. Mantén las URL de configuración privadas, aplica HTTPS y restringe el acceso de red al indexador.