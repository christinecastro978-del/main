# Custom CRM and attribution engine

A self-hosted CRM for a fractional marketing practice selling to founders and CEOs of venture-backed cybersecurity companies. It tracks **where every lead came from**, **how they move through the sales cycle**, and **which channels produce pipeline and revenue**.

It ships with:

- **Companies** with funding stage, security category, ICP fit, total raised and investors.
- **Contacts** with role and a lifecycle stage: Subscriber → Lead → MQL → SQL → Opportunity → Client.
- **Deals** with engagement type and pipeline stages: Discovery call booked → Discovery held → Proposal sent → Negotiation → Won/Lost.

Everything is customizable from **Settings**: record types, fields, stages, channels and branding. No code changes needed.

## What it does

**CRM**
- Your own record types and fields: text, numbers, currency, dates, dropdowns, links between records, and more.
- Table and drag-and-drop board views, with search, filters, sorting, and CSV import/export.
- Activity timeline (notes, calls, meetings, tasks) and a Tasks page.

**Attribution engine**
- **Website tracking.** A small script on christinecastro.com remembers how each visitor arrived: UTM tags, LinkedIn/Google ad clicks, the referring site, and AI assistants like ChatGPT and Perplexity. When they fill in any form, it creates or updates the contact with that whole journey.
- **Offline touchpoints.** Log investor intros, client referrals, events and podcast appearances on a contact with **+ Touchpoint**.
- **Webhook** for Zapier, Make, Calendly, LinkedIn Lead Gen Forms and similar tools.
- **Stage history.** Every stage change is timestamped, so the CRM knows when each lead became an MQL, an SQL or a client.
- **Attribution report.** Leads, opportunities, open pipeline, won deals, revenue and win rate by channel, source or campaign, under five models:
  - **First touch:** all credit to whatever first brought them in. Use it to see what creates demand.
  - **Last touch:** all credit to the final touch before converting.
  - **Linear:** credit split evenly across every touch.
  - **U-shaped (default):** 40% to the first touch, 40% to the last, 20% shared by the middle.
  - **Time decay:** recent touches count more (the weight halves every 7 days back).
- **Funnels.** How many people reached each stage, conversion between stages, average days spent in each stage, win rate, and sales cycle length.
- **Journey panel** on every contact and deal: first and last touch, every touchpoint with its share of credit, and the stage timeline.

**How deals get credit:** a deal is credited with the touches of its linked contact *and everyone at its company* (B2B deals involve several people), counting touches up to the day the deal opened. A lead is credited with all of that person's touches.

**Built for the web:** individual logins (add teammates as you grow), HttpOnly session cookies, CSRF protection, rate-limited sign-in, one-click database backups, and a Dockerfile.

It has zero dependencies. It runs on Node.js's built-in HTTP server and SQLite, and all data lives in one file.

## Try it locally

Requires Node.js 22.13 or newer.

```bash
npm run demo     # optional: a year of fictional sample data
CRM_ADMIN_EMAIL=you@example.com CRM_ADMIN_PASSWORD='choose-a-long-password' npm start
```

Open http://localhost:3000. Without the `CRM_ADMIN_*` variables, the server prints a one-time setup link instead.

## Put it online

The CRM needs a host that keeps files between restarts, because SQLite stores data on disk. These steps use **Fly.io** (about $3–5/month); `fly.toml` is included.

1. Install the CLI and sign in: <https://fly.io/docs/flyctl/install/>, then `fly auth login`.
2. From this folder:
   ```bash
   fly launch --no-deploy --copy-config   # accept or change the app name
   fly volumes create crm_data --size 1
   fly deploy
   fly logs                               # copy the "Create yours at" setup link
   ```
3. Open the setup link, replacing `http://localhost:3000` with your app's URL (for example `https://christinecastro-crm.fly.dev`), and create your account.
4. **Custom domain (recommended):** run `fly certs add crm.christinecastro.com`, then add the DNS record it shows at your domain registrar.

**Other hosts:** any platform that runs a Dockerfile and has a persistent volume works, such as Railway or Render (paid plan). Mount the volume at `/data` and, if the platform terminates HTTPS for you, set `SECURE_COOKIES=1`.

**Backups:** use **Settings → Your account & data → Download backup** regularly. On Fly you can also enable volume snapshots.

## Connect your website

1. **Settings → Attribution & tracking** shows a one-line `<script>` tag. Paste it into your site's header on every page:
   - **Squarespace:** Settings → Advanced → Code Injection → Header
   - **Webflow:** Site settings → Custom code → Head code
   - **WordPress:** a "header and footer scripts" plugin
