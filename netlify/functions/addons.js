import { randomUUID } from 'node:crypto';
import { roomStore, RoomError, read, mutate } from '../lib/room-store.js';
import { RoomsService, normalizeRoom } from '../lib/rooms-service.js';
import { masterKey, identity, requireOrigin, boundedJson, rateLimit, seal, unseal, privateId } from '../lib/room-security.js';
import { manifestUrl, safeJson, normalizeManifest, supports, resourceUrl, metaPreview, streamView, subtitleView } from '../lib/stremio-addon.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const validText = (value, max = 180) => typeof value === 'string' && value.length > 0 && value.length <= max;
const stateKey = (slug) => `addons/${slug}`;
const publicAddon = ({ id, manifest }) => ({ id, manifest });
const urlFor = (addon, slug, env) => unseal(addon.location, `addon:${slug}:${addon.id}`, env);
const selectAddon = (addons, id) => {
  const addon = addons.find((a) => a.id === id);
  if (!addon) throw new RoomError('Addon no instalado en la sala.', 404);
  return addon;
};
const itemIdentifier = (v) => {
  if (!validText(v)) throw new RoomError('Identificador inválido.');
  return v;
};

export function createAddonsHandler({ getStore = roomStore, env = process.env, fetchJson = safeJson, clock = () => Math.floor(Date.now() / 1000) } = {}) {
  return async (request, context = {}) => {
    try {
      masterKey(env);
      const parsed = new URL(request.url), action = parsed.searchParams.get('action');
      const input = request.method === 'POST' ? (requireOrigin(request), await boundedJson(request)) : {};
      if (!['GET', 'POST'].includes(request.method)) throw new RoomError('Método no permitido.', 405);
      const slug = normalizeRoom(input.room ?? parsed.searchParams.get('room'));
      const store = getStore();
      const who = await identity(store, request, clock());
      const service = new RoomsService(store, { env, clock });
      const ownerOnly = ['install', 'remove'].includes(action);
      await service.access(slug, who, ownerOnly);
      const ip = context.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
      const actor = who.sessionId || ip;
      if (action === 'list' && request.method === 'GET') {
        const state = await read(store, stateKey(slug));
        return json({ addons: (state?.addons || []).map(publicAddon), owner: !!who.account && (await service.access(slug, who)).ownerId === who.account.id });
      }
      if (request.method !== 'POST') throw new RoomError('Método no permitido.', 405);
      await rateLimit(store, `addon:${actor}`, ownerOnly ? 20 : 120, 300, clock());
      if (action === 'install') {
        await rateLimit(store, `addon-install:${actor}`, 20, 3600, clock());
        const location = manifestUrl(input.url);
        const manifest = normalizeManifest(await fetchJson(location));
        const id = randomUUID();
        const fingerprint = privateId(location, env);
        const entry = { id, fingerprint, manifest, location: seal(location, `addon:${slug}:${id}`, env) };
        await mutate(store, stateKey(slug), (state) => {
          const addons = state?.addons || [];
          if (addons.length >= 8) throw new RoomError('Máximo de 8 addons por sala.', 409);
          if (addons.some((a) => a.fingerprint === fingerprint)) throw new RoomError('Ese addon ya está instalado.', 409);
          return { addons: [...addons, entry] };
        });
        return json({ addon: publicAddon(entry) }, 201);
      }
      if (action === 'remove') {
        const addonId = itemIdentifier(input.addonId, 100);
        await mutate(store, stateKey(slug), (state) => {
          const addons = state?.addons || [];
          if (!addons.some((a) => a.id === addonId)) throw new RoomError('Addon no instalado.', 404);
          return { addons: addons.filter((a) => a.id !== addonId) };
        });
        return json({ ok: true });
      }
      const addons = (await read(store, stateKey(slug)))?.addons || [];
      if (action === 'catalog') {
        const addon = selectAddon(addons, itemIdentifier(input.addonId, 100));
        const type = input.type, id = itemIdentifier(input.catalogId);
        const catalog = addon.manifest.catalogs.find((c) => c.type === type && c.id === id);
        if (!catalog || !supports(addon.manifest, 'catalog', type)) throw new RoomError('Catálogo no disponible.', 404);
        const search = typeof input.search === 'string' ? input.search.trim().slice(0, 100) : '';
        if (search && !catalog.search) throw new RoomError('Este catálogo no permite búsquedas.', 400);
        if (!search && catalog.searchRequired) throw new RoomError('Este catálogo requiere una búsqueda.', 400);
        if (catalog.required) throw new RoomError('Este catálogo requiere filtros no disponibles.', 400);
        const extra = {};
        if (search) extra.search = search;
        if (input.skip !== undefined && input.skip !== null) {
          if (!Number.isSafeInteger(input.skip) || input.skip < 0 || input.skip > 10000) throw new RoomError('Página inválida.');
          if (input.skip) extra.skip = String(input.skip);
        }
        const data = await fetchJson(resourceUrl(urlFor(addon, slug, env), 'catalog', type, id, extra));
        return json({ metas: (Array.isArray(data.metas) ? data.metas : []).slice(0, 100).map(metaPreview).filter(Boolean) });
      }
      if (action === 'meta') {
        const type = input.type, id = itemIdentifier(input.id);
        const primary = addons.find((a) => a.id === input.addonId);
        const candidates = [primary, ...addons.filter((a) => a !== primary)].filter((a) => a && supports(a.manifest, 'meta', type, id));
        for (const addon of candidates) {
          try {
            const data = await fetchJson(resourceUrl(urlFor(addon, slug, env), 'meta', type, id));
            const meta = metaPreview(data.meta);
            if (meta) return json({ meta });
          } catch { /* try next metadata source */ }
        }
        throw new RoomError('No hay información adicional para este título.', 404);
      }
      if (action === 'streams' || action === 'subtitles') {
        const type = input.type, id = itemIdentifier(input.id);
        const resource = action === 'streams' ? 'stream' : 'subtitles';
        const candidates = addons.filter((a) => supports(a.manifest, resource, type, id));
        const results = await Promise.all(candidates.map(async (addon) => {
          try {
            const data = await fetchJson(resourceUrl(urlFor(addon, slug, env), resource, type, id));
            const items = action === 'streams'
              ? (Array.isArray(data.streams) ? data.streams : []).slice(0, 30).map((s) => streamView(s, addon.manifest.name)).filter(Boolean)
              : (Array.isArray(data.subtitles) ? data.subtitles : []).slice(0, 30).map(subtitleView).filter(Boolean);
            return { items };
          } catch (error) {
            return { items: [], warning: { addon: addon.manifest.name, reason: error instanceof RoomError ? error.message : 'No se pudo conectar con el addon.' } };
          }
        }));
        if (action === 'streams') return json({
          streams: results.flatMap(({ items }) => items).slice(0, 80),
          warnings: results.flatMap(({ warning }) => warning ? [warning] : []),
        });
        return json({ subtitles: results.flatMap(({ items }) => items).slice(0, 80) });
      }
      throw new RoomError('Ruta no encontrada.', 404);
    } catch (error) {
      if (error instanceof RoomError) return json({ error: error.message }, error.status);
      return json({ error: 'No se pudo consultar el addon. Inténtalo de nuevo.' }, 503);
    }
  };
}
export default createAddonsHandler();
