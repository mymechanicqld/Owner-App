# Current limitations

This file records verified gaps in the current owner-app code as of 17 September 2026. It is intended to prevent future work from trusting stale comments or UI descriptions.

## Security and access

### No real owner authentication

The app does not sign the owner into Supabase. Operational data is available through the publishable key and broad anonymous RLS policies.

The Settings passcode is a browser prompt implemented after page scripts load. It discourages casual access on that device but does not protect Supabase or the network APIs.

### Public PDFs

Invoice and inspection buckets are public. Anyone with an object URL can retrieve that PDF.

### Browser token storage

The Gmail access token is kept in local storage. It expires quickly, but any script running on the same origin can read it while valid.

## Setup drift

### `supabase-schema.sql` is not a complete fresh setup

It covers calendar events, invoice records, inspection records and two storage buckets. It does not create:

- `quote_submissions`
- `products`
- `app_settings`

Fresh environment setup needs the later migrations in addition to this file.

### `sw.js` is legacy

The repository still contains a no-cache service worker, but no current page registers it. Page boot code actively removes previously registered workers. Documentation or future code must not describe the app as offline-capable.

## Settings wiring

### Generator PDF business details are hard-coded

`settings.js` updates `CONFIG.BUSINESS_NAME`, phone, email, ABN and website. Ashley and several message paths consume those values.

The invoice and inspection PDF generators still render their own hard-coded `BUSINESS` objects. Changing business details in Settings does not currently change the business header printed on those PDFs.

### Invoice defaults are displayed but not consumed

Settings exposes:

- `invoice_gst_inclusive`
- `invoice_terms_days`

`invoice/blankState()` currently starts with GST-inclusive pricing and a due date of today regardless of those values.

### Generator email signatures are hard-coded

The invoice and inspection generator Send actions contain fixed business name and phone text. They do not use all business details from Settings. Ashley's send tool does use the configurable values.

### Clear invoice drafts uses an old key

The current invoice generator stores drafts in `mmqld_invoice_drafts_v2`. The Settings page checks and removes `mmqld_invoice_drafts`, so its draft count and Clear invoice drafts action do not affect current drafts.

## Document lifecycle

### Database record and PDF can diverge

Record-first saving protects the editable document, but a failed PDF upload leaves no current PDF for View, record-list Send or Ashley attachment Send.

When editing an existing record, a failed new upload leaves the older `pdf_path` intact. The form state can therefore be newer than the PDF until the next successful save.

### Main-screen document deletion may leave an object

The main Records delete path removes the database row first, then makes a best-effort Storage delete. The Storage request includes the publishable key as both `apikey` and a Bearer token, while the storage helper correctly treats the current publishable key as non-JWT. A failed object deletion is swallowed, so an orphaned public PDF can remain.

### Ashley deletion removes the row only

`delete_record` deletes invoice or inspection rows but does not delete their PDF objects.

### Local document counters can collide

Invoice and report counters are stored per browser. Two phones or a cleared browser profile can generate the same visible number on the same date.

## Gmail

### Token refresh is interactive browser OAuth

There is no server-side refresh token. When the cached access token expires, the app asks Google for another browser access token. Existing consent should avoid the full consent screen, but popup rules still apply.

### Main and generator Gmail implementations are duplicated

The main shell has its own Gmail helpers and the generator pages use `gmail-send.js`. Behaviour is intentionally aligned but changes must currently be made in both places.

## Price list

### Deletion is optimistic

The price list removes a row from the page immediately after confirmation and starts the database delete without waiting for success. If deletion fails, the item reappears after reload.

### Product details are copied, not linked

A product's description is copied into the invoice line's printed details when it is added. Editing the price list later does not change invoices already made, which is intended, but it also means an old draft keeps the old wording.

## Ashley

### Privacy minimisation is not anonymisation

The model request omits project identity and attribution headers, but relevant customer details and tool results still go to the selected model provider.

### Rate limiting is instance-local

The per-IP map lives in one serverless instance. It limits accidental bursts but is not a durable cross-instance quota.

### Mixed confirmation batches need care

Independent tool calls run in parallel. If a model turn includes a confirmed action and unrelated reads, the reads can finish while the owner decides. Tool design should avoid bundling several confirmed actions into one turn.

## External dependency and offline limits

The owner app depends on network access for Supabase, Gmail, Ashley and several CDN scripts. There is no offline shell or queued write system.

Invoice and inspection PDF creation also depends on the pdfmake CDN being available on first load.
