import { createServer } from 'node:http';
import { createAddonHandler } from './addon.js';

const handler = createAddonHandler({
  token: process.env.ADDON_TOKEN,
  torznabUrl: process.env.TORZNAB_URL,
  torznabKey: process.env.TORZNAB_API_KEY,
  sourcePath: process.env.SOURCES_FILE,
});
const port = Number(process.env.PORT || 5310);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('PORT inválido.');
const server = createServer((request, response) => {
  Promise.resolve(handler(request, response)).catch((error) => {
    console.error('Error inesperado en el addon:', error.message);
    if (!response.headersSent) {
      response.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: 'Servicio no disponible' }));
    } else response.destroy();
  });
});
server.listen(port, '0.0.0.0', () => console.log('DoradoTV self-hosted addon listening on port ' + port));
