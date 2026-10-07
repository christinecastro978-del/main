import { transaction } from './db.js';

export const FIELD_TYPES = [
  'text', 'textarea', 'number', 'currency', 'date', 'email', 'phone', 'url',
  'select', 'multiselect', 'checkbox', 'relation',
];
export const ACTIVITY_TYPES = ['note', 'task', 'call', 'email', 'meeting'];

const SEARCHABLE_TYPES = new Set(['text', 'textarea', 'email', 'phone', 'url', 'select']);

export const DEFAULT_SETTINGS = {
  business_name: 'My Business',
  accent_color: '#4f46e5',
  currency: 'USD',
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

export function slugify(text, separator = '_') {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '');
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${name} is required`);
  return value.trim();
}

/**
 * The CRM domain layer. Everything the HTTP server and the CLI scripts do goes
 * through here, so validation lives in exactly one place.
 */
export class Crm {
  constructor(db) {
    this.db = db;
  }

  // ---------------------------------------------------------------- settings

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const settings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of rows) settings[key] = value;
    return settings;
  }

  updateSettings(patch) {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (patch[key] === undefined) continue;
      const value = String(patch[key]).trim();
      if (key === 'accent_color' && !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new HttpError(400, 'accent_color must be a hex color like #4f46e5');
      }
      if (key === 'currency' && !/^[A-Z]{3}$/.test(value)) {
        throw new HttpError(400, 'currency must be a 3-letter ISO code like USD');
      }
      if (!value) throw new HttpError(400, `${key} cannot be empty`);
      stmt.run(key, value);
    }
    return this.getSettings();
  }

  // ------------------------------------------------------------------ schema

  listObjects() {
    const objects = this.db.prepare('SELECT * FROM objects ORDER BY position, id').all();
    const fields = this.db.prepare('SELECT * FROM fields ORDER BY position, id').all();
    return objects.map((o) => ({
      ...o,
      fields: fields.filter((f) => f.object_id === o.id).map(this.#fieldOut),
    }));
  }

  #fieldOut = (f) => ({
    ...f,
    options: JSON.parse(f.options),
    required: !!f.required,
    show_in_list: !!f.show_in_list,
  });

  getObject(idOrSlug) {
    const o = typeof idOrSlug === 'number' || /^\d+$/.test(idOrSlug)
      ? this.db.prepare('SELECT * FROM objects WHERE id = ?').get(Number(idOrSlug))
      : this.db.prepare('SELECT * FROM objects WHERE slug = ?').get(idOrSlug);
    if (!o) throw new HttpError(404, `Object "${idOrSlug}" not found`);
    const fields = this.db
      .prepare('SELECT * FROM fields WHERE object_id = ? ORDER BY position, id')
      .all(o.id)
      .map(this.#fieldOut);
    return { ...o, fields };
  }

  createObject({ name, singular, icon, slug }) {
    name = requireString(name, 'name');
    singular = singular?.trim() || name.replace(/s$/i, '');
    slug = slugify(slug || name, '-');
    if (!slug) throw new HttpError(400, 'name must contain letters or numbers');
    if (this.db.prepare('SELECT 1 FROM objects WHERE slug = ?').get(slug)) {
      throw new HttpError(409, `An object with slug "${slug}" already exists`);
    }
    const position = this.db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM objects').get().p;
    return transaction(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare('INSERT INTO objects (slug, name, singular, icon, position, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(slug, name, singular, icon?.trim() || '📁', position, now());
      const id = Number(lastInsertRowid);
      // Every object needs a field that names its records.
      this.createField(id, { label: 'Name', type: 'text', required: true });
      return this.getObject(id);
    });
  }

  updateObject(idOrSlug, patch) {
    const o = this.getObject(idOrSlug);
    const next = { name: o.name, singular: o.singular, icon: o.icon, primary_field: o.primary_field, board_field: o.board_field, value_field: o.value_field };
    if (patch.name !== undefined) next.name = requireString(patch.name, 'name');
    if (patch.singular !== undefined) next.singular = requireString(patch.singular, 'singular');
    if (patch.icon !== undefined) next.icon = requireString(patch.icon, 'icon');
    const fieldByKey = Object.fromEntries(o.fields.map((f) => [f.key, f]));
    const checkField = (key, prop, types) => {
      if (patch[prop] === undefined) return;
      if (patch[prop] === null || patch[prop] === '') {
        if (prop === 'primary_field') throw new HttpError(400, 'primary_field cannot be empty');
        next[prop] = null;
        return;
      }
      const f = fieldByKey[patch[prop]];
      if (!f || !types.includes(f.type)) {
        throw new HttpError(400, `${prop} must be one of this object's ${types.join('/')} fields`);
      }
      next[prop] = f.key;
    };
    checkField('primary_field', 'primary_field', ['text', 'email', 'phone']);
    checkField('board_field', 'board_field', ['select']);
    checkField('value_field', 'value_field', ['number', 'currency']);
    this.db
      .prepare('UPDATE objects SET name = ?, singular = ?, icon = ?, primary_field = ?, board_field = ?, value_field = ? WHERE id = ?')
      .run(next.name, next.singular, next.icon, next.primary_field, next.board_field, next.value_field, o.id);
    return this.getObject(o.id);
  }

  deleteObject(idOrSlug) {
    const o = this.getObject(idOrSlug);
    transaction(this.db, () => {
      // Relation fields on other objects that point here would dangle; drop them.
      const incoming = this.db
        .prepare('SELECT id FROM fields WHERE target_object_id = ? AND object_id != ?')
        .all(o.id, o.id);
      for (const { id } of incoming) this.deleteField(id);
      this.db.prepare('DELETE FROM objects WHERE id = ?').run(o.id);
    });
  }

  reorderObjects(ids) {
    const stmt = this.db.prepare('UPDATE objects SET position = ? WHERE id = ?');
    transaction(this.db, () => ids.forEach((id, i) => stmt.run(i, Number(id))));
    return this.listObjects();
  }

  getField(id) {
    const f = this.db.prepare('SELECT * FROM fields WHERE id = ?').get(Number(id));
    if (!f) throw new HttpError(404, `Field ${id} not found`);
    return this.#fieldOut(f);
  }

  createField(objectIdOrSlug, { label, type, options, target_object, required, show_in_list, key }) {
    const o = this.getObject(objectIdOrSlug);
    label = requireString(label, 'label');
    if (!FIELD_TYPES.includes(type)) throw new HttpError(400, `type must be one of: ${FIELD_TYPES.join(', ')}`);

    key = slugify(key || label);
    if (!key) throw new HttpError(400, 'label must contain letters or numbers');
    if (/^\d/.test(key)) key = `f_${key}`;
    const taken = new Set(o.fields.map((f) => f.key));
    for (let base = key, n = 2; taken.has(key); n++) key = `${base}_${n}`;

    let targetId = null;
    if (type === 'relation') {
      if (target_object === undefined || target_object === null || target_object === '') {
        throw new HttpError(400, 'relation fields need a target_object');
      }
      targetId = this.getObject(target_object).id;
    }
    const opts = ['select', 'multiselect'].includes(type) ? cleanOptions(options) : [];
    if (['select', 'multiselect'].includes(type) && !opts.length) {
      throw new HttpError(400, `${type} fields need at least one option`);
    }

    const position = this.db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM fields WHERE object_id = ?')
      .get(o.id).p;
    const { lastInsertRowid } = this.db
      .prepare(`INSERT INTO fields (object_id, key, label, type, options, target_object_id, required, show_in_list, position)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(o.id, key, label, type, JSON.stringify(opts), targetId, required ? 1 : 0, show_in_list === false ? 0 : 1, position);

    if (!o.primary_field && ['text', 'email', 'phone'].includes(type)) {
      this.db.prepare('UPDATE objects SET primary_field = ? WHERE id = ?').run(key, o.id);
    }
    return this.getField(Number(lastInsertRowid));
  }

  /**
   * Updates a field's label, options, required and show_in_list flags.
   * A field's key and type are fixed once created so stored data stays valid.
   * For select fields, `renames: { old: new }` migrates stored values so
   * renaming a pipeline stage keeps every record in it.
   */
  updateField(id, patch) {
    const f = this.getField(id);
    if (patch.type !== undefined && patch.type !== f.type) {
      throw new HttpError(400, "A field's type can't be changed; create a new field instead");
    }
    const label = patch.label !== undefined ? requireString(patch.label, 'label') : f.label;
    const required = patch.required !== undefined ? !!patch.required : f.required;
    const showInList = patch.show_in_list !== undefined ? !!patch.show_in_list : f.show_in_list;
    let options = f.options;

    return transaction(this.db, () => {
      if (patch.options !== undefined && ['select', 'multiselect'].includes(f.type)) {
        options = cleanOptions(patch.options);
        if (!options.length) throw new HttpError(400, `${f.type} fields need at least one option`);
        const renames = patch.renames && typeof patch.renames === 'object' ? patch.renames : {};
        const path = `$.${f.key}`;
        const rows = this.db
          .prepare('SELECT id, data FROM records WHERE object_id = ? AND json_extract(data, ?) IS NOT NULL')
          .all(f.object_id, path);
        const update = this.db.prepare('UPDATE records SET data = ? WHERE id = ?');
        const valid = new Set(options);
        const migrate = (v) => {
          const renamed = Object.hasOwn(renames, v) ? String(renames[v]).trim() : v;
          return valid.has(renamed) ? renamed : null;
        };
        for (const row of rows) {
          const data = JSON.parse(row.data);
          const before = JSON.stringify(data[f.key]);
          if (f.type === 'select') {
            const v = migrate(data[f.key]);
            if (v === null) delete data[f.key];
            else data[f.key] = v;
          } else {
            const list = [...new Set([].concat(data[f.key]).map(migrate).filter((v) => v !== null))];
            if (list.length) data[f.key] = list;
            else delete data[f.key];
          }
          if (JSON.stringify(data[f.key]) !== before) update.run(JSON.stringify(data), row.id);
        }
      }
      this.db
        .prepare('UPDATE fields SET label = ?, options = ?, required = ?, show_in_list = ? WHERE id = ?')
        .run(label, JSON.stringify(options), required ? 1 : 0, showInList ? 1 : 0, f.id);
      return this.getField(f.id);
    });
  }

  deleteField(id) {
    const f = this.getField(id);
    const o = this.getObject(f.object_id);
    if (o.primary_field === f.key) {
      throw new HttpError(400, `"${f.label}" is the primary field of ${o.name}; choose another primary field first`);
    }
    transaction(this.db, () => {
      this.db
        .prepare('UPDATE records SET data = json_remove(data, ?) WHERE object_id = ?')
        .run(`$.${f.key}`, f.object_id);
      if (o.board_field === f.key) this.db.prepare('UPDATE objects SET board_field = NULL WHERE id = ?').run(o.id);
      if (o.value_field === f.key) this.db.prepare('UPDATE objects SET value_field = NULL WHERE id = ?').run(o.id);
      this.db.prepare('DELETE FROM fields WHERE id = ?').run(f.id);
    });
  }

  reorderFields(objectIdOrSlug, ids) {
    const o = this.getObject(objectIdOrSlug);
    const stmt = this.db.prepare('UPDATE fields SET position = ? WHERE id = ? AND object_id = ?');
    transaction(this.db, () => ids.forEach((id, i) => stmt.run(i, Number(id), o.id)));
    return this.getObject(o.id);
  }

  // ----------------------------------------------------------------- records

  /** Coerces and validates input against the object's fields. */
  #validate(o, input, { partial }) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new HttpError(400, 'data must be an object');
    }
    const out = {};
    const errors = [];
    for (const f of o.fields) {
      if (!Object.hasOwn(input, f.key)) {
        if (!partial && f.required) errors.push(`${f.label} is required`);
        continue;
      }
      try {
        const value = this.#coerce(f, input[f.key]);
        if (value === null && f.required) errors.push(`${f.label} is required`);
        out[f.key] = value;
      } catch (err) {
        errors.push(`${f.label}: ${err.message}`);
      }
    }
    if (errors.length) throw new HttpError(400, errors.join('; '));
    return out;
  }

  #coerce(f, raw) {
    if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
      return f.type === 'checkbox' ? false : null;
    }
    const str = () => String(raw).trim();
    switch (f.type) {
      case 'text':
      case 'phone':
        return str().replace(/\s+/g, ' ');
      case 'textarea':
        return String(raw).trim();
      case 'number':
      case 'currency': {
        const n = typeof raw === 'number' ? raw : Number(str().replace(/[,\s$€£¥]/g, ''));
        if (!Number.isFinite(n)) throw new Error('must be a number');
        return f.type === 'currency' ? Math.round(n * 100) / 100 : n;
      }
      case 'date': {
        const s = str().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Error('must be a date (YYYY-MM-DD)');
        return s;
      }
      case 'email': {
        const s = str().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw new Error('must be a valid email address');
        return s;
      }
      case 'url': {
        let s = str();
        if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
        let u;
        try { u = new URL(s); } catch { throw new Error('must be a valid URL'); }
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('must be an http(s) URL');
        return s;
      }
      case 'select': {
        const s = str();
        const match = f.options.find((opt) => opt.toLowerCase() === s.toLowerCase());
        if (!match) throw new Error(`must be one of: ${f.options.join(', ')}`);
        return match;
      }
      case 'multiselect': {
        const list = Array.isArray(raw) ? raw : String(raw).split(/[;,]/);
        const out = [];
        for (const item of list.map((v) => String(v).trim()).filter(Boolean)) {
          const match = f.options.find((opt) => opt.toLowerCase() === item.toLowerCase());
          if (!match) throw new Error(`"${item}" is not one of: ${f.options.join(', ')}`);
          if (!out.includes(match)) out.push(match);
        }
        return out.length ? out : null;
      }
      case 'checkbox':
        if (typeof raw === 'boolean') return raw;
        if (/^(true|1|yes|y|on|x)$/i.test(str())) return true;
        if (/^(false|0|no|n|off)$/i.test(str())) return false;
        throw new Error('must be true or false');
      case 'relation': {
        const id = Number(raw);
        if (!Number.isInteger(id)) throw new Error('must be a record id');
        const exists = this.db
          .prepare('SELECT 1 FROM records WHERE id = ? AND object_id = ?')
          .get(id, f.target_object_id);
        if (!exists) throw new Error(`record ${id} not found`);
        return id;
      }
      default:
        throw new Error(`unknown field type ${f.type}`);
    }
  }

  #title(o, data) {
    const v = o.primary_field ? data[o.primary_field] : null;
    return v === null || v === undefined || v === '' ? `Untitled ${o.singular.toLowerCase()}` : String(v);
  }

  /** Shapes DB rows for the API, resolving relation ids to titles in one pass. */
  #recordsOut(o, rows) {
    const relFields = o.fields.filter((f) => f.type === 'relation');
    const parsed = rows.map((r) => ({ ...r, data: JSON.parse(r.data) }));
    const refIds = new Set();
    for (const r of parsed) for (const f of relFields) if (r.data[f.key] != null) refIds.add(r.data[f.key]);
    const refs = new Map();
    if (refIds.size) {
      const objects = new Map(this.listObjects().map((x) => [x.id, x]));
      const ids = [...refIds];
      const placeholders = ids.map(() => '?').join(',');
      for (const ref of this.db.prepare(`SELECT id, object_id, data FROM records WHERE id IN (${placeholders})`).all(...ids)) {
        const target = objects.get(ref.object_id);
        refs.set(ref.id, { id: ref.id, object: target.slug, title: this.#title(target, JSON.parse(ref.data)) });
      }
    }
    return parsed.map((r) => {
      const out = { id: r.id, object: o.slug, title: this.#title(o, r.data), data: r.data, refs: {}, created_at: r.created_at, updated_at: r.updated_at };
      for (const f of relFields) {
        const ref = refs.get(r.data[f.key]);
        if (ref) out.refs[f.key] = ref;
      }
      return out;
    });
  }

  /**
   * Lists records. Options:
   *   q       - case-insensitive search across text-like fields
   *   sort    - field key, or created_at / updated_at (default: updated_at)
   *   dir     - asc | desc
   *   filters - { fieldKey: value } exact matches (multiselect: contains)
   *   limit / offset
   */
  listRecords(objectIdOrSlug, { q, sort, dir, filters = {}, limit = 50, offset = 0 } = {}) {
    const o = this.getObject(objectIdOrSlug);
    const where = ['object_id = ?'];
    const params = [o.id];

    if (q && String(q).trim()) {
      const searchable = o.fields.filter((f) => SEARCHABLE_TYPES.has(f.type) || f.type === 'multiselect');
      if (searchable.length) {
        // json_extract returns JSON text for arrays, so multiselect values are matched too.
        where.push(`(${searchable.map(() => "json_extract(data, ?) LIKE ? ESCAPE '\\'").join(' OR ')})`);
        const like = `%${String(q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        for (const f of searchable) params.push(`$.${f.key}`, like);
      }
    }

    for (const [key, value] of Object.entries(filters)) {
      const f = o.fields.find((x) => x.key === key);
      if (!f) throw new HttpError(400, `Unknown filter field "${key}"`);
      const path = `$.${f.key}`;
      if (value === '' || value === null) {
        where.push('json_extract(data, ?) IS NULL');
        params.push(path);
      } else if (f.type === 'multiselect') {
        where.push('EXISTS (SELECT 1 FROM json_each(data, ?) WHERE value = ?)');
        params.push(path, String(value));
      } else if (f.type === 'checkbox') {
        where.push('COALESCE(json_extract(data, ?), 0) = ?');
        params.push(path, /^(true|1)$/i.test(String(value)) ? 1 : 0);
      } else if (['number', 'currency', 'relation'].includes(f.type)) {
        where.push('json_extract(data, ?) = ?');
        params.push(path, Number(value));
      } else {
        where.push('json_extract(data, ?) = ?');
        params.push(path, String(value));
      }
    }

    let order = 'updated_at';
    const orderParams = [];
    if (sort === 'created_at' || sort === 'updated_at') order = sort;
    else if (sort) {
      const f = o.fields.find((x) => x.key === sort);
      if (!f) throw new HttpError(400, `Unknown sort field "${sort}"`);
      const textual = SEARCHABLE_TYPES.has(f.type);
      order = textual ? 'lower(json_extract(data, ?))' : 'json_extract(data, ?)';
      orderParams.push(`$.${f.key}`);
    }
    const direction = dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : sort && !['created_at', 'updated_at'].includes(sort) ? 'ASC' : 'DESC';
    const nulls = direction === 'ASC' ? 'NULLS LAST' : 'NULLS FIRST';

    const whereSql = where.join(' AND ');
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${whereSql}`).get(...params).n;
    limit = Math.min(Math.max(Number(limit) || 50, 1), 1000);
    offset = Math.max(Number(offset) || 0, 0);
    const rows = this.db
      .prepare(`SELECT * FROM records WHERE ${whereSql} ORDER BY ${order} ${direction} ${nulls}, id ${direction} LIMIT ? OFFSET ?`)
      .all(...params, ...orderParams, limit, offset);
    return { total, records: this.#recordsOut(o, rows) };
  }

  getRecord(id) {
    const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(Number(id));
    if (!row) throw new HttpError(404, `Record ${id} not found`);
    const o = this.getObject(row.object_id);
    return this.#recordsOut(o, [row])[0];
  }

  createRecord(objectIdOrSlug, input) {
    const o = this.getObject(objectIdOrSlug);
    const data = stripEmpty(this.#validate(o, input, { partial: false }));
    const ts = now();
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO records (object_id, data, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(o.id, JSON.stringify(data), ts, ts);
    return this.getRecord(Number(lastInsertRowid));
  }

  updateRecord(id, input) {
    const current = this.getRecord(id);
    const o = this.getObject(current.object);
    const patch = this.#validate(o, input, { partial: true });
    const data = stripEmpty({ ...current.data, ...patch });
    this.db.prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(data), now(), current.id);
    return this.getRecord(current.id);
  }

  deleteRecord(id) {
    const r = this.getRecord(id);
    const o = this.getObject(r.object);
    transaction(this.db, () => {
      // Clear relation fields that point at this record.
      const incoming = this.db.prepare("SELECT object_id, key FROM fields WHERE type = 'relation' AND target_object_id = ?").all(o.id);
      for (const f of incoming) {
        this.db
          .prepare('UPDATE records SET data = json_remove(data, ?) WHERE object_id = ? AND json_extract(data, ?) = ?')
          .run(`$.${f.key}`, f.object_id, `$.${f.key}`, r.id);
      }
      this.db.prepare('DELETE FROM records WHERE id = ?').run(r.id);
    });
  }

  /** Records on other objects whose relation fields point at this record. */
  relatedRecords(id) {
    const r = this.getRecord(id);
    const o = this.getObject(r.object);
    const groups = [];
    for (const src of this.listObjects()) {
      for (const f of src.fields) {
        if (f.type !== 'relation' || f.target_object_id !== o.id) continue;
        const { records, total } = this.listRecords(src.id, { filters: { [f.key]: r.id }, limit: 100 });
        groups.push({ object: src.slug, name: src.name, singular: src.singular, icon: src.icon, field: f.key, field_label: f.label, total, records });
      }
    }
    return groups;
  }

  // -------------------------------------------------------------- activities

  #activityOut = (a) => (a && { ...a, done: !!a.done });

  listActivities({ record_id, type, done, limit = 100 } = {}) {
    const where = [];
    const params = [];
    if (record_id !== undefined) { where.push('a.record_id = ?'); params.push(Number(record_id)); }
    if (type) { where.push('a.type = ?'); params.push(type); }
    if (done !== undefined && done !== '') { where.push('a.done = ?'); params.push(/^(true|1)$/i.test(String(done)) ? 1 : 0); }
    const sql = `SELECT a.*, r.object_id FROM activities a LEFT JOIN records r ON r.id = a.record_id
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY ${type === 'task' ? 'a.done, a.due_at IS NULL, a.due_at,' : ''} a.created_at DESC, a.id DESC LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, Math.min(Number(limit) || 100, 1000));
    const objects = new Map(this.listObjects().map((o) => [o.id, o]));
    const recordStmt = this.db.prepare('SELECT data FROM records WHERE id = ?');
    return rows.map(({ object_id, ...a }) => {
      const out = this.#activityOut(a);
      if (a.record_id && objects.has(object_id)) {
        const o = objects.get(object_id);
        out.record = { id: a.record_id, object: o.slug, title: this.#title(o, JSON.parse(recordStmt.get(a.record_id).data)) };
      }
      return out;
    });
  }

  getActivity(id) {
    const a = this.#activityOut(this.db.prepare('SELECT * FROM activities WHERE id = ?').get(Number(id)));
    if (!a) throw new HttpError(404, `Activity ${id} not found`);
    return a;
  }

  #checkActivity({ type, body, due_at }) {
    if (type !== undefined && !ACTIVITY_TYPES.includes(type)) {
      throw new HttpError(400, `type must be one of: ${ACTIVITY_TYPES.join(', ')}`);
    }
    if (body !== undefined) requireString(body, 'body');
    if (due_at && Number.isNaN(Date.parse(due_at))) throw new HttpError(400, 'due_at must be a date');
  }

  createActivity({ record_id, type = 'note', body, due_at, done }) {
    this.#checkActivity({ type, body: body ?? '', due_at });
    if (record_id !== undefined && record_id !== null) this.getRecord(record_id);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO activities (record_id, type, body, due_at, done, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(record_id ?? null, type, body.trim(), due_at || null, done ? 1 : 0, now());
    return this.getActivity(Number(lastInsertRowid));
  }

  updateActivity(id, patch) {
    const a = this.getActivity(id);
    this.#checkActivity(patch);
    const next = {
      type: patch.type ?? a.type,
      body: patch.body !== undefined ? patch.body.trim() : a.body,
      due_at: patch.due_at !== undefined ? patch.due_at || null : a.due_at,
      done: patch.done !== undefined ? !!patch.done : a.done,
    };
    this.db
      .prepare('UPDATE activities SET type = ?, body = ?, due_at = ?, done = ? WHERE id = ?')
      .run(next.type, next.body, next.due_at, next.done ? 1 : 0, a.id);
    return this.getActivity(a.id);
  }

  deleteActivity(id) {
    this.getActivity(id);
    this.db.prepare('DELETE FROM activities WHERE id = ?').run(Number(id));
  }

  // --------------------------------------------------------------- dashboard

  dashboard() {
    const objects = this.listObjects().map((o) => {
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM records WHERE object_id = ?').get(o.id).n;
      const out = { slug: o.slug, name: o.name, icon: o.icon, count };
      const board = o.fields.find((f) => f.key === o.board_field);
      if (board) {
        const valuePath = o.value_field ? `$.${o.value_field}` : null;
        const rows = this.db
          .prepare(`SELECT json_extract(data, ?) AS stage, COUNT(*) AS n, ${valuePath ? 'SUM(COALESCE(json_extract(data, ?), 0))' : '0'} AS value
                    FROM records WHERE object_id = ? GROUP BY stage`)
          .all(...(valuePath ? [`$.${o.board_field}`, valuePath] : [`$.${o.board_field}`]), o.id);
        const byStage = new Map(rows.map((r) => [r.stage, r]));
        out.board = {
          field: board.key,
          label: board.label,
          value_field: o.value_field,
          stages: board.options.map((s) => ({ stage: s, count: byStage.get(s)?.n ?? 0, value: byStage.get(s)?.value ?? 0 })),
        };
      }
      return out;
    });
    const today = new Date().toISOString().slice(0, 10);
    const openTasks = this.listActivities({ type: 'task', done: false, limit: 200 });
    return {
      objects,
      tasks: {
        open: openTasks.length,
        overdue: openTasks.filter((t) => t.due_at && t.due_at.slice(0, 10) < today).length,
        upcoming: openTasks.slice(0, 8),
      },
      recent: this.listActivities({ limit: 10 }),
    };
  }
}

function cleanOptions(options) {
  const list = Array.isArray(options) ? options : String(options ?? '').split(/\r?\n|,/);
  return [...new Set(list.map((o) => String(o).trim()).filter(Boolean))];
}

function stripEmpty(data) {
  for (const [k, v] of Object.entries(data)) if (v === null || v === undefined) delete data[k];
  return data;
}
