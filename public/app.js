// Single-page CRM client. No framework: views are plain functions that build
// DOM nodes with h(), and the hash (#/...) is the router.

const state = { settings: {}, objects: [], meta: { field_types: [], activity_types: [] } };
const main = document.getElementById('main');
const PALETTE = ['#6366f1', '#0ea5e9', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#64748b'];
const ACTIVITY_ICONS = { note: '📝', task: '✅', call: '📞', email: '✉️', meeting: '🤝' };
const TYPE_LABELS = {
  text: 'Text', textarea: 'Long text', number: 'Number', currency: 'Currency', date: 'Date',
  email: 'Email', phone: 'Phone', url: 'URL', select: 'Single select', multiselect: 'Multi select',
  checkbox: 'Checkbox', relation: 'Link to record',
};

// ------------------------------------------------------------------ helpers

async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [prop, val] of Object.entries(v)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, val); else el.style[prop] = val;
      }
    }
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return appendChildren(el, children);
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Like el.replaceChildren(), but accepts nested arrays and skips null/false like h(). */
function fill(el, ...children) {
  el.replaceChildren();
  return appendChildren(el, children);
}

function toast(message, kind = 'info') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

/** Wraps an async action so failures show as a toast instead of vanishing. */
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { toast(err.message, 'error'); }
};

function openDialog(build) {
  const dialog = document.getElementById('dialog');
  dialog.replaceChildren(build(() => dialog.close()));
  dialog.showModal();
  dialog.querySelector('input, select, textarea')?.focus();
}

function confirmDialog(message, { confirmLabel = 'Delete', danger = true } = {}) {
  return new Promise((resolve) => {
    openDialog((close) => h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); close(); resolve(true); } },
      h('p', { style: { marginTop: 0 } }, message),
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', onclick: () => { close(); resolve(false); } }, 'Cancel'),
        h('button', { type: 'submit', class: danger ? 'danger solid' : 'primary' }, confirmLabel))));
    document.getElementById('dialog').addEventListener('close', () => resolve(false), { once: true });
  });
}

const objectBySlug = (slug) => state.objects.find((o) => o.slug === slug);
const objectById = (id) => state.objects.find((o) => o.id === id);
const optionColor = (field, value) => PALETTE[Math.max(field.options.indexOf(value), 0) % PALETTE.length];
const pill = (text, color) => h('span', { class: 'pill', style: { '--pill': color } }, text);
const today = () => new Date().toISOString().slice(0, 10);

function money(n) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: state.settings.currency || 'USD', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return String(n);
  }
}

function formatDate(iso, withTime = false) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/** Renders a field value for display. */
function formatValue(field, value, record) {
  if (value === undefined || value === null || value === '') return h('span', { class: 'muted' }, '—');
  switch (field.type) {
    case 'currency': return money(value);
    case 'number': return value.toLocaleString();
    case 'date': return formatDate(value);
    case 'checkbox': return value ? '✓' : '—';
    case 'email': return h('a', { href: `mailto:${value}`, onclick: (e) => e.stopPropagation() }, value);
    case 'phone': return h('a', { href: `tel:${value.replace(/[^\d+]/g, '')}`, onclick: (e) => e.stopPropagation() }, value);
    case 'url': return h('a', { href: value, target: '_blank', rel: 'noopener noreferrer', onclick: (e) => e.stopPropagation() }, value.replace(/^https?:\/\//, ''));
    case 'select': return pill(value, optionColor(field, value));
    case 'multiselect': return value.map((v) => pill(v, optionColor(field, v)));
    case 'relation': {
      const ref = record?.refs?.[field.key];
      return ref ? h('a', { href: `#/r/${ref.id}`, onclick: (e) => e.stopPropagation() }, ref.title) : h('span', { class: 'muted' }, '—');
    }
    case 'textarea': return h('span', { style: { whiteSpace: 'pre-wrap' } }, value);
    default: return String(value);
  }
}

const relationCache = new Map();
async function relationOptions(targetId) {
  if (!relationCache.has(targetId)) {
    relationCache.set(targetId, api('GET', `/objects/${targetId}/records?limit=1000&sort=${encodeURIComponent(objectById(targetId).primary_field ?? '')}`)
      .then((r) => r.records)
      .catch((err) => { relationCache.delete(targetId); throw err; }));
  }
  return relationCache.get(targetId);
}

/** Builds an input for a field. Returns { el, get() } where get() yields the API value. */
function fieldInput(field, value) {
  const id = `f-${field.key}`;
  switch (field.type) {
    case 'textarea': {
      const el = h('textarea', { id, value: value ?? '' });
      return { el, get: () => el.value };
    }
    case 'select': {
      const el = h('select', { id },
        h('option', { value: '' }, '—'),
        field.options.map((o) => h('option', { value: o, selected: o === value }, o)));
      return { el, get: () => el.value };
    }
    case 'multiselect': {
      const boxes = field.options.map((o) => h('input', { type: 'checkbox', value: o, checked: (value ?? []).includes(o) }));
      const el = h('div', { class: 'checks', id }, boxes.map((b) => h('label', null, b, b.value)));
      return { el, get: () => boxes.filter((b) => b.checked).map((b) => b.value) };
    }
    case 'checkbox': {
      const el = h('input', { type: 'checkbox', id, checked: !!value });
      return { el: h('label', { class: 'check-row' }, el, 'Yes'), get: () => el.checked };
    }
    case 'relation': {
      const el = h('select', { id }, h('option', { value: '' }, 'Loading…'));
      const target = objectById(field.target_object_id);
      relationOptions(field.target_object_id).then((records) => {
        fill(el,
          h('option', { value: '' }, `— No ${target?.singular.toLowerCase() ?? 'record'} —`),
          records.map((r) => h('option', { value: r.id, selected: r.id === value }, r.title)));
        if (value && !records.some((r) => r.id === value)) el.append(h('option', { value, selected: true }, `#${value}`));
      }).catch((err) => toast(err.message, 'error'));
      return { el, get: () => (el.value ? Number(el.value) : null) };
    }
    default: {
      const type = { number: 'number', currency: 'number', date: 'date', email: 'email', phone: 'tel', url: 'url' }[field.type] ?? 'text';
      const el = h('input', { id, type, value: value ?? '', step: field.type === 'currency' ? '0.01' : field.type === 'number' ? 'any' : undefined });
      return { el, get: () => el.value };
    }
  }
}

// ------------------------------------------------------------------- chrome

async function loadSchema() {
  [state.settings, state.objects] = await Promise.all([api('GET', '/settings'), api('GET', '/objects')]);
  relationCache.clear();
  applyBranding();
}

function applyBranding() {
  document.documentElement.style.setProperty('--accent', state.settings.accent_color);
  document.getElementById('brand-name').textContent = state.settings.business_name;
  document.getElementById('brand-mark').textContent = state.settings.business_name.trim().charAt(0).toUpperCase() || 'C';
  document.title = state.settings.business_name;
}

function renderNav(path) {
  const link = (href, icon, label) => h('a', { href, class: path === href.slice(1) || (href !== '#/' && path.startsWith(href.slice(1) + '/')) ? 'active' : '' }, h('span', null, icon), label);
  fill(document.getElementById('nav'),
    link('#/', '📊', 'Dashboard'),
    link('#/tasks', '✅', 'Tasks'),
    h('div', { class: 'nav-label' }, 'Records'),
    state.objects.map((o) => link(`#/o/${o.slug}`, o.icon, o.name)),
    h('div', { class: 'nav-label' }, 'Customize'),
    link('#/settings', '⚙️', 'Settings'));
}

document.getElementById('menu-toggle').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));

