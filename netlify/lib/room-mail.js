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
