# Dorado TV

Televisión privada con acceso de administrador. La lista se cifra en el navegador antes de subirla a Netlify Blobs; la M3U original y la clave no se envían al servidor ni se guardan en GitHub.

## Preparar Netlify

1. Conecta `Doradux/doradoTV` a un proyecto de Netlify. `netlify.toml` configura el build y las funciones.
2. Activa **[Netlify Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/get-started/)** en ese proyecto.
3. Cambia el registro a **Invite only**. Invita únicamente tu correo desde **Identity → Users**.
4. En la ficha de ese usuario, asígnale el rol **`admin`**. La app y las funciones rechazan cualquier cuenta sin ese rol.
5. Abre el enlace de invitación, crea tu contraseña e inicia sesión.

Netlify Identity debe estar activado y tu cuenta debe tener `admin` para usar la app. No hay formulario de registro público. La web estática es visible, pero los canales y la subida están protegidos por comprobaciones de sesión y rol en las funciones.

## Subir la lista

Después de iniciar sesión, pulsa el **botón con icono de subida** de la esquina inferior izquierda. Elige tu M3U y escribe una clave para cifrarla (mínimo 12 caracteres). La app cifra el archivo con AES-256-GCM y PBKDF2-SHA256 antes de enviarlo en fragmentos. [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/) guarda únicamente el contenido cifrado y lo conserva entre despliegues. La clave no se guarda: tendrás que introducirla de nuevo para desbloquear los canales al volver a entrar.

El botón solo aparece en una sesión de administrador y la función de subida vuelve a comprobar ese rol. Las listas de hasta 24 MB se admiten en el formulario.

## Desarrollo

```bash
npm ci
npm test
npm run build
```

Para probar el login y las funciones en local, vincula primero este proyecto con tu sitio de Netlify y ejecuta `npm run dev:netlify`. `npm run dev` inicia solo Vite y puede mostrar el login, pero no ofrece Identity ni las funciones. Netlify Dev utiliza un almacén de Blobs local separado del de producción.

## Reproducción

Los canales HTTP pueden quedar bloqueados en HTTPS; HLS y MPEG-TS dependen del navegador y de las cabeceras CORS del proveedor. Las emisiones que requieran conversión o relay continuo necesitan un servicio externo.

Utiliza únicamente listas y emisiones para las que tengas autorización.
