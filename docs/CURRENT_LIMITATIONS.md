# Current limitations

This file records verified gaps in the current owner-app code as of 19 September 2026. It is intended to prevent future work from trusting stale comments or UI descriptions.

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

It covers calendar events (including the `customer_email` column), invoice records, inspection records and two storage buckets. It does not create:

- `quote_submissions`
- `products`
- `app_settings`

Fresh environment setup needs the later migrations in addition to this file.

### `sw.js` is legacy

The repository still contains a no-cache service worker, but no current page registers it. Page boot code actively removes previously registered workers. Documentation or future code must not describe the app as offline-capable.

## Settings

### Syncing needs one table

Settings are saved on the phone. They follow the owner to other devices only after `app_settings` is created in Supabase (migration 007). Until then each device keeps its own settings, and the Settings page says "This phone only".

### Numbers are per phone

Next invoice and report numbers are stored on each phone. Two phones can issue the same visible number on the same day.

### Changes apply to new documents

Business details, bank details, terms and wording apply to invoices and reports built after the change. Saved PDFs are unchanged until the document is opened and saved again. An inspection report keeps the terms it was created with.

## Document lifecycle

### Database record and PDF can diverge

Record-first saving protects the editable document, but a failed PDF upload leaves no current PDF for View, record-list Send or Ashley attachment Send.

When editing an existing record, a failed new upload leaves the older `pdf_path` intact. The form state can therefore be newer than the PDF until the next successful save.

### Main-screen document deletion may leave an object

The main Records delete path removes the database row first, then makes best-effort Storage deletes for the PDF and, for reports, every photo, thumbnail and the cover photo. A failed object deletion is swallowed, so an orphaned public file can remain.

### Calendar

### Drag works within one day

A booking can be dragged to a new time or length on the day being viewed. Moving it to another day still means opening it and changing the date.

### Overlaps are allowed

Dropping a booking onto another is allowed on purpose (two jobs at one address). The confirmation message mentions the overlap; nothing prevents it.

## Leaving a form

### Browser limits on the warning

Closing or reloading the tab only shows the browser's own "leave site?" prompt; browsers forbid a custom window there, and iOS often shows nothing at all. The in-app logo and the back gesture show the full three-button window.

The back-gesture handling keeps one extra browser history entry. It was verified in a desktop browser; behaviour in the installed iPhone app should be confirmed on the phone.

## Ashley

### GLM 4.7 Flash is a small model

It is fast and cheap, but in testing it described a declined action as done, and it added details such as "today" to a drafted message. Declines are now enforced in code; drafted messages rely on the owner reading the confirmation card. Bulk judgement across long lists (for example deciding which of many records to change) is its weakest area, so such work should be written as a tool in code rather than left to the model.

### Daily allowance

Workers AI gives 10,000 free neurons a day, about 150 to 250 Ashley questions. When that is used up, Ashley stops answering until 10am Brisbane time. The app does not count usage itself; the Cloudflare dashboard shows it.

### The Worker lives on a personal Cloudflare account

`mmqld-ashley` is deployed on the Cloudflare account signed in as gursahib99888@gmail.com, on that account's `todo-r2-d1.workers.dev` subdomain. Deploying or changing it needs that login. Moving it to a business-owned account would change the endpoint URL in `config.js`.

### Privacy minimisation is not anonymisation

The system instructions omit the business and app identity, but relevant customer details and tool results still go to Cloudflare Workers AI when a question needs them.

### Rate limiting is per isolate

The per-IP map lives in one Worker isolate. It limits accidental bursts but is not a durable global quota. The handshake key is public in the app code, so anyone who reads it can call the Worker and spend the daily allowance; rotating the key is the remedy.

### Mixed confirmation batches need care

Independent tool calls run in parallel. If a model turn includes a confirmed action and unrelated reads, the reads can finish while the owner decides. Tool design should avoid bundling several confirmed actions into one turn.

## External dependency and offline limits

The owner app depends on network access for Supabase, Gmail, Ashley and several CDN scripts. There is no offline shell or queued write system.

Invoice and inspection PDF creation also depends on the pdfmake CDN being available on first load.
