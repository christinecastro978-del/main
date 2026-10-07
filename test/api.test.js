import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Crm } from '../src/crm.js';
import { ensureDefaultSchema } from '../src/setup.js';
import { createServer } from '../src/server.js';

let server;
let base;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  const crm = new Crm(openDb(':memory:'));
  ensureDefaultSchema(crm);
  server = createServer(crm);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

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

  const res = await fetch(`${base}/api/objects`, { method: 'POST', body: 'not json', headers: { 'Content-Type': 'application/json' } });
  assert.equal(res.status, 400);
});

test('schema customization over HTTP', async () => {
  const obj = await call('POST', '/api/objects', { name: 'Vehicles', icon: '🚚' });
  assert.equal(obj.status, 201);
  const field = await call('POST', '/api/objects/vehicles/fields', { label: 'Mileage', type: 'number' });
  assert.equal(field.data.key, 'mileage');
  const objects = await call('GET', '/api/objects');
  assert.ok(objects.data.some((o) => o.slug === 'vehicles' && o.fields.length === 2));
  assert.equal((await call('DELETE', '/api/objects/vehicles')).status, 204);
});

test('CSV import and export', async () => {
  const imp = await call('POST', '/api/objects/companies/import', { csv: 'Name,City\nBluebird,Portland\n' });
  assert.equal(imp.data.created, 1);
  const res = await fetch(`${base}/api/objects/companies/export.csv`);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(await res.text(), /Bluebird,.*Portland/);
});

test('serves the app and blocks path traversal', async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /<main id="main"/);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/src/server.js`)).status, 404);
});

test('basic auth when a password is configured', async () => {
  const crm = new Crm(openDb(':memory:'));
  const secured = createServer(crm, { auth: { user: 'admin', password: 's3cret' } });
  await new Promise((resolve) => secured.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${secured.address().port}/api/settings`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const wrong = Buffer.from('admin:nope').toString('base64');
    assert.equal((await fetch(url, { headers: { Authorization: `Basic ${wrong}` } })).status, 401);
    const right = Buffer.from('admin:s3cret').toString('base64');
    assert.equal((await fetch(url, { headers: { Authorization: `Basic ${right}` } })).status, 200);
  } finally {
    secured.close();
  }
});