// ------------------------------------------------------------------- router

const routes = [
  [/^\/$/, viewDashboard],
  [/^\/tasks$/, viewTasks],
  [/^\/o\/([\w-]+)$/, viewList],
  [/^\/o\/([\w-]+)\/new$/, viewNewRecord],
  [/^\/r\/(\d+)$/, viewRecord],
  [/^\/settings$/, viewSettings],
  [/^\/settings\/o\/([\w-]+)$/, viewObjectSettings],
];

function currentRoute() {
  const [path, qs = ''] = location.hash.slice(1).split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}

function setQuery(query) {
  const { path } = currentRoute();
  const qs = query.toString();
  history.replaceState(null, '', `#${path}${qs ? `?${qs}` : ''}`);
}

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const { path, query } = currentRoute();
  document.querySelector('.sidebar').classList.remove('open');
  renderNav(path);
  const route = routes.find(([re]) => re.test(path));
  try {
    if (!route) throw new Error('Page not found');
    const view = await route[1](...route[0].exec(path).slice(1), query);
    if (token !== renderToken) return; // a newer navigation won
    main.replaceChildren(view);
  } catch (err) {
    if (token !== renderToken) return;
    main.replaceChildren(h('div', { class: 'card empty' }, h('h2', null, 'Something went wrong'), err.message, h('p', null, h('a', { href: '#/' }, 'Back to dashboard'))));
  }
}

window.addEventListener('hashchange', render);

// ---------------------------------------------------------------- dashboard

async function viewDashboard() {
  const d = await api('GET', '/dashboard');
  const stats = h('div', { class: 'grid grid-stats' },
    d.objects.map((o) => h('a', { class: 'card stat', href: `#/o/${o.slug}` },
      h('div', { class: 'stat-label' }, h('span', null, o.icon), o.name),
      h('div', { class: 'stat-value' }, o.count.toLocaleString()))),
    h('a', { class: 'card stat', href: '#/tasks' },
      h('div', { class: 'stat-label' }, '✅ Open tasks'),
      h('div', { class: 'stat-value' }, d.tasks.open)),
    d.tasks.overdue ? h('a', { class: 'card stat warn', href: '#/tasks' },
      h('div', { class: 'stat-label' }, '⏰ Overdue'),
      h('div', { class: 'stat-value' }, d.tasks.overdue)) : null,
  );

  const boards = d.objects.filter((o) => o.board && o.count).map((o) => {
    const max = Math.max(...o.board.stages.map((s) => (o.board.value_field ? s.value : s.count)), 1);
    const total = o.board.stages.reduce((sum, s) => sum + s.value, 0);
    return h('div', { class: 'card' },
      h('h2', null, `${o.icon} ${o.name} by ${o.board.label.toLowerCase()}`, o.board.value_field ? h('span', { class: 'muted', style: { fontWeight: 'normal' } }, ` · ${money(total)} total`) : null),
      h('div', { class: 'pipeline' }, o.board.stages.map((s) => {
        const amount = o.board.value_field ? s.value : s.count;
        return h('a', { class: 'pipeline-row', href: `#/o/${o.slug}?view=board` },
          h('span', null, s.stage),
          h('div', { class: 'bar' }, h('span', { style: { width: `${(amount / max) * 100}%` } })),
          h('span', { class: 'muted' }, o.board.value_field ? `${money(s.value)} · ${s.count}` : s.count));
      })));
  });

  const welcome = d.objects.every((o) => o.count === 0)
    ? h('div', { class: 'card' },
      h('h2', null, `Welcome to ${state.settings.business_name} CRM 👋`),
      h('p', null, 'You start with Companies, Contacts and Deals. Make it yours:'),
      h('ul', null,
        h('li', null, h('a', { href: '#/settings' }, 'Settings'), ' — rename the CRM, pick a brand color, add fields, edit pipeline stages, or create new record types (Projects, Properties, Orders…).'),
        h('li', null, 'Add records yourself or import a CSV from any list page.'),
        h('li', null, 'Want sample data? Run ', h('code', null, 'npm run demo'), ' and refresh.')))
    : null;

  return h('div', null,
    h('div', { class: 'page-header' }, h('h1', null, 'Dashboard')),
    welcome,
    stats,
    h('div', { class: 'grid grid-2', style: { marginTop: '16px' } },
      h('div', null, boards.length ? boards : null),
      h('div', null,
        h('div', { class: 'card' }, h('h2', null, 'Upcoming tasks'), taskList(d.tasks.upcoming, render, { compact: true })),
        h('div', { class: 'card' }, h('h2', null, 'Recent activity'), activityList(d.recent, render, { showRecord: true })))));
}

