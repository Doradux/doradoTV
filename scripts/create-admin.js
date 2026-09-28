import { getDatabase } from '@netlify/database';
import { hashPassword, validUsername } from '../netlify/lib/auth.js';

const username = process.argv[2];
const password = process.env.DORADO_ADMIN_PASSWORD;
if (!validUsername(username) || !password) {
  process.stderr.write('Uso: DORADO_ADMIN_PASSWORD=<contraseña> npm run admin:create -- <usuario>\n');
  process.exit(1);
}

const db = getDatabase(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined);
const passwordHash = await hashPassword(password);
const existing = await db.sql`SELECT id FROM app_users WHERE username = ${username}`;
if (existing.length) {
  await db.sql`UPDATE app_users SET password_hash = ${passwordHash}, failed_logins = 0, locked_until = NULL WHERE username = ${username}`;
  await db.sql`DELETE FROM app_sessions WHERE user_id = ${existing[0].id}`;
  process.stdout.write('Contraseña del administrador actualizada y sesiones cerradas.\n');
} else {
  await db.sql`INSERT INTO app_users (username, password_hash, role) VALUES (${username}, ${passwordHash}, 'admin')`;
  process.stdout.write('Administrador creado en la base de datos.\n');
}
