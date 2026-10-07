import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { openDb } from './db.js';
import { Crm, HttpError, FIELD_TYPES, ACTIVITY_TYPES } from './crm.js';
import { ensureDefaultSchema } from './setup.js';
import { exportCsv, importCsv } from './transfer.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY = 10 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function routes(crm) {
  const r = [];
  const on = (method, pattern, handler) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    r.push({ method, regex, keys, handler });
  };

  on('GET', '/api/meta', () => ({ field_types: FIELD_TYPES, activity_types: ACTIVITY_TYPES }));
  on('GET', '/api/settings', () => crm.getSettings());
  on('PUT', '/api/settings', ({ body }) => crm.updateSettings(body));
  on('GET', '/api/dashboard', () => crm.dashboard());

  on('GET', '/api/objects', () => crm.listObjects());
  on('POST', '/api/objects', ({ body }) => [201, crm.createObject(body)]);
  on('PUT', '/api/objects/order', ({ body }) => crm.reorderObjects(body.ids ?? []));
  on('GET', '/api/objects/:object', ({ params }) => crm.getObject(params.object));
  on('PATCH', '/api/objects/:object', ({ params, body }) => crm.updateObject(params.object, body));
  on('DELETE', '/api/objects/:object', ({ params }) => (crm.deleteObject(params.object), [204]));

  on('POST', '/api/objects/:object/fields', ({ params, body }) => [201, crm.createField(params.object, body)]);
  on('PUT', '/api/objects/:object/fields/order', ({ params, body }) => crm.reorderFields(params.object, body.ids ?? []));
  on('PATCH', '/api/fields/:id', ({ params, body }) => crm.updateField(params.id, body));
  on('DELETE', '/api/fields/:id', ({ params }) => (crm.deleteField(params.id), [204]));

  on('GET', '/api/objects/:object/records', ({ params, query }) => {
    const filters = {};
    for (const [k, v] of query) {
      const m = /^filter\[(\w+)\]$/.exec(k);
      if (m) filters[m[1]] = v;
    }
    return crm.listRecords(params.object, {
      q: query.get('q'), sort: query.get('sort'), dir: query.get('dir'),
      limit: query.get('limit'), offset: query.get('offset'), filters,
    });
  });
  on('POST', '/api/objects/:object/records', ({ params, body }) => [201, crm.createRecord(params.object, body)]);
  on('GET', '/api/objects/:object/export.csv', ({ params }) => [200, exportCsv(crm, params.object), 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="${crm.getObject(params.object).slug}.csv"`,
  }]);
  on('POST', '/api/objects/:object/import', ({ params, body }) => importCsv(crm, params.object, body.csv ?? ''));

  on('GET', '/api/records/:id', ({ params }) => crm.getRecord(params.id));
  on('PATCH', '/api/records/:id', ({ params, body }) => crm.updateRecord(params.id, body));
  on('DELETE', '/api/records/:id', ({ params }) => (crm.deleteRecord(params.id), [204]));
  on('GET', '/api/records/:id/related', ({ params }) => crm.relatedRecords(params.id));

  on('GET', '/api/activities', ({ query }) => crm.listActivities({
    record_id: query.get('record_id') ?? undefined,
    type: query.get('type') ?? undefined,
    done: query.get('done') ?? undefined,
    limit: query.get('limit') ?? undefined,
  }));
  on('POST', '/api/activities', ({ body }) => [201, crm.createActivity(body)]);
  on('PATCH', '/api/activities/:id', ({ params, body }) => crm.updateActivity(params.id, body));
  on('DELETE', '/api/activities/:id', ({ params }) => (crm.deleteActivity(params.id), [204]));

  return r;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object') throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Request body must be a JSON object');
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  if (status === 204 || body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, ...headers }).end(payload);
}

function checkAuth(req, auth) {
  if (!auth) return true;
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) return false;
  const given = Buffer.from(Buffer.from(header.slice(6), 'base64').toString('utf8'));
  const expected = Buffer.from(`${auth.user}:${auth.password}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function serveStatic(pathname, res) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return send(res, 400, { error: 'Bad path' });
  }
  const file = resolve(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep)) return send(res, 404, { error: 'Not found' });
  try {
    const content = await readFile(file);
    send(res, 200, content, MIME[extname(file)] ?? 'application/octet-stream', { 'Cache-Control': 'no-cache' });
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

/** Creates the HTTP server. `auth` ({ user, password }) enables HTTP Basic auth. */
export function createServer(crm, { auth } = {}) {
  const table = routes(crm);
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
    if (!checkAuth(req, auth)) {
      return send(res, 401, { error: 'Authentication required' }, undefined, { 'WWW-Authenticate': 'Basic realm="CRM", charset="UTF-8"' });
    }

    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(url.pathname, res);
    }

    try {
      const route = table.find((x) => x.method === req.method && x.regex.test(url.pathname));
      if (!route) throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
      const match = route.regex.exec(url.pathname);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
      const result = await route.handler({ params, query: url.searchParams, body });
      if (Array.isArray(result) && typeof result[0] === 'number') send(res, ...result);
      else send(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Internal server error' });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbFile = process.env.CRM_DB ?? 'data/crm.db';
  const crm = new Crm(openDb(dbFile));
  if (ensureDefaultSchema(crm)) console.log('Created starter objects: Companies, Contacts, Deals');

  const { CRM_USER, CRM_PASSWORD } = process.env;
  const auth = CRM_PASSWORD ? { user: CRM_USER || 'admin', password: CRM_PASSWORD } : undefined;
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  createServer(crm, { auth }).listen(port, host, () => {
    console.log(`CRM running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port} (database: ${dbFile})`);
    if (!auth && host !== '127.0.0.1' && host !== 'localhost') {
      console.warn('Warning: listening on a public interface without a password. Set CRM_PASSWORD to require login.');
    }
  });
}
