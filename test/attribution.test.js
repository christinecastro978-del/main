import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { Crm } from '../src/crm.js';
import { Attribution, classifyChannel, credits } from '../src/attribution.js';
import { captureLead, mapFormFields, webhookPayload } from '../src/capture.js';
import { importCsv } from '../src/transfer.js';
import { genericSchema } from './fixtures.js';

let crm;
let attribution;
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

beforeEach(() => {
  crm = new Crm(openDb(':memory:'));
  genericSchema(crm);
  crm.updateObject('contacts', { won_stage: 'Customer', exit_stages: ['Inactive'] });
  crm.updateSettings({ allowed_origins: 'https://example.com' });
  attribution = new Attribution(crm);
});

test('classifies channels from UTMs, click ids and referrers', () => {
  const cases = [
    [{ source: 'google', medium: 'cpc' }, 'Paid search'],
    [{ source: 'linkedin', medium: 'cpc' }, 'Paid social'],
    [{ source: 'linkedin', medium: 'paid_social' }, 'Paid social'],
    [{ click_id: 'gclid' }, 'Paid search'],
    [{ click_id: 'li_fat_id' }, 'Paid social'],
    [{ source: 'newsletter', medium: 'email' }, 'Email'],
    [{ source: 'linkedin', medium: 'social' }, 'Organic social'],
    [{ referrer: 'https://www.linkedin.com/feed/' }, 'Organic social'],
    [{ referrer: 'https://www.google.com/' }, 'Organic search'],
    [{ referrer: 'https://chatgpt.com/' }, 'AI assistants'],
    [{ referrer: 'https://gemini.google.com/app' }, 'AI assistants'],
    [{ referrer: 'https://someblog.example/post' }, 'Website referral'],
    [{ source: 'breachpoint', medium: 'podcast' }, 'Podcast'],
    [{ source: 'mystery' }, 'Other'],
    [{}, 'Direct'],
  ];
  for (const [input, expected] of cases) assert.equal(classifyChannel(input), expected, JSON.stringify(input));
});

test('attribution models split one unit of credit', () => {
  const t = (d) => ({ occurred_at: daysAgo(d) });
  const four = [t(30), t(20), t(10), t(0)];
  assert.deepEqual(credits('first_touch', four), [1, 0, 0, 0]);
  assert.deepEqual(credits('last_touch', four), [0, 0, 0, 1]);
  assert.deepEqual(credits('linear', four), [0.25, 0.25, 0.25, 0.25]);
  assert.deepEqual(credits('u_shaped', four), [0.4, 0.1, 0.1, 0.4]);
  assert.deepEqual(credits('u_shaped', [t(1)]), [1]);
  const decay = credits('time_decay', [t(14), t(7), t(0)], daysAgo(0));
  assert.ok(Math.abs(decay.reduce((a, b) => a + b) - 1) < 1e-9);
  assert.ok(Math.abs(decay[1] / decay[0] - 2) < 0.01, 'a touch 7 days later gets twice the weight');
  assert.throws(() => credits('nope', four), /model must be/);
});

function wonDeal() {
  const co = crm.createRecord('companies', { name: 'Acme' }, { at: daysAgo(60) });
  const ceo = crm.createRecord('contacts', { name: 'CEO', company: co.id, status: 'Lead' }, { at: daysAgo(30) });
  const cto = crm.createRecord('contacts', { name: 'CTO', company: co.id, status: 'Lead' }, { at: daysAgo(20) });
  attribution.addTouchpoint(ceo.id, { channel: 'Investor / VC network', source: 'Intro from Team8', occurred_at: daysAgo(30) });
  attribution.addTouchpoint(cto.id, { channel: 'Organic search', occurred_at: daysAgo(20) });
  // After the deal opened, so it shouldn't get deal credit.
  attribution.addTouchpoint(ceo.id, { channel: 'Email', occurred_at: daysAgo(2) });
  const deal = crm.createRecord('deals', { name: 'Retainer', stage: 'New', value: 90000, company: co.id }, { at: daysAgo(10) });
  crm.updateRecord(deal.id, { stage: 'Proposal' }, { at: daysAgo(6) });
  crm.updateRecord(deal.id, { stage: 'Won' }, { at: daysAgo(1) });
  return { co, ceo, cto, deal };
}

