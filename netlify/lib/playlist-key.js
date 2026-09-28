import { randomBytes } from 'node:crypto';
import { getDatabase } from '@netlify/database';

export async function getPlaylistKey(db = getDatabase()) {
  const generated = randomBytes(32).toString('base64');
  await db.sql`INSERT INTO app_settings (name, value) VALUES ('playlist_key', ${generated}) ON CONFLICT (name) DO NOTHING`;
  const rows = await db.sql`SELECT value FROM app_settings WHERE name = 'playlist_key'`;
  return rows[0].value;
}
