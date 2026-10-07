import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Crm } from '../src/crm.js';
import { ensureDefaultSchema } from '../src/setup.js';
import { exportCsv, importCsv } from '../src/transfer.js';
import { parseCsv, toCsv } from '../src/csv.js';

let crm;
beforeEach(() => {
  crm = new Crm(openDb(':memory:'));
  ensureDefaultSchema(crm);
});

test('default schema has companies, contacts and deals', () => {
  const slugs = crm.listObjects().map((o) => o.slug);
  assert.deepEqual(slugs, ['companies', 'contacts', 'deals']);
  const deals = crm.getObject('deals');
  assert.equal(deals.board_field, 'stage');
  assert.equal(deals.value_field, 'value');
  assert.equal(ensureDefaultSchema(crm), false, 'does not re-seed');
});

test('records are validated and coerced against field types', () => {
  const co = crm.createRecord('companies', { name: '  Acme  ', website: 'acme.example', industry: 'technology' });
  assert.equal(co.data.name, 'Acme');
  assert.equal(co.data.website, 'https://acme.example');
  assert.equal(co.data.industry, 'Technology', 'select matches case-insensitively');

  const deal = crm.createRecord('deals', { name: 'Big one', stage: 'New', value: '$1,234.567', company: co.id, close_date: '2026-12-01' });
  assert.equal(deal.data.value, 1234.57);
  assert.deepEqual(deal.refs.company, { id: co.id, object: 'companies', title: 'Acme' });

  assert.throws(() => crm.createRecord('deals', { name: 'x' }), /Stage is required/);
  assert.throws(() => crm.createRecord('deals', { name: 'x', stage: 'Nope' }), /must be one of/);
  assert.throws(() => crm.createRecord('deals', { name: 'x', stage: 'New', value: 'lots' }), /must be a number/);
  assert.throws(() => crm.createRecord('deals', { name: 'x', stage: 'New', company: 99999 }), /not found/);
  assert.throws(() => crm.createRecord('contacts', { name: 'x', email: 'not-an-email' }), /valid email/);
  assert.throws(() => crm.createRecord('companies', { name: 'x', website: 'javascript:alert(1)' }), /http/);
});

test('updates merge data and clearing a value removes it', () => {
  const c = crm.createRecord('contacts', { name: 'Maya', email: 'MAYA@x.example', tags: 'vip; referral' });
  assert.equal(c.data.email, 'maya@x.example');
  assert.deepEqual(c.data.tags, ['VIP', 'Referral']);
  const u = crm.updateRecord(c.id, { email: '', status: 'Customer' });
  assert.equal(u.data.name, 'Maya');
  assert.equal(u.data.status, 'Customer');
  assert.equal('email' in u.data, false);
  assert.throws(() => crm.updateRecord(c.id, { name: '' }), /Name is required/);
});

test('list supports search, filters, sorting and paging', () => {
  for (const [name, status] of [['Charlie', 'Lead'], ['alice', 'Customer'], ['Bob', 'Lead'], ['100% Dan', 'Lead']]) {
    crm.createRecord('contacts', { name, status });
  }
  assert.deepEqual(crm.listRecords('contacts', { sort: 'name' }).records.map((r) => r.title), ['100% Dan', 'alice', 'Bob', 'Charlie']);
  assert.deepEqual(crm.listRecords('contacts', { sort: 'name', dir: 'desc', limit: 2 }).records.map((r) => r.title), ['Charlie', 'Bob']);
  assert.equal(crm.listRecords('contacts', { filters: { status: 'Lead' } }).total, 3);
  assert.deepEqual(crm.listRecords('contacts', { q: 'LIC' }).records.map((r) => r.title), ['alice']);
  assert.equal(crm.listRecords('contacts', { q: '%' }).total, 1, 'LIKE wildcards are escaped');
  assert.throws(() => crm.listRecords('contacts', { sort: 'nope' }), /Unknown sort field/);
});

test('related records and relation cleanup on delete', () => {
  const co = crm.createRecord('companies', { name: 'Acme' });
  const ct = crm.createRecord('contacts', { name: 'Sam', company: co.id });
  crm.createRecord('deals', { name: 'D1', stage: 'New', company: co.id, contact: ct.id });

  const related = crm.relatedRecords(co.id);
  assert.deepEqual(related.map((g) => [g.object, g.field, g.total]), [['contacts', 'company', 1], ['deals', 'company', 1]]);

  crm.deleteRecord(co.id);
  assert.equal('company' in crm.getRecord(ct.id).data, false, 'dangling link is cleared');
});

