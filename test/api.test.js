import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Crm } from '../src/crm.js';
import { createServer } from '../src/server.js';
import { genericSchema } from './fixtures.js';

let server;
let base;
let cookie = '';

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'X-CRM': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  const crm = new Crm(openDb(':memory:'));
  genericSchema(crm);
  crm.updateSettings({ allowed_origins: 'https://site.example' });
  server = createServer(crm);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  // First-run setup creates the account and signs in.
  const token = server.auth.setupToken;
  assert.ok(token);
  const bad = await call('POST', '/api/setup', { token: 'wrong', name: 'Me', email: 'me@x.io', password: 'correct horse battery' });
  assert.equal(bad.status, 403);
  const res = await call('POST', '/api/setup', { token, name: 'Me', email: 'me@x.io', password: 'correct horse battery' });
  assert.equal(res.status, 201);
  cookie = res.headers.get('set-cookie').split(';')[0];
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
});

after(() => server.close());

test('requires a session and the CSRF header', async () => {
  const anon = await fetch(`${base}/api/objects`);
  assert.equal(anon.status, 401);
  const session = await fetch(`${base}/api/session`).then((r) => r.json());
  assert.equal(session.user, null);
  assert.equal(session.needs_setup, false);
  assert.ok(session.branding.business_name);

  const noHeader = await fetch(`${base}/api/objects`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":"X"}' });
  assert.equal(noHeader.status, 403);
  assert.equal((await call('GET', '/api/session')).data.user.email, 'me@x.io');
  assert.equal((await call('POST', '/api/setup', { token: 'x' })).status, 409, 'setup only runs once');
});

test('login, logout and password changes', async () => {
  assert.equal((await call('POST', '/api/login', { email: 'me@x.io', password: 'nope' })).status, 401);
  const login = await call('POST', '/api/login', { email: 'ME@x.io', password: 'correct horse battery' });
  assert.equal(login.status, 200);
  const other = login.headers.get('set-cookie').split(';')[0];

  const changed = await call('POST', '/api/me/password', { current_password: 'correct horse battery', new_password: 'even better passphrase' });
  assert.equal(changed.status, 204);
  cookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/objects', null, { Cookie: other })).status, 401, 'other sessions are signed out');
  assert.equal((await call('GET', '/api/objects')).status, 200);

  const added = await call('POST', '/api/users', { name: 'Assistant', email: 'va@x.io', password: 'short' });
  assert.equal(added.status, 400);
  const ok = await call('POST', '/api/users', { name: 'Assistant', email: 'va@x.io', password: 'long enough password' });
  assert.equal(ok.status, 201);
  assert.equal((await call('GET', '/api/users')).data.length, 2);
  assert.equal((await call('DELETE', `/api/users/${ok.data.id}`)).status, 204);
});

test('record CRUD over HTTP', async () => {
  const created = await call('POST', '/api/objects/companies/records', { name: 'Acme' });
  assert.equal(created.status, 201);
  const id = created.data.id;
  const patched = await call('PATCH', `/api/records/${id}`, { city: 'Austin' });
  assert.equal(patched.data.data.city, 'Austin');
  const list = await call('GET', '/api/objects/companies/records?q=acm&filter[city]=Austin');
  assert.equal(list.data.total, 1);
  assert.equal((await call('DELETE', `/api/records/${id}`)).status, 204);
  assert.equal((await call('GET', `/api/records/${id}`)).status, 404);
});

test('errors are JSON with useful status codes', async () => {
  const bad = await call('POST', '/api/objects/deals/records', { name: 'x' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /Stage is required/);
  assert.equal((await call('GET', '/api/objects/nope')).status, 404);
  assert.equal((await call('GET', '/api/nothing')).status, 404);
  const res = await fetch(`${base}/api/objects`, { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json', 'X-CRM': '1', Cookie: cookie } });
  assert.equal(res.status, 400);
});

test('schema customization over HTTP', async () => {
  const obj = await call('POST', '/api/objects', { name: 'Vehicles', icon: '🚚' });
  assert.equal(obj.status, 201);
  const field = await call('POST', '/api/objects/vehicles/fields', { label: 'Mileage', type: 'number' });
  assert.equal(field.data.key, 'mileage');
  assert.equal((await call('DELETE', '/api/objects/vehicles')).status, 204);
});

test('CSV import and export', async () => {
  const imp = await call('POST', '/api/objects/companies/import', { csv: 'Name,City\nBluebird,Portland\n' });
  assert.equal(imp.data.created, 1);
  const res = await fetch(`${base}/api/objects/companies/export.csv`, { headers: { Cookie: cookie } });
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(await res.text(), /Bluebird,.*Portland/);
});

test('website form capture is limited to allowed origins', async () => {
  const payload = JSON.stringify({
    fields: { email: 'lead@vault.io', name: 'Lee', company: 'Vault' },
    touches: [{ at: new Date().toISOString(), source: 'google', medium: 'cpc', campaign: 'brand' }],
  });
  const blocked = await fetch(`${base}/t/submit`, { method: 'POST', body: payload, headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' } });
  assert.equal(blocked.status, 403);
  const noOrigin = await fetch(`${base}/t/submit`, { method: 'POST', body: payload });
  assert.equal(noOrigin.status, 403);

  const ok = await fetch(`${base}/t/submit`, { method: 'POST', body: payload, headers: { Origin: 'https://site.example', 'Content-Type': 'text/plain' } });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://site.example');

  const contacts = await call('GET', '/api/objects/contacts/records?q=lead@vault.io');
  assert.equal(contacts.data.total, 1);
  assert.equal(contacts.data.records[0].first_touch.channel, 'Paid search');

  const preflight = await fetch(`${base}/t/submit`, { method: 'OPTIONS', headers: { Origin: 'https://site.example' } });
  assert.equal(preflight.status, 204);
  const snippet = await fetch(`${base}/t/track.js`);
  assert.equal(snippet.status, 200);
  assert.match(snippet.headers.get('content-type'), /javascript/);
});

test('webhook requires the secret URL', async () => {
  const { data } = await call('GET', '/api/tracking');
  assert.match(data.snippet, /\/t\/track\.js/);
  const url = new URL(data.webhook_url);
  assert.equal((await fetch(`${base}/t/webhook/wrong-key`, { method: 'POST', body: '{"email":"a@b.io"}' })).status, 404);
  const res = await fetch(base + url.pathname, { method: 'POST', body: JSON.stringify({ email: 'cal@endly.io', name: 'Cal', channel: 'Podcast', source: 'Breach Point' }) });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.created, true);
  const journey = await call('GET', `/api/records/${body.contact_id}/journey`);
  assert.equal(journey.data.first.channel, 'Podcast');

  const rotated = await call('POST', '/api/tracking/rotate');
  assert.notEqual(rotated.data.webhook_url, data.webhook_url);
  assert.equal((await fetch(base + url.pathname, { method: 'POST', body: '{"email":"a@b.io"}' })).status, 404);
});

test('reports and touchpoints over HTTP', async () => {
  const c = await call('POST', '/api/objects/contacts/records', { name: 'Ana' });
  const tp = await call('POST', `/api/records/${c.data.id}/touchpoints`, { channel: 'Referral', source: 'Client CEO' });
  assert.equal(tp.status, 201);
  const report = await call('GET', '/api/reports/attribution?model=first_touch');
  assert.ok(report.data.rows.some((r) => r.key === 'Referral' && r.leads === 1));
  assert.equal((await call('GET', '/api/reports/attribution?model=bogus')).status, 400);
  const funnel = await call('GET', '/api/reports/funnel?object=deals');
  assert.equal(funnel.status, 200);
  assert.equal((await call('DELETE', `/api/touchpoints/${tp.data.id}`)).status, 204);
});

test('backup download is a SQLite database', async () => {
  const res = await fetch(`${base}/api/backup`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
});

test('serves the app and blocks path traversal', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<main id="main"/);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/src/server.js`)).status, 404);
});
