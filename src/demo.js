// Fills the CRM with sample data so you can try it out: `npm run demo`.
// Uses the same database as the server (CRM_DB, default data/crm.db).
import { openDb, transaction } from './db.js';
import { Crm } from './crm.js';
import { ensureDefaultSchema } from './setup.js';

const dbFile = process.env.CRM_DB ?? 'data/crm.db';
const crm = new Crm(openDb(dbFile));
ensureDefaultSchema(crm);

const has = (slug) => crm.listObjects().some((o) => o.slug === slug);
if (!has('companies') || !has('contacts') || !has('deals')) {
  console.error('Demo data needs the starter Companies, Contacts and Deals objects.');
  process.exit(1);
}
if (crm.listRecords('companies', { limit: 1 }).total) {
  console.log('The database already has data; not adding demo records.');
  process.exit(0);
}

const days = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

transaction(crm.db, () => {
  const companies = [
    { name: 'Bluebird Bakery', industry: 'Retail', website: 'bluebirdbakery.example', city: 'Portland', phone: '+1 503 555 0101' },
    { name: 'Northwind Logistics', industry: 'Services', website: 'northwind.example', city: 'Chicago', phone: '+1 312 555 0144' },
    { name: 'Acme Robotics', industry: 'Technology', website: 'acme-robotics.example', city: 'Austin', phone: '+1 512 555 0190' },
    { name: 'Greenleaf Clinic', industry: 'Healthcare', website: 'greenleaf.example', city: 'Denver', phone: '+1 303 555 0123' },
  ].map((c) => crm.createRecord('companies', c));

  const contacts = [
    { name: 'Maya Patel', email: 'maya@bluebirdbakery.example', company: companies[0].id, job_title: 'Owner', status: 'Customer', tags: ['VIP'] },
    { name: 'Jordan Lee', email: 'jordan@northwind.example', company: companies[1].id, job_title: 'Operations Manager', status: 'Prospect' },
    { name: 'Sam Rivera', email: 'sam@acme-robotics.example', company: companies[2].id, job_title: 'CTO', status: 'Lead', tags: ['Referral'] },
    { name: 'Alex Kim', email: 'alex@greenleaf.example', company: companies[3].id, job_title: 'Practice Manager', status: 'Customer', tags: ['Newsletter'] },
    { name: 'Riley Chen', email: 'riley@acme-robotics.example', company: companies[2].id, job_title: 'Procurement', status: 'Prospect' },
  ].map((c) => crm.createRecord('contacts', c));

  const deals = [
    { name: 'Wholesale bread contract', stage: 'Won', value: 12000, company: companies[0].id, contact: contacts[0].id, close_date: days(-12) },
    { name: 'Fleet tracking rollout', stage: 'Proposal', value: 48000, company: companies[1].id, contact: contacts[1].id, close_date: days(21) },
    { name: 'Pilot automation project', stage: 'Qualified', value: 30000, company: companies[2].id, contact: contacts[2].id, close_date: days(45) },
    { name: 'Annual support renewal', stage: 'Negotiation', value: 9500, company: companies[3].id, contact: contacts[3].id, close_date: days(10) },
    { name: 'Spare parts order', stage: 'New', value: 4200, company: companies[2].id, contact: contacts[4].id },
  ].map((d) => crm.createRecord('deals', d));

  crm.createActivity({ record_id: contacts[1].id, type: 'call', body: 'Intro call. Interested in tracking for 40 trucks; wants pricing by next week.' });
  crm.createActivity({ record_id: deals[1].id, type: 'task', body: 'Send revised proposal with volume discount', due_at: days(2) });
  crm.createActivity({ record_id: deals[3].id, type: 'task', body: 'Confirm renewal terms with Alex', due_at: days(-1) });
  crm.createActivity({ record_id: contacts[2].id, type: 'meeting', body: 'Demo at their office. Sam brought two engineers.' });
  crm.createActivity({ record_id: companies[0].id, type: 'note', body: 'Prefers deliveries before 6am.' });
  crm.createActivity({ type: 'task', body: 'Plan Q4 newsletter', due_at: days(7) });
});

console.log(`Added demo companies, contacts, deals and activities to ${dbFile}`);
