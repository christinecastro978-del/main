import { transaction } from './db.js';

/**
 * The starter schema a fresh CRM gets. It's only a starting point: every
 * object, field and pipeline stage here can be renamed, changed or deleted
 * from Settings.
 */
export function ensureDefaultSchema(crm) {
  if (crm.listObjects().length) return false;

  transaction(crm.db, () => {
    const companies = crm.createObject({ name: 'Companies', singular: 'Company', icon: '🏢' });
    crm.createField(companies.id, { label: 'Industry', type: 'select', options: ['Retail', 'Services', 'Technology', 'Manufacturing', 'Healthcare', 'Other'] });
    crm.createField(companies.id, { label: 'Website', type: 'url' });
    crm.createField(companies.id, { label: 'Phone', type: 'phone' });
    crm.createField(companies.id, { label: 'City', type: 'text' });
    crm.createField(companies.id, { label: 'Notes', type: 'textarea', show_in_list: false });

    const contacts = crm.createObject({ name: 'Contacts', singular: 'Contact', icon: '👤' });
    crm.createField(contacts.id, { label: 'Email', type: 'email' });
    crm.createField(contacts.id, { label: 'Phone', type: 'phone' });
    crm.createField(contacts.id, { label: 'Company', type: 'relation', target_object: companies.id });
    crm.createField(contacts.id, { label: 'Job title', type: 'text' });
    crm.createField(contacts.id, { label: 'Status', type: 'select', options: ['Lead', 'Prospect', 'Customer', 'Inactive'] });
    crm.createField(contacts.id, { label: 'Tags', type: 'multiselect', options: ['VIP', 'Referral', 'Newsletter'], show_in_list: false });
    const status = crm.getObject(contacts.id).fields.find((f) => f.key === 'status');
    crm.updateObject(contacts.id, { board_field: status.key });

    const deals = crm.createObject({ name: 'Deals', singular: 'Deal', icon: '💼' });
    crm.createField(deals.id, { label: 'Stage', type: 'select', options: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'], required: true });
    crm.createField(deals.id, { label: 'Value', type: 'currency' });
    crm.createField(deals.id, { label: 'Company', type: 'relation', target_object: companies.id });
    crm.createField(deals.id, { label: 'Contact', type: 'relation', target_object: contacts.id });
    crm.createField(deals.id, { label: 'Close date', type: 'date' });
    crm.updateObject(deals.id, { board_field: 'stage', value_field: 'value' });
  });
  return true;
}
