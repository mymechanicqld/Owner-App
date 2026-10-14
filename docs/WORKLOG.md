# Owner App Work Log

This file records completed owner-app changes, production updates and important verification details. Add new entries at the top.

## 14 October 2026: A test reply did not show or alert (two fixes)

Status: Deployed.

A reply sent from the Vishal Verma test address (gursahib99888@gmail.com) at 8:39 am into the existing enquiry conversation did not appear on the Email tab and sent no alert. Two separate bugs:

- **Email tab order.** The list came from `threads.list`, which orders conversations by when they started. The Vishal conversation began on 3 Oct, so with the enquiries since, it was not in the first 25 even with a new reply. The list now comes from `messages.list` (newest message first) and keeps the first 25 distinct conversations, then sorts by latest activity. Checked: the Vishal conversation went from missing to second.
- **The listener never ran on its own.** Its every-minute cron trigger was registered, and Cloudflare listed a scheduled handler, but the scheduled-run log had no runs at all, while `mmqld-triage`'s identical cron ran every minute. Re-registering it did not help. The triage cron now starts the listener every minute through a service binding, and the listener's own cron was removed so it can never run twice. Checked in Cloudflare's run counts: 5 runs per 5 minutes, no errors. Before switching, the enquiry position was moved to "now" so the first run did not send alerts for every enquiry since the previous afternoon; the inbox position was left, so the test reply got its alert.
- Enquiry alerts never worked before this fix for the same reason; the iPhone test alert worked because tests are sent directly, not by the schedule.

## 14 October 2026: Notifications on the old GitHub Pages copy

Status: Deployed.

- Turning on notifications failed on the owner's Android phone with "Failed to register a ServiceWorker for scope https://mymechanicqld.github.io/push/". That phone runs the old GitHub Pages copy, where the app lives under /Owner-App/, and the code used a fixed /push/ path (404 there).
- `push.js` now works out the app's folder from where it was loaded, and `push/sw.js` resolves its icon and the tapped-alert link from its own scope, so both Vercel and GitHub Pages work.
- The canonical address is still https://mmqld-app.vercel.app; the phone should be moved there (see OPERATIONS.md, deployment).

## 13 October 2026: Summary of the day

Everything shipped today, newest first (details in the entries below):

- No pop-up after an AI draft; the text is no longer covered.
- Draft with Ashley beside Send on the Email tab (enquiry plus last ten messages, [gaps] for anything only the owner can decide).
- The Email tab keeps itself current: open conversations check every minute and everything re-checks on return to the app.
- Phone notifications for new enquiries and customer replies, from a new listener Worker; confirmed on a real iPhone.
- Gmail stays signed in: one sign-in per phone, refresh token kept encrypted on Cloudflare.
- Likely DIY catches customers with some of their own parts (Zilla), the dashboard DIY banner is gone, a DIY button sits in every enquiry's header, and search is back on Inquiries.
- Free plan budget checked and written up (OPERATIONS.md); all four Workers fit comfortably.

## 13 October 2026: No pop-up after an AI draft

Status: Deployed.

- The "Drafted by Ashley / Rewritten by Ashley" toast (with Undo) is gone from all three AI drafts: Email tab sparkle, Rewrite, and Draft a polite no. It sat over the draft while the owner read it. Error messages still show. Send still asks before a reply with a [gap] goes out.

## 13 October 2026: Draft with Ashley on the Email tab

Status: Deployed.

- A small sparkle button beside Send in an open conversation drafts the reply with Ashley's Cloudflare model from the enquiry and the last ten messages, following whatever the owner typed. Missing figures become [gaps], and Send asks before a reply with a gap goes out. Undo restores the typed text.
- Tested on the real Vishal Verma test thread; see ASHLEY.md for the rule changes that stopped it mixing in earlier prices.

## 13 October 2026: Email tab keeps itself current

Status: Deployed.

- An open conversation checks for new messages every minute (message ids only, so it is cheap) and adds them in place, with a toast for customer messages. Only the message log is redrawn; the reply box keeps its text and the keyboard.
- Returning to the app re-checks the list or the open conversation straight away.
- The list's own one-minute re-check already existed; since Gmail now stays signed in it keeps working without taps.
- Tested on the real Vishal Verma test thread with the newest message held back on first load: it appeared on return to the app, the half-typed reply and cursor were untouched.

