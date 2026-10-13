# My Mechanic QLD owner app

Mobile-first owner console for running the daily office side of My Mechanic QLD. It is designed to be installed on the business owner's phone and used between jobs.

The production app is deployed on Vercel at:

- <https://mmqld-app.vercel.app/>

The app is plain HTML, CSS and browser JavaScript. Most business data is read and written directly between the browser and Supabase. Gmail is called directly from the browser; a phone signs in once and stays signed in, because a Cloudflare Worker keeps the Google refresh token and renews the access token quietly. Four small Workers on the business Cloudflare account (free plan) do the rest: Ashley's model (GLM 4.7 Flash), the automatic "Likely DIY" check on new enquiries (Clef-flash), the Gmail connection keeper, and a listener that sends phone notifications. Models run through Cloudflare's AI binding, so no model key exists anywhere. The Workers are managed from this Mac with `cloudflare/harness`.

## Current navigation

The five bottom tabs are:

1. Dashboard
2. Inquiries
3. Calendar
4. Email
5. Ashley

The sidebar groups the complete app:

- Day to day: Dashboard, Ashley, Inquiries, Calendar, Email, Search customers
- Create: New invoice, New inspection
- Records: Invoices, Inspection reports
- Business: Analytics, Price list, Settings

## Main capabilities

- Read, search (name, rego, phone, email, suburb) and update website inquiries. Each row's left tile shows its status, or "DIY" when the automatic check thinks the customer has their own parts or started the job themselves.
- Reply to an inquiry in its existing Gmail thread. Ashley can rewrite a quick draft ("$168") into a proper reply, or draft a polite decline for a DIY job in one tap.
- Phone notifications for new enquiries and customer email replies, opening the right screen when tapped.
- Gmail stays signed in on each phone after one sign-in.
- Read and answer customer email conversations on the Email tab without opening Gmail: the website enquiry, every reply and every answer in one thread, in order, with a manual Refresh.
- Call or prepare an SMS for a customer.
- Plan the day on a Google Calendar style timeline: drag bookings to new times, drag to resize, tap an empty slot to book, jump to any date. Bookings keep the customer's email.
- Create editable invoice PDFs with one searchable "Add items" picker, printed service checklists, bank payment details, recorded payments, drafts and Gmail sending. Saving fills any gaps (email, address, rego, car) in the customer's enquiry and bookings.
- Create detailed vehicle inspection PDFs with a cover photo, Good/Fair/Poor grades, photos, a 0 to 100 score gauge, signatures and editable terms.
- Maintain the parts and job price list that feeds the invoice item picker; new items can also be created from an invoice.
- Leave an invoice or inspection with unsaved work only after choosing to keep editing, save a draft or discard.
- View and manage saved invoice and inspection records.
- Ask Ashley to look up business information, work across Supabase and Gmail, update routine records, and prepare confirmed customer communications.
- Edit everything from an iOS-style Settings page: business and bank details, invoice and report defaults, all email and text wording, calendar hours, Ashley, Gmail, notifications, passcode and on-phone storage.

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
  |-- Gmail API (called from the phone)
  |     `-- Inbox, threaded replies and PDF attachments
  |
  `-- Cloudflare Workers, business account, free plan (*.mmqld.workers.dev)
        |-- mmqld-ashley    Ashley and Rewrite: GLM 4.7 Flash, no key
        |-- mmqld-triage    every minute: Likely DIY scores on new enquiries (Clef-flash)
        |-- mmqld-gmail     keeps Gmail signed in (encrypted refresh token, device keys)
        `-- mmqld-listener  every minute: phone alerts for new enquiries and customer replies
```

No service worker controls any app page: a controlling service worker made cross-origin PDF uploads fail on iOS WebKit. The only service worker is the notification one, `push/sw.js`, scoped to `/push/` so it never controls a page. The app needs a network connection.

## Documentation

- [Feature inventory](docs/FEATURES.md)
- [Architecture and runtime flows](docs/ARCHITECTURE.md)
- [Data and integrations](docs/DATA_AND_INTEGRATIONS.md)
- [Ashley agent harness](docs/ASHLEY.md)
- [Operations and deployment](docs/OPERATIONS.md)
- [Current limitations](docs/CURRENT_LIMITATIONS.md)
- [Work log](docs/WORKLOG.md), newest changes first

