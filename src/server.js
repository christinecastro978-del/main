import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDb } from './db.js';
import { Crm, HttpError, FIELD_TYPES, ACTIVITY_TYPES } from './crm.js';
import { Attribution, MODELS, GROUPS } from './attribution.js';
import { Auth, rateLimiter, SESSION_MAX_AGE } from './auth.js';
import { captureLead, webhookKey, rotateWebhookKey, webhookPayload } from './capture.js';
import { ensureDefaultSchema } from './setup.js';
import { exportCsv, importCsv } from './transfer.js';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public', import.meta.url)));
const MAX_BODY = 10 * 1024 * 1024;
const MAX_PUBLIC_BODY = 64 * 1024;
const COOKIE = 'crm_session';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function routes({ crm, attribution, auth }) {
  const r = [];
  const on = (method, pattern, handler, { open = false } = {}) => {
    const keys = [];
    const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    r.push({ method, regex, keys, handler, open });
  };

  // ------------------------------------------------------------ session
  on('GET', '/api/session', ({ user }) => {
    const { business_name: name, accent_color: color } = crm.getSettings();
    return { user, needs_setup: auth.userCount() === 0, branding: { business_name: name, accent_color: color } };
  }, { open: true });
  on('POST', '/api/login', ({ body, limit, setSession }) => {
    if (!limit('login')) throw new HttpError(429, 'Too many sign-in attempts. Try again in a few minutes.');
    const { token, user } = auth.login(body.email, body.password);
    setSession(token);
    return { user };
  }, { open: true });
  on('POST', '/api/setup', ({ body, limit, setSession }) => {
    if (!limit('login')) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const user = auth.setup(body);
    setSession(auth.login(user.email, body.password).token);
    return [201, { user }];
  }, { open: true });
  on('POST', '/api/logout', ({ token, setSession }) => {
    auth.logout(token);
    setSession(null);
    return [204];
  }, { open: true });
  on('POST', '/api/me/password', ({ user, body, setSession }) => {
    setSession(auth.changePassword(user.id, body.current_password, body.new_password));
    return [204];
  });

  on('GET', '/api/users', () => auth.listUsers());
  on('POST', '/api/users', ({ body }) => [201, auth.createUser(body)]);
  on('DELETE', '/api/users/:id', ({ params, user }) => (auth.deleteUser(params.id, user.id), [204]));

  // ------------------------------------------------------------- schema
  on('GET', '/api/meta', () => ({ field_types: FIELD_TYPES, activity_types: ACTIVITY_TYPES, models: MODELS, groups: GROUPS }));
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

  // ------------------------------------------------------------ records
  on('GET', '/api/objects/:object/records', ({ params, query }) => {
    const filters = {};
    for (const [k, v] of query) {
      const m = /^filter\[(\w+)\]$/.exec(k);
      if (m) filters[m[1]] = v;
    }
    const result = crm.listRecords(params.object, {
      q: query.get('q'), sort: query.get('sort'), dir: query.get('dir'),
      limit: query.get('limit'), offset: query.get('offset'), filters,
    });
    // People and deals show where they came from.
    const { contacts, deals } = attribution.config();
    if ([contacts?.slug, deals?.slug].includes(crm.getObject(params.object).slug)) {
      const firsts = attribution.firstTouches(crm.getObject(params.object).slug, result.records);
      for (const rec of result.records) rec.first_touch = firsts.get(rec.id) ?? null;
    }
    return result;
  });
  on('POST', '/api/objects/:object/records', ({ params, body }) => [201, crm.createRecord(params.object, body)]);
  on('GET', '/api/objects/:object/export.csv', ({ params }) => [200, exportCsv(crm, params.object), 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="${crm.getObject(params.object).slug}.csv"`,
  }]);
  on('POST', '/api/objects/:object/import', ({ params, body }) => importCsv(crm, params.object, body.csv ?? '', attribution));

  on('GET', '/api/records/:id', ({ params }) => crm.getRecord(params.id));
  on('PATCH', '/api/records/:id', ({ params, body }) => crm.updateRecord(params.id, body));
  on('DELETE', '/api/records/:id', ({ params }) => (crm.deleteRecord(params.id), [204]));
  on('GET', '/api/records/:id/related', ({ params }) => crm.relatedRecords(params.id));
  on('GET', '/api/records/:id/journey', ({ params, query }) => attribution.journey(params.id, query.get('model') || undefined));
  on('POST', '/api/records/:id/touchpoints', ({ params, body }) => [201, attribution.addTouchpoint(params.id, body)]);
  on('DELETE', '/api/touchpoints/:id', ({ params }) => (attribution.deleteTouchpoint(params.id), [204]));

  on('GET', '/api/activities', ({ query }) => crm.listActivities({
    record_id: query.get('record_id') ?? undefined,
    type: query.get('type') ?? undefined,
    done: query.get('done') ?? undefined,
    limit: query.get('limit') ?? undefined,
  }));
  on('POST', '/api/activities', ({ body }) => [201, crm.createActivity(body)]);
  on('PATCH', '/api/activities/:id', ({ params, body }) => crm.updateActivity(params.id, body));
  on('DELETE', '/api/activities/:id', ({ params }) => (crm.deleteActivity(params.id), [204]));

  // ------------------------------------------------------------ reports
  on('GET', '/api/reports/attribution', ({ query }) => attribution.report({
    from: query.get('from') || undefined, to: query.get('to') || undefined,
    model: query.get('model') || undefined, group_by: query.get('group_by') || undefined,
  }));
  on('GET', '/api/reports/funnel', ({ query }) => attribution.funnel(query.get('object') ?? '', {
    from: query.get('from') || undefined, to: query.get('to') || undefined,
  }));

  // ----------------------------------------------------------- tracking
  on('GET', '/api/tracking', ({ baseUrl }) => ({
    snippet: `<script src="${baseUrl}/t/track.js" defer></script>`,
    webhook_url: `${baseUrl}/t/webhook/${webhookKey(crm)}`,
    allowed_origins: crm.settingList('allowed_origins'),
  }));
  on('POST', '/api/tracking/rotate', ({ baseUrl }) => ({ webhook_url: `${baseUrl}/t/webhook/${rotateWebhookKey(crm)}` }));

  on('GET', '/api/backup', () => {
    const file = join(tmpdir(), `crm-backup-${randomBytes(6).toString('hex')}.db`);
    crm.db.prepare('VACUUM INTO ?').run(file);
    const stamp = new Date().toISOString().slice(0, 10);
    return { stream: file, filename: `crm-backup-${stamp}.db` };
  });

  return r;
}

async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
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

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function serveStatic(pathname, res, extraHeaders = {}) {
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
    send(res, 200, content, MIME[extname(file)] ?? 'application/octet-stream', { 'Cache-Control': 'no-cache', ...extraHeaders });
  } catch {
    send(res, 404, { error: 'Not found' });
  }
}

/**
 * Creates the HTTP server.
 *   trustProxy    - read client IP and protocol from X-Forwarded-* (set when behind a proxy/load balancer)
 *   secureCookies - always mark the session cookie Secure
 */
export function createServer(crm, { trustProxy = false, secureCookies = false } = {}) {
  const attribution = new Attribution(crm);
  const auth = new Auth(crm.db);
  const table = routes({ crm, attribution, auth });
  const limits = {
    login: rateLimiter({ windowMs: 15 * 60000, max: 10 }),
    submit: rateLimiter({ windowMs: 10 * 60000, max: 30 }),
    webhook: rateLimiter({ windowMs: 60000, max: 120 }),
  };

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    const ip = (trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress;
    const https = secureCookies || (trustProxy && req.headers['x-forwarded-proto'] === 'https');
    const baseUrl = `${https ? 'https' : 'http'}://${(trustProxy && req.headers['x-forwarded-host']) || req.headers.host}`;

    try {
      // ---------------------------------------------- public tracking
      if (url.pathname === '/health') return send(res, 200, { ok: true });
      if (url.pathname === '/t/track.js' && req.method === 'GET') {
        return serveStatic('/track.js', res, { 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' });
      }
      if (url.pathname === '/t/submit') {
        const origin = req.headers.origin;
        const allowed = crm.settingList('allowed_origins');
        if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'Origin not allowed. Add it under Settings → Attribution & tracking.');
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        if (req.method === 'OPTIONS') {
          return send(res, 204, undefined, undefined, { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' });
        }
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        if (!limits.submit(ip)) throw new HttpError(429, 'Too many submissions');
        captureLead(crm, attribution, await readBody(req, MAX_PUBLIC_BODY), { origin: 'website' });
        return send(res, 204);
      }
      const hook = /^\/t\/webhook\/([\w-]+)$/.exec(url.pathname);
      if (hook) {
        if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
        if (!limits.webhook(ip)) throw new HttpError(429, 'Too many requests');
        if (hook[1] !== webhookKey(crm)) throw new HttpError(404, 'Unknown webhook');
        return send(res, 200, captureLead(crm, attribution, webhookPayload(await readBody(req, MAX_PUBLIC_BODY)), { origin: 'webhook' }));
      }

      // --------------------------------------------------------- app
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
        return serveStatic(url.pathname, res);
      }

      const route = table.find((x) => x.method === req.method && x.regex.test(url.pathname));
      if (!route) throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);

      // CSRF: state-changing calls must carry a header that only our own
      // same-origin JavaScript can set without a CORS preflight.
      if (req.method !== 'GET' && req.headers['x-crm'] !== '1') throw new HttpError(403, 'Missing X-CRM header');

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = auth.sessionUser(token);
      if (!route.open && !user) throw new HttpError(401, 'Please sign in');

      const match = route.regex.exec(url.pathname);
      const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req, MAX_BODY) : {};
      const setSession = (value) => {
        const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', https ? 'Secure' : null].filter(Boolean);
        res.setHeader('Set-Cookie', value
          ? `${COOKIE}=${value}; Max-Age=${SESSION_MAX_AGE}; ${attrs.join('; ')}`
          : `${COOKIE}=; Max-Age=0; ${attrs.join('; ')}`);
      };
      const result = await route.handler({
        params, query: url.searchParams, body, user, token, baseUrl, setSession,
        limit: (name) => limits[name](ip),
      });
      if (result?.stream) {
        const { size } = await stat(result.stream);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': size,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
        });
        createReadStream(result.stream).pipe(res).on('close', () => rm(result.stream, { force: true }));
        return;
      }
      if (Array.isArray(result) && typeof result[0] === 'number') send(res, ...result);
      else send(res, 200, result);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Internal server error' });
    }
  });
  server.auth = auth;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbFile = process.env.CRM_DB ?? 'data/crm.db';
  const crm = new Crm(openDb(dbFile));
  if (ensureDefaultSchema(crm)) console.log('Created the starter record types.');

  const flag = (name) => /^(1|true|yes)$/i.test(process.env[name] ?? '');
  const server = createServer(crm, { trustProxy: flag('TRUST_PROXY'), secureCookies: flag('SECURE_COOKIES') });

  const { CRM_ADMIN_EMAIL, CRM_ADMIN_PASSWORD, CRM_ADMIN_NAME } = process.env;
  if (!server.auth.userCount() && CRM_ADMIN_EMAIL && CRM_ADMIN_PASSWORD) {
    server.auth.createUser({ email: CRM_ADMIN_EMAIL, password: CRM_ADMIN_PASSWORD, name: CRM_ADMIN_NAME || CRM_ADMIN_EMAIL.split('@')[0] });
    console.log(`Created admin account ${CRM_ADMIN_EMAIL}.`);
  }

  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? '127.0.0.1';
  server.listen(port, host, () => {
    const shown = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`CRM running at ${shown} (database: ${dbFile})`);
    if (server.auth.setupToken) {
      console.log(`\nNo accounts yet. Create yours at:\n  ${shown}/#/setup?token=${server.auth.setupToken}\n(On a hosted server, replace the address with your CRM's URL.)\n`);
    }
  });
}