## 13 October 2026: Phone notifications, and a listener Worker

Status: Deployed. Confirmed on a real iPhone on 13 Oct 2026: turned on from Settings > Notifications and the test alert arrived.

- New Worker `cloudflare/listener` (`mmqld-listener`): every minute it alerts connected phones about new enquiries (with Likely DIY, spam left out) and customer email replies. Encrypted Web Push written with Web Crypto only; matches the RFC 8291 test vector byte for byte.
- `mmqld-gmail` gained `/internal/token` and `/internal/device` for the listener (service binding, shared `INTERNAL_KEY`).
- App: Settings > Notifications (on, test, per-kind switches, off), `push.js`, `push/sw.js`, and alerts open the enquiry or conversation.
- The service worker problem: the app had removed its service worker because one that controls the page breaks iPhone PDF uploads, and every page removes any it finds. The notification worker is scoped to `/push/` so it never controls a page, and the kill switch now spares it. Checked: registered, active, no page controlled, no reload.
- Free plan budget written up in OPERATIONS.md: everything fits, with KV writes (1,000 a day) the one to watch, so state is only written when something changes.

## 13 October 2026: Gmail stays signed in

Status: Deployed.

The owner had to sign in to Google again before sending whenever more than an hour had passed, because browser-only Google sign-in gives one-hour tokens that cannot be renewed quietly (and the iPhone home-screen app often forgot the Google login, so it was a full sign-in).

- New Worker `cloudflare/gmail` (`mmqld-gmail`, business Cloudflare account, KV `mmqld-gmail`) keeps an encrypted Google refresh token for the business mailbox only, and gives each connected phone a fresh access token on request.
- New `gmail-auth.js`, used by every page: one-time connect per phone, quiet renewal after that, Disconnect this phone in Settings.
- The OAuth app was published by the owner (refresh tokens would expire weekly in Testing). The web client's secret is a Worker secret only.
- Tested end to end on the local copy after the owner connected: with the access token removed, a new one came back with no popup in 0.1 s (Worker copy) and, with the Worker's copy cleared too, 0.4 s via Google's refresh. The main app, Email tab and invoice page all sent Gmail requests through it.

## 13 October 2026: Zilla's enquiry, search on Inquiries, DIY button in the header

Status: Deployed.

- Zilla Lingwoodock (own shock absorbers and ball joints to fit, brake pads not bought yet) was missed at 0.13. The checker now asks a third own-parts question and takes the higher score; the last 48 hours were re-scored and she is flagged (0.77). One expected extra flag: Gaylene Smith (changed her own fuel and spark plugs, 0.72). See DATA_AND_INTEGRATIONS.md for what was tried.
- The dashboard's likely DIY banner is removed (the DIY tile on each row is enough).
- Search is back at the top of Inquiries (name, rego, phone, email, suburb, car, job), across all enquiries.
- A small DIY button beside the close button in any enquiry's details drafts the polite no, for jobs the check missed.

## 11 October 2026: Draft a polite no for Likely DIY enquiries

Status: Deployed.

