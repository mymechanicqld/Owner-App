# Architecture and runtime flows

## Scope

This document covers only the owner PWA in this repository. It does not describe the public website except where website inquiry rows enter the owner app through Supabase.

## Runtime shape

The PWA has five independent browser entry points:

| Entry point | Purpose | Main scripts |
| --- | --- | --- |
| `/` | Main owner console | `app.js`, `email.js`, `customers.js`, Ashley scripts |
| `/invoice/` | Invoice generator | `invoice/app.js`, `invoice/invoice-pdf.js`, `leave-guard.js` |
| `/inspection/` | Inspection generator | `inspection/app.js`, `inspection/report-pdf.js`, `leave-guard.js` |
| `/prices/` | Price catalogue editor | inline page script |
| `/settings/` | App settings and connections | inline page script |

Every page loads `config.js`. Pages that consume owner settings also load `settings.js` immediately afterwards so local settings can update `CONFIG` before the rest of the page starts.

## Deployment

Two independent deployments:

- **Vercel** serves the static app from the `mymechanicqld/Owner-App` repository, redeploying on every push to `main`. `.vercelignore` keeps `cloudflare/` and `docs/` off the public site.
- **Cloudflare Workers** (business account, free plan) runs `mmqld-ashley`, `mmqld-triage`, `mmqld-gmail` and `mmqld-listener` from `cloudflare/<name>`. They are deployed by hand with the harness (`node cf.mjs deploy ../<name>` from `cloudflare/harness`); a push to GitHub does not update them.

Every owner-app page redirects non-canonical Vercel aliases to `mmqld-app.vercel.app`. This is necessary because Google OAuth authorises an exact origin. It also avoids branch aliases that can sit behind Vercel authentication.

`vercel.json` provides:

- no-cache revalidation for HTML, JavaScript, CSS and JSON
- long immutable caching for image assets
- noindex headers
- content-type, frame and referrer security headers

## Main shell lifecycle

On boot, the main page:

1. redirects to the canonical Vercel host when necessary
2. unregisters any service worker except the notification worker (scope `/push/`) and removes old caches
3. loads external Supabase, Lucide and Google Identity scripts
4. loads browser configuration
5. applies local settings and starts a non-blocking cloud settings refresh
6. creates the Supabase client
7. applies Ashley visibility
8. loads inquiries, then calendar events
9. renders the selected screen
10. refreshes inquiries and events every 60 seconds
11. warms Google Identity Services for later email actions

The main shell keeps its current screen, filters, loaded rows, calendar reference date, record caches and Gmail token reference in a single in-memory `STATE` object.

## Data boundaries

```text
Browser UI
  |
  |-- Supabase JavaScript client
  |     `-- main inquiry, calendar, record and Ashley tools
  |
  |-- Direct fetch with apikey
  |     |-- document logs and storage uploads
  |     |-- customer autocomplete
  |     |-- product list
  |     `-- settings
  |
  |-- Google OAuth and Gmail REST API
  |     |-- search and read inbox
  |     |-- send threaded plain-text replies
  |     `-- send multipart PDF attachments
  |
  `-- Ashley Worker on Cloudflare (cross-origin, X-Ashley-Key handshake)
        `-- GLM 4.7 Flash via the Workers AI binding
