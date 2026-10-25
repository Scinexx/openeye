// OpenEye on Cloudflare Workers.
//   fetch      serves /api/* from D1 (everything else is a static asset from public/)
//   scheduled  runs the collector from the Cron Trigger in wrangler.jsonc
import {loadSettings} from './core/settings.js';
import {ensureSchema} from './core/schema.js';
import {makeApi, handleApiRequest, SECURITY_HEADERS} from './core/site.js';
import {Collector} from './core/collector.js';
import items from '../public/catalog/items.json';

const API_CACHE_SECONDS = 30;
let ready = null;
// Create tables on first use in each isolate; idempotent and cheap.
const init = env => (ready ??= ensureSchema(env.DB).catch(e => { ready = null; throw e; }));

async function allowed(env, key) {
  if (!env.API_LIMIT) return true;
  const {success} = await env.API_LIMIT.limit({key});
  return success;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await allowed(env, ip))) {
      return new Response(JSON.stringify({error: 'Too many requests. Try again in a minute.'}), {
        status: 429, headers: {...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8', 'retry-after': '60'}
      });
    }

    // Short edge cache so a busy page does not hit the database for every visitor.
    const cache = caches.default;
    const cacheable = request.method === 'GET';
    if (cacheable) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    await init(env);
    const api = makeApi(env.DB, {items}, loadSettings(env));
    const response = await handleApiRequest(request, {api, allow: () => true, clientKey: ip});
    if (cacheable && response.status === 200) {
      const cached = new Response(response.body, response);
      cached.headers.set('cache-control', `public, max-age=${API_CACHE_SECONDS}`);
      ctx.waitUntil(cache.put(request, cached.clone()));
      return cached;
    }
    return response;
  },

  async scheduled(controller, env, ctx) {
    await init(env);
    const collector = new Collector(env.DB, loadSettings(env));
    ctx.waitUntil(collector.tick());
  }
};
