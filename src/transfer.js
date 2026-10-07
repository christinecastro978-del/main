import { parseCsv, toCsv } from './csv.js';
import { HttpError } from './crm.js';

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

/**
 * Imports CSV rows as new records. Columns are matched to fields by label or
 * key (case-insensitive); unknown columns are ignored. Relation columns may
 * hold a record id or the related record's name.
 */
export function importCsv(crm, objectSlug, text) {
  const o = crm.getObject(objectSlug);
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new HttpError(400, 'The CSV file is empty');

  const norm = (s) => String(s).trim().toLowerCase();
  const columns = header.map((h) => o.fields.find((f) => norm(f.label) === norm(h) || f.key === norm(h)) ?? null);
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
      const data = {};
      columns.forEach((f, c) => {
        if (!f) return;
        const value = row[c] ?? '';
        data[f.key] = f.type === 'relation' && value.trim() ? resolveRelation(f, value) : value;
      });
      crm.createRecord(o.id, data);
      created++;
    } catch (err) {
      errors.push({ row: i + 2, error: err.message });
    }
  });
  return { created, errors, ignored_columns: header.filter((_, c) => !columns[c]) };
}
