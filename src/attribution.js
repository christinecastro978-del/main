import { HttpError } from './crm.js';

export const MODELS = {
  first_touch: 'First touch',
  last_touch: 'Last touch',
  linear: 'Linear',
  u_shaped: 'U-shaped (40/20/40)',
  time_decay: 'Time decay (7-day half-life)',
};
export const GROUPS = ['channel', 'source', 'campaign'];
export const UNATTRIBUTED = 'Unattributed';

const DAY = 86400000;
const HALF_LIFE_DAYS = 7;

const SOCIAL = /(^|\.)(linkedin\.com|lnkd\.in|twitter\.com|x\.com|t\.co|facebook\.com|fb\.com|instagram\.com|youtube\.com|youtu\.be|reddit\.com|threads\.net|bsky\.app|news\.ycombinator\.com|medium\.com|substack\.com)$/;
const SOCIAL_NAMES = /^(linkedin|li|twitter|x|facebook|fb|instagram|ig|youtube|reddit|threads|bluesky|hackernews|hn|medium|substack)$/i;
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com)$/;
const AI_NAMES = /^(chatgpt|openai|perplexity|claude|gemini|copilot)$/i;
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|baidu\.com|yandex\.[a-z]+|search\.brave\.com|startpage\.com)$/;
const SEARCH_NAMES = /^(google|bing|duckduckgo|yahoo|ecosia|brave)$/i;

