import nodemailer from 'nodemailer';
import { RoomError } from './room-store.js';
export const mailReady = (env = process.env) => !!(env.SMTP_USER && env.SMTP_PASSWORD && env.DORADO_APP_URL);
export async function sendAccountMail(email, token, kind, env = process.env) {
  if (!mailReady(env)) throw new RoomError('El servicio de correo aún no está disponible.', 503);
  const url = new URL(env.DORADO_APP_URL);
  url.hash = new URLSearchParams({ [kind === 'reset' ? 'reset' : 'verify']: token }).toString();
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 465), secure: (env.SMTP_PORT || '465') === '465',
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }, connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
    requireTLS: true,
  });
  await transport.sendMail({
    from: { name: 'Dorado TV', address: env.SMTP_USER }, to: email,
    subject: kind === 'reset' ? 'Recupera tu acceso a Dorado TV' : 'Verifica tu correo en Dorado TV',
    text: `${kind === 'reset' ? 'Elige una nueva contraseña' : 'Confirma tu correo para crear tus salas'}:\n\n${url.href}\n\nEste enlace caduca en 30 minutos y solo se puede utilizar una vez. Si no lo has solicitado, ignora este mensaje.`,
  });
}

// Public reporting channel for specific alleged illegal content. No proactive M3U/addon inspection.
export const reportReady = (env = process.env) => !!(env.DORADO_REPORT_EMAIL && env.SMTP_USER && env.SMTP_PASSWORD);
export async function sendContentNotice(input, env = process.env) {
  if (!reportReady(env)) throw new RoomError('El canal de avisos aún no está configurado.', 503);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST || 'smtp.gmail.com', port: Number(env.SMTP_PORT || 465),
    secure: (env.SMTP_PORT || '465') === '465', requireTLS: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
  });
  const body = [
    'Aviso recibido desde el formulario público de DoradoTV.',
    'Tipo de aviso: ' + input.category,
    'Sala: ' + (input.room || 'Sin especificar'),
    'Referencia: ' + (input.resource || 'Sin especificar'),
    'Correo de contacto: ' + input.email,
    'Descripción:',
    input.details,
    '',
    'Revisar el aviso y actuar según proceda. No responder automáticamente con información de terceros.',
  ].join('\n');
  await transport.sendMail({
    from: { name: 'DoradoTV avisos', address: env.SMTP_USER },
    to: env.DORADO_REPORT_EMAIL,
    replyTo: input.email,
    subject: '[DoradoTV] Notificación de posible contenido ilícito',
    text: body,
  });
}
