# Dorado TV

Salas privadas de televisión para compartir con amigos. Los invitados entran con **nombre único de sala + contraseña**, sin registrarse. Solo necesitan cuenta quienes quieren subir su M3U y crear salas.

## Qué incluye

- Acceso con Google para propietarios: al entrar por primera vez se elige un nombre de usuario único. No requiere SMTP, una contraseña de Dorado TV ni Turnstile. Los invitados siguen usando sala y contraseña.
- El acceso anterior por contraseña se conserva. El registro y la recuperación por correo requieren SMTP y Turnstile; sus enlaces son de un solo uso y caducan a los 30 minutos.
- Límites persistentes de solicitudes en ambos métodos; Turnstile, si se configura, añade una comprobación tras intentos fallidos de acceso por contraseña.
- Hasta 3 salas por propietario, cada una con título, nombre único, contraseña independiente y una lista `.m3u` de hasta 10 MB.
- Invitados con sesiones de 7 días y acceso solo a la sala autenticada. El propietario puede cambiar la contraseña, revocar accesos, cerrar reproducciones o eliminar la sala.
- Panel de salas, enlaces para compartir (sin contraseña), exportación de copia, favoritos por sala y reproductor con animaciones, selects custom y bookmarks rellenos.
- Detección del máximo de conexiones para cuentas compatibles con `player_api.php`. Si se detectan 3, permite habilitar 1–3. Si no se conoce, queda sin límite configurado y permite fijar uno manual.
- Reserva de plazas con escrituras condicionales, renovación cada 25 segundos y caducidad de 90 segundos. Las salas que usan las mismas credenciales del proveedor comparten el máximo detectado. La app reintenta una sala llena cada 30 segundos mientras la pestaña está visible.

## Almacenamiento y privacidad

Las salas nuevas **no necesitan Netlify Database ni otro proveedor de base de datos**. Usan un almacén persistente de Netlify Blobs, `dorado-rooms-v1`, con registros separados para cuentas, salas, sesiones, verificaciones y reservas. Las vistas previas usan otro almacén para no modificar los datos de producción.

La M3U se envía por HTTPS a una función, se valida en el servidor y se cifra con AES-256-GCM antes de persistirla. El cifrado está vinculado a la sala; la clave maestra se guarda en una variable privada de entorno, nunca en el código ni en el navegador. Esta versión cambia el cifrado exclusivamente en navegador del sistema anterior para poder validar las subidas y consultar límites desde el servidor.

Las contraseñas se guardan con scrypt y una sal aleatoria. Los tokens se guardan mediante hash. Todas las rutas verifican permisos en el servidor; ocultar botones no concede ni restringe permisos. Los nombres de usuario (sin distinguir mayúsculas) y de salas se reservan mediante escrituras condicionales y no hay un directorio público de salas.

Google se valida en el servidor con sus claves públicas y la librería `jose`: firma RS256, emisor, destinatario, caducidad y nonce vinculado al navegador. Cada intento tiene una cookie HttpOnly de 10 minutos y solo se puede completar una vez. La sesión posterior es propia de Dorado TV. No se guarda el token de Google ni se solicita acceso a Gmail, Drive u otras APIs.

Las cuentas de Google se identifican por su `sub`, no por su correo. Un cambio de correo conserva la cuenta y sus salas. No se fusionan automáticamente con cuentas antiguas aunque coincida el correo: para acceder a las salas anteriores hay que usar el método anterior. El correo de una cuenta de Google externa a Gmail/Workspace no se usa como prueba de propiedad de otra cuenta ni como mecanismo de recuperación de esta identidad.

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

Sin clave de cifrado, las salas están desactivadas. Con `GOOGLE_CLIENT_ID`, el acceso de Google funciona independientemente de la configuración de correo y CAPTCHA. Sin SMTP/Turnstile, solo permanecen desactivados el registro y la recuperación **por correo**. El botón «Entrar con contraseña» conserva el acceso a cuentas anteriores. No se usan credenciales de prueba ni se omite la validación de Google en producción.