function host(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Infers a marketing channel from UTM parameters, ad click ids and the
 * referrer, following the usual analytics conventions.
 */
export function classifyChannel({ source, medium, referrer, click_id: clickId } = {}) {
  const m = String(medium ?? '').toLowerCase().trim();
  const src = String(source ?? '').toLowerCase().trim();
  const ref = host(referrer);
  const social = SOCIAL_NAMES.test(src) || SOCIAL.test(src) || SOCIAL.test(ref);

  if (/^(cpc|ppc|paid|paidsearch|paid[-_ ]search|sem)$/.test(m) || /^(gclid|msclkid)$/.test(clickId ?? '')) {
    return social ? 'Paid social' : 'Paid search';
  }
  if (/(paid|sponsored)/.test(m) || clickId === 'li_fat_id') return 'Paid social';
  if (/^(e-?mail|newsletter)$/.test(m)) return 'Email';
  if (/(^social|organic[-_ ]social|social[-_ ]?media|^sm$)/.test(m)) return 'Organic social';
  if (/podcast/.test(m)) return 'Podcast';
  if (/(event|conference|webinar)/.test(m)) return m.includes('webinar') ? 'Content / Webinar' : 'Events';
  if (/partner|affiliate/.test(m)) return 'Partner';
  if (/referral/.test(m)) return 'Referral';
  if (/^organic$/.test(m)) return SEARCH_NAMES.test(src) ? 'Organic search' : 'Other';
  if (AI_NAMES.test(src) || AI.test(src) || AI.test(ref)) return 'AI assistants';
  if (social) return 'Organic social';
  if (SEARCH_NAMES.test(src) || SEARCH.test(ref)) return 'Organic search';
  if (src) return 'Other';
  if (ref) return 'Website referral';
  return 'Direct';
}

/** Splits one unit of credit across touches (sorted oldest first). */
export function credits(model, touches, conversionAt) {
  const n = touches.length;
  if (!n) return [];
  switch (model) {
    case 'first_touch': return touches.map((_, i) => (i === 0 ? 1 : 0));
    case 'last_touch': return touches.map((_, i) => (i === n - 1 ? 1 : 0));
    case 'linear': return touches.map(() => 1 / n);
    case 'u_shaped':
      if (n === 1) return [1];
      if (n === 2) return [0.5, 0.5];
      return touches.map((_, i) => (i === 0 || i === n - 1 ? 0.4 : 0.2 / (n - 2)));
    case 'time_decay': {
      const end = Math.max(Date.parse(conversionAt) || 0, ...touches.map((t) => Date.parse(t.occurred_at)));
      const weights = touches.map((t) => 2 ** (-((end - Date.parse(t.occurred_at)) / DAY) / HALF_LIFE_DAYS));
      const total = weights.reduce((a, b) => a + b, 0);
      return weights.map((w) => w / total);
    }
    default: throw new HttpError(400, `model must be one of: ${Object.keys(MODELS).join(', ')}`);
  }
}

const clip = (v, max = 300) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

function parseRange({ from, to }) {
  const check = (v, name) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${name} must be a date (YYYY-MM-DD)`);
    return v;
  };
  const start = check(from, 'from');
  const end = check(to, 'to');
  return {
    from: start, to: end,
    // Compare ISO timestamps as strings; `to` includes the whole day.
    contains: (iso) => !!iso && (!start || iso >= start) && (!end || iso.slice(0, 10) <= end),
  };
}

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
const round = (n, digits = 1) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10 ** digits) / 10 ** digits);
const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const median = (list) => {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export class Attribution {
  constructor(crm) {
    this.crm = crm;
    this.db = crm.db;
  }

  /** The configured people and revenue objects (either may be null). */
  config() {
    const settings = this.crm.getSettings();
    const find = (slug) => (slug ? this.crm.listObjects().find((o) => o.slug === slug) ?? null : null);
    return { contacts: find(settings.contact_object), deals: find(settings.deal_object) };
  }

  // -------------------------------------------------------------- touchpoints

  addTouchpoint(recordId, input, { origin = 'manual' } = {}) {
    this.crm.getRecord(recordId);
    const t = this.#cleanTouch(input);
    const { lastInsertRowid } = this.db
      .prepare(`INSERT INTO touchpoints (record_id, occurred_at, channel, source, medium, campaign, content, term,
                landing_page, referrer, note, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(Number(recordId), t.occurred_at, t.channel, t.source, t.medium, t.campaign, t.content, t.term,
        t.landing_page, t.referrer, t.note, origin, new Date().toISOString());
    return this.getTouchpoint(Number(lastInsertRowid));
  }

  /** Adds a touch unless an identical one (same moment and parameters) is already on the record. */
  addTouchpointOnce(recordId, input, opts) {
    const t = this.#cleanTouch(input);
    const dup = this.db
      .prepare(`SELECT id FROM touchpoints WHERE record_id = ? AND occurred_at = ? AND channel = ?
                AND COALESCE(source, '') = COALESCE(?, '') AND COALESCE(campaign, '') = COALESCE(?, '')
                AND COALESCE(landing_page, '') = COALESCE(?, '')`)
      .get(Number(recordId), t.occurred_at, t.channel, t.source, t.campaign, t.landing_page);
    return dup ? null : this.addTouchpoint(recordId, t, opts);
  }

  #cleanTouch(input) {
    if (!input || typeof input !== 'object') throw new HttpError(400, 'touchpoint must be an object');
    let occurredAt = new Date().toISOString();
    if (input.occurred_at) {
      const ts = Date.parse(input.occurred_at);
      if (Number.isNaN(ts)) throw new HttpError(400, 'occurred_at must be a date');
      if (ts > Date.now() + DAY) throw new HttpError(400, "occurred_at can't be in the future");
      occurredAt = new Date(ts).toISOString();
    }
    const t = {
      occurred_at: occurredAt,
      source: clip(input.source),
      medium: clip(input.medium),
      campaign: clip(input.campaign),
      content: clip(input.content),
      term: clip(input.term),
      landing_page: clip(input.landing_page, 2000),
      referrer: clip(input.referrer, 2000),
      note: clip(input.note, 2000),
    };
    t.channel = clip(input.channel, 100) ?? classifyChannel({ ...t, click_id: input.click_id });
    return t;
  }

  getTouchpoint(id) {
    const t = this.db.prepare('SELECT * FROM touchpoints WHERE id = ?').get(Number(id));
    if (!t) throw new HttpError(404, `Touchpoint ${id} not found`);
    return t;
  }

  deleteTouchpoint(id) {
    this.getTouchpoint(id);
    this.db.prepare('DELETE FROM touchpoints WHERE id = ?').run(Number(id));
  }

  #touchesByRecord(recordIds) {
    const map = new Map();
    const ids = recordIds ? [...new Set(recordIds)] : null;
    if (ids && !ids.length) return map;
    const rows = ids
      ? this.db.prepare(`SELECT * FROM touchpoints WHERE record_id IN (${ids.map(() => '?').join(',')}) ORDER BY occurred_at, id`).all(...ids)
      : this.db.prepare('SELECT * FROM touchpoints ORDER BY occurred_at, id').all();
    for (const t of rows) {
      if (!map.has(t.record_id)) map.set(t.record_id, []);
      map.get(t.record_id).push(t);
    }
    return map;
  }

  /**
   * Maps each deal to the people whose touches count toward it: people linked
   * directly (Deal → Contact) and people at a linked account (Deal → Company ←
   * Contact).
   */
  #dealPeople(dealObj, contactObj, dealRecords) {
    const result = new Map(dealRecords.map((d) => [d.id, new Set()]));
    if (!contactObj) return result;
    const contactRows = this.db.prepare('SELECT id, data FROM records WHERE object_id = ?').all(contactObj.id)
      .map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
    for (const f of dealObj.fields.filter((x) => x.type === 'relation')) {
      if (f.target_object_id === contactObj.id) {
        for (const d of dealRecords) if (d.data[f.key]) result.get(d.id).add(d.data[f.key]);
        continue;
      }
      for (const g of contactObj.fields.filter((x) => x.type === 'relation' && x.target_object_id === f.target_object_id)) {
        const index = new Map();
        for (const c of contactRows) {
          const v = c.data[g.key];
          if (v == null) continue;
          if (!index.has(v)) index.set(v, []);
          index.get(v).push(c.id);
        }
        for (const d of dealRecords) for (const id of index.get(d.data[f.key]) ?? []) result.get(d.id).add(id);
      }
    }
    return result;
  }

  /**
   * The touches credited for each deal: its people's touches (plus any logged
   * on the deal itself) up to the end of the day it was opened, or all of
   * them if none came before.
   */
  #dealTouches(dealObj, contactObj, dealRecords) {
    const people = this.#dealPeople(dealObj, contactObj, dealRecords);
    const allIds = dealRecords.map((d) => d.id);
    for (const set of people.values()) allIds.push(...set);
    const byRecord = this.#touchesByRecord(allIds);
    const out = new Map();
    for (const d of dealRecords) {
      const touches = [...(byRecord.get(d.id) ?? [])];
      for (const pid of people.get(d.id)) touches.push(...(byRecord.get(pid) ?? []));
      touches.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id - b.id);
      const cutoff = new Date(Date.parse(d.created_at) + DAY).toISOString();
      const before = touches.filter((t) => t.occurred_at <= cutoff);
      out.set(d.id, before.length ? before : touches);
    }
    return out;
  }

  #records(obj) {
    return this.db.prepare('SELECT * FROM records WHERE object_id = ?').all(obj.id)
      .map((r) => ({ ...r, data: JSON.parse(r.data) }));
  }

  /** First-touch source for list views: Map recordId → { channel, source }. */
  firstTouches(objectSlug, records) {
    const { contacts, deals } = this.config();
    const out = new Map();
    if (!records.length) return out;
    let touches;
    if (deals && objectSlug === deals.slug) {
      touches = this.#dealTouches(deals, contacts, records);
    } else {
      touches = this.#touchesByRecord(records.map((r) => r.id));
    }
    for (const r of records) {
      const t = touches.get(r.id)?.[0];
      if (t) out.set(r.id, { channel: t.channel, source: t.source, campaign: t.campaign });
    }
    return out;
  }

  /** Everything the record page shows about how this record was won over. */
  journey(recordId, model = 'u_shaped') {
    const record = this.crm.getRecord(recordId);
    const obj = this.crm.getObject(record.object);
    const { contacts, deals } = this.config();
    let touches;
    let conversionAt = record.created_at;
    if (deals && obj.id === deals.id) {
      const row = { id: record.id, data: record.data, created_at: record.created_at };
      touches = this.#dealTouches(deals, contacts, [row]).get(record.id);
    } else {
      touches = this.#touchesByRecord([record.id]).get(record.id) ?? [];
      conversionAt = touches.at(-1)?.occurred_at ?? record.created_at;
    }
    const titles = new Map();
    const titleOf = (id) => {
      if (!titles.has(id)) titles.set(id, this.crm.getRecord(id));
      const r = titles.get(id);
      return { id: r.id, object: r.object, title: r.title };
    };
    const split = credits(model, touches, conversionAt);
    const byChannel = {};
    touches.forEach((t, i) => { byChannel[t.channel] = (byChannel[t.channel] ?? 0) + split[i]; });
    return {
      model,
      touchpoints: touches.map((t, i) => ({ ...t, credit: round(split[i], 3), record: t.record_id === record.id ? null : titleOf(t.record_id) })),
      first: touches[0] ?? null,
      last: touches.at(-1) ?? null,
      credit_by_channel: Object.entries(byChannel).map(([channel, credit]) => ({ channel, credit: round(credit, 3) })).sort((a, b) => b.credit - a.credit),
      stage_history: obj.board_field ? this.crm.stageHistory(record.id, obj.board_field) : [],
      days_since_first_touch: touches.length ? round(days(touches[0].occurred_at, new Date().toISOString())) : null,
    };
  }

  // ------------------------------------------------------------------ reports

  /**
   * Credits leads, pipeline and revenue to channels (or sources/campaigns)
   * under the chosen attribution model.
   */
  report({ from, to, model = 'u_shaped', group_by: groupBy = 'channel' } = {}) {
    if (!MODELS[model]) throw new HttpError(400, `model must be one of: ${Object.keys(MODELS).join(', ')}`);
    if (!GROUPS.includes(groupBy)) throw new HttpError(400, `group_by must be one of: ${GROUPS.join(', ')}`);
    const range = parseRange({ from, to });
    const { contacts, deals } = this.config();
    const rows = new Map();
    const row = (key) => {
      if (!rows.has(key)) {
        rows.set(key, { key, touchpoints: 0, leads: 0, opportunities: 0, pipeline: 0, won: 0, revenue: 0, lost: 0 });
      }
      return rows.get(key);
    };
    const keyOf = (t) => (t ? t[groupBy] || '(none)' : UNATTRIBUTED);
    const spread = (touches, conversionAt, apply) => {
      if (!touches.length) return apply(row(UNATTRIBUTED), 1);
      credits(model, touches, conversionAt).forEach((c, i) => { if (c) apply(row(keyOf(touches[i])), c); });
    };

    if (contacts) {
      const people = this.#records(contacts);
      const touches = this.#touchesByRecord(people.map((p) => p.id));
      for (const list of touches.values()) for (const t of list) if (range.contains(t.occurred_at)) row(keyOf(t)).touchpoints++;
      for (const p of people) {
        if (!range.contains(p.created_at)) continue;
        spread(touches.get(p.id) ?? [], p.created_at, (r, c) => { r.leads += c; });
      }
    }

    const dealStats = { opportunities: 0, won: 0, lost: 0, pipeline: 0, revenue: 0 };
    if (deals) {
      const all = this.#records(deals);
      const touches = this.#dealTouches(deals, contacts, all);
      const value = (d) => (deals.value_field ? Number(d.data[deals.value_field]) || 0 : 0);
      const stage = (d) => d.data[deals.board_field];
      const wonAt = this.#firstEntries(deals, all, deals.won_stage);
      for (const d of all) {
        const isWon = !!wonAt.get(d.id);
        const isLost = !isWon && deals.exit_stages.includes(stage(d));
        if (range.contains(d.created_at)) {
          dealStats.opportunities++;
          spread(touches.get(d.id), d.created_at, (r, c) => {
            r.opportunities += c;
            if (!isWon && !isLost) r.pipeline += c * value(d);
            if (isLost) r.lost += c;
          });
          if (!isWon && !isLost) dealStats.pipeline += value(d);
          if (isLost) dealStats.lost++;
        }
        if (isWon && range.contains(wonAt.get(d.id))) {
          dealStats.won++;
          dealStats.revenue += value(d);
          spread(touches.get(d.id), d.created_at, (r, c) => { r.won += c; r.revenue += c * value(d); });
        }
      }
    }

    const list = [...rows.values()].map((r) => ({
      ...r,
      leads: round(r.leads, 2),
      opportunities: round(r.opportunities, 2),
      won: round(r.won, 2),
      lost: round(r.lost, 2),
      pipeline: round(r.pipeline, 2),
      revenue: round(r.revenue, 2),
      win_rate: r.won + r.lost > 0 ? round(r.won / (r.won + r.lost), 3) : null,
    })).sort((a, b) => b.revenue - a.revenue || b.pipeline - a.pipeline || b.leads - a.leads || b.touchpoints - a.touchpoints);

    return {
      model, group_by: groupBy, from: range.from, to: range.to,
      contact_object: contacts?.slug ?? null, deal_object: deals?.slug ?? null,
      rows: list,
      totals: {
        touchpoints: list.reduce((s, r) => s + r.touchpoints, 0),
        leads: round(list.reduce((s, r) => s + r.leads, 0), 2),
        ...dealStats,
      },
    };
  }

  /** Map recordId → ISO time it first entered `stage` (null if never). */
  #firstEntries(obj, records, stage) {
    const out = new Map(records.map((r) => [r.id, null]));
    if (!stage || !obj.board_field) return out;
    const rows = this.db
      .prepare(`SELECT sc.record_id, MIN(sc.changed_at) AS at FROM stage_changes sc JOIN records r ON r.id = sc.record_id
                WHERE r.object_id = ? AND sc.field = ? AND sc.to_value = ? GROUP BY sc.record_id`)
      .all(obj.id, obj.board_field, stage);
    for (const { record_id: id, at } of rows) if (out.has(id)) out.set(id, at);
    for (const r of records) {
      if (!out.get(r.id) && r.data[obj.board_field] === stage) out.set(r.id, r.updated_at);
    }
    return out;
  }

  /**
   * Funnel for an object's board field: how many records reached each stage
   * (reaching a later stage counts as passing earlier ones), conversion
   * between stages, average days spent in each, win rate and cycle length.
   */
  funnel(objectIdOrSlug, { from, to } = {}) {
    const obj = this.crm.getObject(objectIdOrSlug);
    const field = obj.fields.find((f) => f.key === obj.board_field);
    if (!field) throw new HttpError(400, `${obj.name} has no board field to build a funnel from`);
    const range = parseRange({ from, to });
    const exits = new Set(obj.exit_stages);
    const steps = field.options.filter((o) => !exits.has(o));
    const index = new Map(steps.map((s, i) => [s, i]));

    const records = this.#records(obj).filter((r) => range.contains(r.created_at));
    const history = new Map();
    if (records.length) {
      const ids = records.map((r) => r.id);
      const rows = this.db
        .prepare(`SELECT record_id, to_value, changed_at FROM stage_changes
                  WHERE field = ? AND record_id IN (${ids.map(() => '?').join(',')}) ORDER BY changed_at, id`)
        .all(field.key, ...ids);
      for (const h of rows) {
        if (!history.has(h.record_id)) history.set(h.record_id, []);
        history.get(h.record_id).push(h);
      }
    }

    const reached = steps.map(() => 0);
    const current = new Map(field.options.map((o) => [o, 0]));
    const dwell = steps.map(() => []);
    const cycle = [];
    let won = 0;
    let lost = 0;
    let wonValue = 0;

    for (const r of records) {
      const now = r.data[field.key];
      if (now) current.set(now, (current.get(now) ?? 0) + 1);
      const entries = new Map();
      for (const h of history.get(r.id) ?? []) if (h.to_value && !entries.has(h.to_value)) entries.set(h.to_value, h.changed_at);
      if (now && !entries.has(now)) entries.set(now, r.created_at);

      let max = -1;
      for (const s of entries.keys()) if (index.has(s)) max = Math.max(max, index.get(s));
      for (let i = 0; i <= max; i++) reached[i]++;

      steps.forEach((s, i) => {
        const enteredAt = entries.get(s);
        if (!enteredAt) return;
        const next = steps.slice(i + 1).map((x) => entries.get(x)).filter((t) => t && t >= enteredAt).sort()[0];
        if (next) dwell[i].push(days(enteredAt, next));
      });

      const wonAt = obj.won_stage ? entries.get(obj.won_stage) : null;
      if (wonAt) {
        won++;
        cycle.push(days(r.created_at, wonAt));
        if (obj.value_field) wonValue += Number(r.data[obj.value_field]) || 0;
      } else if (exits.has(now)) lost++;
    }

    return {
      object: obj.slug, name: obj.name, field: field.key, label: field.label,
      won_stage: obj.won_stage, from: range.from, to: range.to, total: records.length,
      stages: steps.map((s, i) => ({
        stage: s,
        reached: reached[i],
        current: current.get(s) ?? 0,
        conversion_from_previous: i === 0 ? null : reached[i - 1] ? round(reached[i] / reached[i - 1], 3) : null,
        conversion_from_start: reached[0] ? round(reached[i] / reached[0], 3) : null,
        avg_days_in_stage: round(avg(dwell[i])),
      })),
      exits: [...exits].filter((e) => field.options.includes(e)).map((e) => ({ stage: e, current: current.get(e) ?? 0 })),
      won, lost,
      win_rate: won + lost ? round(won / (won + lost), 3) : null,
      avg_cycle_days: round(avg(cycle)),
      median_cycle_days: round(median(cycle)),
      avg_won_value: won && obj.value_field ? round(wonValue / won, 2) : null,
    };
  }
}