test('custom objects and fields', () => {
  const projects = crm.createObject({ name: 'Projects', icon: '🚧' });
  assert.equal(projects.slug, 'projects');
  assert.equal(projects.singular, 'Project');
  assert.equal(projects.primary_field, 'name');

  const budget = crm.createField('projects', { label: 'Budget', type: 'currency' });
  const client = crm.createField('projects', { label: 'Client', type: 'relation', target_object: 'companies' });
  const phase = crm.createField('projects', { label: 'Phase', type: 'select', options: 'Plan\nBuild\nShip' });
  const dup = crm.createField('projects', { label: 'Budget', type: 'number' });
  assert.equal(dup.key, 'budget_2', 'keys stay unique');
  assert.deepEqual(phase.options, ['Plan', 'Build', 'Ship']);

  assert.throws(() => crm.createField('projects', { label: 'X', type: 'select' }), /at least one option/);
  assert.throws(() => crm.createField('projects', { label: 'X', type: 'relation' }), /target_object/);
  assert.throws(() => crm.createField('projects', { label: 'X', type: 'bogus' }), /type must be/);
  assert.throws(() => crm.createObject({ name: 'projects' }), /already exists/);

  const co = crm.createRecord('companies', { name: 'Acme' });
  const p = crm.createRecord('projects', { name: 'Website', budget: 5000, client: co.id, phase: 'Build' });
  assert.equal(p.refs.client.title, 'Acme');

  crm.updateObject('projects', { board_field: 'phase', value_field: 'budget' });
  const dash = crm.dashboard().objects.find((o) => o.slug === 'projects');
  assert.deepEqual(dash.board.stages.find((s) => s.stage === 'Build'), { stage: 'Build', count: 1, value: 5000 });
  assert.throws(() => crm.updateObject('projects', { board_field: 'budget' }), /board_field/);

  crm.deleteField(budget.id);
  assert.equal(crm.getObject('projects').value_field, null);
  assert.equal('budget' in crm.getRecord(p.id).data, false);
  assert.throws(() => crm.deleteField(crm.getObject('projects').fields[0].id), /primary field/);

  // Deleting a target object drops relation fields pointing at it.
  crm.deleteObject('companies');
  assert.equal(crm.getObject('projects').fields.some((f) => f.id === client.id), false);
  assert.equal(crm.getObject('contacts').fields.some((f) => f.key === 'company'), false);
});

test('renaming and removing select options migrates stored values', () => {
  const stage = crm.getObject('deals').fields.find((f) => f.key === 'stage');
  const a = crm.createRecord('deals', { name: 'A', stage: 'Proposal' });
  const b = crm.createRecord('deals', { name: 'B', stage: 'Lost' });
  crm.updateField(stage.id, {
    options: ['New', 'Qualified', 'Quote sent', 'Negotiation', 'Won'],
    renames: { Proposal: 'Quote sent' },
  });
  assert.equal(crm.getRecord(a.id).data.stage, 'Quote sent');
  assert.equal('stage' in crm.getRecord(b.id).data, false, 'removed option is cleared');

  const tags = crm.getObject('contacts').fields.find((f) => f.key === 'tags');
  const c = crm.createRecord('contacts', { name: 'C', tags: ['VIP', 'Newsletter'] });
  crm.updateField(tags.id, { options: ['Key account', 'Newsletter'], renames: { VIP: 'Key account' } });
  assert.deepEqual(crm.getRecord(c.id).data.tags, ['Key account', 'Newsletter']);
  assert.throws(() => crm.updateField(tags.id, { type: 'text' }), /can't be changed/);
});

test('activities and tasks', () => {
  const c = crm.createRecord('contacts', { name: 'Sam' });
  crm.createActivity({ record_id: c.id, type: 'note', body: 'Met at expo' });
  const t = crm.createActivity({ record_id: c.id, type: 'task', body: 'Follow up', due_at: '2000-01-01' });
  crm.createActivity({ type: 'task', body: 'Unlinked task' });

  assert.equal(crm.listActivities({ record_id: c.id }).length, 2);
  assert.equal(crm.dashboard().tasks.overdue, 1);
  assert.equal(crm.listActivities({ type: 'task', done: false })[0].record.title, 'Sam');

  crm.updateActivity(t.id, { done: true });
  assert.equal(crm.dashboard().tasks.open, 1);
  assert.throws(() => crm.createActivity({ type: 'fax', body: 'x' }), /type must be/);
  assert.throws(() => crm.createActivity({ type: 'note', body: '  ' }), /body is required/);

  crm.deleteRecord(c.id);
  assert.equal(crm.listActivities({}).length, 1, 'activities are deleted with their record');
});

test('settings validation', () => {
  assert.equal(crm.getSettings().business_name, 'My Business');
  const s = crm.updateSettings({ business_name: 'Bluebird', accent_color: '#ff0000', currency: 'EUR' });
  assert.equal(s.business_name, 'Bluebird');
  assert.throws(() => crm.updateSettings({ accent_color: 'red' }), /hex color/);
  assert.throws(() => crm.updateSettings({ currency: 'euro' }), /ISO code/);
});

test('CSV round trip', () => {
  const co = crm.createRecord('companies', { name: 'Acme, Inc.', city: 'Austin' });
  crm.createRecord('contacts', { name: 'Sam "The Man"', company: co.id, tags: ['VIP', 'Referral'] });
  const csv = exportCsv(crm, 'contacts');
  assert.match(csv, /"Sam ""The Man"""/);
  assert.match(csv, /"Acme, Inc\."/);
  assert.match(csv, /VIP; Referral/);

  const result = importCsv(crm, 'contacts', 'Name,Email,Company,Status,Favorite color\nAna,ana@x.example,"acme, inc.",Lead,blue\n,bad,,\nBo,bo@x.example,Nowhere Ltd,,\n');
  assert.equal(result.created, 1);
  assert.deepEqual(result.ignored_columns, ['Favorite color']);
  assert.deepEqual(result.errors.map((e) => e.row), [3, 4]);
  assert.equal(crm.listRecords('contacts', { q: 'Ana' }).records[0].refs.company.id, co.id);
});

test('csv helpers', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x,1","y\n""2"""\n\n'), [['a', 'b'], ['x,1', 'y\n"2"']]);
  assert.equal(toCsv([['=SUM(A1)', '-5', 'ok']]), "'=SUM(A1),-5,ok\r\n");
});
