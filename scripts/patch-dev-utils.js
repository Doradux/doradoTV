import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = join(__dirname, '../node_modules/@netlify/dev-utils/dist/main.js');

if (existsSync(target)) {
  let content = readFileSync(target, 'utf8');
  const broken = `webRes.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });`;
  const fixed = `if (typeof webRes.headers?.getSetCookie === 'function') {
    webRes.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'set-cookie') res.setHeader(name, value);
    });
    const cookies = webRes.headers.getSetCookie();
    if (cookies?.length) res.setHeader('set-cookie', cookies);
  } else {
    webRes.headers.forEach((value, name) => {
      res.setHeader(name, value);
    });
  }`;
  if (content.includes(broken)) {
    content = content.replace(broken, fixed);
    writeFileSync(target, content, 'utf8');
    console.log('[patch] Patched @netlify/dev-utils Set-Cookie handling.');
  }
}
