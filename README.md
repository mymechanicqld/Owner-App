# My Mechanic QLD owner app

Mobile-first owner console for running the daily office side of My Mechanic QLD. It is designed to be installed on the business owner's phone and used between jobs.

The production app is deployed on Vercel at:

- <https://mmqld-app.vercel.app/>

The app is plain HTML, CSS and browser JavaScript. Most business data is read and written directly between the browser and Supabase. Gmail is accessed directly from the browser after Google OAuth. Ashley is the only feature with its own server endpoint, because the OpenRouter key must remain server-side.

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
- Create, edit, reorder and delete calendar bookings.
- Create editable invoice PDFs, record payments, save drafts, send invoices and reopen saved invoices.
- Create detailed vehicle inspection PDFs with grades, comments, camera or gallery images, signatures and editable terms.
- Maintain the parts and job price list that feeds the invoice item picker.
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
  `-- /api/ashley on the same Vercel deployment
        `-- OpenRouter model request with server-side credentials
```

The app intentionally does not register a service worker. A controlling service worker caused cross-origin PDF uploads to fail on iOS WebKit. The manifest and Apple touch icons still provide the installed home-screen experience, but the app requires a network connection.

## Documentation

- [Feature inventory](docs/FEATURES.md)
- [Architecture and runtime flows](docs/ARCHITECTURE.md)
- [Data and integrations](docs/DATA_AND_INTEGRATIONS.md)
- [Ashley agent harness](docs/ASHLEY.md)
- [Operations and deployment](docs/OPERATIONS.md)
- [Current limitations](docs/CURRENT_LIMITATIONS.md)

These documents describe the code as it exists on 17 September 2026. `CURRENT_LIMITATIONS.md` records places where the UI wording or older setup files are ahead of the actual wiring.

## Repository map

```text
owner-app/
  index.html              Main shell, navigation and shared drawers
  app.js                  Dashboard, inquiries, calendar, records and Gmail actions
  styles.css              Main shell and Ashley styling
  config.js               Public browser configuration and message templates
  settings.js             Shared local and Supabase-backed settings layer
  customers.js            Shared recent-customer autocomplete
  storage.js              Record-first document saving and PDF storage uploads
  gmail-send.js           Shared Gmail sender for generator pages
  ashley-agent.js         Tool-calling loop and system instructions
  ashley-tools.js         Ashley's tool definitions and implementations
  ashley-ui.js            Ashley chat interface and confirmation cards
  api/ashley.js           Vercel serverless OpenRouter proxy
  invoice/                Invoice form and PDF generator
  inspection/             Inspection form and PDF generator
  prices/                 Supabase-backed product and pricing editor
  settings/               Owner-facing settings page
  manifest.json           Installed-app metadata and icons
  vercel.json             Function limits, caching and security headers
  supabase-schema.sql     Original calendar/document setup SQL
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

The values are obfuscated to discourage casual copying, but that is not encryption. Never add a Supabase secret key, Google client secret or OpenRouter key to browser code.

The Ashley server function requires these Vercel environment variables:

- `OPENROUTER_API_KEY`
- `ASHLEY_APP_KEY`
- `ASHLEY_MODEL`, optional, currently defaulting to `google/gemini-3.7-flash`

## Security model

This is currently a single-owner internal app, not a multi-user authenticated product.

- Supabase access uses a publishable browser key and depends entirely on Row Level Security.
- The current owner-app policies allow broad anonymous access to operational tables and document buckets.
- The optional passcode is a client-side convenience gate, not real database authentication.
- Gmail access tokens are cached in browser local storage until shortly before expiry.
- The Ashley browser handshake is not a secret. The OpenRouter key remains server-side.
- Invoice and inspection PDF buckets are public so documents can be opened directly.

Keep the production URL private until proper user authentication and restrictive RLS policies are added.

## Development and verification

Serve this folder through HTTP rather than opening files directly:

```bash
python3 -m http.server 8771
```

Then open <http://127.0.0.1:8771/>. Localhost is accepted by the Ashley proxy only for the configured development origins. Gmail OAuth also requires the exact origin to be listed in the Google OAuth web client.

Before shipping changes, verify at minimum:

1. Main navigation and sidebar routes.
2. Supabase inquiry and calendar loading.
3. Invoice Save, Open and Send.
4. Inspection Save, Open and Send.
5. Gmail connection from Settings and from Ashley.
6. Ashley read, write and confirmation paths.
7. Installed-app icon and iPhone home-screen launch.
8. No service worker controls any owner-app page.