Configurar Google no restringe el alta a tus amigos: cualquier cuenta de Google que pueda autorizar el cliente puede registrarse. Se aplican límites de solicitudes y el máximo de tres salas por cuenta. No hay todavía un sistema de invitaciones para crear cuentas.

Las pruebas automatizadas de Google utilizan tokens firmados con claves de prueba y un almacén aislado; no completan el consentimiento de una cuenta real. Es necesario comprobar ese último paso desde un origen autorizado en tu consola de Google. No se ha enviado correo real ni se han creado recursos externos durante las pruebas automatizadas.

## Migrar la instalación anterior

La migración es opcional y no borra los datos previos:

1. Mantén temporalmente la conexión de Netlify Database existente y activa `DORADO_ENABLE_LEGACY_LOGIN=true`.
2. En **Mis salas**, inicia sesión con tu antiguo nombre de usuario y contraseña. Se copia únicamente esa cuenta a Blobs; los siguientes accesos de ese usuario ya se verifican allí.
3. Crea una sala con su propia contraseña. En **Ajustes de la sala**, pulsa **Importar mi lista anterior**. La lista antigua se lee, se valida con los límites nuevos y se vuelve a cifrar para esa sala. Si supera 10 MB, prepara una M3U más pequeña.
4. Verifica que todo funciona antes de retirar cualquier dato SQL. Desactivar la opción de acceso anterior deshabilita el login por nombre de usuario; conserva esa opción mientras uses cuentas migradas sin correo. Las cuentas nuevas con correo funcionan siempre en Blobs.

Los archivos y endpoints antiguos se conservan para esta transición y para el relay anterior. No son el backend de las salas nuevas. El script `npm run admin:create -- <usuario>` sigue destinado exclusivamente al sistema SQL antiguo.

## Reproducción y conexiones

Las salas nuevas reproducen directamente desde el proveedor. Cada espectador consume normalmente una conexión de origen, incluso si varios ven el mismo canal. La señal debe ser reproducible desde el navegador: HTTPS cuando la app se sirve por HTTPS, CORS compatible y un formato admitido. No se reenvía el vídeo a través de Netlify.

La detección consulta la API del proveedor identificado en URLs de tipo `/live/usuario/contraseña/id.ts` o `.m3u8`; no abre emisiones de prueba para descubrir el límite. Solo se aceptan respuestas con un entero positivo. Un error temporal conserva un máximo conocido para esa cuenta. Para una lista con varias cuentas, la configuración de sala usa el menor máximo conocido, y cada cuenta mantiene además su propio contador compartido. Las consultas están acotadas a 8 cuentas por subida, con DNS validado, bloqueo de direcciones privadas, sin redirecciones y límites de tiempo/tamaño.

El límite controla plazas de la app, no las emisiones externas. La caducidad libera conexiones de navegadores desconectados, pero no puede imponer un corte al servidor de origen. El límite configurado menor que el uso actual bloquea nuevas reproducciones hasta que se liberen plazas; no expulsa arbitrariamente a quienes ya estaban viendo.

El [relay persistente anterior](relay/README.md) permanece disponible como componente separado, pero **no está conectado a las nuevas salas**. Integrarlo exige aislar sus emisiones por sala/cuenta y alojarlo en un servidor permanente fuera de Netlify. No se ha reutilizado un relay global para mezclar salas privadas.

## Coste y desarrollo

El almacenamiento y las funciones consumen las cuotas de tu plan Netlify; no se promete uso ilimitado gratuito. El vídeo directo evita que su tráfico consuma el ancho de banda del sitio. El estado de conexiones se consulta solo en las vistas activas del propietario; las reproducciones mantienen su renovación periódica.

```bash
npm ci
npm test
npm run build
npm run dev -- --port 5199 --strictPort
```

Copia `.env.example` a `.env` y configura tus valores privados para trabajar con servicios reales. El plugin de Netlify para Vite proporciona Blobs local. Los tests usan almacenamiento en memoria con el contrato de escrituras condicionales, correo simulado y respuestas de proveedor controladas; no contactan con proveedores de canales.

Utiliza listas y emisiones para las que tengas autorización.