```

The browser performs Ashley's tools itself. The model endpoint never receives Supabase credentials or Gmail tokens. The endpoint receives the conversation, tool definitions and the compact tool results needed to continue the turn.

## Shared modules

### `config.js`

Defines Supabase, Google and Ashley browser configuration, baseline business details, storage buckets, service labels, quick email templates and SMS templates.

The values are char-code obfuscated. This makes casual copying less convenient but provides no security boundary.

### `settings.js`

Maintains one settings object with this precedence:

1. built-in defaults
2. local `mmqld_settings`
3. shared Supabase `app_settings` row when it exists and contains data

It mutates selected `CONFIG` properties so downstream code can keep reading its existing configuration object. Saving is local-first and cloud-second.

### `customers.js`

Used by the invoice and inspection generators and by the main app's booking sheet. Loads up to 400 recent inquiries, 200 invoices and 200 calendar bookings in parallel (bookings with `select=*`, so an older table without `customer_email` still loads). It normalises them into one customer shape, sorts newest first, de-duplicates by person or business plus rego, and backfills missing fields from older records.

Autocomplete ranking is:

1. selected name starts with the query
2. selected name contains the query
3. alternate person/business name contains the query
4. rego contains the query

Recency breaks ties.

Each customer carries `refs`: every inquiry and booking it was built from. Invoice rows contribute the customer address by selecting `addr:state->customer->>address` from the saved state.

`saveBack(details, { refs, submissionId, bookingId })` runs after an invoice or report saves. It reads each target row and PATCHes only empty columns (`quote_submissions`: full_name, email, phone, address, vehicle_rego, vehicle_year, and vehicle_make when make and model are both empty; `calendar_events`: customer_name, customer_email, customer_phone, address, vehicle_rego). With no explicit link it falls back to an exact name + rego match. `describe()` turns the result into the owner's message. The booking sheet passes `booking=<id>` to the generators so a document started from a booking links back to it.

### `email.js`

The Email tab. Loaded after `app.js` and uses its globals (`gFetch`, `getToken`, `cachedGToken`, `STATE`, `sb`, `esc`, `toast`, `setView`, `openDetail`, `encHeader`, `u8b64`, `b64url`). Exposes `renderEmail()` for `render()` and `MMQLD_MAIL` (`openFor(email)`, `openThread(id)`, `refresh()`, `isOpen()`, `close()`).

- List: `messages.list` with the Customers or All inbox query (newest message first), keeping the first 25 distinct threads, so a conversation with a fresh reply comes to the top. `threads.list` was used before, but it orders by when a conversation started, so an old conversation with a new reply fell off the page. `threads.get?format=metadata` runs only for threads whose newest message changed (five at a time). Summaries and the customer list are cached in `mmqld_mail_v1`.
- Thread: `threads.get?format=full`, MIME walked for text/plain (HTML converted to text when there is no usable plain part; email HTML is never inserted into the page), quoted history split off, the website notification parsed into fields.
- Send: plain-text MIME to `messages.send` with `threadId`, the thread's subject, `In-Reply-To` and `References`.
- Staying current: `renderEmail()` (called by the one-minute repaint) re-checks the list when it is over a minute old, and `checkThread()` checks an open conversation with a `format=minimal` call, fetching the full thread only when a new message id appears and redrawing only the message log. `visibilitychange` runs the same checks when the app returns to the screen.
- Repaint safety: `app.js` repaints the active view every minute. `renderEmail()` only builds what is missing, and the reply text is kept in memory and in `mmqld_mail_v1`, so a background repaint never loses a half-written reply.
- `body.mail-thread` gives an open conversation the whole area above the nav, like `ash-mode` for Ashley; `setView()` clears it on other tabs.

### `mail-mime.js`

Builds every outgoing email body: `MMQLD_MIME.alternative(text)` returns the Content-Type and encoded body of a `multipart/alternative` part (plain text + HTML with a unique invisible ending, so Gmail does not fold the repeated signature). Loaded before `app.js` on the main page and before `gmail-send.js` on the generator pages.

### `cloudflare/triage`

Worker `mmqld-triage` on the business Cloudflare account. A cron trigger runs every minute: it reads up to 25 inquiries from the last `WINDOW_HOURS` (48) with `ai_checked_at` null, runs `@cf/cloudflare/clef-flash` through the AI binding with three `noul` questions in one call (own parts, parts they already own or bought to be fitted, started it themselves; `ai_diy_score` is the higher of the first two) over "Service requested / Customer notes", and PATCHes `ai_diy_score`, `ai_started_score`, `ai_checked_at` and `ai_model`. Rows checked before the second question existed (`ai_started_score` null) are re-checked. If migration 011 has not run, it falls back to the own-parts question alone. A failed row stays unchecked and is retried next minute. `POST /run` with `X-Run-Key` triggers a pass on demand and returns the scores. Secrets: `SUPABASE_URL`, `SUPABASE_KEY` (the publishable key), `RUN_KEY`.

### `gmail-auth.js`

Shared Gmail sign-in for the main app, the invoice and inspection pages and Settings (`MMQLD_GAUTH`: `getToken`, `quiet`, `connect`, `disconnect`, `expire`, `connected`, `lasting`). Keeps the phone signed in through the `mmqld-gmail` Worker; see DATA_AND_INTEGRATIONS.md > Gmail > Authentication. `app.js` keeps `getToken`, `cachedGToken` and `ensureGis` as thin wrappers so `email.js` and Ashley's tools did not change.

### `cloudflare/listener` (`mmqld-listener`)

Runs every minute, started by `mmqld-triage`'s cron via a service binding (`POST /run` with `X-Internal-Key`); its own cron trigger never fired. Jobs: `newEnquiries` (Supabase rows after the last one seen; waits up to 3 minutes for the DIY check; skips spam with one Clef-flash question) and `customerReplies` (Gmail `history.list` from the last history id, INBOX additions not sent by us or robots, in a thread that has a SENT message). Sends encrypted Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID, `src/webpush.js`, checked against the RFC 8291 test vector by `test-webpush.mjs`). Gets its Gmail token and checks phone device keys through a service binding to `mmqld-gmail` (`/internal/*`, guarded by `INTERNAL_KEY`). Routes: `/subscribe`, `/unsubscribe`, `/test` (device key), `/run` (device key, or `X-Internal-Key` from the harness). New jobs go in `JOBS`.

### `push.js` and `push/sw.js`

`push.js` (Settings) asks permission, registers `push/sw.js` with scope `/push/`, subscribes with the VAPID public key and registers with the listener. `push/sw.js` shows alerts. On a tap it writes the link to IndexedDB (`mmqld-push`, key `open`), then focuses the open app (and posts a message) or opens `/?open=<id>` / `/?thread=<id>`. `app.js` reads and removes that stored link on start, on `visibilitychange` and on focus (`takePendingLink()`), because on iPhone a message to a page the worker does not control is not delivered and opening a window can just bring the app forward. `openFromLink()` then opens the enquiry (reloading data first if it is brand new) or the conversation. The app also calls `update()` on the `/push/` registration at every start, since a worker that controls no page is rarely checked for new versions otherwise. The worker's scope keeps it from controlling any page, which matters: a page-controlling service worker breaks PDF uploads on iPhone. The kill switch in each page head now removes every service worker except `/push/`.

### `gmail-send.js`

Provides generator-page Gmail access. It waits for and can re-inject Google Identity Services, caches a short-lived token, searches for an existing conversation, and sends a multipart PDF attachment.

`app.js` keeps its own Gmail helpers (thread search and sending) for the main shell; sign-in for both comes from `gmail-auth.js`. Both copies of `findThread()` finish with `latestInThread()`, so an invoice, report or Reply-sheet email answers the newest message in the conversation (bounces skipped) with the full `References` chain, not the first notification.

### `storage.js`

Uses direct Supabase REST and Storage requests so document saving does not depend on the Supabase JavaScript CDN.

The save order is deliberate:

1. insert or update the searchable database row
2. attempt the PDF upload
3. attach `pdf_path` when upload succeeds
4. keep the complete row even when the binary upload fails

New PDF object names include date, rego, document identifier where applicable, and time. The upload helper tries multipart fetch, raw-byte fetch, Blob fetch and XHR Blob, verifying object existence after failures.

Database inserts and patches can strip an unknown column named by PostgREST and retry. This lets old databases accept newer app rows without losing the entire save.

### `leave-guard.js`

Shared by the invoice and inspection pages. Each page passes `isDirty()`, `saveDraft()` and a back URL. The page records a snapshot of its state when it is loaded, started, restored from a draft or saved; anything different counts as unsaved. The inspection snapshot leaves out photo bodies, whose ids already change.

It intercepts the logo link in the capture phase, keeps one extra history entry so the phone's back gesture lands on the page first (re-pushing it and asking when dirty, carrying on back when clean), and sets `beforeunload` for closing or reloading. It injects its own styles and dialog markup.

### PDF layout modules

`invoice/invoice-pdf.js` and `inspection/report-pdf.js` hold the whole printed layout and build a pdfmake document definition from plain state. Neither touches the DOM, so the same files render in Node with pdfmake 0.2.10. That is how real saved invoices and reports were rendered and inspected during the 19 September redesign. The form pages keep a thin `buildInvoiceDoc` / `buildReportDoc` that passes state, totals, business details and the logo.

Two pdfmake rules both layouts depend on:

- a filled table cell that splits across a page gets its background painted on the wrong page, so filled panels are unbreakable or live in rows that cannot break
- separate `canvas` nodes in the page background stack one below another, so anything positioned from the page corner, such as the invoice footer strip, needs `absolutePosition`

## Calendar flow

1. `loadEvents()` reads every `calendar_events` row; the 60-second refresh reloads them.
2. `renderCalendar()` draws Day view as a timeline. `calDayBounds()` sets the hour range and `calLayout()` assigns overlapping bookings to side-by-side columns.
3. A booking drag is tracked in `CAL_DRAG`. Touch needs a 380 ms hold before it lifts; movement before then cancels so the page scrolls. While a drag is active the background refresh does not repaint.
4. On release, `commitCalDrag()` updates the booking in memory, repaints, then updates `starts_at` and `ends_at` in Supabase. On failure the old times are restored. Undo writes the previous times back.
5. Saving the booking sheet writes `customer_email`. If the database lacked that column, the row is saved without it and the owner is told the email was not kept.

## Invoice flow

### New from scratch

1. `blankState()` creates the initial form state.
2. The page loads products cache-first and refreshes from Supabase.
3. The owner enters customer, vehicle, items (through the Add items sheet, which can also upsert a new product), line details, tax, payments and signature.
4. `compute()` is the single source for subtotal, GST, total, paid and outstanding.
5. `invoice-pdf.js` builds the document definition and pdfmake renders the PDF in the browser.
6. Save writes a local draft and then calls `storage.js`.

### Prefilled from an inquiry or booking

The main shell passes customer values in URL parameters. The generator applies non-empty values to its state and retains the inquiry ID for `submission_id`.

### Editing

`?edit=<uuid>` loads the saved row. A current row restores its full `state` JSON. A legacy row is rebuilt from individual columns. Further saves patch the same record ID rather than creating another invoice.

### Sending

The page asks Gmail for a token before PDF generation so the OAuth popup remains close to the owner's tap. It searches for a thread by email and then rego, sends the attachment, and saves the invoice using the same base64 PDF.

## Inspection flow

The inspection generator follows the same create, prefill, edit, save and send shape.

Its section definitions are data-driven. The same `SECTIONS` structure controls:

- form rendering
- grade storage
- progress and flag counts
- searchable JSON saved to Supabase
- PDF section pages

Camera and gallery photos are compressed in the browser and uploaded to the `inspections` bucket under `images/<report folder>/`. The cover photo (`state.coverImage`) is stored the same way. The saved state keeps paths, dimensions and captions, not image bodies, and the PDF downloads the masters only when a report is opened, saved or sent. Any photo without stored dimensions is measured first, because photo rows are sized from each photo's proportions.

`normaliseState()` runs whenever the form renders: it turns old "Repair" grades into "Poor" and adds the `score` and `coverImage` fields to older reports.

The PDF layout is built by `report-pdf.js`. Photos are laid out in justified rows: a row grows until it overfills the page width, then keeps whichever of "with" or "without" the last photo lands closer to the target height of 172 points, capped so no row towers. Every photo in a row shares its height.

Deleting a report from Records removes its PDF, photos, thumbnails and cover photo.

## Ashley flow

```text
Owner question
  -> browser builds current system instructions
  -> the Cloudflare Worker runs one GLM 4.7 Flash step
  -> model returns zero or more tool calls
  -> browser runs independent calls in parallel
  -> confirmed actions pause for the owner's button
  -> compact results go back to the model
  -> final plain-language answer is rendered and saved locally
```

If the owner declines a confirmation and nothing confirmed ran, the final answer is replaced in code with "Okay, I have left it. Nothing was sent or changed."

Only user messages and final assistant text survive into the next turn's history. Tool calls and tool results are not persisted in conversation history.

See `ASHLEY.md` for the complete harness and tool inventory.

## PWA and iOS behaviour

The app has a manifest and home-screen icons. No service worker controls any page. This is intentional.

A previously controlling service worker made iOS WebKit fail cross-origin requests with request bodies, including Supabase Storage uploads. Each page unregisters old workers before starting, except the notification worker `push/sw.js`, which is registered with scope `/push/` (no app page lives there), has no fetch handler and only shows alerts. `sw.js` remains in the repository as a legacy no-cache worker but is never registered by current code.

Notifications on iPhone need iOS 16.4 or later and the app opened from its Home Screen icon.

As a result:

- the app can launch in standalone home-screen mode
- fresh code is favoured over stale cached code
- the app requires connectivity for business data and external libraries
- an old installed copy may need to be removed and added to the home screen again after icon or origin changes

## External runtime dependencies

- Supabase JavaScript v2 on the main shell
- Lucide icons on the main shell
- Google Identity Services on pages that send email
- Gmail REST API
- pdfmake and its virtual font bundle on generator pages
- Google Fonts on generator pages
- Supabase REST and Storage APIs
- Cloudflare Workers AI through the Ashley Worker

If a CDN dependency fails, only the related part of the app is available. `storage.js`, price list, settings and customer lookup use direct HTTP requests and do not require the Supabase JavaScript library.
