# My Mechanic QLD owner app

Mobile-first owner console for running the daily office side of My Mechanic QLD. It is designed to be installed on the business owner's phone and used between jobs.

The production app is deployed on Vercel at:

- <https://mmqld-app.vercel.app/>

The app is plain HTML, CSS and browser JavaScript. Most business data is read and written directly between the browser and Supabase. Gmail is accessed directly from the browser after Google OAuth. Ashley's model runs on Cloudflare Workers AI (GLM 4.7 Flash) behind a small Worker in `cloudflare/ashley`, which reaches the model through Cloudflare's built-in AI binding, so no model key exists anywhere.

## Current navigation

The five bottom tabs are:

1. Dashboard
2. Inquiries
3. Calendar
4. Search
5. Ashley

The sidebar groups the complete app:

- Day to day: Dashboard, Ashley, Inquiries, Calendar, Search
- Create: New invoice, New inspection
- Records: Invoices, Inspection reports
- Business: Analytics, Price list, Settings

## Main capabilities

- Read, search and update website inquiries.
- Reply to an inquiry in its existing Gmail thread.
- Call or prepare an SMS for a customer.
- Plan the day on a Google Calendar style timeline: drag bookings to new times, drag to resize, tap an empty slot to book, jump to any date. Bookings keep the customer's email.
- Create editable invoice PDFs with one searchable "Add items" picker, printed service checklists, bank payment details, recorded payments, drafts and Gmail sending.
- Create detailed vehicle inspection PDFs with a cover photo, Good/Fair/Poor grades, photos, a 0 to 100 score gauge, signatures and editable terms.
- Maintain the parts and job price list that feeds the invoice item picker; new items can also be created from an invoice.
- Leave an invoice or inspection with unsaved work only after choosing to keep editing, save a draft or discard.
- View and manage saved invoice and inspection records.
- Ask Ashley to look up business information, work across Supabase and Gmail, update routine records, and prepare confirmed customer communications.
- Manage app defaults, Gmail connection and on-device data from Settings.

## Architecture at a glance

```text
Owner's phone
  |
  |-- Static PWA pages on Vercel
  |     |-- Main owner console
  |     |-- Invoice generator
  |     |-- Inspection generator
  |     |-- Price list
  |     `-- Settings
  |
  |-- Supabase
  |     |-- Inquiries, bookings, documents, products and settings
  |     `-- Public invoice and inspection PDF buckets
  |
  |-- Google Identity Services and Gmail API
  |     `-- Inbox search, threaded replies and PDF attachments
  |
  `-- Ashley Worker on Cloudflare (mmqld-ashley.todo-r2-d1.workers.dev)
        `-- GLM 4.7 Flash through the Workers AI binding, no key
```

The app intentionally does not register a service worker. A controlling service worker caused cross-origin PDF uploads to fail on iOS WebKit. The manifest and Apple touch icons still provide the installed home-screen experience, but the app requires a network connection.

## Documentation

- [Feature inventory](docs/FEATURES.md)
- [Architecture and runtime flows](docs/ARCHITECTURE.md)
- [Data and integrations](docs/DATA_AND_INTEGRATIONS.md)
- [Ashley agent harness](docs/ASHLEY.md)
- [Operations and deployment](docs/OPERATIONS.md)
- [Current limitations](docs/CURRENT_LIMITATIONS.md)
- [Work log](docs/WORKLOG.md), newest changes first

These documents describe the code as it exists on 19 September 2026. `CURRENT_LIMITATIONS.md` records places where the UI wording or older setup files are ahead of the actual wiring.

## Repository map

```text
owner-app/
  index.html              Main shell, navigation and shared drawers
  app.js                  Dashboard, inquiries, calendar, records and Gmail actions
  styles.css              Main shell and Ashley styling
  config.js               Public browser configuration and message templates
  settings.js             Shared local and Supabase-backed settings layer
  customers.js            Shared recent-customer autocomplete (inquiries, invoices, bookings)
  storage.js              Record-first document saving and PDF storage uploads
  gmail-send.js           Shared Gmail sender for generator pages
  leave-guard.js          Unsaved-work warning shared by the invoice and inspection pages
  ashley-agent.js         Tool-calling loop and system instructions
  ashley-tools.js         Ashley's tool definitions and implementations
  ashley-ui.js            Ashley chat interface and confirmation cards
  cloudflare/ashley/      Cloudflare Worker that runs Ashley's model (deploy with wrangler)
  invoice/                Invoice form (app.js) and printed layout (invoice-pdf.js)
  inspection/             Inspection form (app.js) and printed layout (report-pdf.js)
  prices/                 Supabase-backed product and pricing editor
  settings/               Owner-facing settings page
  manifest.json           Installed-app metadata and icons
  vercel.json             Caching and security headers (static site, no functions)
  .vercelignore           Keeps cloudflare/ and docs/ out of the public site
  supabase-schema.sql     Original calendar/document setup SQL (plus the booking email column)
  sw.js                   Legacy no-cache service worker, not registered
  docs/                   Current technical and product documentation
```

## Configuration

`config.js` contains browser-safe configuration:

- Supabase URL and publishable key
- Google OAuth web client ID
- Ashley endpoint and browser handshake value
- baseline business details and quick-message defaults
- storage bucket names

The values are obfuscated to discourage casual copying, but that is not encryption. Never add a Supabase secret key, Google client secret or any Cloudflare API token to browser code.

Ashley's Worker needs one secret, set with `npx wrangler secret put ASHLEY_APP_KEY` in `cloudflare/ashley`. It must match the handshake in `config.js`. There is no model API key.

## Security model

This is currently a single-owner internal app, not a multi-user authenticated product.

- Supabase access uses a publishable browser key and depends entirely on Row Level Security.
- The current owner-app policies allow broad anonymous access to operational tables and document buckets.
- The optional passcode is a client-side convenience gate, not real database authentication.
- Gmail access tokens are cached in browser local storage until shortly before expiry.
- The Ashley browser handshake is not a secret. The model needs no key: the Worker uses Cloudflare's AI binding.
- Invoice and inspection PDF buckets are public so documents can be opened directly.

Keep the production URL private until proper user authentication and restrictive RLS policies are added.

## Development and verification

Serve this folder through HTTP rather than opening files directly:

```bash
python3 -m http.server 8771
```

Then open <http://127.0.0.1:8771/>. The Ashley Worker accepts `localhost:8771` and `127.0.0.1:8771` as development origins, and every Ashley question uses real Workers AI allowance. Gmail OAuth also requires the exact origin to be listed in the Google OAuth web client.

Before shipping changes, verify at minimum:

1. Main navigation and sidebar routes.
2. Supabase inquiry and calendar loading.
3. Invoice Save, Open and Send.
4. Inspection Save, Open and Send.
5. Gmail connection from Settings and from Ashley.
6. Ashley read, write and confirmation paths, including a declined confirmation.
7. Calendar drag, resize and undo on a real phone.
8. The unsaved-work warning on the invoice and inspection pages.
9. Installed-app icon and iPhone home-screen launch.
10. No service worker controls any owner-app page.