// -------------------------------------------------------------------- lists

async function viewList(slug, query) {
  const o = objectBySlug(slug);
  if (!o) throw new Error(`No object "${slug}"`);
  const boardField = o.fields.find((f) => f.key === o.board_field);
  const mode = boardField && query.get('view') === 'board' ? 'board' : 'table';
  const container = h('div');

  const search = h('input', { type: 'search', placeholder: `Search ${o.name.toLowerCase()}…`, value: query.get('q') ?? '' });
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (search.value) query.set('q', search.value); else query.delete('q');
      query.delete('page');
      setQuery(query);
      load();
    }, 250);
  });

  const filterable = o.fields.filter((f) => ['select', 'multiselect', 'checkbox'].includes(f.type) && !(mode === 'board' && f.key === o.board_field));
  const filters = filterable.map((f) => {
    const sel = h('select', { title: `Filter by ${f.label}` },
      h('option', { value: '' }, `${f.label}: any`),
      f.type === 'checkbox'
        ? [h('option', { value: 'true' }, `${f.label}: yes`), h('option', { value: 'false' }, `${f.label}: no`)]
        : f.options.map((opt) => h('option', { value: opt }, opt)));
    sel.value = query.get(`f.${f.key}`) ?? '';
    sel.addEventListener('change', () => {
      if (sel.value) query.set(`f.${f.key}`, sel.value); else query.delete(`f.${f.key}`);
      query.delete('page');
      setQuery(query);
      load();
    });
    return sel;
  });

  const switchMode = (m) => {
    if (m === 'board') query.set('view', 'board'); else query.delete('view');
    location.hash = `#/o/${slug}${query.toString() ? `?${query}` : ''}`;
  };

  async function load() {
    const params = new URLSearchParams();
    if (query.get('q')) params.set('q', query.get('q'));
    for (const f of filterable) if (query.get(`f.${f.key}`)) params.set(`filter[${f.key}]`, query.get(`f.${f.key}`));
    if (mode === 'board') {
      params.set('limit', '1000');
      const { records, total } = await api('GET', `/objects/${slug}/records?${params}`);
      container.replaceChildren(renderBoard(o, boardField, records, total, load));
      return;
    }
    const page = Math.max(Number(query.get('page')) || 1, 1);
    const pageSize = 50;
    if (query.get('sort')) params.set('sort', query.get('sort'));
    if (query.get('dir')) params.set('dir', query.get('dir'));
    params.set('limit', pageSize);
    params.set('offset', (page - 1) * pageSize);
    const { records, total } = await api('GET', `/objects/${slug}/records?${params}`);
    container.replaceChildren(renderTable(o, records, query, () => { setQuery(query); load(); }),
      total > pageSize || page > 1
        ? h('div', { class: 'pager' },
          h('span', null, `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`),
          h('div', { class: 'seg' },
            h('button', { disabled: page <= 1, onclick: () => { query.set('page', page - 1); setQuery(query); load(); } }, '‹ Prev'),
            h('button', { disabled: page * pageSize >= total, onclick: () => { query.set('page', page + 1); setQuery(query); load(); } }, 'Next ›')))
        : h('div', { class: 'pager' }, h('span', null, `${total} ${total === 1 ? o.singular.toLowerCase() : o.name.toLowerCase()}`)));
  }
  await load();

  return h('div', null,
    h('div', { class: 'page-header' },
      h('h1', null, h('span', null, o.icon), o.name),
      h('div', { class: 'spacer' }),
      h('button', { onclick: () => importDialog(o, load) }, '⬆ Import'),
      h('a', { class: 'btn', href: `/api/objects/${slug}/export.csv`, download: '' }, '⬇ Export'),
      h('a', { class: 'btn primary', href: `#/o/${slug}/new` }, `+ New ${o.singular.toLowerCase()}`)),
    h('div', { class: 'toolbar' },
      search, filters,
      h('div', { class: 'spacer' }),
      boardField ? h('div', { class: 'seg' },
        h('button', { class: mode === 'table' ? 'on' : '', onclick: () => switchMode('table') }, '☰ Table'),
        h('button', { class: mode === 'board' ? 'on' : '', onclick: () => switchMode('board') }, '▦ Board')) : null),
    container);
}

function listColumns(o) {
  const primary = o.fields.find((f) => f.key === o.primary_field);
  return [primary, ...o.fields.filter((f) => f.show_in_list && f !== primary)].filter(Boolean);
}

