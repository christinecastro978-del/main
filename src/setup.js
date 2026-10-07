import { transaction } from './db.js';

/**
 * The starter setup a fresh CRM gets: built for a fractional marketing
 * consultancy selling to founders and CEOs of venture-backed cybersecurity
 * companies. It's only a starting point. Every record type, field, stage and
 * setting here can be renamed, changed or deleted from Settings.
 */
export function ensureDefaultSchema(crm) {
  if (crm.listObjects().length) return false;

  transaction(crm.db, () => {
    crm.updateSettings({
      business_name: 'Christine Castro',
      accent_color: '#0f766e',
      allowed_origins: 'https://christinecastro.com\nhttps://www.christinecastro.com',
    });

    const companies = crm.createObject({ name: 'Companies', singular: 'Company', icon: '🏢' });
    crm.createField(companies.id, { label: 'Website', type: 'url' });
    crm.createField(companies.id, { label: 'Funding stage', type: 'select', options: ['Seed', 'Series A', 'Series B', 'Series C', 'Series D+', 'Pre-IPO', 'Public', 'Bootstrapped'] });
    crm.createField(companies.id, {
      label: 'Security category', type: 'multiselect',
      options: ['Cloud security', 'Identity & access', 'Application security', 'Data security', 'Endpoint', 'Network security',
        'SecOps / SIEM / XDR', 'GRC & compliance', 'Threat intelligence', 'OT / IoT security', 'AI security', 'Email security', 'Other'],
    });
    crm.createField(companies.id, { label: 'ICP fit', type: 'select', options: ['A – Ideal', 'B – Good', 'C – Stretch', 'Not a fit'] });
    crm.createField(companies.id, { label: 'Total raised', type: 'currency' });
    crm.createField(companies.id, { label: 'Last round date', type: 'date', show_in_list: false });
    crm.createField(companies.id, { label: 'Lead investors', type: 'text', show_in_list: false });
    crm.createField(companies.id, { label: 'Employees', type: 'number' });
    crm.createField(companies.id, { label: 'HQ', type: 'text', show_in_list: false });
    crm.createField(companies.id, { label: 'LinkedIn', type: 'url', show_in_list: false });
    crm.createField(companies.id, { label: 'Notes', type: 'textarea', show_in_list: false });

    const contacts = crm.createObject({ name: 'Contacts', singular: 'Contact', icon: '👤' });
    crm.createField(contacts.id, { label: 'Email', type: 'email' });
    crm.createField(contacts.id, { label: 'Company', type: 'relation', target_object: companies.id });
    crm.createField(contacts.id, { label: 'Title', type: 'text' });
    crm.createField(contacts.id, {
      label: 'Role', type: 'select',
      options: ['Founder & CEO', 'CEO', 'Co-founder', 'CTO', 'CRO / Head of Sales', 'CMO / VP Marketing', 'Board member / Investor', 'Other'],
    });
    crm.createField(contacts.id, {
      label: 'Lifecycle stage', type: 'select',
      options: ['Subscriber', 'Lead', 'MQL', 'SQL', 'Opportunity', 'Client', 'Former client', 'Disqualified'],
    });
    crm.createField(contacts.id, { label: 'LinkedIn', type: 'url', show_in_list: false });
    crm.createField(contacts.id, { label: 'Phone', type: 'phone', show_in_list: false });
    crm.createField(contacts.id, { label: 'Tags', type: 'multiselect', options: ['Newsletter', 'Podcast guest', 'Speaker', 'Referral partner', 'Investor', 'VIP'], show_in_list: false });
    crm.updateObject(contacts.id, { board_field: 'lifecycle_stage', won_stage: 'Client', exit_stages: ['Former client', 'Disqualified'] });

    const deals = crm.createObject({ name: 'Deals', singular: 'Deal', icon: '💼' });
    crm.createField(deals.id, {
      label: 'Stage', type: 'select', required: true,
      options: ['Discovery call booked', 'Discovery held', 'Proposal sent', 'Negotiation', 'Won', 'Lost'],
    });
    crm.createField(deals.id, { label: 'Value', type: 'currency' });
    crm.createField(deals.id, {
      label: 'Engagement type', type: 'select',
      options: ['Fractional CMO retainer', 'GTM strategy sprint', 'Positioning & messaging', 'IPO-readiness narrative', 'Advisory', 'Workshop'],
    });
    crm.createField(deals.id, { label: 'Monthly retainer', type: 'currency', show_in_list: false });
    crm.createField(deals.id, { label: 'Company', type: 'relation', target_object: companies.id });
    crm.createField(deals.id, { label: 'Contact', type: 'relation', target_object: contacts.id });
    crm.createField(deals.id, { label: 'Expected close', type: 'date' });
    crm.createField(deals.id, {
      label: 'Lost reason', type: 'select', show_in_list: false,
      options: ['Budget', 'Timing', 'Hired full-time CMO', 'Went with an agency', 'No decision', 'Not a fit'],
    });
    crm.updateObject(deals.id, { board_field: 'stage', value_field: 'value', won_stage: 'Won', exit_stages: ['Lost'] });
  });
  return true;
}