- A **Draft a polite no** button in the Likely DIY note. One tap opens the reply on the matching decline and Ashley writes a one or two sentence, personal "sorry, we can't take this on" with the right reason and the offer to do the whole job ourselves. The owner reviews and taps Send reply.
- The word "DIY" never reaches the customer: the model is told the reason in plain words, and any draft containing "DIY" or "do it yourself" falls back to the standard template.
- Rewrite button restyled white with navy (owner's request), and the new button matches.

## 11 October 2026: Rewrite with Ashley on the Reply sheet

Status: Deployed.

- Migration 011 applied by the owner. The once-a-minute triage run re-scored the last 48 hours by itself and scored two new enquiries with no manual trigger, confirming the scheduled path. Mitch Taylor (0.93) and Shantal (0.86) now carry the DIY tile.
- New sparkle **Rewrite** button left of Send reply: the owner's quick draft plus the enquiry go to the Cloudflare model behind Ashley (no tools) and come back as a proper reply in "we", greeting kept, signature added, with Undo. See ASHLEY.md for the rules and what testing changed.
- Tested on real enquiries: "$168" on a brake fault diagnosis, "220 all in, thursday arvo" on brake pads, and a decline with a $650 counter-offer on a started water pump job. The final rules gave accurate replies for all of them.

## 11 October 2026: Started-it-themselves check added to Likely DIY

Status: Deployed; needs website migration 011 run once to take effect.

- The triage Worker now asks Clef-flash a second question in the same call: has the customer already started the repair themselves and wants it finished. Stored in `ai_started_score` (migration 011). About 1.1 neurons per enquiry for both.
- Calibrated on the last 400 enquiries: 0.84 and above all genuine; cut-off 0.8.
- App: the same "Likely DIY" label covers both, the detail note says which, and the Reply sheet starts on a new **Started job** decline (playbook wording, editable in Settings > Messages). Ashley gets `diy_reason` and the wording for both.
- Row layout (owner's request): the left tile, which repeated the job type already written on the right, is now the flag tile: solid violet "DIY" for Likely DIY, otherwise the status in its colour. The status dot and the in-line tag are gone. The filter chip moved to the front of the chip row.
- Scored with both questions, the last 48 hours give two flags: Mitch Taylor (started the water pump himself, 93%) and Shantal (replaced O2 sensors, now wants a diagnosis, 86%, borderline).

## 11 October 2026: Automatic "Likely DIY" check with Cloudflare Clef

Status: Deployed.

The owner wanted enquiries where the customer supplies their own parts flagged as soon as they arrive, so he does not spend time on them.

- Research: the models are Cloudflare's **Clef** family (Clef, Clef-flash, Clef-omni), decision models released 1 Oct 2026 that return probabilities for typed questions. Clef-flash runs on the free plan at $0.038 per million input tokens, under one neuron per enquiry.
- Calibrated on the last 400 real enquiries: every one at 0.76 or above said they had or would supply the part; the next was 0.33. Cut-off 0.6.
- Website migration 010 (applied by the owner) added `ai_diy_score`, `ai_checked_at`, `ai_model`.
- New Worker `cloudflare/triage` (`mmqld-triage`, business account): every minute it scores unchecked inquiries from the last 48 hours and writes the score back. `POST /run` triggers a pass on demand.
- App: Likely DIY tag, dashboard bar, Inquiries filter, detail note, an "Own parts" decline template (Settings > Messages), the tag on the Email tab, and Ashley can see and filter them.
- First pass: all 11 enquiries from the last 48 hours scored, none flagged (highest 0.33, a self-replaced O2 sensor wanting diagnosis). One was a started-it-themselves job without parts (0.07), which the parts question does not cover.

## 11 October 2026: Ashley moved to the business Cloudflare account

Status: Built and tested; live once pushed.

- New `cloudflare/harness`: a dependency-free Node tool (`cf.mjs`) that drives a Cloudflare account through its API using an account token in a git-ignored `.env` (the repository is public). It verifies the token, registers the workers.dev subdomain, lists and deploys Workers (wrangler with the token, no login), sets secrets from stdin, makes a single Workers AI call, and passes any other API request through.
- New account: "Mymechanicqld@gmail.com's Account" (`da076ea95e20322c72f5c47f698bdeb5`). The token reaches Workers, Workers AI, KV, D1 and R2.
- Registered the subdomain `mmqld`, deployed `mmqld-ashley` (unchanged code), set `ASHLEY_APP_KEY` to the app's existing handshake.
- `config.js` now points Ashley at `https://mmqld-ashley.mmqld.workers.dev`.
- Checks: no key returns 401; one tool-calling request picked the right tool for about 2 neurons; a full question in the local app ("enquiries this week and most common job") ran two model steps through the new Worker and answered from real data.
- The old Worker on the personal account is still deployed so nothing breaks mid-switch.

## 4 October 2026: Signature no longer folded by Gmail, signature switch

Status: Deployed; the Gmail side needs one more real reply to confirm.

The live test of the Email tab passed: enquiry (Vishal Verma, QBC123), owner reply, customer answer and a further owner reply all sat in one thread in the app and in the customer's Gmail. It showed one problem: on the customer's side, Gmail folded the signature of the second reply into "...", because it repeated the first reply's ending.

- Every email the app sends now goes out as plain text plus simple HTML, ending in a short invisible reference unique to that email (`mail-mime.js`), so there is no repeated ending for Gmail to fold. Covers Email tab replies, the Reply sheet, invoice and report emails, and Ashley.
- The reply bar's "Signed as Ashley automatically" note is now a switch. Off sends the reply without the signature. Remembered, and mirrored in Settings > Business > Signing off.
- Settings > Payments footnote no longer mentions the removed payment reference.
- Checked locally: four messages built (Email tab with and without signature, Reply sheet, invoice with PDF) are well-formed, each with its own ending.

## 4 October 2026: Saving an invoice or report fills gaps in the customer's records

Status: Deployed.

The owner asked that when an invoice is saved, any basic detail missing from the customer's records is saved from the invoice. There is no customers table: a customer is assembled from their enquiry, invoices and bookings, so the gaps are filled in those records.

- Invoice and inspection Save (and Send, which saves first) fill empty email, address, rego, phone (reports) and car on the customer's own enquiry and bookings. Nothing already on file is overwritten.
- The customer lookup now also picks up the address from past invoices.
- Bookings pass their id to the invoice and report pages, so a document started from a booking links back to it.
- Found for testing: 8 phone bookings had no email (Troy, Jeremiah Sami, Kelly Kaur, Cameron Burness and others), Pat Lally Plumbing had no email or address, Damien Beechey no rego. Website enquiries were complete apart from spam.
- Checked by pressing the real Save button on the local copy with database writes captured: Troy's booking got only its email (his address was on file and kept), Pat Lally's booking got email and address, a report for Jeremiah Sami filled his email, and changing the name after picking wrote nothing. The real rows were confirmed unchanged afterwards.

## 4 October 2026: New website service categories

Status: Deployed.

The website's quote form now groups services into Standard servicing, Diagnosis, Pre-purchase inspections and Maintenance, with new choices (general servicing, fault diagnosis, brake pads, pads and rotors, alternator, starter motor). Website migration 009 added `service_category`; the owner ran it and the column is confirmed live, null on older rows.

Without a change the app would have shown new choices as raw text ("brake pads and rotors") with a generic icon and grey calendar colour. Now:

- every new choice has a label, icon and calendar colour; the older choices keep theirs for old inquiries and bookings
- the inquiry sheet shows the category under the service
- the booking job-type picker offers only the current services, grouped like the website (an older choice appears only on a booking that already uses it)
- Analytics has a "By category" chart; inquiries from before the regroup are counted as "Earlier form choices"
- the reply sheet starts on the matching template instead of always the service quote
- Search customers also matches the category; Ashley sees the category and the new slugs
- the category is read from `service_category`, or worked out from the service when that is empty

## 3 October 2026: Email tab

Status: Built and tested locally against recorded real Gmail data; live end-to-end test pending.

- **Email** replaces Search in the bottom navigation. Search moved to the sidebar as "Search customers"; it works as before.
- The Email tab lists the business Gmail's customer conversations (Customers / All inbox, Gmail search, unread count on the tab), opens a conversation as one thread in order (website enquiry card, owner replies, customer answers) and replies into the same thread. See FEATURES.md > Email.
- The inquiry sheet gained an **Emails** button that opens the customer's conversation.
- The Reply sheet, invoice sending and report sending now answer the newest message in the thread with the full References chain, instead of the first notification.
- Bounced emails are shown as "Email not delivered" and never become the reply address. Found on a real thread where an invoice went to a mistyped address.

### How it was checked

- The real inbox was read (metadata and bodies of recent enquiry threads) to confirm how threads form. Gmail already keeps notification, reply and customer answers together: a real 4-message enquiry thread was used as the reference.
- The page was run locally against recorded real Gmail responses with sending captured instead of sent: list of 25 threads, the 4-message thread, a 5-message invoice thread with two bounces and a PDF, the Connect Gmail state, back gesture, repaint while typing, and the inquiry sheet's Emails button.
- The outgoing MIME was inspected: `threadId`, `Re:` + the thread subject, `In-Reply-To` = newest message, `References` = full chain, UTF-8 body with signature.

## 20 September 2026: Owner feedback after first use

Status: Deployed.

The owner used the app and sent feedback. Every point below is his, except the date bug, which his report of "Canadian time" led to.

### Date bug: documents dated a day early

`today()` in both generators built the date from `toISOString()`, which is UTC. In Brisbane, UTC is still on the previous day until 10am, so any invoice or report started before 10am was dated **yesterday**. Both now build the date from the phone's own clock.

Bookings were never affected: they are stored as UTC instants and shown in the phone's timezone. Confirmed against the data (his 9:45am booking is stored as 23:45 UTC, correct) and by running the booking code under `TZ=Australia/Brisbane`.

### Invoices

- Standard Service checklist: the heading is now "Inspected the following visually only (wherever applicable)", with **Spark plugs** and **Air & pollen filter** added at the top (21 items). Updated in Supabase and in the price list seed.
- The due date follows the issue date and only stops once it is set by hand. Settings > Payment due now defaults to "On receipt"; a phone still holding the old 7-day default is migrated.
- Notes moved up beside the totals into a red-edged "Please note" card. Notes over 320 characters still take the full width below.
- "How to pay" moved to the foot of the invoice, across one row, and the reference line (the invoice number) was removed.

### Inspection reports

- The sign-off section is gone from the PDF and the form, along with its settings (statement, inspector name) and the progress credit for signing.
- The score slider no longer sets the Good/Fair/Poor rating; they are independent.
- The email wording lost "Happy to talk through anything in it." A phone holding the old default is migrated.

### Verification

A new invoice's due date followed the issue date, then stayed put once set by hand. Standard Service printed the new heading and the two new items at the top. Notes printed beside the totals; How to pay printed at the foot with no reference. A report PDF built with no sign-off. Setting the score to 90 left the rating on Fair. The report email read "Please find your vehicle inspection report attached." with the signature.

## 19 September 2026 (later): Settings rebuilt, everything editable

Status: Deployed.

The owner confirmed the calendar drag works on his iPhone.

Problem: Settings showed business details, GST and payment terms that the invoice and inspection PDFs ignored, the bank details and all message wording were hard-coded, and "Clear invoice drafts" cleared the wrong storage key.

Changes:

- `settings/index.html` rebuilt in the style of iOS Settings (see FEATURES.md, Settings): pages for Business profile, Payments, Invoices, Inspection reports, Messages, Calendar, Ashley, Gmail, Passcode, Storage and About, with search, instant saving, pickers and a template editor with placeholders and live preview.
- `settings.js` gained about 25 keys and three helpers (`text`, `signature`, `business`). Every default equals the previous hard-coded value.
- Now wired to Settings: invoice and report PDF business details and bank details (`businessProfile()` in both generators), invoice GST default, due date from payment terms, default notes, footer sign-off, the report sign-off statement, terms and default inspector, the email subject and message on all three Send paths, Ashley's signature, the two email reply templates and three text templates in `config.js`, and the calendar's hours, snap and opening view.
- Storage now counts and clears the real invoice drafts (`mmqld_invoice_drafts_v2`) and inspection drafts (IndexedDB), refreshes the price-list cache and clears Ashley's conversation.

Verification: in the browser, changing the BSB updated the Payments preview and printed on a new invoice PDF; turning the bank toggle off removed the panel; a new invoice's due date followed the 7-day terms; a test inspector name and statement reached a new report and its PDF; a 7am day start moved the calendar's first hour; the service reply and diagnostic text rebuilt from Settings matched the old wording exactly; a mistyped placeholder showed red in the preview; search for "bsb" and "due" found the right rows. All test values were put back.

## 19 September 2026: Calendar timeline, report and invoice redesign, leave warning, Ashley on Cloudflare

Status: Deployed. Owner app commits `175f47c` and `9fe4857` on `mymechanicqld/Owner-App`; database migration committed as `afa89d9` on both website remotes; Ashley Worker `mmqld-ashley` version `b9246b90`.

### 1. Calendar

Problem: Day view was a plain list grouped by date. There was no way to see a day's shape, move a job by touch, or jump to a date, and bookings had nowhere to keep a customer's email, so invoices for phone bookings could not be emailed.

Changes (`app.js`, `styles.css`, `customers.js`, `index.html`):

- Day view is a Google Calendar style timeline with hour labels, bookings drawn to scale, overlapping bookings side by side, a current-time line and a pinned header with date, arrows, Today and a week strip.
- Hold a booking to lift it and drag to a new time; drag its bottom edge to change its length. 15-minute snapping, edge auto-scroll, save on release, Undo, overlap notice, restore on failure.
- Tap an empty slot to book at that half hour. Tap the date title for the phone's date picker. Week view stays a list and its day headings open the timeline.
- The booking sheet gained an Email field and past-customer autocomplete (inquiries, invoices and bookings, by name or rego) that fills email, phone, rego, suburb and address.
- The email travels to invoices and inspections started from a booking, and the Records Send button falls back to a booking's email.
- Ashley's `save_booking` stores the email and booking lookups return it.

Database: `supabase/migrations/20260919_008_calendar_customer_email.sql` in the website repository adds `calendar_events.customer_email` and backfills it. The owner ran it on 19 September; 40 of 46 bookings then had an email. `supabase-schema.sql` includes the column.

Verification: a test booking on an empty future day was dragged 1 pm to 4 pm and resized to 6 pm with the mouse, moved by a simulated hold-and-drag, undone, and checked in Supabase after each step. A quick simulated swipe left the booking alone. Tapping 9:40 opened a new booking at 9:30. Autocomplete filled Nolan Murray's email from his invoice. Both test rows were deleted (46 bookings before and after).

### 2. Inspection reports

Problem: the latest report (Elena Sirena, Mazda MX5) ran to 26 pages. The cover's title was hidden under a tinted block, a tint covered page 2's header, and a comments box sat alone on page 3. Photo pages held one or two photos with large gaps, and upright photos stood twice as tall as landscape ones.

Cause of the broken cover: pdfmake paints a filled table cell's background onto the wrong page when that cell splits across pages.

Changes:

- New layout module `inspection/report-pdf.js`, pure and renderable in Node. The old builder in `inspection/app.js` was removed.
- Cover: title with a "REGO" plate (grey N/A when not recorded), report reference line, Prepared for and Vehicle cards, the cover photo at a fixed height, uncropped and centred, and an at-a-glance table of each section's counts and Poor items.
- Sections flow continuously; a section's title repeats if it runs over a page and its notes travel with it.
- Photos in justified rows sharing one height; no forced page breaks.
- Conclusion always on a new page: half-moon gauge of the 0 to 100 score, verdict, Poor items by section, sign-off. Terms on the final page.
- Gold accent added to the navy design; subtle green, amber and red grade chips; footer shows the rego.
- Form: cover photo card first (camera, gallery, retake, remove), score slider that sets the rating, "Repair" renamed "Poor" everywhere with automatic conversion of old reports.
- Fixed: the Overall rating buttons never showed which one was selected.
- Photos without stored dimensions are measured before building the PDF; deleting a report also removes its cover photo.

Results: the Mazda MX5 report with 47 photos went from 26 pages to 11, and Daniel Archer's Hilux with 61 photos from 33 to 12. Section-number circles were measured at 300 dpi and centred to within a quarter of a point. Real reports were only rendered locally; no saved report or PDF was changed.

### 3. Invoices

Changes:

- One **Add items** button replaces Add item and Saved items. Tap to add, tap again for more, prefix-first search ranking, and **Add a new item** that also saves to the price list.
- Line **details**: a product's description prints under its line; plain lines as bullets, a line ending in ":" as a ticked checklist in columns. Editable per invoice.
- Price list: General Service became **Standard Service**, $369, with the owner's service record and 19-point checklist; Standard/Regular Service was deleted. 44 products remain.
- Partial payment removed from the invoice form and from Ashley.
- Bank details (My Mechanic Qld, BSB 484-799, account 506731007, invoice number as reference) print on every invoice.
- New layout module `invoice/invoice-pdf.js`: shorter navy header with a gold rule, tinted table heading, How to pay beside the totals, navy Total bar, paid or amount-due line, notes at full width, sign-off in the last page's footer.
- Fixed: the navy footer strip had never drawn. Separate background canvases stack in pdfmake and pushed it off the page; it now uses `absolutePosition`.
- Removed made-up bank details from the Notes placeholder and a dash from the sign-off.

Verification: a test item created through the picker was confirmed in Supabase and in search, then deleted. Simon Gonzalez Bravo's invoice was rendered paid and owing with a Standard Service line, and a dummy invoice (Standard Service plus Front Brake Pads and Labour, $748) was rendered; all fit on one page. Nothing was saved to real invoices.

### 4. Leave warning

`leave-guard.js`, shared by both generators. With unsaved work, the logo, the phone's back gesture and closing the tab ask first: Keep editing, Save draft and leave, Discard and leave. Verified: logo and back both showed the window on a changed invoice; Save draft and leave stored the draft and returned to the main app; Discard and leave on an inspection returned without saving; an untouched form left without asking.

### 5. Ashley moved to Cloudflare Workers AI

Changes:

- New Worker `cloudflare/ashley`, deployed as `mmqld-ashley.todo-r2-d1.workers.dev`. It runs GLM 4.7 Flash through the Workers AI binding, so no model key exists. It keeps the old proxy's origin filter, handshake, size, count and rate limits, fixes the model and output ceiling, switches thinking off and retries once.
- `api/ashley.js` and its OpenRouter call were deleted; `vercel.json` has no functions; `config.js` points at the Worker.
- Fixed: a declined confirmation reached the model as `[object Object]`. It is now plain text, and a declined action with nothing confirmed produces a fixed "Nothing was sent or changed" reply in code.
- Prompt rules for GLM against guessing ids across parallel calls and adding details the owner did not give.

Verification (frugal, about 160 neurons in total): 401 without the handshake, 403 from an unknown origin, correct CORS for the production origin; "How's my week looking?" answered correctly in 3.7 s for about 39 neurons; a declined text message now reports that nothing was sent.

Follow-ups for the owner: remove `OPENROUTER_API_KEY` from the mmqld-app Vercel project, revoke that OpenRouter key, and keep the Cloudflare API token shared in chat private or delete it.

### Housekeeping

- `.gitignore` now excludes `output/`, which held a customer's PDF. `.vercelignore` keeps `cloudflare/` and `docs/` off the public site.
- Documentation under `docs/` and the README were brought up to date and stale statements removed.

## 17 September 2026: Inspection image and report performance overhaul

Status: Resolved, migrated and deployed

### Problem

Inspection photos were stored as base64 strings inside `inspection_reports.state`. The reports list selected every column, so opening the list downloaded every embedded photo even though the screen only needed names, regos and report numbers. Report edits also created a new PDF without removing the previous file.

Live audit before the fix:

- 10 inspection report rows.
- 268 embedded JPEG photos across five reports.
- 56.31 MB transferred when the ten full rows were fetched individually in 22.5 seconds.
- A normal full-table request could exceed the Supabase statement timeout.
- 39 PDFs occupied 146,684,296 bytes in the `inspections` bucket.
- 29 of those PDFs were no longer referenced by any report and occupied 93,413,644 bytes.

### Application changes

- The reports list now selects summary fields only.
- New photos are prepared as a 1024 px JPEG master at quality 0.60 and a 320 px thumbnail at quality 0.55.
- Master images and thumbnails are stored in the existing `inspections` bucket under an `images/<report-folder>/` prefix.
- The database state stores image paths, dimensions, byte size, MIME type and captions, not base64 image bodies.
- Existing and legacy image formats remain readable while reports are being migrated.
- The report editor renders 24 lazy-loaded thumbnails at a time with Previous and Next controls.
- PDF generation downloads report-quality masters only when the owner opens, saves or sends that report.
- Inspection drafts now use IndexedDB instead of synchronous localStorage, avoiding the small localStorage quota and main-thread blocking.
- Saving an edited report removes the superseded PDF after the replacement is verified.
- Removing an image deletes its master and thumbnail after the report saves.
- Deleting a report now removes its PDF, master images and thumbnails in small batches.
- Storage requests continue to use the Supabase `apikey` header without an invalid Bearer token.

### Existing-data migration

The five image-heavy reports were migrated in place with a resumable migration script at `scripts/migrate-inspection-images.py`.

- 268 masters and 268 thumbnails were uploaded and read back for SHA-256 verification.
- Original decoded photos totalled 44,210,376 bytes.
- New masters total 16,556,837 bytes.
- New thumbnails total 2,240,156 bytes.
- Combined image storage is 18,796,993 bytes, a 57.5 percent reduction.
- All five affected PDFs were regenerated through the deployed Save flow.
- All 29 unreferenced PDFs were removed only after backup and hash verification.

The rollback backup is stored outside the repository at `~/Documents/MyMechanicQLD Backups/inspection-images-20260917-155339`. It contains the ten original full database rows, all 39 original PDFs, hashes and migration manifests. The removed PDFs are recoverable from that backup.

### Verification after migration

- Full ten-row payload: 206,086 bytes, down from 56.31 MB.
- Full ten-row request: 0.56 seconds.
- Reports-list payload: 4,051 bytes.
- Live Reports screen: ten rows displayed in 0.39 seconds with no browser errors.
- Database image references: 268.
- Remaining embedded base64 images: 0.
- Stored image objects: 536, exactly matching 268 masters plus 268 thumbnails.
- Missing or unreferenced image objects: 0.
- Stored PDFs: 10, one per report.
- Missing or unreferenced PDFs: 0.
- Current PDFs occupy 27,483,683 bytes.
- Total inspection bucket data now occupies 46,280,676 bytes, down 68.4 percent from the previous PDF-only footprint.
- The 69-image report PDF is 5,432,196 bytes, down from 8.78 MB.
- The 53-image report PDF is 5,265,723 bytes, down from about 11 MB.
- A regenerated 36-page A4 report was rendered to images and visually inspected. Photos remained clear at report size and the largest embedded source dimension was 1024 px.
- A 47-image report rendered only 24 storage-backed thumbnails in the editor DOM.

### Release

- Main implementation: `6584496`
- Asset lifecycle safeguards and migration tooling: `81acb92`
- Repository: `mymechanicqld/Owner-App`
- Branch: `main`
- Deployment: `https://mmqld-app.vercel.app/`

## 17 September 2026: Invoice notes PDF overflow

Status: Resolved and deployed

### Problem

Invoices containing long notes could break across two PDF pages incorrectly. The notes were rendered inside the left side of a two-column notes and totals section. When pdfmake split that container, the continued notes could cover the second page header and make the document look broken.

The issue was confirmed using the saved Nolan Murray invoice, `INV_20260916_0151`.

### Fix

- Kept the totals block together as an unbreakable section.
- Moved notes into a separate full-width section below the totals.
- Split entered notes into small text blocks.
- Limited each generated block to approximately 240 characters.
- Made each block unbreakable so page breaks occur only between safe blocks.
- Preserved paragraph spacing from the notes field.

Changed file: `invoice/app.js`

### Verification

- Regenerated the Nolan Murray invoice from its saved Supabase state.
- Rendered both PDF pages to images and inspected them visually.
- Confirmed a two-page A4 PDF.
- Confirmed the page-two business header and contact details remain visible.
- Confirmed notes start below the page header and do not overlap it.
- Confirmed the payment status, payment table, sign-off and footer remain clear.
- Confirmed JavaScript syntax and repository diff checks pass.

### Supabase update

The existing Nolan Murray PDF was replaced at its original Supabase Storage path. The invoice database row and its metadata were not changed.

- Record ID: `6c0d34da-af70-42a7-80ce-f4f66df0ab7b`
- Invoice number: `INV_20260916_0151`
- Storage path: `2026-09-16_210CZ3_INV202609160151_155600.pdf`
- Verified live PDF size: `191142` bytes
- Verified SHA-256: `a747b6c452e0ca955eebddc4547e58a1ef4d8a03b127ddcd52d080ec6d49e343`

The original PDF was preserved in the Mac Trash as `MMQLD-INV_20260916_0151-original-before-notes-fix-20260917.pdf` and remains recoverable until Trash is emptied.

### Release

- Git commit: `12e1fb6bc6213c376264a8c24a4a5292eef3b8bc`
- Repository: `mymechanicqld/Owner-App`
- Branch: `main`
- Deployment: Verified live on `https://mmqld-app.vercel.app/`

Future invoices generated after the deployment use the corrected notes layout. Previously generated PDFs remain unchanged unless they are regenerated or replaced manually.
