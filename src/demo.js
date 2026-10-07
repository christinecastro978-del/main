// Fills the CRM with a year of realistic sample data so the pipeline and
// attribution reports have something to show: `npm run demo`.
// Uses the same database as the server (CRM_DB, default data/crm.db).
// All companies and people are fictional.
import { openDb, transaction } from './db.js';
import { Crm } from './crm.js';
import { Attribution } from './attribution.js';
import { ensureDefaultSchema } from './setup.js';

const dbFile = process.env.CRM_DB ?? 'data/crm.db';
const crm = new Crm(openDb(dbFile));
const attribution = new Attribution(crm);
ensureDefaultSchema(crm);

for (const slug of ['companies', 'contacts', 'deals']) {
  if (!crm.listObjects().some((o) => o.slug === slug)) {
    console.error('Demo data needs the starter Companies, Contacts and Deals record types.');
    process.exit(1);
  }
}
if (crm.listRecords('contacts', { limit: 1 }).total) {
  console.log('The database already has contacts; not adding demo data.');
  process.exit(0);
}

// Deterministic randomness so every demo database looks the same.
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const ago = (days, hour = 10) => {
  const d = new Date(Date.now() - days * 86400000);
  d.setUTCHours(hour, Math.floor(rand() * 60), 0, 0);
  return d.toISOString();
};
const date = (iso) => iso.slice(0, 10);

const COMPANIES = [
  ['Sentinel Grid', 'Cloud security', 'Series C', 'A – Ideal', 120e6, 340],
  ['Ironclad Identity', 'Identity & access', 'Series B', 'A – Ideal', 62e6, 180],
  ['Cipherline', 'Data security', 'Series D+', 'A – Ideal', 210e6, 520],
  ['NullVector AI', 'AI security', 'Series A', 'B – Good', 24e6, 45],
  ['Harborwall', 'OT / IoT security', 'Series C', 'A – Ideal', 95e6, 260],
  ['Quietpath', 'Email security', 'Series B', 'B – Good', 48e6, 140],
  ['Trustlayer', 'GRC & compliance', 'Series A', 'B – Good', 18e6, 60],
  ['Bastionforge', 'Application security', 'Series C', 'A – Ideal', 110e6, 300],
  ['Glasswing Intel', 'Threat intelligence', 'Pre-IPO', 'A – Ideal', 340e6, 780],
  ['Packetmoss', 'Network security', 'Series B', 'B – Good', 55e6, 150],
  ['Driftguard', 'Endpoint', 'Seed', 'C – Stretch', 6e6, 18],
  ['Keystone Shield', 'SecOps / SIEM / XDR', 'Series D+', 'A – Ideal', 260e6, 610],
];
const FIRST = ['Maya', 'Jordan', 'Priya', 'Daniel', 'Elena', 'Marcus', 'Aisha', 'Tom', 'Sofia', 'Ravi', 'Hannah', 'Leo', 'Nina', 'Omar', 'Grace', 'Felix', 'Iris', 'Sam', 'Yuki', 'Ben', 'Clara', 'Diego', 'Amara', 'Noah', 'Lena', 'Victor', 'Zoe', 'Ethan'];
const LAST = ['Patel', 'Reyes', 'Shah', 'Cohen', 'Novak', 'Bennett', 'Okafor', 'Lindqvist', 'Marino', 'Iyer', 'Brooks', 'Weiss', 'Tanaka', 'Haddad', 'Kim', 'Moreau', 'Ortiz', 'Levi', 'Sato', 'Fischer', 'Duarte', 'Mensah', 'Rossi', 'Avery', 'Schmidt', 'Costa', 'Nakamura', 'Walsh'];
const ROLES = [['Founder & CEO', 'Co-founder & CEO'], ['CEO', 'Chief Executive Officer'], ['Co-founder', 'Co-founder & President'], ['CRO / Head of Sales', 'Chief Revenue Officer'], ['CTO', 'Co-founder & CTO']];

