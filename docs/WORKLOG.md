# Owner App Work Log

This file records completed owner-app changes, production updates and important verification details. Add new entries at the top.

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