function renderTable(o, records, query, reload) {
  const cols = listColumns(o);
  if (!records.length) {
    return h('div', { class: 'table-wrap' }, h('div', { class: 'empty' },
      query.get('q') || [...query.keys()].some((k) => k.startsWith('f.'))
        ? 'No matches. Try a different search or filter.'
        : h('span', null, `No ${o.name.toLowerCase()} yet. `, h('a', { href: `#/o/${o.slug}/new` }, `Add your first ${o.singular.toLowerCase()}`), '.')));
  }
  const sort = query.get('sort');
  const dir = query.get('dir') ?? 'asc';
  const header = (key, label, numeric) => h('th', {
    class: `sortable ${numeric ? 'num' : ''}`,
    onclick: () => {
      if (sort === key) query.set('dir', dir === 'asc' ? 'desc' : 'asc');
      else { query.set('sort', key); query.set('dir', 'asc'); }
      query.delete('page');
      reload();
    },
  }, label, sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : '');
  const numeric = (f) => ['number', 'currency'].includes(f.type);
  return h('div', { class: 'table-wrap' }, h('table', null,
    h('thead', null, h('tr', null, cols.map((f) => header(f.key, f.label, numeric(f))), header('updated_at', 'Updated'))),
    h('tbody', null, records.map((r) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/r/${r.id}`; } },
      cols.map((f, i) => h('td', { class: numeric(f) ? 'num' : '' },
        i === 0 ? h('a', { href: `#/r/${r.id}` }, r.title) : formatValue(f, r.data[f.key], r))),
      h('td', { class: 'muted small' }, formatDate(r.updated_at)))))));
}

function renderBoard(o, field, records, total, reload) {
  const valueField = o.fields.find((f) => f.key === o.value_field);
  const cardFields = listColumns(o).slice(1).filter((f) => f.key !== field.key && f.key !== o.value_field).slice(0, 2);
  const columns = [...field.options, null];
  const groups = new Map(columns.map((c) => [c, []]));
  for (const r of records) (groups.get(r.data[field.key] ?? null) ?? groups.get(null)).push(r);
  if (!groups.get(null).length) columns.pop(); // only show "No value" when something's in it

  const board = h('div', { class: 'board' }, columns.map((stage) => {
    const items = groups.get(stage);
    const sum = valueField ? items.reduce((s, r) => s + (Number(r.data[valueField.key]) || 0), 0) : null;
    const col = h('div', { class: 'column' },
      h('div', { class: 'column-head' },
        stage === null ? h('strong', { class: 'muted' }, `No ${field.label.toLowerCase()}`) : pill(stage, optionColor(field, stage)),
        h('span', { class: 'muted' }, `${items.length}${valueField ? ` · ${money(sum)}` : ''}`)),
      h('div', { class: 'column-cards' }, items.map((r) => {
        const card = h('a', { class: 'board-card', href: `#/r/${r.id}`, draggable: 'true' },
          h('div', { class: 'title' }, r.title),
          valueField && r.data[valueField.key] != null ? h('div', null, money(r.data[valueField.key])) : null,
          cardFields.map((f) => (r.data[f.key] != null && r.data[f.key] !== '' ? h('div', { class: 'meta' }, formatValue(f, r.data[f.key], r)) : null)));
        card.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(r.id)); card.classList.add('dragging'); });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));
        return card;
      })));
    if (stage !== null) {
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', guard(async (e) => {
        e.preventDefault();
        col.classList.remove('drop');
        const id = Number(e.dataTransfer.getData('text/plain'));
        const rec = records.find((x) => x.id === id);
        if (!rec || rec.data[field.key] === stage) return;
        await api('PATCH', `/records/${id}`, { [field.key]: stage });
        toast(`Moved “${rec.title}” to ${stage}`);
        await reload();
      }));
    }
    return col;
  }));
  return h('div', null,
    total > records.length ? h('p', { class: 'muted small' }, `Showing the ${records.length} most recently updated of ${total}. Use search or filters to narrow down.`) : null,
    board);
}

function importDialog(o, reload) {
  openDialog((close) => {
    const file = h('input', { type: 'file', accept: '.csv,text/csv', required: true });
    const result = h('div');
    return h('form', {
      onsubmit: guard(async (e) => {
        e.preventDefault();
        const text = await file.files[0].text();
        const res = await api('POST', `/objects/${o.slug}/import`, { csv: text });
        relationCache.clear();
        fill(result,
          h('p', null, `✅ Imported ${res.created} ${o.name.toLowerCase()}.`),
          res.ignored_columns.length ? h('p', { class: 'muted small' }, `Ignored columns: ${res.ignored_columns.join(', ')}`) : null,
          res.errors.length ? h('details', { open: true }, h('summary', null, `${res.errors.length} rows skipped`),
            h('ul', { class: 'small' }, res.errors.slice(0, 50).map((x) => h('li', null, `Row ${x.row}: ${x.error}`)))) : null);
        await reload();
      }),
    },
    h('h2', null, `Import ${o.name.toLowerCase()} from CSV`),
    h('p', { class: 'muted' }, 'The first row must be column headers matching field names: ',
      o.fields.map((f) => f.label).join(', '), '. Links to other records can use the record’s name.'),
    h('div', { class: 'form-row' }, file),
    result,
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', onclick: close }, 'Close'),
      h('button', { type: 'submit', class: 'primary' }, 'Import')));
  });
}

// ------------------------------------------------------------------ records

function recordForm(o, record, { onSubmit, submitLabel, prefill = {} }) {
  const inputs = o.fields.map((f) => ({ f, input: fieldInput(f, record ? record.data[f.key] : prefill[f.key]) }));
  const form = h('form', {
    onsubmit: guard(async (e) => {
      e.preventDefault();
      const data = {};
      for (const { f, input } of inputs) data[f.key] = input.get();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try { await onSubmit(data); } finally { btn.disabled = false; }
    }),
  },
  h('div', { class: 'form-grid' }, inputs.map(({ f, input }) => h('div', { class: `form-row ${['textarea', 'multiselect'].includes(f.type) ? 'wide' : ''}` },
    h('label', { for: `f-${f.key}` }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
    input.el))),
  h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, submitLabel)));
  return form;
}