// Ways people find a fractional CMO, from strongest to weakest intent.
const JOURNEYS = [
  { weight: 3, quality: 0.85, path: [{ channel: 'Investor / VC network', source: pick(['Intro from Team8', 'Intro from YL Ventures', 'Intro from Evolution Equity', 'Intro from Ten Eleven Ventures']) }] },
  { weight: 3, quality: 0.8, path: [{ channel: 'Referral', source: 'Referral from a client CEO' }, { channel: 'Direct' }] },
  { weight: 4, quality: 0.55, path: [{ channel: 'Organic social', source: 'linkedin', medium: 'social', campaign: 'founder-led-growth-series' }, { channel: 'Content / Webinar', source: 'webinar', medium: 'webinar', campaign: 'pre-ipo-narrative-webinar' }, { channel: 'Direct' }] },
  { weight: 3, quality: 0.5, path: [{ channel: 'Podcast', source: 'Breach Point podcast', medium: 'podcast' }, { channel: 'Organic search', source: 'google' }] },
  { weight: 3, quality: 0.35, path: [{ channel: 'Paid social', source: 'linkedin', medium: 'paid_social', campaign: 'cyber-ceo-gtm-audit' }, { channel: 'Email', source: 'newsletter', medium: 'email', campaign: 'gtm-teardown-weekly' }] },
  { weight: 2, quality: 0.6, path: [{ channel: 'Events', source: 'RSAC 2026', medium: 'event', campaign: 'rsac-founder-dinner' }, { channel: 'Email', source: 'follow-up', medium: 'email' }] },
  { weight: 2, quality: 0.45, path: [{ channel: 'AI assistants', source: 'chatgpt.com', referrer: 'https://chatgpt.com/' }, { channel: 'Direct' }] },
  { weight: 3, quality: 0.3, path: [{ channel: 'Organic search', source: 'google', referrer: 'https://www.google.com/' }, { channel: 'Email', source: 'newsletter', medium: 'email', campaign: 'gtm-teardown-weekly' }] },
  { weight: 1, quality: 0.25, path: [{ channel: 'Outbound', source: 'LinkedIn outreach' }] },
];
const pickJourney = () => {
  let r = rand() * JOURNEYS.reduce((s, j) => s + j.weight, 0);
  for (const j of JOURNEYS) if ((r -= j.weight) < 0) return j;
  return JOURNEYS[0];
};
const PAGES = ['/', '/fractional-cmo', '/pre-ipo-narrative', '/insights/cyber-gtm-teardown', '/about', '/contact'];
const ENGAGEMENTS = [
  ['Fractional CMO retainer', 90000, 15000],
  ['GTM strategy sprint', 35000, null],
  ['Positioning & messaging', 45000, null],
  ['IPO-readiness narrative', 60000, null],
  ['Advisory', 24000, 4000],
];
const LIFECYCLE = ['Subscriber', 'Lead', 'MQL', 'SQL', 'Opportunity', 'Client'];
const DEAL_STAGES = ['Discovery call booked', 'Discovery held', 'Proposal sent', 'Negotiation', 'Won'];

