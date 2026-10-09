# Dorado TV

[**English**](#english) · [**Español**](#espanol)

<a id="english"></a>

## English

Dorado TV is an open-source room-based video application for authorized M3U live channels and Stremio-compatible movie and series sources. This repository provides software, not content, subscriptions, or IPTV accounts.

### Rooms and accounts

Owners sign in with Google and can create up to three private rooms with independent passwords and provider accounts. Guests enter rooms with their room name and password. Signed-in users can revisit up to 40 previously joined rooms from their dashboard, without receiving owner privileges or bypassing room passwords. Room owners can update settings, revoke room sessions, stop broadcasts, export backups, or delete rooms.

### Provider credentials and encryption

During room creation, specify your authorized Xtream-compatible provider's server URL, username and password and click **Verify credentials**. The server checks player_api.php and verifies the credentials again before saving. Credentials can be updated in Room settings after another successful check. Existing rooms can opt in later.

Provider credentials and uploaded M3U files are separately stored using **AES-256-GCM** encryption with room-specific associated data. The master key never reaches browsers. Room metadata does not return account passwords. Once configured, Xtream playlist URLs must match the room's provider credentials. Passwords use salted scrypt; tokens and owner actions are checked on the server.

**Limitation:** M3U playback URLs may themselves embed credentials. Authorized viewers can inspect those URLs in their browser. Storage encryption does not conceal playback URLs from viewers. A full authenticated video proxy would be required for that and would use significant additional bandwidth.

### Unified movies, series and live TV

The same room video player handles both live channels and on-demand streams. Selecting Cinema & Series changes the sidebar to searches, results, seasons, episodes and sources. Every installed addon advertising a compatible searchable catalog is consulted automatically; there is no engine selector. Search results have staggered entrance animations. Series support previous/next episode, a seek bar and ±10-second skips when seekable.

The owner manages room addons with a separate Manage addons button. Sources must be authorized and supported by browser codecs/CORS. Torrent sources use each room's Node.js relay and conventional BitTorrent TCP/UDP peers; MKV/AVI/MOV/TS sources can be remuxed to progressive MP4 without video re-encoding, when codecs allow.

### One independently configured relay per room

Each new room requires its own external relay instance with an independent HTTPS URL and private key. This is **not** the IPTV/Xtream provider account. The owner verifies the relay in the creation form. Both /health and the authenticated /status must pass before the room is created, and room settings allow rotation after verification.

The configuration is stored server-side, encrypted per room using AES-256-GCM with associated room data. Guests cannot read relay credentials. A relay URL can only be assigned to one room. The former Netlify-wide relay is NOT used as a fallback, including for pre-existing rooms: their owners need to configure a relay in Room settings to play HTTP channels.

A relay accepts one upstream HTTP connection per distinct channel URL, converting it with FFmpeg to HLS for several authorized viewers of that SAME channel/URL. Direct HTTPS channels still bypass this relay, so there is no upstream deduplication for them. Availability checks target the room-specific server and attempt to wake it; requests cannot start a service that the hosting provider has manually stopped.

The previous relay was hosted on Northflank under a code.run domain. Find its address in Northflank service → Ports/Networking, and its key in the service's environment variables. Your old global Netlify DORADO_RELAY_URL and DORADO_RELAY_SECRET may still exist for retrieval, but they are ignored by the new version. Copy the values before deleting them.

### Server torrent streaming and resource limits

Torrent sources with valid info hashes play through the **room's own relay** using traditional BitTorrent TCP/UDP peers, instead of browser-only WebRTC peers. Room permissions are checked first; addon source capabilities expire after 10 minutes, and each viewer receives a short-lived HTTP media token. The same HTML5 player supports seeking through byte ranges and episode navigation.

To protect small Northflank instances, server torrents are limited by default to **one active swarm, 12 peers, 700 MiB per selected video, 4 MiB/s download and 256 KiB/s upload**. Larger videos show a capacity error: the server never silently downloads multi-gigabyte videos on a 1 GB instance. Increase the relay disk/RAM and then DORADO_TORRENT_MAX_BYTES before selecting larger files. MP4/WebM/OGG files are streamed directly; MKV/AVI/MOV/TS containers can be remuxed to fragmented MP4 without video transcoding. MKV remuxes have no reliable seeking yet. Unsupported video codecs require transcoding hardware that the smallest Northflank instance lacks. Playback requires reachable TCP/UDP peers, and temporary caches expire when no one watches.

### Responsible use and legal notices

Use only authorized M3U channels, addons and media. The [Responsible use and notices page](/legal.html) provides a report form when DORADO_REPORT_EMAIL and valid SMTP settings have been configured. Content is not proactively inspected. Disclaimer text cannot grant automatic legal immunity: applicable obligations and protections depend on actual service functions, use and response to valid complaints. Seek legal advice before opening a public service.

### Setup

1. Use Node.js 22, then run npm ci, npm test and npm run build.
2. Deploy via netlify.toml; the output folder is dist and Netlify Functions live in netlify/functions.
3. Configure DORADO_ENCRYPTION_KEY, GOOGLE_CLIENT_ID, and the canonical site URL. See [.env.example](.env.example). Keep an offline backup of your encryption key.
4. Deploy an independent relay for each room and configure the URL/key in the new-room or room-settings form. See [relay setup](relay/README.md).
5. Optionally enable content notices with DORADO_REPORT_EMAIL, SMTP_USER, SMTP_PASSWORD and optional SMTP_HOST/SMTP_PORT, then verify a real email delivery.
6. Development: npm run dev -- --port 5199 --strictPort.

The repository does not include media, a provider subscription, or seeders. Both Netlify and relay resources have finite usage quotas.

---

<a id="espanol"></a>

## Español

Salas privadas de televisión para compartir con amigos. Los invitados entran con **nombre único de sala + contraseña**, sin registrarse. Solo necesitan cuenta quienes quieren subir su M3U y crear salas.

## Qué incluye

- Acceso con Google para propietarios: al entrar por primera vez se elige un nombre de usuario único. No requiere SMTP, una contraseña de Dorado TV ni Turnstile. Los invitados siguen usando sala y contraseña.
- Límites persistentes de solicitudes en ambos métodos; Turnstile, si se configura, añade una comprobación tras intentos fallidos de acceso por contraseña.
- Hasta 3 salas por propietario, cada una con título, nombre único, contraseña independiente y una lista `.m3u` de hasta 10 MB.
- Invitados con sesiones de 7 días y acceso solo a la sala autenticada. El propietario puede cambiar la contraseña, revocar accesos, cerrar reproducciones o eliminar la sala.
- Panel de salas, enlaces para compartir (sin contraseña), exportación de copia, favoritos por sala y reproductor con animaciones, selects custom y bookmarks rellenos.
- Detección del máximo de conexiones para cuentas compatibles con `player_api.php`. Si se detectan 3, permite habilitar 1–3. Si no se conoce, queda sin límite configurado y permite fijar uno manual.
- Reserva de plazas con escrituras condicionales, renovación cada 25 segundos y caducidad de 90 segundos. Las salas que usan las mismas credenciales del proveedor comparten el máximo detectado. La app reintenta una sala llena cada 30 segundos mientras la pestaña está visible.

## Almacenamiento y privacidad

Dorado TV **no necesita Netlify Database ni otro proveedor SQL**. Usa un almacén persistente de Netlify Blobs, `dorado-rooms-v1`, con registros separados para cuentas, salas, sesiones, verificaciones y reservas. Las vistas previas usan otro almacén para no modificar los datos de producción.

La M3U se envía por HTTPS a una función, se valida en el servidor y se cifra con AES-256-GCM antes de persistirla. El cifrado está vinculado a la sala; la clave maestra se guarda en una variable privada de entorno, nunca en el código ni en el navegador. Esta versión cambia el cifrado exclusivamente en navegador del sistema anterior para poder validar las subidas y consultar límites desde el servidor.

Las contraseñas se guardan con scrypt y una sal aleatoria. Los tokens se guardan mediante hash. Todas las rutas verifican permisos en el servidor; ocultar botones no concede ni restringe permisos. Los nombres de usuario (sin distinguir mayúsculas) y de salas se reservan mediante escrituras condicionales y no hay un directorio público de salas.

Google se valida en el servidor con sus claves públicas y la librería `jose`: firma RS256, emisor, destinatario, caducidad y nonce vinculado al navegador. Cada intento tiene una cookie HttpOnly de 10 minutos y solo se puede completar una vez. La sesión posterior es propia de Dorado TV. No se guarda el token de Google ni se solicita acceso a Gmail, Drive u otras APIs.

Las cuentas de Google se identifican por su `sub`, no por su correo. Un cambio de correo conserva la cuenta y sus salas. No se fusionan automáticamente con otras cuentas aunque coincida el correo. El correo de una cuenta de Google externa a Gmail/Workspace no se usa como prueba de propiedad de otra cuenta ni como mecanismo de recuperación de esta identidad.

En reproducción directa, las URLs de los canales llegan al navegador de los invitados autorizados. La app no puede impedir que esas URLs se utilicen fuera de ella ni controlar conexiones externas al proveedor. Cambiar la contraseña revoca el acceso a la app; el reproductor detiene una emisión al detectar la revocación en su siguiente renovación. El nombre y contraseña compartidos tampoco permiten identificar individualmente a cada invitado.

La exportación incluye la lista **sin cifrar** para que sea recuperable: guárdala en un lugar privado. No contiene hashes de contraseñas ni claves del servidor. Los nombres de salas eliminadas permanecen reservados para evitar que otra persona suplante un enlace antiguo.

## Configurar Netlify

1. Configura el proyecto con `netlify.toml`: build `npm run build`, publicación `dist` y funciones en `netlify/functions`.
2. Añade en **Netlify → Environment variables** las variables de [`.env.example`](.env.example). No pongas secretos en `netlify.toml` ni variables con prefijo `VITE_`.
3. Genera una clave de cifrado estable de 32 bytes:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

   Guarda el resultado como `DORADO_ENCRYPTION_KEY` y conserva una copia segura. No la cambies sin migrar las listas existentes; perderla impide descifrarlas.
4. Configura `DORADO_APP_URL` con la URL pública, por ejemplo `https://tu-sitio.netlify.app`. No hace falta comprar un dominio.
5. En Google Auth Platform, crea un cliente OAuth de tipo **Aplicación web**. Autoriza el origen HTTPS exacto del sitio y, para desarrollo, `http://localhost` y `http://localhost:5199`. Con el botón y callback JavaScript no se necesita URI de redirección ni secreto de cliente. Configura `GOOGLE_CLIENT_ID` con el identificador terminado en `.apps.googleusercontent.com`. Completa la información de la aplicación en Google; los permisos básicos `openid`, `email` y `profile` son suficientes. [Guía oficial](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).
6. Despliega tras configurar las variables. En **Mis salas**, pulsa **Continuar con Google**, elige tu usuario la primera vez, crea una sala y sube la M3U.

Si deseas habilitar también el registro y la recuperación por correo, configura opcionalmente:

- Un widget de Cloudflare Turnstile para el hostname de la app: `TURNSTILE_SITE_KEY` y `TURNSTILE_SECRET_KEY`.
- Una cuenta Gmail dedicada con verificación en dos pasos y contraseña de aplicación: `SMTP_USER` y `SMTP_PASSWORD`. Por defecto se usa `smtp.gmail.com:465` con TLS; otro servidor puede usar `SMTP_HOST` y `SMTP_PORT` (587 usa STARTTLS).

Sin clave de cifrado, las salas están desactivadas. Con `GOOGLE_CLIENT_ID`, el acceso de Google funciona independientemente de la configuración de correo y CAPTCHA. Sin SMTP/Turnstile, solo permanecen desactivados el registro y la recuperación **por correo**. No se usan credenciales de prueba ni se omite la validación de Google en producción.

Configurar Google no restringe el alta a tus amigos: cualquier cuenta de Google que pueda autorizar el cliente puede registrarse. Se aplican límites de solicitudes y el máximo de tres salas por cuenta. No hay todavía un sistema de invitaciones para crear cuentas.

Las pruebas automatizadas de Google utilizan tokens firmados con claves de prueba y un almacén aislado; no completan el consentimiento de una cuenta real. Es necesario comprobar ese último paso desde un origen autorizado en tu consola de Google. No se ha enviado correo real ni se han creado recursos externos durante las pruebas automatizadas.

## Reproducción y conexiones

Las señales HTTPS se reproducen directamente desde el proveedor. Los canales cuya URL es HTTP se envían al [relay persistente](relay/README.md), que los convierte a HLS y los publica mediante HTTPS; Netlify solo controla la sesión y nunca transporta el vídeo. Si el relay no está configurado, los canales HTTP muestran un error de configuración en lugar de intentar mixed content.

La detección consulta la API del proveedor identificado en URLs de tipo `/live/usuario/contraseña/id.ts` o `.m3u8`; no abre emisiones de prueba para descubrir el límite. Solo se aceptan respuestas con un entero positivo. Un error temporal conserva un máximo conocido para esa cuenta. Para una lista con varias cuentas, la configuración de sala usa el menor máximo conocido, y cada cuenta mantiene además su propio contador compartido. Las consultas están acotadas a 8 cuentas por subida, con DNS validado, bloqueo de direcciones privadas, sin redirecciones y límites de tiempo/tamaño.

El límite controla plazas de la app, no las emisiones externas. La caducidad libera conexiones de navegadores desconectados, pero no puede imponer un corte al servidor de origen. El límite configurado menor que el uso actual bloquea nuevas reproducciones hasta que se liberen plazas; no expulsa arbitrariamente a quienes ya estaban viendo.

El relay se usa únicamente para señales HTTP y debe alojarse en un servidor permanente fuera de Netlify. El backend de salas le entrega sesiones temporales; el navegador nunca recibe `DORADO_RELAY_SECRET`. Varias personas viendo el mismo canal comparten una entrada FFmpeg. Cada URL y cada redirección se resuelven y validan contra redes privadas antes de abrirse, FFmpeg recibe una IP fijada y no sigue redirecciones por su cuenta.

## Coste y desarrollo

El almacenamiento y las funciones consumen las cuotas de tu plan Netlify; no se promete uso ilimitado gratuito. Las señales HTTPS directas no consumen ancho de banda de Netlify; las señales HTTP consumen tráfico y CPU del host donde ejecutes el relay. El estado de conexiones se consulta solo mientras una vista de sala está activa; las reproducciones mantienen su renovación periódica.

```bash
npm ci
npm test
npm run build
npm run dev -- --port 5199 --strictPort
```

Copia `.env.example` a `.env` y configura tus valores privados para trabajar con servicios reales. El plugin de Netlify para Vite proporciona Blobs local. Los tests usan almacenamiento en memoria con el contrato de escrituras condicionales, correo simulado y respuestas de proveedor controladas; no contactan con proveedores de canales.

Utiliza listas y emisiones para las que tengas autorización.

## Addons de Stremio por sala (películas y series)

Dentro de una sala, abre **Gestión de addons** en la cabecera. Su propietario puede pegar una URL `https://.../manifest.json` y pulsar **Instalar**; las instalaciones y eliminaciones están protegidas por la sesión de propietario en el servidor. Los invitados autenticados con la contraseña de esa sala pueden explorar sus catálogos y seleccionar fuentes, pero no modificar los addons. Cada sala mantiene sus propios addons (máximo 8) en Netlify Blobs; las URLs de configuración se cifran con `DORADO_ENCRYPTION_KEY` y no se incluyen en las respuestas a invitados. Eliminar la sala elimina también su configuración de addons.

La integración consulta los recursos del [protocolo de Stremio](https://stremio.github.io/stremio-addon-sdk/protocol.html): `manifest`, `catalog`, `meta`, `stream` y `subtitles`, para los tipos `movie` y `series`. Se admiten búsquedas cuando el catálogo las anuncia y selección de episodios. Una película puede ofrecer fuentes desde todos los addons instalados que admitan su identificador. Los streams HTTPS que reproduzca el navegador (por ejemplo MP4 o HLS) se abren con el reproductor web; los torrents se descargan mediante el relay de cada sala (pares BitTorrent TCP/UDP), con remultiplexación a MP4 para MKV/AVI/MOV/TS cuando los códecs lo permiten. Los subtítulos externos se intentan cargar mediante CORS y, si son SRT, convertir a WebVTT. Las fuentes pueden imponer protecciones, códecs o cabeceras que el navegador no soporte.

**Seguridad:** los servidores de addons deben servir HTTPS en el puerto 443 y resolver a IPs públicas. El backend fija la IP al conectar, inspecciona de nuevo cada redirección y limita tiempos, tamaño de respuesta y peticiones por sesión. Se validan los manifests y se escapa su contenido al mostrarlo. Instala únicamente addons de confianza y que proporcionen contenido que tengas derecho a reproducir; DoradoTV no incluye contenidos; el relay privado incorpora el motor BitTorrent. Las URL de vídeo resultantes se entregan al navegador del miembro autorizado y pueden ser visibles en sus herramientas de desarrollador.

Los addons son una función independiente de las listas M3U y no afectan a sus límites de conexión. La reproducción VOD detiene la emisión en directo que estuviera utilizando el mismo navegador. Esta primera versión no sincroniza la reproducción entre los miembros de una sala ni ofrece un proxy genérico de vídeo o subtítulos.

### Cine y series en las salas

La sala tiene un selector entre **Lista de canales** y **Cine y series**. El acceso a **Gestión de addons** solo aparece al propietario; además, las rutas del servidor comprueban sus permisos al instalar y eliminar complementos. Las búsquedas de películas y series se ejecutan sobre los catálogos que anuncian soporte de búsqueda de los addons instalados; los resultados se agrupan por identificador para evitar duplicados. Los addons exclusivamente de streams participan cuando se consultan las fuentes de un título, no como catálogos.

En las series puede seleccionarse temporada y episodio si un addon de metadatos aporta la lista de episodios. Las fuentes se pueden ordenar por seeders cuando estos están disponibles y elegir individualmente. Las fuentes directas HTTPS compatibles pueden reproducirse en el navegador; los torrents se sirven a través del relay propio de la sala; los MKV se convierten a un contenedor MP4 sin recodificar el vídeo cuando el códec es compatible. El número de seeders representa la cantidad indicada por el proveedor, **no** un peer individual al que se pueda conectar desde el navegador.

El favicon y los iconos instalables comparten el nuevo logotipo transparente `public/favicon.svg` (sin fondo), con variantes PNG también transparentes.

## Historial de salas y recuperación de vídeo

- **Mis salas** separa salas propias y salas ajenas visitadas. Solo se añade una sala tras entrar correctamente con contraseña **mientras la cuenta esté iniciada** (sesión de Google, por ejemplo); no se asocian retroactivamente entradas anónimas. Se conservan hasta 40 referencias a salas recientes en la cuenta, nunca contraseñas ni listas de terceros. El usuario puede quitarlas del historial.
- Al volver a una sala ajena, si la sesión actual ya no permite entrar, se solicita la contraseña normalmente. Estar en el historial **no** concede acceso persistente ni permisos de propietario. Salas eliminadas no se listan.
- El botón de reproducción M3U se bloquea y muestra progreso mientras establece una conexión; errores de vídeo y HLS muestran una acción explícita **Reintentar conexión**. La selección de canal desplaza suavemente la página al principio.

## Avisos de contenido y límites de responsabilidad

La página pública /legal.html expone las normas de uso y, solo cuando hay un correo operativo configurado, un formulario de avisos concretos. Los avisos son enviados por correo; no se rastrean automáticamente listas, canales ni complementos. La función valida los datos y limita envíos por IP. No se ha configurado un buzón por defecto para evitar mostrar información privada o simular recepción de avisos.

Para activar el formulario en producción configura **todas** estas variables en Netlify y despliega de nuevo:

- DORADO_REPORT_EMAIL: dirección real donde se recibirán y tramitarán las notificaciones.
- SMTP_USER, SMTP_PASSWORD y, si procede, SMTP_HOST y SMTP_PORT: credenciales válidas del servidor de correo de salida. Usa una cuenta dedicada con contraseña de aplicación.

Prueba el formulario con un aviso de ejemplo controlado y revisa que el mensaje llegue; el test automatizado no envía email real. Los avisos legítimos deben revisarse y gestionarse diligentemente. Es recomendable disponer de un procedimiento para retirar o deshabilitar con rapidez las listas, addons o accesos concretos cuando corresponda, conservar el registro de las actuaciones pertinentes y facilitar el contacto a titulares de derechos y autoridades.

**Importante:** Estas medidas no otorgan exoneración automática. El encaje jurídico de un servicio con M3U, búsqueda de addons y, en ciertos casos, relay de emisiones depende de sus funciones efectivas y del uso, así como de la legislación aplicable. La LSSI española y el Reglamento de Servicios Digitales de la UE incluyen exenciones condicionadas y obligaciones específicas; consulta asesoramiento jurídico antes de abrir el proyecto a terceros fuera de tu entorno de confianza.

### Proveedores por sala, relay y mejoras de reproducción

Las salas nuevas solicitan URL, usuario y contraseña de un proveedor Xtream compatible, que se deben verificar antes de crear la sala. Desde Ajustes pueden sustituirse tras otra comprobación. El servidor vuelve a validar los datos al guardar y los cifra con AES-256-GCM vinculado a la sala. Las salas antiguas pueden seguir funcionando sin migración y añadir su proveedor desde Ajustes. Las listas Xtream de una sala configurada deben coincidir con las credenciales almacenadas.

**Limitación:** las URL de reproducción M3U pueden incluir credenciales que un espectador autorizado puede inspeccionar desde su navegador. El cifrado del almacenamiento no oculta las URL de vídeo entregadas al usuario. Se necesitaría un proxy de vídeo autenticado para ocultarlas por completo, con costes adicionales de tráfico y CPU.

El relay es una infraestructura **compartida** alojada fuera de Netlify, no un relay por sala. Al entrar en una sala la app comprueba su salud y reintenta despertarlo si está suspendido, cuando el proveedor de alojamiento lo permite. No puede arrancar servicios detenidos manualmente en un panel externo.

En Cine y series se reutiliza el reproductor principal de las M3U. El panel lateral muestra búsqueda, resultados, temporadas, episodios y fuentes. La búsqueda usa automáticamente todos los catálogos compatibles, sin selector de motor. El contenido entra con animaciones suaves y escalonadas. Las series tienen anterior/siguiente episodio, barra de tiempo y saltos de 10 segundos.

El relay privado reproduce torrents de pares BitTorrent TCP/UDP normales y puede remultiplexar MKV/AVI/MOV/TS a MP4 sin recodificar el vídeo. Algunos códecs siguen sin estar admitidos por el navegador. Utiliza exclusivamente fuentes autorizadas.

### Relay propio por sala

Cada sala necesita su propio servicio relay HTTPS y clave privada. Es distinto del proveedor IPTV. Se verifica el servicio en la creación de la sala y en Ajustes antes de guardar: las llamadas /health y /status autenticadas deben funcionar.

Las credenciales se cifran por sala (AES-256-GCM) y no se muestran a invitados. No se permite asignar la misma URL de relay a dos salas diferentes, y ya no existe relay global por defecto. Las salas antiguas deben configurarlo manualmente para reproducir canales HTTP; no heredarán las claves antiguas de Netlify.

Tu relay original estaba alojado en Northflank, mediante un dominio code.run. Busca el servicio en Northflank → Ports/Networking y su variable DORADO_RELAY_SECRET en Environment variables. También puedes consultar los valores anteriores en las variables de entorno del proyecto Netlify antes de eliminarlas. No compartas la clave privada con otros propietarios.

El relay comparte una conexión del proveedor entre espectadores de una misma URL HTTP. Los canales HTTPS directos siguen reproduciéndose sin atravesar el relay y no tienen esa deduplicación.

### Torrents en el relay privado

Cada sala utiliza su propio relay para conectar a seeders BitTorrent TCP/UDP tradicionales. Netlify valida la fuente y la sesión antes de permitir la reproducción. El navegador recibe el vídeo mediante HTTP con soporte de solicitudes Range, sin buscar pares WebRTC. Al cerrar la reproducción se liberan las sesiones y se eliminan los archivos temporales después de un periodo sin espectadores.

**Límites por defecto:** un torrent activo, 12 pares, máximo de **700 MiB por archivo de vídeo**, descarga de 4 MiB/s y subida de 256 KiB/s. Para películas más grandes necesitas ampliar primero el almacenamiento y la memoria de Northflank y después ajustar DORADO_TORRENT_MAX_BYTES. MKV/AVI/MOV/TS se remultiplexan a MP4 sin recodificar el vídeo; los códecs incompatibles siguen requiriendo un servidor más potente. Durante la conversión no hay búsqueda temporal fiable. La reproducción requiere seeders TCP/UDP accesibles.

### Remultiplexación MKV, AVI y MOV

Las fuentes torrent MKV, AVI, MOV, TS y M2TS pueden transformarse sobre la marcha en un MP4 fragmentado para el mismo reproductor. FFmpeg copia el vídeo sin recodificarlo y convierte el audio a AAC para aumentar la compatibilidad. No se guarda una segunda película completa en el disco de Northflank. El navegador reproduce los fragmentos conforme llegan, pero los saltos temporales están deshabilitados durante esa conversión por no existir todavía un índice de acceso aleatorio. Los códecs de vídeo que el navegador no soporte, especialmente algunas variantes HEVC/H.265, siguen requiriendo otra fuente o transcodificación de vídeo con más CPU. Continúa el límite de 700 MiB por vídeo del relay pequeño.