async function viewNewRecord(slug, query) {
  const o = objectBySlug(slug);
  if (!o) throw new Error(`No object "${slug}"`);
  const prefill = {};
  for (const f of o.fields) {
    const v = query.get(f.key);
    if (v !== null) prefill[f.key] = f.type === 'relation' ? Number(v) : v;
  }
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: `#/o/${slug}` }, `${o.icon} ${o.name}`)),
    h('div', { class: 'page-header' }, h('h1', null, `New ${o.singular.toLowerCase()}`)),
    h('div', { class: 'card', style: { maxWidth: '900px' } }, recordForm(o, null, {
      prefill,
      submitLabel: `Create ${o.singular.toLowerCase()}`,
      onSubmit: async (data) => {
        const r = await api('POST', `/objects/${slug}/records`, data);
        relationCache.delete(o.id);
        toast(`${o.singular} created`);
        location.hash = `#/r/${r.id}`;
      },
    })));
}

async function viewRecord(id, query) {
  const [record, related, activities] = await Promise.all([
    api('GET', `/records/${id}`),
    api('GET', `/records/${id}/related`),
    api('GET', `/activities?record_id=${id}`),
  ]);
  const o = objectBySlug(record.object);
  const editing = query.get('edit') === '1';

  const details = editing
    ? recordForm(o, record, {
      submitLabel: 'Save changes',
      onSubmit: async (data) => {
        await api('PATCH', `/records/${id}`, data);
        relationCache.delete(o.id);
        toast('Saved');
        location.hash = `#/r/${id}`;
      },
    })
    : h('dl', { class: 'detail-list' }, o.fields.map((f) => [h('dt', null, f.label), h('dd', null, formatValue(f, record.data[f.key], record))]),
      h('dt', null, 'Created'), h('dd', { class: 'muted' }, formatDate(record.created_at, true)),
      h('dt', null, 'Updated'), h('dd', { class: 'muted' }, formatDate(record.updated_at, true)));

  const remove = guard(async () => {
    if (!(await confirmDialog(`Delete “${record.title}”? Its activities will be deleted too. This can't be undone.`))) return;
    await api('DELETE', `/records/${id}`);
    relationCache.clear();
    toast(`${o.singular} deleted`);
    location.hash = `#/o/${o.slug}`;
  });

  const relatedCards = related.map((g) => {
    const src = objectBySlug(g.object);
    const cols = listColumns(src).filter((f) => f.key !== g.field).slice(0, 4);
    return h('div', { class: 'card' },
      h('div', { class: 'page-header', style: { marginBottom: '8px' } },
        h('h2', { style: { margin: 0 } }, `${g.icon} ${g.name}`, h('span', { class: 'muted', style: { fontWeight: 'normal' } }, ` · ${g.total}`),
          related.filter((x) => x.object === g.object).length > 1 ? h('span', { class: 'muted small', style: { fontWeight: 'normal' } }, ` (by ${g.field_label})`) : null),
        h('div', { class: 'spacer' }),
        h('a', { class: 'btn', href: `#/o/${g.object}/new?${g.field}=${id}` }, `+ Add ${g.singular.toLowerCase()}`)),
      g.records.length
        ? h('div', { class: 'table-wrap', style: { boxShadow: 'none' } }, h('table', null,
          h('thead', null, h('tr', null, cols.map((f) => h('th', null, f.label)))),
          h('tbody', null, g.records.map((r) => h('tr', { class: 'clickable', onclick: () => { location.hash = `#/r/${r.id}`; } },
            cols.map((f, i) => h('td', null, i === 0 ? h('a', { href: `#/r/${r.id}` }, r.title) : formatValue(f, r.data[f.key], r))))))))
        : h('p', { class: 'muted', style: { margin: 0 } }, `No ${g.name.toLowerCase()} linked yet.`));
  });

  const reload = () => render();
  return h('div', null,
    h('div', { class: 'crumbs' }, h('a', { href: `#/o/${o.slug}` }, `${o.icon} ${o.name}`)),
    h('div', { class: 'page-header' },
      h('h1', null, record.title),
      o.board_field && record.data[o.board_field] ? formatValue(o.fields.find((f) => f.key === o.board_field), record.data[o.board_field]) : null,
      h('div', { class: 'spacer' }),
      editing
        ? h('a', { class: 'btn', href: `#/r/${id}` }, 'Cancel')
        : h('a', { class: 'btn primary', href: `#/r/${id}?edit=1` }, '✏️ Edit'),
      h('button', { class: 'danger', onclick: remove }, 'Delete')),
    h('div', { class: 'grid grid-2' },
      h('div', null, h('div', { class: 'card' }, details), relatedCards),
      h('div', { class: 'card' },
        h('h2', null, 'Activity'),
        activityComposer(Number(id), reload),
        activityList(activities, reload))));
}

// --------------------------------------------------------------- activities

function activityComposer(recordId, onDone) {
  const type = h('select', null, state.meta.activity_types.map((t) => h('option', { value: t }, `${ACTIVITY_ICONS[t] ?? ''} ${t[0].toUpperCase()}${t.slice(1)}`)));
  const body = h('textarea', { placeholder: 'Write a note, log a call, or add a task…', required: true, style: { minHeight: '64px' } });
  const due = h('input', { type: 'date', title: 'Due date', style: { display: 'none' } });
  type.addEventListener('change', () => { due.style.display = type.value === 'task' ? '' : 'none'; });
  const form = h('form', {
    class: 'composer',
    onsubmit: guard(async (e) => {
      e.preventDefault();
      await api('POST', '/activities', { record_id: recordId, type: type.value, body: body.value, due_at: type.value === 'task' ? due.value || null : null });
      body.value = '';
      await onDone();
    }),
  }, body, h('div', { class: 'composer-row' }, type, due, h('div', { class: 'spacer' }), h('button', { type: 'submit', class: 'primary' }, 'Add')));
  return form;
}

