# Dorado TV

Televisión privada con acceso de administrador mediante nombre de usuario y contraseña. No hay cuentas vinculadas a direcciones de correo ni registro público. La lista se cifra en el navegador antes de subirla a Netlify Blobs; la M3U original y su clave no se envían al servidor ni se guardan en GitHub.

## Preparar Netlify

1. Conecta `Doradux/doradoTV` a un proyecto de Netlify. `netlify.toml` configura el build y las funciones.
2. Netlify aprovisiona [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/) y aplica la migración de `netlify/database/migrations`, que crea las tablas de cuentas y sesiones.
3. Crea el administrador directamente en la base de datos con `npm run admin:create -- <usuario>`. El script necesita `NETLIFY_DB_URL` o `DATABASE_URL` en el entorno y la contraseña en `DORADO_ADMIN_PASSWORD`. Genera un hash aleatorio con scrypt antes de insertar la cuenta; la contraseña nunca se guarda en el repositorio. Ejecutarlo de nuevo para el mismo usuario cambia la contraseña y cierra las sesiones anteriores.
4. Inicia sesión con ese usuario. Solo una sesión con rol `admin` puede leer o subir la lista. La sesión usa una cookie `HttpOnly`, `SameSite=Strict` y `Secure` bajo HTTPS.

No publiques `NETLIFY_DB_URL`, `DATABASE_URL` ni `DORADO_ADMIN_PASSWORD`. Para conectar el script a producción, obtén la cadena de conexión desde el panel de Netlify Database y pásala al proceso como variable de entorno. El proyecto debe estar vinculado a tu cuenta de Netlify para gestionar allí la base de datos.

## Subir la lista

Después de iniciar sesión, pulsa el **botón con icono de subida** de la esquina inferior izquierda y elige tu M3U. La app cifra el archivo con AES-256-GCM antes de enviarlo en fragmentos. [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) guarda únicamente el contenido cifrado y lo conserva entre despliegues. La clave se genera aleatoriamente y se almacena en Netlify Database; solo una sesión de administrador puede obtenerla. Los canales se cargan automáticamente después del login o al volver a abrir la app con una sesión válida.

El botón solo aparece en una sesión de administrador y la función de subida vuelve a comprobar ese rol. Las listas de hasta 24 MB se admiten en el formulario.

Si ya existía una lista cifrada con la versión anterior, súbela una vez más para activar la apertura automática.

## Desarrollo

```bash
npm ci
npm test
npm run build
npm run dev -- --port 5199 --strictPort
```

El plugin de Netlify para Vite sirve las funciones y una base de datos local. Aplica la migración local con `npx netlify database migrations apply` mientras el servidor está activo. Después, obtén la conexión local con `npx netlify database connect --json` y crea el administrador con el script. La base de datos y las listas locales están separadas de producción.

## Reproducción

Los canales HTTP pueden quedar bloqueados en HTTPS; HLS y MPEG-TS dependen del navegador y de las cabeceras CORS del proveedor. Las emisiones que requieran conversión o relay continuo necesitan un servicio externo.

Utiliza únicamente listas y emisiones para las que tengas autorización.

Cada navegador se conecta directamente al origen del canal. La app no comparte una única conexión entre varios espectadores. Esa función exige un relay persistente fuera de Netlify.
