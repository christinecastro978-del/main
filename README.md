# Custom CRM

A self-hosted CRM you shape around your business. It ships with **Companies**, **Contacts**, and **Deals**, and you can rename, extend, or replace every part from the Settings page. No code changes needed.

- **Your own record types.** Add objects like Projects, Properties, Orders, Vehicles, or Patients, each with its own list, board, and CSV import/export.
- **Custom fields.** Text, long text, number, currency, date, email, phone, URL, single select, multi select, checkbox, and links to other records.
- **Pipelines.** Pick any single-select field as a record type's board field to get a drag-and-drop board. Pick a number or currency field as its value field to see totals per stage. Renaming a stage moves every record in it.
- **Relationships.** A link field (for example Deal → Company) shows up on both records. The company page lists its contacts and deals, with one-click "Add deal" prefilled.
- **Activity timeline.** Notes, calls, emails, meetings, and tasks with due dates on any record, plus a Tasks page for everything that's open or overdue.
- **Dashboard.** Record counts, pipeline value by stage, upcoming and overdue tasks, and recent activity.
- **Search, filter, sort, and paging** on every list.
- **Branding.** Business name, accent color, and currency.

It has zero dependencies: Node.js's built-in HTTP server and SQLite, plus a plain-JavaScript frontend. There is nothing to `npm install`, and all your data lives in one file.

## Quick start

Requires **Node.js 22.13 or newer** (`node --version`).

```bash
npm start          # http://localhost:3000
npm run demo       # optional: load sample companies, contacts and deals
```

## Configuration

Set these as environment variables:

| Variable       | Default        | Purpose |
|----------------|----------------|---------|
| `PORT`         | `3000`         | Port to listen on |
| `HOST`         | `127.0.0.1`    | Use `0.0.0.0` to allow other machines to connect |
| `CRM_DB`       | `data/crm.db`  | SQLite database file |
| `CRM_PASSWORD` | *(none)*       | When set, the app requires HTTP Basic login |
| `CRM_USER`     | `admin`        | Username used with `CRM_PASSWORD` |

If you expose the CRM beyond your own computer, set `CRM_PASSWORD` and put it behind HTTPS (for example Caddy or nginx as a reverse proxy).

**Backups:** copy the database file (`data/crm.db`), or export each record type to CSV.

## Customizing

Open **Settings** in the sidebar.

1. **Business:** name, brand color, currency.
2. **Record types:** add, reorder, or open one to customize it:
   - rename it and change its icon;
   - choose its **title field** (what records are called), **board field** (pipeline), and **value field** (summed on boards);
   - add, edit, reorder, or delete **fields**, and edit select options or pipeline stages.

A few rules keep your data consistent:

- A field's type can't change after it's created. Add a new field instead.
- Removing a select option clears it from the records that used it. Renaming an option updates them.
- Deleting a field deletes its data. Deleting a record type deletes its records and any link fields pointing to it.

## Importing data

On any list page, click **Import** and choose a CSV file. Column headers are matched to field labels, case-insensitively. Link columns can contain the linked record's name, such as a company name. Rows that fail validation are skipped and reported by row number. **Export** downloads the current data in the same format.

## REST API

The UI is built on a JSON API you can script against.

```
GET    /api/objects                              schema: record types and their fields
POST   /api/objects                              {name, singular?, icon?}
PATCH  /api/objects/:slug                        {name, singular, icon, primary_field, board_field, value_field}
DELETE /api/objects/:slug
POST   /api/objects/:slug/fields                 {label, type, options?, target_object?, required?, show_in_list?}
PATCH  /api/fields/:id                           {label, options, renames?, required, show_in_list}
DELETE /api/fields/:id

GET    /api/objects/:slug/records?q=&sort=&dir=&limit=&offset=&filter[field]=value
POST   /api/objects/:slug/records                {fieldKey: value, ...}
GET    /api/records/:id
PATCH  /api/records/:id                          partial update
DELETE /api/records/:id
GET    /api/records/:id/related                  records linking to this one

GET    /api/activities?record_id=&type=&done=
POST   /api/activities                           {record_id?, type, body, due_at?}
PATCH  /api/activities/:id
DELETE /api/activities/:id

GET    /api/objects/:slug/export.csv
POST   /api/objects/:slug/import                 {csv: "..."}
GET    /api/dashboard
GET    /api/settings · PUT /api/settings         {business_name, accent_color, currency}
```

Example:

```bash
curl -X POST localhost:3000/api/objects/deals/records \
  -H 'Content-Type: application/json' \
  -d '{"name": "Website redesign", "stage": "New", "value": 8000}'
```

## Development

```bash
npm test
```

| Path | What's there |
|------|--------------|
| `src/crm.js` | Domain logic: schema, validation, records, activities, dashboard |
| `src/server.js` | HTTP routes, static files, auth |
| `src/db.js` | SQLite schema |
| `src/setup.js` | Starter record types |
| `src/transfer.js`, `src/csv.js` | CSV import/export |
| `public/` | The single-page app (`app.js`, `styles.css`) |

Records are stored as JSON in SQLite and validated against the field definitions in `fields`, which is why the schema can change at runtime without migrations.