function activityItem(a, onChange, { showRecord } = {}) {
  const isTask = a.type === 'task';
  const overdue = isTask && !a.done && a.due_at && a.due_at.slice(0, 10) < today();
  const toggle = isTask ? h('input', {
    type: 'checkbox', checked: a.done, title: a.done ? 'Mark as not done' : 'Mark as done',
    onchange: guard(async (e) => { await api('PATCH', `/activities/${a.id}`, { done: e.target.checked }); await onChange(); }),
  }) : null;
  return h('li', { class: a.done ? 'done' : '' },
    h('div', { class: 'tl-icon' }, toggle ?? ACTIVITY_ICONS[a.type] ?? '•'),
    h('div', { class: 'tl-body' },
      h('div', { class: 'tl-text' }, a.body),
      h('div', { class: 'tl-meta' },
        `${a.type[0].toUpperCase()}${a.type.slice(1)} · ${formatDate(a.created_at, true)}`,
        a.due_at ? h('span', { class: overdue ? 'overdue' : '' }, ` · due ${formatDate(a.due_at)}`) : null,
        showRecord && a.record ? [' · ', h('a', { href: `#/r/${a.record.id}` }, a.record.title)] : null)),
    h('button', {
      class: 'ghost icon-btn', title: 'Delete',
      onclick: guard(async () => {
        if (!(await confirmDialog('Delete this activity?'))) return;
        await api('DELETE', `/activities/${a.id}`);
        await onChange();
      }),
    }, '✕'));
}

function activityList(items, onChange, opts = {}) {
  if (!items.length) return h('p', { class: 'muted', style: { margin: 0 } }, 'Nothing here yet.');
  return h('ul', { class: 'timeline' }, items.map((a) => activityItem(a, onChange, opts)));
}

function taskList(items, onChange, { compact } = {}) {
  if (!items.length) return h('p', { class: 'muted', style: { margin: 0 } }, compact ? 'No open tasks. 🎉' : 'No tasks here.');
  return h('ul', { class: 'timeline' }, items.map((a) => activityItem(a, onChange, { showRecord: true })));
}

