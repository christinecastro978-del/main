import { randomBytes } from 'node:crypto';
import { HttpError } from './crm.js';
import { transaction } from './db.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOUCHES = 25;

// Form field names we recognize, normalized to lowercase letters and digits.
const ALIASES = {
  email: ['email', 'emailaddress', 'workemail', 'businessemail', 'youremail', 'mail'],
  name: ['name', 'fullname', 'yourname', 'contactname'],
  first: ['firstname', 'fname', 'first', 'givenname'],
  last: ['lastname', 'lname', 'last', 'surname', 'familyname'],
  company: ['company', 'companyname', 'organization', 'organisation', 'org', 'business', 'businessname', 'employer'],
  title: ['title', 'jobtitle', 'role', 'position', 'yourrole'],
  phone: ['phone', 'phonenumber', 'tel', 'telephone', 'mobile', 'cell'],
  website: ['website', 'companywebsite', 'url', 'site', 'domain', 'companyurl'],
  message: ['message', 'comments', 'comment', 'details', 'howcanwehelp', 'howcanihelp', 'notes', 'inquiry', 'enquiry', 'projectdetails', 'body'],
};
const HONEYPOTS = ['gotcha', 'honeypot', 'hp', 'botfield', 'leaveblank', 'faxonly'];
const ATTRIBUTION_KEYS = ['channel', 'source', 'medium', 'campaign', 'content', 'term', 'referrer', 'landing_page', 'occurred_at', 'note',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

const norm = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Picks out the person's details from arbitrary form fields. */
export function mapFormFields(fields) {
  const entries = Object.entries(fields ?? {})
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
    .map(([k, v]) => [k, String(v).trim().slice(0, 5000)])
    .filter(([, v]) => v);
  const used = new Set();
  const pick = (kind) => {
    const hit = entries.find(([k]) => ALIASES[kind].includes(norm(k)));
    if (hit) used.add(hit[0]);
    return hit?.[1] ?? null;
  };
  const out = {
    spam: entries.some(([k]) => HONEYPOTS.includes(norm(k).replace(/^_+/, ''))),
    email: pick('email'),
    name: pick('name'),
    company: pick('company'),
    title: pick('title'),
    phone: pick('phone'),
    website: pick('website'),
    message: pick('message'),
  };
  const first = pick('first');
  const last = pick('last');
  if (!out.name && (first || last)) out.name = [first, last].filter(Boolean).join(' ');
  if (!out.email || !EMAIL.test(out.email)) {
    const hit = entries.find(([k, v]) => !used.has(k) && EMAIL.test(v));
    out.email = hit?.[1] ?? null;
    if (hit) used.add(hit[0]);
  }
  out.extra = entries.filter(([k]) => !used.has(k) && !HONEYPOTS.includes(norm(k).replace(/^_+/, '')));
  return out;
}

export function webhookKey(crm) {
  let key = crm.getSecret('webhook_key');
  if (!key) {
    key = randomBytes(24).toString('base64url');
    crm.setSecret('webhook_key', key);
  }
  return key;
}

export function rotateWebhookKey(crm) {
  crm.setSecret('webhook_key', randomBytes(24).toString('base64url'));
  return webhookKey(crm);
}

/**
 * Turns a form submission or webhook into a contact with its marketing
 * touches. Existing contacts (matched by email) get new touches and any blank
 * fields filled in; nothing they already have is overwritten.
 *
 * payload: { fields: {...form fields}, touches: [{ at, source, medium, campaign,
 *            content, term, referrer, landing, click_id, channel }], page }
 */
export function captureLead(crm, attribution, payload, { origin }) {
  const { contacts } = attribution.config();
  if (!contacts) throw new HttpError(409, 'No contact record type is configured for attribution');
  const person = mapFormFields(payload.fields);
  if (person.spam) return { ignored: true };
  if (!person.email || !EMAIL.test(person.email)) throw new HttpError(400, 'An email address is required');

  const emailField = contacts.fields.find((f) => f.type === 'email');
  if (!emailField) throw new HttpError(409, `${contacts.name} needs an email field to capture leads`);
  const byType = (type, keys) => contacts.fields.find((f) => f.type === type && (!keys || keys.includes(f.key)));
  const companyField = contacts.fields.find((f) => f.type === 'relation' && f.key === 'company')
    ?? contacts.fields.find((f) => f.type === 'relation' && f.target_object_id !== contacts.id);

  return transaction(crm.db, () => {
    const existing = crm.findRecordBy(contacts.id, emailField.key, person.email);
    const data = {};
    const setIfEmpty = (field, value) => {
      if (field && value && (existing?.data[field.key] ?? '') === '') data[field.key] = value;
    };
    setIfEmpty(emailField, person.email);
    if (contacts.primary_field !== emailField.key) {
      setIfEmpty(contacts.fields.find((f) => f.key === contacts.primary_field), person.name || person.email.split('@')[0]);
    }
    setIfEmpty(byType('text', ['title', 'job_title', 'role']), person.title);
    setIfEmpty(byType('phone'), person.phone);

    if (companyField && person.company && !existing?.data[companyField.key]) {
      data[companyField.key] = findOrCreateCompany(crm, companyField.target_object_id, person.company, person.website).id;
    }

    // Promote to the lead stage unless they're already further along or have exited.
    const stageField = contacts.fields.find((f) => f.key === contacts.board_field);
    const leadStage = crm.getSettings().lead_stage;
    if (stageField?.options.includes(leadStage)) {
      const current = existing?.data[stageField.key];
      const order = stageField.options.filter((o) => !contacts.exit_stages.includes(o));
      if (!current || (order.includes(current) && order.indexOf(current) < order.indexOf(leadStage))) {
        data[stageField.key] = leadStage;
      }
    }

    const record = existing ? crm.updateRecord(existing.id, data) : crm.createRecord(contacts.id, data);

    let touches = Array.isArray(payload.touches) ? payload.touches.slice(-MAX_TOUCHES) : [];
    if (!touches.length && payload.page) touches = [{ ...payload.page, at: new Date().toISOString() }];
    let added = 0;
    for (const t of touches) {
      if (!t || typeof t !== 'object') continue;
      const tp = attribution.addTouchpointOnce(record.id, {
        occurred_at: t.at ?? t.occurred_at,
        channel: t.channel,
        source: t.source, medium: t.medium, campaign: t.campaign, content: t.content, term: t.term,
        referrer: t.referrer, landing_page: t.landing ?? t.landing_page, click_id: t.click_id, note: t.note,
      }, { origin });
      if (tp) added++;
    }

    const page = payload.page?.landing ?? payload.page?.url;
    const lines = [`${origin === 'webhook' ? 'Received via webhook' : 'Website form submitted'}${page ? ` on ${page}` : ''}.`];
    if (person.message) lines.push('', person.message);
    if (person.extra.length) lines.push('', ...person.extra.map(([k, v]) => `${k}: ${v}`));
    crm.createActivity({ record_id: record.id, type: 'note', body: lines.join('\n') });
    if (!existing) {
      const due = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      crm.createActivity({ record_id: record.id, type: 'task', body: `Follow up with new inbound lead ${record.title}`, due_at: due });
    }
    return { contact_id: record.id, created: !existing, touchpoints_added: added };
  });
}

function findOrCreateCompany(crm, objectId, name, website) {
  const obj = crm.getObject(objectId);
  const found = crm.findRecordBy(obj.id, obj.primary_field, name);
  if (found) return found;
  const data = { [obj.primary_field]: name };
  const urlField = obj.fields.find((f) => f.type === 'url');
  if (urlField && website) data[urlField.key] = website;
  try {
    return crm.createRecord(obj.id, data);
  } catch {
    // e.g. a malformed website or a required field we can't fill: keep just the name.
    return crm.createRecord(obj.id, { [obj.primary_field]: name });
  }
}

/** Converts a flat webhook body (Zapier, Calendly, etc.) into a capture payload. */
export function webhookPayload(body) {
  const fields = {};
  for (const [k, v] of Object.entries(body ?? {})) if (!ATTRIBUTION_KEYS.includes(k)) fields[k] = v;
  const touch = {
    channel: body.channel,
    source: body.source ?? body.utm_source,
    medium: body.medium ?? body.utm_medium,
    campaign: body.campaign ?? body.utm_campaign,
    content: body.content ?? body.utm_content,
    term: body.term ?? body.utm_term,
    referrer: body.referrer,
    landing: body.landing_page,
    note: body.note,
    at: body.occurred_at,
  };
  const hasTouch = Object.values(touch).some((v) => v !== undefined && v !== null && v !== '');
  return { fields, touches: hasTouch ? [touch] : [] };
}