test('revenue is credited to the touches of everyone at the account before the deal opened', () => {
  wonDeal();
  const byKey = (report) => Object.fromEntries(report.rows.map((r) => [r.key, r]));

  const first = byKey(attribution.report({ model: 'first_touch' }));
  assert.equal(first['Investor / VC network'].revenue, 90000);
  assert.equal(first['Organic search'].revenue, 0);

  const last = byKey(attribution.report({ model: 'last_touch' }));
  assert.equal(last['Organic search'].revenue, 90000);
  assert.equal(last.Email?.revenue ?? 0, 0, 'touches after the deal opened are excluded');

  const linear = byKey(attribution.report({ model: 'linear' }));
  assert.equal(linear['Investor / VC network'].won, 0.5);
  assert.equal(linear['Organic search'].revenue, 45000);

  const all = attribution.report({ model: 'linear' });
  assert.equal(all.totals.revenue, 90000);
  assert.equal(all.totals.won, 1);
  assert.equal(all.totals.leads, 2);
  assert.equal(linear.Email.leads, 0.5, 'lead credit uses all of a person’s touches');

  const outside = attribution.report({ from: daysAgo(400).slice(0, 10), to: daysAgo(100).slice(0, 10) });
  assert.equal(outside.totals.revenue, 0);
  assert.throws(() => attribution.report({ from: 'yesterday' }), /from must be a date/);
});

test('people without touches show up as unattributed', () => {
  crm.createRecord('contacts', { name: 'Walk-in' });
  const report = attribution.report({});
  assert.equal(report.rows.find((r) => r.key === 'Unattributed').leads, 1);
});

test('journey and first-touch summaries', () => {
  const { deal, ceo } = wonDeal();
  const journey = attribution.journey(deal.id, 'u_shaped');
  assert.deepEqual(journey.touchpoints.map((t) => t.channel), ['Investor / VC network', 'Organic search']);
  assert.equal(journey.touchpoints[0].record.title, 'CEO');
  assert.deepEqual(journey.stage_history.map((s) => s.to_value), ['New', 'Proposal', 'Won']);

  const firsts = attribution.firstTouches('contacts', crm.listRecords('contacts').records);
  assert.equal(firsts.get(ceo.id).channel, 'Investor / VC network');
});

test('funnel counts stages reached, conversion, time in stage, win rate and cycle', () => {
  wonDeal();
  const lost = crm.createRecord('deals', { name: 'Lost one', stage: 'New' }, { at: daysAgo(20) });
  crm.updateRecord(lost.id, { stage: 'Lost' }, { at: daysAgo(15) });
  crm.createRecord('deals', { name: 'Skipped ahead', stage: 'Negotiation' }, { at: daysAgo(3) });

  const f = attribution.funnel('deals');
  const reached = Object.fromEntries(f.stages.map((s) => [s.stage, s.reached]));
  assert.deepEqual(reached, { New: 3, Qualified: 2, Proposal: 2, Negotiation: 2, Won: 1 });
  assert.equal(f.stages.find((s) => s.stage === 'New').avg_days_in_stage, 4);
  assert.equal(f.won, 1);
  assert.equal(f.lost, 1);
  assert.equal(f.win_rate, 0.5);
  assert.equal(f.avg_cycle_days, 9);
  assert.deepEqual(f.exits, [{ stage: 'Lost', current: 1 }]);
  assert.throws(() => attribution.funnel('companies'), /no board field/);
});

