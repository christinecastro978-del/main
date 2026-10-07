import { parseCsv, toCsv } from './csv.js';
import { HttpError } from './crm.js';
import { transaction } from './db.js';

const PAGE = 1000;

export function exportCsv(crm, objectSlug) {
  const o = crm.getObject(objectSlug);
  const rows = [['ID', ...o.fields.map((f) => f.label), 'Created', 'Updated']];
  for (let offset = 0; ; offset += PAGE) {
    const { records } = crm.listRecords(o.id, { sort: 'created_at', dir: 'asc', limit: PAGE, offset });
    for (const r of records) {
      rows.push([
        r.id,
        ...o.fields.map((f) => {
          const v = r.data[f.key];
          if (f.type === 'relation') return r.refs[f.key]?.title ?? '';
          if (f.type === 'multiselect') return (v ?? []).join('; ');
          if (f.type === 'checkbox') return v ? 'yes' : 'no';
          return v ?? '';
        }),
        r.created_at,
        r.updated_at,
      ]);
    }
    if (records.length < PAGE) break;
  }
  return toCsv(rows);
}

// Columns that describe where a record came from rather than a field on it.
const TOUCH_COLUMNS = {
  channel: 'channel', 'lead source': 'lead_source',
  source: 'source', utm_source: 'source', 'utm source': 'source',
  medium: 'medium', utm_medium: 'medium', 'utm medium': 'medium',
  campaign: 'campaign', utm_campaign: 'campaign', 'utm campaign': 'campaign',
  'touch date': 'occurred_at', 'source date': 'occurred_at', 'first touch date': 'occurred_at',
  'touch note': 'note',
};

/**
 * Imports CSV rows as new records. Columns are matched to fields by label or
 * key (case-insensitive). Relation columns may hold a record id or the related
 * record's name. With `attribution`, columns like Channel, Lead source, UTM
 * source/medium/campaign and Touch date become a touchpoint on each record.
 * Other columns are ignored.
 */
export function importCsv(crm, objectSlug, text, attribution) {
  const o = crm.getObject(objectSlug);
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new HttpError(400, 'The CSV file is empty');

  const norm = (s) => String(s).trim().toLowerCase();
  const columns = header.map((h) => o.fields.find((f) => norm(f.label) === norm(h) || f.key === norm(h)) ?? null);
  const touchColumns = attribution ? header.map((h, c) => (columns[c] ? null : TOUCH_COLUMNS[norm(h)] ?? null)) : [];
  const channels = new Map(crm.settingList('channels').map((ch) => [norm(ch), ch]));
  if (!columns.some(Boolean)) {
    throw new HttpError(400, `No CSV columns match ${o.name} fields (${o.fields.map((f) => f.label).join(', ')})`);
  }

  const lookups = new Map();
  const resolveRelation = (f, value) => {
    if (/^\d+$/.test(value.trim())) return Number(value);
    if (!lookups.has(f.key)) {
      const target = crm.getObject(f.target_object_id);
      const byTitle = new Map();
      for (let offset = 0; ; offset += PAGE) {
        const { records } = crm.listRecords(target.id, { limit: PAGE, offset });
        for (const r of records) if (!byTitle.has(norm(r.title))) byTitle.set(norm(r.title), r.id);
        if (records.length < PAGE) break;
      }
      lookups.set(f.key, { target, byTitle });
    }
    const { target, byTitle } = lookups.get(f.key);
    const id = byTitle.get(norm(value));
    if (!id) throw new HttpError(400, `${f.label}: no ${target.singular.toLowerCase()} named "${value}"`);
    return id;
  };

  let created = 0;
  const errors = [];
  rows.forEach((row, i) => {
    try {
      transaction(crm.db, () => importRow(row));
      created++;
    } catch (err) {
      errors.push({ row: i + 2, error: err.message });
    }
  });
  return { created, errors, ignored_columns: header.filter((_, c) => !columns[c] && !touchColumns[c]) };

  function importRow(row) {
    const data = {};
    columns.forEach((f, c) => {
      if (!f) return;
      const value = row[c] ?? '';
      data[f.key] = f.type === 'relation' && value.trim() ? resolveRelation(f, value) : value;
    });
    const record = crm.createRecord(o.id, data);
    const touch = {};
    touchColumns.forEach((key, c) => { if (key && row[c]?.trim()) touch[key] = row[c].trim(); });
    if (touch.lead_source) {
      // A known channel name goes in channel; anything else (a person, an event) is the source.
      const known = channels.get(norm(touch.lead_source));
      if (known && !touch.channel) touch.channel = known;
      else if (!touch.source) touch.source = touch.lead_source;
      delete touch.lead_source;
    }
    if (touch.channel) touch.channel = channels.get(norm(touch.channel)) ?? touch.channel;
    if (Object.keys(touch).some((k) => k !== 'occurred_at' && k !== 'note')) {
      attribution.addTouchpoint(record.id, touch, { origin: 'import' });
    }
  }
}