2. Check that your site's address is listed under **Websites allowed to send leads**. `https://christinecastro.com` and `https://www.christinecastro.com` are there by default.
3. Submit your own contact form once and confirm the contact appears.

The script captures any form with an email field. To capture only specific forms, add `data-forms="tagged"` to the script tag and `data-crm` to those `<form>` tags. To exclude a form, add `data-crm-ignore` to it. Forms that run inside an iframe (for example, embedded HubSpot or Typeform forms) can't be seen by the script. Send those through the webhook instead.

**Privacy:** the script keeps its notes in the visitor's own browser (`localStorage`) and sends nothing unless they submit a form. Mention this in your privacy policy. If you market to the EU or UK, show it behind your cookie-consent banner.

### Tag your links

Attribution is only as good as your UTM tags. A simple convention:

| Where the link goes | utm_source | utm_medium | utm_campaign |
|---|---|---|---|
| LinkedIn post | `linkedin` | `social` | topic, e.g. `founder-led-growth` |
| LinkedIn ad | `linkedin` | `paid_social` | ad campaign name |
| Newsletter | `newsletter` | `email` | issue, e.g. `gtm-teardown-42` |
| Podcast show notes | show name | `podcast` | episode |
| Conference follow-up | event, e.g. `rsac` | `event` | `rsac-2026` |
| Partner or VC newsletter | partner name | `partner` | placement |

Example: `https://christinecastro.com/?utm_source=linkedin&utm_medium=social&utm_campaign=founder-led-growth`

Untagged visits are still classified from where they came from: Google, LinkedIn, ChatGPT, another website, or direct.

### Webhook (Zapier, Calendly, LinkedIn Lead Gen…)

POST JSON to the webhook URL shown in Settings:

```json
{ "email": "ceo@example.com", "name": "Dana Okoro", "company": "Vaultline", "title": "CEO",
  "message": "…", "channel": "Events", "source": "RSAC 2026", "campaign": "founder-dinner" }
```

Only `email` is required. Leave out `channel` to have it inferred from `source`/`medium`/`utm_*`. Existing contacts (matched by email) get the new touchpoint, and their existing data is never overwritten. New contacts get a follow-up task due the next day.

### Importing existing contacts

On the Contacts list, use **Import** with a CSV file. Columns matching field names fill those fields. These extra columns become a touchpoint: `Channel`, `Lead source` (a channel name, or something like "Intro from Team8"), `UTM Source`/`Medium`/`Campaign`, and `Touch date`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | `0.0.0.0` to accept outside connections (set in the Dockerfile) |
| `CRM_DB` | `data/crm.db` | SQLite database file (`/data/crm.db` in Docker) |
| `CRM_ADMIN_EMAIL` / `CRM_ADMIN_PASSWORD` / `CRM_ADMIN_NAME` | — | Creates the first account at startup if none exists |
| `TRUST_PROXY` | off | Read client IP and HTTPS from `X-Forwarded-*` headers (set in the Dockerfile) |
| `SECURE_COOKIES` | off | Always mark the session cookie Secure (set in `fly.toml`) |

## API

Everything in the UI is available as JSON under `/api`. Requests need a session cookie (sign in through `POST /api/login`), and every request other than GET needs an `X-CRM: 1` header.

```
POST   /api/login · /api/logout · /api/setup          GET /api/session
GET    /api/objects                                    schema
GET    /api/objects/:slug/records?q=&sort=&dir=&filter[field]=value
POST   /api/objects/:slug/records · PATCH/DELETE /api/records/:id
GET    /api/records/:id/journey?model=u_shaped        touchpoints, credit, stage history
POST   /api/records/:id/touchpoints                    {channel, source, campaign, occurred_at, note}
GET    /api/reports/attribution?from=&to=&model=&group_by=channel|source|campaign
GET    /api/reports/funnel?object=deals&from=&to=
GET    /api/objects/:slug/export.csv · POST /api/objects/:slug/import {csv}
GET    /api/backup
POST   /t/submit (website snippet) · POST /t/webhook/:key (integrations)
```

## Development

```bash
npm test
```

| Path | What's there |
|---|---|
| `src/crm.js` | Records, schema, validation, stage history |
| `src/attribution.js` | Channel classification, attribution models, reports, funnels |
| `src/capture.js` | Turning form posts and webhooks into contacts and touchpoints |
| `src/auth.js` | Users, password hashing (scrypt), sessions |
| `src/server.js` | HTTP routes and security headers |
| `src/setup.js` | Starter record types for a new database |
| `public/app.js` | The web app |
| `public/track.js` | The website tracking snippet |