transaction(crm.db, () => {
  const companies = COMPANIES.map(([name, category, funding, fit, raised, employees], i) => crm.createRecord('companies', {
    name, website: `${name.toLowerCase().replace(/[^a-z]/g, '')}.example`, security_category: [category],
    funding_stage: funding, icp_fit: fit, total_raised: raised, employees,
    last_round_date: date(ago(60 + i * 37)), hq: pick(['Tel Aviv', 'New York', 'San Francisco', 'Boston', 'Austin', 'London', 'Washington, DC']),
  }, { at: ago(360) }));

  let n = 0;
  for (let i = 0; i < 30; i++) {
    const company = companies[i % companies.length];
    const [role, title] = pick(ROLES);
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 5) % LAST.length];
    const journey = pickJourney();
    const firstTouch = 20 + Math.floor(rand() * 320);
    const touches = journey.path.map((t, k) => ({ ...t, days: Math.max(firstTouch - k * (3 + Math.floor(rand() * 20)), 1) }));
    const createdDays = touches.at(-1).days;

    // How far this person gets depends on how they found us.
    // Walk up to Opportunity at most; whether they become a client is decided by the deal.
    let reach = 1;
    while (reach < 4 && rand() < journey.quality + 0.1) reach++;
    if (createdDays < 25) reach = Math.min(reach, 3);
    const wins = reach === 4 && createdDays > 40 && rand() < 0.3 + journey.quality * 0.4;
    if (wins) reach = 5;
    const startStage = journey.quality > 0.7 ? 'SQL' : rand() < 0.3 ? 'Subscriber' : 'Lead';
    const startIdx = Math.min(LIFECYCLE.indexOf(startStage), reach);

    const contact = crm.createRecord('contacts', {
      name: `${first} ${last}`,
      email: `${first}.${last}@${company.data.website}`.toLowerCase(),
      company: company.id, title, role,
      lifecycle_stage: LIFECYCLE[startIdx],
      linkedin: `https://www.linkedin.com/in/${first}-${last}`.toLowerCase(),
      tags: journey.path[0].channel === 'Email' || rand() < 0.4 ? ['Newsletter'] : undefined,
    }, { at: ago(createdDays) });

    for (const t of touches) {
      const { days, ...rest } = t;
      attribution.addTouchpoint(contact.id, {
        ...rest, occurred_at: ago(days, 9),
        landing_page: rest.channel === 'Investor / VC network' || rest.channel === 'Referral' ? null : `https://christinecastro.com${pick(PAGES)}`,
      }, { origin: rest.channel === 'Investor / VC network' || rest.channel === 'Referral' || rest.channel === 'Outbound' ? 'manual' : 'website' });
    }

    // Walk the lifecycle forward over the following weeks.
    let day = createdDays;
    let opportunityDay = startIdx >= 4 ? createdDays : null;
    for (let s = startIdx + 1; s <= reach; s++) {
      day = Math.max(day - (4 + Math.floor(rand() * 18)), 0);
      crm.updateRecord(contact.id, { lifecycle_stage: LIFECYCLE[s] }, { at: ago(day, 15) });
      if (s === 4) opportunityDay = day;
    }
    if (reach < 4 && rand() < 0.25) {
      crm.updateRecord(contact.id, { lifecycle_stage: 'Disqualified' }, { at: ago(Math.max(day - 10, 0), 16) });
    }

    // Opportunities usually have a deal; some SQLs get as far as a proposal too.
    if (reach >= 4 || (reach === 3 && rand() < 0.6)) {
      const [type, value, monthly] = pick(ENGAGEMENTS);
      const won = wins;
      const lost = !won && createdDays > 40 && rand() < 0.7;
      const opened = opportunityDay ?? Math.max(day - 3, 0);
      const deal = crm.createRecord('deals', {
        name: `${company.data.name} — ${type}`, stage: DEAL_STAGES[0], value, monthly_retainer: monthly ?? undefined,
        engagement_type: type, company: company.id, contact: contact.id,
        expected_close: date(ago(Math.max(opened - 45, -30))),
      }, { at: ago(opened, 11) });
      const lastStage = won ? 4 : lost ? 1 + Math.floor(rand() * 3) : Math.min(1 + Math.floor(rand() * 3), 3);
      let d = opened;
      for (let s = 1; s <= lastStage; s++) {
        d = Math.max(d - (5 + Math.floor(rand() * 14)), 0);
        crm.updateRecord(deal.id, { stage: DEAL_STAGES[s] }, { at: ago(d, 14) });
      }
      if (lost) {
        crm.updateRecord(deal.id, { stage: 'Lost', lost_reason: pick(['Budget', 'Timing', 'Hired full-time CMO', 'No decision']) }, { at: ago(Math.max(d - 7, 0), 14) });
      }
      if (!won && !lost) {
        crm.createActivity({ record_id: deal.id, type: 'task', body: `Follow up on ${DEAL_STAGES[lastStage].toLowerCase()} with ${first}`, due_at: date(ago(Math.floor(rand() * 10) - 5)) });
      }
    }

    if (i % 4 === 0) crm.createActivity({ record_id: contact.id, type: 'call', body: `Intro call with ${first}. Talked through their ${company.data.funding_stage} GTM priorities and category positioning.` });
    n++;
  }
  crm.createActivity({ type: 'task', body: 'Draft next GTM teardown newsletter issue', due_at: date(ago(-4)) });
  console.log(`Added ${companies.length} companies and ${n} contacts with touchpoints, stage history and deals to ${dbFile}`);
});
