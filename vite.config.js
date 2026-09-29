import { defineConfig } from 'vite';
import netlify from '@netlify/vite-plugin';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(import.meta.dirname, '.env');
if (existsSync(envPath)) {
  const content = readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w.-]+)=(.*)$/);
    if (match) {
      const key = match[1];
      const val = match[2].trim().replace(/^['"]|['"]$/g, '');
      process.env[key] = val;
    }
  }
}

export default defineConfig({
  root: import.meta.dirname,
  envDir: import.meta.dirname,
  plugins: [netlify({ edgeFunctions: { enabled: false } })],
});