test('renaming a stage keeps history and won/exit stages in step', () => {
  const { deal } = wonDeal();
  const stage = crm.getObject('deals').fields.find((f) => f.key === 'stage');
  crm.updateField(stage.id, { options: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Closed won', 'Closed lost'], renames: { Won: 'Closed won', Lost: 'Closed lost' } });
  const deals = crm.getObject('deals');
  assert.equal(deals.won_stage, 'Closed won');
  assert.deepEqual(deals.exit_stages, ['Closed lost']);
  assert.equal(crm.stageHistory(deal.id).at(-1).to_value, 'Closed won');
  assert.equal(attribution.funnel('deals').won, 1);
  assert.throws(() => crm.updateObject('deals', { won_stage: 'Nope' }), /won_stage/);
});

test('form fields are mapped to a person', () => {
  const p = mapFormFields({ 'First Name': 'Maya', last_name: 'Patel', 'Work Email': 'maya@acme.io', Company: 'Acme', 'Job Title': 'CEO', 'How can we help?': 'Positioning', budget: '50k' });
  assert.deepEqual([p.name, p.email, p.company, p.title, p.message], ['Maya Patel', 'maya@acme.io', 'Acme', 'CEO', 'Positioning']);
  assert.deepEqual(p.extra, [['budget', '50k']]);
  assert.equal(mapFormFields({ field_3: 'x@y.co' }).email, 'x@y.co', 'finds an email in any field');
  assert.equal(mapFormFields({ email: 'a@b.co', _gotcha: 'spam' }).spam, true);
});

test('captured leads get a contact, company, touches, lead stage and a follow-up task', () => {
  const res = captureLead(crm, attribution, {
    fields: { name: 'Maya Patel', email: 'Maya@Acme.io', company: 'Acme', message: 'Need a fractional CMO' },
    touches: [
      { at: daysAgo(9), source: 'linkedin', medium: 'paid_social', campaign: 'gtm-audit', landing: 'https://example.com/audit' },
      { at: daysAgo(1), referrer: 'https://www.google.com/' },
    ],
  }, { origin: 'website' });
  assert.equal(res.created, true);
  const contact = crm.getRecord(res.contact_id);
  assert.equal(contact.data.email, 'maya@acme.io');
  assert.equal(contact.data.status, 'Lead');
  assert.equal(contact.refs.company.title, 'Acme');
  const journey = attribution.journey(contact.id);
  assert.deepEqual(journey.touchpoints.map((t) => t.channel), ['Paid social', 'Organic search']);
  const activities = crm.listActivities({ record_id: contact.id });
  assert.ok(activities.some((a) => a.type === 'task'));
  assert.ok(activities.some((a) => a.body.includes('Need a fractional CMO')));

  // Same person again: no duplicate contact or touches, nothing overwritten, stage not demoted.
  crm.updateRecord(contact.id, { status: 'Customer', name: 'Maya P.' });
  const again = captureLead(crm, attribution, {
    fields: { name: 'Someone Else', email: 'maya@acme.io' },
    touches: [{ at: journey.touchpoints[0].occurred_at, source: 'linkedin', medium: 'paid_social', campaign: 'gtm-audit', landing: 'https://example.com/audit' }],
  }, { origin: 'website' });
  assert.equal(again.created, false);
  assert.equal(again.touchpoints_added, 0);
  assert.equal(crm.getRecord(contact.id).data.name, 'Maya P.');
  assert.equal(crm.getRecord(contact.id).data.status, 'Customer');
  assert.equal(crm.listRecords('contacts').total, 1);
  assert.equal(crm.listRecords('companies').total, 1);

  assert.deepEqual(captureLead(crm, attribution, { fields: { email: 'bot@x.io', honeypot: 'yes' } }, { origin: 'website' }), { ignored: true });
  assert.throws(() => captureLead(crm, attribution, { fields: { name: 'No email' } }, { origin: 'website' }), /email/);
});

test('webhook payloads carry explicit attribution', () => {
  const payload = webhookPayload({ email: 'sam@vault.io', name: 'Sam', channel: 'Events', source: 'RSAC 2026', utm_campaign: 'founder-dinner' });
  assert.deepEqual(payload.fields, { email: 'sam@vault.io', name: 'Sam' });
  const res = captureLead(crm, attribution, payload, { origin: 'webhook' });
  const [touch] = attribution.journey(res.contact_id).touchpoints;
  assert.deepEqual([touch.channel, touch.source, touch.campaign, touch.origin], ['Events', 'RSAC 2026', 'founder-dinner', 'webhook']);
});

test('CSV import turns lead source columns into touchpoints', () => {
  const csv = 'Name,Lead source,UTM Campaign,Touch date\nAna,Referral,,2026-01-15\nBo,Intro from Team8,,\nCy,,,\nDee,Referral,,not-a-date\n';
  const res = importCsv(crm, 'contacts', csv, attribution);
  assert.equal(res.created, 3);
  assert.deepEqual(res.errors.map((e) => e.row), [5]);
  assert.equal(crm.listRecords('contacts', { q: 'Dee' }).total, 0, 'failed rows are rolled back');
  const touchOf = (name) => attribution.journey(crm.listRecords('contacts', { q: name }).records[0].id).touchpoints[0];
  assert.equal(touchOf('Ana').channel, 'Referral');
  assert.equal(touchOf('Ana').occurred_at.slice(0, 10), '2026-01-15');
  assert.deepEqual([touchOf('Bo').channel, touchOf('Bo').source], ['Other', 'Intro from Team8']);
  assert.equal(touchOf('Cy'), undefined);
});

test('attribution settings are validated', () => {
  assert.throws(() => crm.updateSettings({ allowed_origins: 'example.com' }), /origins/);
  assert.equal(crm.updateSettings({ allowed_origins: 'https://a.example/\nhttps://a.example' }).allowed_origins, 'https://a.example');
  assert.throws(() => crm.updateSettings({ contact_object: 'nope' }), /not found/);
  assert.equal(crm.updateSettings({ deal_object: '' }).deal_object, '');
  assert.equal(attribution.config().deals, null);
  assert.equal(crm.getSettings()['secret.webhook_key'], undefined);
});