These documents describe the code as it exists on 13 October 2026. `CURRENT_LIMITATIONS.md` records places where the UI wording or older setup files are ahead of the actual wiring.

## Repository map

```text
owner-app/
  index.html              Main shell, navigation and shared drawers
  app.js                  Dashboard, inquiries, calendar, records, reply sheet (Rewrite, DIY decline) and Gmail actions
  email.js                Email tab: customer conversations from Gmail
  gmail-auth.js           Shared Gmail sign-in that stays signed in (with cloudflare/gmail)
  mail-mime.js            Builds every outgoing email body (stops Gmail folding the signature)
  push.js                 Turns phone notifications on or off (Settings)
  push/sw.js              Notification-only service worker, scope /push/
  styles.css              Main shell and Ashley styling
  config.js               Public browser configuration and message templates
  settings.js             Shared local and Supabase-backed settings layer
  customers.js            Shared recent-customer autocomplete (inquiries, invoices, bookings)
  storage.js              Record-first document saving and PDF storage uploads
  gmail-send.js           Gmail sender for the invoice and inspection pages
  leave-guard.js          Unsaved-work warning shared by the invoice and inspection pages
  ashley-agent.js         Tool-calling loop and system instructions
  ashley-tools.js         Ashley's tool definitions and implementations
  ashley-ui.js            Ashley chat interface and confirmation cards
  cloudflare/harness/     Command-line tool for the Cloudflare account (credentials in a git-ignored .env)
  cloudflare/ashley/      Worker: Ashley's model endpoint
  cloudflare/triage/      Worker: Likely DIY check on new enquiries, every minute
  cloudflare/gmail/       Worker: keeps Gmail signed in
  cloudflare/listener/    Worker: phone notifications, every minute
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
- Gmail connection keeper and notification listener endpoints, and the public Web Push key
- baseline business details and quick-message defaults
- storage bucket names

The values are obfuscated to discourage casual copying, but that is not encryption. Never add a Supabase secret key, Google client secret or any Cloudflare API token to browser code.

Worker secrets (Google client secret, encryption key, Supabase details, Web Push private key, internal key) are set with the harness (`cloudflare/harness`, value on stdin) and backed up only in its git-ignored `.env`. See docs/OPERATIONS.md. There is no model API key.

## Security model

This is currently a single-owner internal app, not a multi-user authenticated product.

- Supabase access uses a publishable browser key and depends entirely on Row Level Security.
- The current owner-app policies allow broad anonymous access to operational tables and document buckets.
- The optional passcode is a client-side convenience gate, not real database authentication.
- Gmail access tokens are cached in browser local storage until shortly before expiry. The long-lived Google refresh token stays encrypted on Cloudflare; each phone holds only a device key, which Settings > Gmail can disconnect.
- Only a phone with Gmail connected can sign up for notifications, because alerts carry customer names. Alerts are encrypted end to end.
- The Ashley browser handshake is not a secret. The model needs no key: the Worker uses Cloudflare's AI binding.
- Invoice and inspection PDF buckets are public so documents can be opened directly.

Keep the production URL private until proper user authentication and restrictive RLS policies are added.

## Development and verification

Serve this folder through HTTP rather than opening files directly:

```bash
python3 -m http.server 8771
```

Then open <http://127.0.0.1:8771/>. The Workers accept `localhost:8771` and `127.0.0.1:8771` as development origins, and every Ashley question uses real Workers AI allowance. `http://localhost:8771` is listed in the Google OAuth web client, so Gmail sign-in works there too. The local copy uses the real Supabase data and the real Gmail: anything sent from it reaches customers.

Before shipping changes, verify at minimum:

1. Main navigation and sidebar routes.
2. Supabase inquiry and calendar loading.
3. Invoice Save, Open and Send.
4. Inspection Save, Open and Send.
5. Gmail connection from Settings, and that a send after the access token is removed renews quietly with no popup.
11. Settings > Notifications: turn on, test alert arrives, tapping opens the app.
6. Ashley read, write and confirmation paths, including a declined confirmation.
7. Calendar drag, resize and undo on a real phone.
8. The unsaved-work warning on the invoice and inspection pages.
9. Installed-app icon and iPhone home-screen launch.
10. No service worker controls any owner-app page (the `/push/` one must not).
