/**
 * Small backend for the Kroger integration. The Kroger client secret must never
 * ship to the browser, so the app calls these endpoints and this server talks to
 * api.kroger.com with the client-credentials grant.
 *
 *   GET  /api/kroger/status
 *   GET  /api/kroger/locations?zip=45202
 *   GET  /api/kroger/products?term=milk&locationId=01400943
 *   POST /api/kroger/deals   { locationId, terms: ["chicken", "broccoli"] }
 *
 * In production it also serves the built app from ./dist.
 */
import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestDeal, normalizeProduct } from './deals.mjs';

try {
  process.loadEnvFile?.();
} catch {
  // No .env file; rely on the real environment.
}

const API = 'https://api.kroger.com/v1';
const { KROGER_CLIENT_ID, KROGER_CLIENT_SECRET } = process.env;
const PORT = Number(process.env.PORT ?? 8787);
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const CACHE_MS = 6 * 60 * 60 * 1000;

let token = null; // { value, expiresAt }
const cache = new Map(); // key -> { at, value }

async function getToken() {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const basic = Buffer.from(`${KROGER_CLIENT_ID}:${KROGER_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=product.compact',
  });
  if (!res.ok) throw new Error(`Kroger auth failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

async function kroger(path, params) {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await getToken()}`, Accept: 'application/json' } });
  if (res.status === 401) token = null;
  if (!res.ok) throw new Error(`Kroger ${path} failed: ${res.status} ${await res.text()}`);
  const value = await res.json();
  cache.set(url, { at: Date.now(), value });
  return value;
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 100_000) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > limit) throw new Error('Body too large');
  }
  return data ? JSON.parse(data) : {};
}

/** When APP_KEY is set, every API call except the status checks must send it as x-app-key. */
function authorized(req) {
  const key = process.env.APP_KEY;
  if (!key) return true;
  const given = Buffer.from(String(req.headers['x-app-key'] ?? ''));
  const want = Buffer.from(key);
  return given.length === want.length && timingSafeEqual(given, want);
}

async function handleApi(req, res, url) {
  if (!url.pathname.endsWith('/status') && !authorized(req)) {
    return send(res, 401, { error: 'Wrong or missing access key. Enter it in Settings.' });
  }
  const configured = Boolean(KROGER_CLIENT_ID && KROGER_CLIENT_SECRET);
  if (url.pathname === '/api/kroger/status') return send(res, 200, { configured });
  if (!configured) return send(res, 503, { error: 'Set KROGER_CLIENT_ID and KROGER_CLIENT_SECRET in .env' });

  if (url.pathname === '/api/kroger/locations') {
    const zip = url.searchParams.get('zip') ?? '';
    if (!/^\d{5}$/.test(zip)) return send(res, 400, { error: 'zip must be 5 digits' });
    const json = await kroger('/locations', { 'filter.zipCode.near': zip, 'filter.limit': '10' });
    return send(
      res,
      200,
      json.data.map((l) => ({
        locationId: l.locationId,
        name: l.name,
        chain: l.chain,
        address: `${l.address.addressLine1}, ${l.address.city}, ${l.address.state} ${l.address.zipCode}`,
      })),
    );
  }

  if (url.pathname === '/api/kroger/products') {
    const term = url.searchParams.get('term');
    const locationId = url.searchParams.get('locationId');
    if (!term || !locationId) return send(res, 400, { error: 'term and locationId are required' });
    const json = await kroger('/products', { 'filter.term': term, 'filter.locationId': locationId, 'filter.limit': '20' });
    return send(res, 200, json.data.map(normalizeProduct));
  }

  if (url.pathname === '/api/kroger/deals' && req.method === 'POST') {
    const { locationId, terms } = await readBody(req);
    if (!locationId || !Array.isArray(terms)) return send(res, 400, { error: 'locationId and terms[] are required' });
    const unique = [...new Set(terms.map((t) => String(t).toLowerCase().trim()).filter(Boolean))].slice(0, 40);
    const deals = {};
    // Sequential on purpose: the public API is rate limited and results are cached anyway.
    for (const term of unique) {
      try {
        const json = await kroger('/products', { 'filter.term': term, 'filter.locationId': locationId, 'filter.limit': '20' });
        deals[term] = bestDeal(json.data);
      } catch (e) {
        deals[term] = null;
        console.error(e.message);
      }
    }
    return send(res, 200, { deals });
  }

  return send(res, 404, { error: 'Not found' });
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.gz': 'application/gzip',
  '.json': 'application/json',
};

async function serveStatic(res, pathname) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'Forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // SPA fallback
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    send(res, 404, { error: 'Build the app first: npm run build' });
  }
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await serveStatic(res, url.pathname);
    } catch (e) {
      console.error(e);
      send(res, 502, { error: e.message });
    }
  })
  .listen(PORT, () => {
    console.log(`Grocery server on http://localhost:${PORT} (Kroger ${KROGER_CLIENT_ID ? 'configured' : 'NOT configured'})`);
  });