async function viewTasks(query) {
  const showDone = query.get('done') === '1';
  const tasks = await api('GET', `/activities?type=task&done=${showDone ? 1 : 0}&limit=500`);
  const body = h('textarea', { placeholder: 'New task…', required: true, style: { minHeight: '44px' } });
  const due = h('input', { type: 'date', title: 'Due date' });
  return h('div', null,
    h('div', { class: 'page-header' },
      h('h1', null, '✅ Tasks'),
      h('div', { class: 'spacer' }),
      h('div', { class: 'seg' },
        h('button', { class: showDone ? '' : 'on', onclick: () => { location.hash = '#/tasks'; } }, 'Open'),
        h('button', { class: showDone ? 'on' : '', onclick: () => { location.hash = '#/tasks?done=1'; } }, 'Done'))),
    h('div', { class: 'card', style: { maxWidth: '820px' } },
      showDone ? null : h('form', {
        class: 'composer',
        onsubmit: guard(async (e) => {
          e.preventDefault();
          await api('POST', '/activities', { type: 'task', body: body.value, due_at: due.value || null });
          await render();
        }),
      }, body, h('div', { class: 'composer-row' }, due, h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Tip: add tasks from a record page to link them.'), h('div', { class: 'spacer' }), h('button', { type: 'submit', class: 'primary' }, 'Add task'))),
      taskList(tasks, render)));
}

// ----------------------------------------------------------------- settings

async function viewSettings() {
  const s = state.settings;
  const name = h('input', { value: s.business_name, required: true });
  const color = h('input', { type: 'color', value: s.accent_color });
  const currency = h('input', { value: s.currency, maxlength: 3, pattern: '[A-Za-z]{3}', style: { width: '100px' }, required: true });
  color.addEventListener('input', () => document.documentElement.style.setProperty('--accent', color.value));

  const general = h('form', {
    class: 'card',
    onsubmit: guard(async (e) => {
      e.preventDefault();
      state.settings = await api('PUT', '/settings', { business_name: name.value, accent_color: color.value, currency: currency.value.toUpperCase() });
      applyBranding();
      toast('Settings saved');
    }),
  },
  h('h2', null, 'Business'),
  h('div', { class: 'form-grid' },
    h('div', { class: 'form-row' }, h('label', null, 'Business name'), name),
    h('div', { class: 'form-row' }, h('label', null, 'Brand color'), color),
    h('div', { class: 'form-row' }, h('label', null, 'Currency (ISO code)'), currency)),
  h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save')));

  const counts = await api('GET', '/dashboard').then((d) => new Map(d.objects.map((o) => [o.slug, o.count])));
  const move = guard(async (index, delta) => {
    const ids = state.objects.map((o) => o.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    state.objects = await api('PUT', '/objects/order', { ids });
    render();
  });
  const objects = h('div', { class: 'card' },
    h('div', { class: 'page-header', style: { marginBottom: '8px' } },
      h('h2', { style: { margin: 0 } }, 'Record types'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: newObjectDialog }, '+ New record type')),
    h('p', { class: 'muted' }, 'Each record type has its own fields, list, board and import/export. Add types for whatever your business tracks — projects, properties, orders, vehicles, pets…'),
    h('ul', { class: 'field-list' }, state.objects.map((o, i) => h('li', null,
      h('span', { style: { fontSize: '20px' } }, o.icon),
      h('div', { class: 'grow' }, h('a', { href: `#/settings/o/${o.slug}` }, h('strong', null, o.name)),
        h('div', { class: 'muted small' }, `${o.fields.length} fields · ${counts.get(o.slug) ?? 0} records`)),
      h('button', { class: 'ghost icon-btn', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'ghost icon-btn', title: 'Move down', disabled: i === state.objects.length - 1, onclick: () => move(i, 1) }, '↓'),
      h('a', { class: 'btn', href: `#/settings/o/${o.slug}` }, 'Customize')))));

  return h('div', { style: { maxWidth: '820px' } },
    h('div', { class: 'page-header' }, h('h1', null, '⚙️ Settings')),
    general, objects);
}

function newObjectDialog() {
  openDialog((close) => {
    const name = h('input', { placeholder: 'e.g. Projects', required: true });
    const singular = h('input', { placeholder: 'e.g. Project' });
    const icon = h('input', { value: '📁', style: { width: '80px' }, required: true });
    name.addEventListener('input', () => { singular.placeholder = name.value.replace(/s$/i, '') || 'e.g. Project'; });
    return h('form', {
      onsubmit: guard(async (e) => {
        e.preventDefault();
        const o = await api('POST', '/objects', { name: name.value, singular: singular.value || undefined, icon: icon.value });
        await loadSchema();
        close();
        toast(`${o.name} created — now add some fields`);
        location.hash = `#/settings/o/${o.slug}`;
      }),
    },
    h('h2', null, 'New record type'),
    h('div', { class: 'form-row' }, h('label', null, 'Name (plural)'), name),
    h('div', { class: 'form-row' }, h('label', null, 'Singular name'), singular),
    h('div', { class: 'form-row' }, h('label', null, 'Icon (emoji)'), icon),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, 'Create')));
  });
}

function optionsEditor(initial) {
  const list = h('div', { class: 'options-editor' });
  const addRow = (value = '', original = null) => {
    const input = h('input', { value, placeholder: 'Option' });
    input.dataset.original = original ?? '';
    const row = h('div', { class: 'opt' }, input,
      h('button', { type: 'button', class: 'ghost icon-btn', title: 'Move up', onclick: () => row.previousElementSibling?.before(row) }, '↑'),
      h('button', { type: 'button', class: 'ghost icon-btn', title: 'Remove', onclick: () => row.remove() }, '✕'));
    list.append(row);
    return input;
  };
  for (const v of initial) addRow(v, v);
  if (!initial.length) { addRow(); addRow(); }
  const el = h('div', null, list, h('button', { type: 'button', style: { marginTop: '6px' }, onclick: () => addRow().focus() }, '+ Add option'));
  return {
    el,
    get: () => [...list.querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean),
    renames: () => Object.fromEntries([...list.querySelectorAll('input')]
      .filter((i) => i.dataset.original && i.value.trim() && i.value.trim() !== i.dataset.original)
      .map((i) => [i.dataset.original, i.value.trim()])),
  };
}

function fieldDialog(o, field) {
  openDialog((close) => {
    const label = h('input', { value: field?.label ?? '', required: true, placeholder: 'e.g. Budget' });
    const type = h('select', { disabled: !!field }, state.meta.field_types.map((t) => h('option', { value: t, selected: field?.type === t }, TYPE_LABELS[t] ?? t)));
    const target = h('select', null, state.objects.map((x) => h('option', { value: x.id, selected: field?.target_object_id === x.id }, `${x.icon} ${x.name}`)));
    const opts = optionsEditor(field?.options ?? []);
    const required = h('input', { type: 'checkbox', checked: field?.required ?? false });
    const inList = h('input', { type: 'checkbox', checked: field?.show_in_list ?? true });
    const targetRow = h('div', { class: 'form-row' }, h('label', null, 'Links to'), target);
    const optsRow = h('div', { class: 'form-row' }, h('label', null, 'Options'), opts.el,
      field ? h('p', { class: 'muted small' }, 'Renaming an option updates every record that uses it. Removing one clears it from those records.') : null);
    const sync = () => {
      targetRow.style.display = type.value === 'relation' && !field ? '' : 'none';
      optsRow.style.display = ['select', 'multiselect'].includes(type.value) ? '' : 'none';
    };
    type.addEventListener('change', sync);
    sync();
    return h('form', {
      onsubmit: guard(async (e) => {
        e.preventDefault();
        const body = { label: label.value, required: required.checked, show_in_list: inList.checked };
        if (['select', 'multiselect'].includes(type.value)) body.options = opts.get();
        if (field) {
          if (body.options) body.renames = opts.renames();
          await api('PATCH', `/fields/${field.id}`, body);
        } else {
          body.type = type.value;
          if (type.value === 'relation') body.target_object = Number(target.value);
          await api('POST', `/objects/${o.slug}/fields`, body);
        }
        await loadSchema();
        close();
        toast(field ? 'Field updated' : 'Field added');
        render();
      }),
    },
    h('h2', null, field ? `Edit “${field.label}”` : `New field on ${o.name}`),
    h('div', { class: 'form-row' }, h('label', null, 'Label'), label),
    h('div', { class: 'form-row' }, h('label', null, 'Type'), type, field ? h('div', { class: 'muted small' }, 'A field’s type can’t be changed after it’s created.') : null),
    targetRow, optsRow,
    h('div', { class: 'form-row' },
      h('label', { class: 'check-row' }, required, 'Required'),
      h('label', { class: 'check-row' }, inList, 'Show as a column in the list')),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', onclick: close }, 'Cancel'), h('button', { type: 'submit', class: 'primary' }, field ? 'Save' : 'Add field')));
  });
}

async function viewObjectSettings(slug) {
  const o = objectBySlug(slug);
  if (!o) throw new Error(`No object "${slug}"`);

  const name = h('input', { value: o.name, required: true });
  const singular = h('input', { value: o.singular, required: true });
  const icon = h('input', { value: o.icon, required: true, style: { width: '80px' } });
  const fieldSelect = (types, current, allowNone) => h('select', null,
    allowNone ? h('option', { value: '' }, '— None —') : null,
    o.fields.filter((f) => types.includes(f.type)).map((f) => h('option', { value: f.key, selected: f.key === current }, f.label)));
  const primary = fieldSelect(['text', 'email', 'phone'], o.primary_field, false);
  const board = fieldSelect(['select'], o.board_field, true);
  const value = fieldSelect(['number', 'currency'], o.value_field, true);

  const general = h('form', {
    class: 'card',
    onsubmit: guard(async (e) => {
      e.preventDefault();
      await api('PATCH', `/objects/${slug}`, {
        name: name.value, singular: singular.value, icon: icon.value,
        primary_field: primary.value, board_field: board.value || null, value_field: value.value || null,
      });
      await loadSchema();
      toast('Saved');
      render();
    }),
  },
  h('h2', null, 'General'),
  h('div', { class: 'form-grid' },
    h('div', { class: 'form-row' }, h('label', null, 'Name (plural)'), name),
    h('div', { class: 'form-row' }, h('label', null, 'Singular name'), singular),
    h('div', { class: 'form-row' }, h('label', null, 'Icon (emoji)'), icon),
    h('div', { class: 'form-row' }, h('label', null, 'Title field'), primary, h('div', { class: 'muted small' }, 'Names each record in lists and links.')),
    h('div', { class: 'form-row' }, h('label', null, 'Board / pipeline field'), board, h('div', { class: 'muted small' }, 'Enables the drag-and-drop board, grouped by this field’s options.')),
    h('div', { class: 'form-row' }, h('label', null, 'Value field'), value, h('div', { class: 'muted small' }, 'Summed per board column and on the dashboard.'))),
  h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'primary' }, 'Save')));

  const move = guard(async (index, delta) => {
    const ids = o.fields.map((f) => f.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    await api('PUT', `/objects/${slug}/fields/order`, { ids });
    await loadSchema();
    render();
  });
  const removeField = guard(async (f) => {
    if (!(await confirmDialog(`Delete the “${f.label}” field? Its data will be removed from every ${o.singular.toLowerCase()}.`))) return;
    await api('DELETE', `/fields/${f.id}`);
    await loadSchema();
    toast('Field deleted');
    render();
  });

  const fields = h('div', { class: 'card' },
    h('div', { class: 'page-header', style: { marginBottom: '8px' } },
      h('h2', { style: { margin: 0 } }, 'Fields'),
      h('div', { class: 'spacer' }),
      h('button', { class: 'primary', onclick: () => fieldDialog(o) }, '+ Add field')),
    h('ul', { class: 'field-list' }, o.fields.map((f, i) => h('li', null,
      h('div', { class: 'grow' },
        h('strong', null, f.label), ' ',
        h('span', { class: 'badge' }, TYPE_LABELS[f.type] ?? f.type),
        f.type === 'relation' ? h('span', { class: 'muted small' }, ` → ${objectById(f.target_object_id)?.name ?? '?'}`) : null,
        f.required ? h('span', { class: 'badge' }, 'required') : null,
        f.key === o.primary_field ? h('span', { class: 'badge' }, 'title') : null,
        f.key === o.board_field ? h('span', { class: 'badge' }, 'board') : null,
        !f.show_in_list ? h('span', { class: 'badge' }, 'hidden in list') : null,
        f.options.length ? h('div', null, f.options.map((opt) => pill(opt, optionColor(f, opt)))) : null),
      h('button', { class: 'ghost icon-btn', title: 'Move up', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
      h('button', { class: 'ghost icon-btn', title: 'Move down', disabled: i === o.fields.length - 1, onclick: () => move(i, 1) }, '↓'),
      h('button', { onclick: () => fieldDialog(o, f) }, 'Edit'),
      h('button', { class: 'danger', disabled: f.key === o.primary_field, title: f.key === o.primary_field ? 'This is the title field' : 'Delete field', onclick: () => removeField(f) }, 'Delete')))));

  const danger = h('div', { class: 'card danger-zone' },
    h('h2', null, 'Danger zone'),
    h('p', { class: 'muted' }, `Deleting ${o.name} removes all of its records, their activities, and any fields on other record types that link to it.`),
    h('button', {
      class: 'danger solid',
      onclick: guard(async () => {
        if (!(await confirmDialog(`Delete ${o.name} and all its records? This can't be undone.`, { confirmLabel: `Delete ${o.name}` }))) return;
        await api('DELETE', `/objects/${slug}`);
        await loadSchema();
        toast(`${o.name} deleted`);
        location.hash = '#/settings';
      }),
    }, `Delete ${o.name}`));

  return h('div', { style: { maxWidth: '900px' } },
    h('div', { class: 'crumbs' }, h('a', { href: '#/settings' }, '⚙️ Settings')),
    h('div', { class: 'page-header' },
      h('h1', null, h('span', null, o.icon), o.name),
      h('div', { class: 'spacer' }),
      h('a', { class: 'btn', href: `#/o/${slug}` }, `View ${o.name.toLowerCase()} →`)),
    general, fields, danger);
}

// --------------------------------------------------------------------- boot

(async () => {
  try {
    [state.meta] = await Promise.all([api('GET', '/meta'), loadSchema()]);
  } catch (err) {
    main.replaceChildren(h('div', { class: 'card empty' }, `Couldn't reach the CRM server: ${err.message}`));
    return;
  }
  render();
})();
