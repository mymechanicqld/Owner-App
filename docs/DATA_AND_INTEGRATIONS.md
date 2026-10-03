# Data and integrations

## Supabase

The owner app connects directly to one Supabase project with the browser publishable key. The project URL and key are decoded from `config.js` at runtime.

Do not add a Supabase secret or service-role key to this repository.

### Tables

| Table | Purpose | Read paths | Write paths |
| --- | --- | --- | --- |
| `quote_submissions` | Website inquiries and customer source data | Dashboard, Inquiries, Search, autocomplete, Ashley | status and notes updates, email reply status advancement |
| `calendar_events` | Owner booking calendar | Calendar, customer autocomplete, document email lookup, Ashley | create, update, drag to a new time or length, delete |
| `invoices` | Searchable invoice log plus full generator state | Records, autocomplete, invoice edit, Ashley | create, edit, payment update and delete |
| `inspection_reports` | Searchable inspection log plus full generator state | Records, inspection edit, Ashley | create, edit and delete |
| `products` | Invoice products, parts and jobs | Price list, invoice Add items picker, Settings count | price list upsert and delete, new items created from an invoice |
| `app_settings` | One shared settings JSON document | shared settings and Settings status | row `id = 1` upsert |

### Services and categories

Since 3 October 2026 the website's quote form groups services into four categories. `SERVICES` and `SERVICE_CATEGORIES` in `config.js` mirror `lib/quote-services.ts` in the website repo:

| Category | Services (slug) |
| --- | --- |
| Standard servicing | `logbook-servicing`, `general-servicing` |
| Diagnosis | `diagnosis` |
| Pre-purchase inspections | `pre-purchase-inspection` |
| Maintenance | `brake-pads`, `brake-pads-and-rotors`, `alternator-replacement`, `starter-motor-replacement`, `radiator-water-pump` |

The earlier slugs (`brake-repair`, `alternator-starter`, `battery-replacement`, `warning-light-diagnostics`, `steering-suspension`, `emergency-breakdown`, `not-sure`, and the older `alternator-starter-motor`, `general-enquiry`) stay in `SERVICES` with `legacy: true`. They still label old inquiries and bookings but are not offered for new bookings, and they have no category. A new website slug must be added to `SERVICES` (and a colour to `JOB_COLORS` in `app.js`), or it shows as plain text with a grey colour.

### Inquiry fields consumed by the owner app

The app currently relies on:

- `id`
- `created_at`
- `full_name`
- `email`
- `phone`
- `suburb`
- `address`
- `vehicle_rego`
- `vehicle_make`
- `vehicle_model`
- `vehicle_year`
- `service_needed`
- `service_category` (added by website migration 009 on 3 Oct 2026; null on older rows, so the app works it out from `service_needed` when it is empty)
- `symptoms`
- `preferred_date`
- `status`
- `notes`, for Ashley updates

### Calendar fields

- `id`, `created_at`, `updated_at`
- `title`
- `starts_at`, `ends_at`, `all_day`
- `customer_name`, `customer_phone`
- `customer_email`, added 19 September 2026 by migration 008. The migration backfilled existing bookings from the linked inquiry, then the newest inquiry with the same rego, then the newest invoice with the same rego; 40 of the 46 bookings then held an email
- `vehicle_rego`
- `suburb`, `address`
- `service`, `notes`, `status`
- `submission_id`

### Invoice fields

The list and Ashley use searchable columns such as invoice number, customer, business, email, rego, vehicle, odometer, dates, status, totals, items, signer, notes and PDF path.

The `state` JSON column is the lossless editing source. It stores the full generator form including receipt rows and signature data. Each item in `state.items` (and the searchable `items` column) is `{ id, desc, qty, price }` plus an optional `details` string, the text printed under that line.

`status` is `paid` or `outstanding`. Older rows may hold `partial`; the generator opens those as outstanding.

`submission_id` links a generated invoice back to the source inquiry when the invoice was opened from that inquiry.

### Inspection fields

The report log stores report number, customer details, vehicle, odometer, rating, date, structured sections, comments, PDF path and source inquiry ID.

The `state` JSON column stores the complete editable report including images, signature and terms. Fields added on 19 September 2026:

- `coverImage`: `{ id, path, thumbPath, width, height, bytes, mime }` for the cover photo, stored in the `inspections` bucket like the other photos
- `score`: 0 to 100 in steps of 10, or `null` when not scored
- grades are `Good`, `Fair`, `Poor` or `NA`. Rows saved before then may hold `Repair`, which the form and PDF read as `Poor`; the `overall_rating` column likewise holds `Repair` on older rows and `Poor` on new ones

### Product fields used by the page

- `id`
- `code`, unique upsert key
- `name`
- `description`
- `price`
- `active`
- `sort_order`

The invoice picker requests active products (`id, code, name, description, price`). Adding a product copies its name and price to the line and its description to the line's printed `details`.

New items created from the invoice get a `code` made from the name (a time suffix is added if that code exists) and are upserted with `on_conflict=code`.

Price list changes made on 19 September 2026:

- `general-service` became `standard-service`: name **Standard Service**, price $369, description holding the service record and 19-point checklist
- `standard-regular-service` ("Standard/Regular Service", $369) was deleted
- the table now holds 44 products, 22 priced

### Settings row

`app_settings` is treated as a singleton table:

```json
{
  "id": 1,
  "data": {
    "business_name": "...",
    "calendar_default_minutes": "60"
  }
}
```

Local settings remain usable when this table is missing. The Settings page labels that state as saved on this phone only.

The settings document holds about 40 keys: business profile (`business_*`, `sender_name`, `website_form_url`), bank details (`bank_name`, `bank_bsb`, `bank_account`, `invoice_show_bank`), invoice defaults (`invoice_gst_inclusive`, `invoice_terms_days`, `invoice_default_notes`, `invoice_signoff`), report defaults (`report_inspector`, `report_statement`, `report_disclaimer`, `report_not_checked`), email and message templates (`email_*`, `tpl_reply_*`, `tpl_sms_*`), quote prices (`price_*`), calendar (`calendar_*`), Ashley and the passcode. `settings.js` holds the defaults and the helpers every page uses: `text(key, vars)` fills a template, `signature()` builds the shared email signature, and `business()` returns the details the PDF layouts print.

## Storage buckets

Two public buckets are used:

- `invoices`
- `inspections`

Files use a readable unique pattern based on save date, rego and current time. Invoice names also include the invoice number where possible.

Document saving is record-first. A failed PDF upload produces a complete database row with `pdf_path = null` for a new record. This row still appears in Records and can be reopened and saved again.

Public buckets allow direct PDF opening without signed URLs. They also mean anyone with an object URL can read the document.

## Row Level Security

The original `supabase-schema.sql` enables broad anonymous policies for calendar events, invoices, inspection reports and the document buckets. Products and settings were added after that file and are not represented in it.

The browser architecture currently depends on anonymous read and write access because there is no Supabase user session.

This is the largest security boundary in the app. A production hardening project should add real owner authentication first, then restrict every table and bucket policy to that authenticated owner.

## Gmail

### Authentication

Google Identity Services uses OAuth's browser token client with these scopes:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`

The OAuth client is a Web application and must list the exact owner-app origin. The canonical production origin is `https://mmqld-app.vercel.app`.

The returned access token is cached under `mmqld_gtok` until 60 seconds before expiry. The token cache is shared across the main app, invoice generator, inspection generator and Settings because all pages use the same origin.

The token itself does not last permanently. The Google grant normally allows a new access token without showing the consent screen again.

### Thread search

Before replying or attaching a document, the app searches Gmail by quoted email address. If nothing matches and a rego is available, it searches by quoted rego.

It reads up to ten matching messages and prefers a subject that looks like a booking or quote request. It then sends with:

- the Gmail `threadId`
- `In-Reply-To`
- `References`

The `In-Reply-To` is the newest message in that thread (bounces skipped) and `References` is its full chain, so the customer's mail app keeps every email in one conversation too. The subject stays the thread's own subject with `Re:`, because Gmail only files a sent message into a thread when the subject matches.

This keeps the communication in the existing Gmail conversation when possible.

### How an enquiry thread forms

Checked against the real inbox on 3 October 2026:

1. The website's Resend notification arrives from `"<Customer> via My Mechanic QLD" <onboarding@resend.dev>` (or the configured sender) to `mymechanicqld@gmail.com`, subject `New booking — <Name> (<REGO>) · <Service> · <Suburb>`, with `Reply-To: <customer>`. Gmail's own filter labels it "Form Inquiries".
2. The owner's reply (from the app or from Gmail's Reply) goes to the customer as `Re: New booking — ...` in the same thread.
3. The customer's answer carries `In-Reply-To`/`References`, so Gmail files it in the same thread (and its filter labels it "Customer Replies").

The Email tab relies on this: one thread per enquiry, and the notification's Reply-To identifies the customer.

### Email tab queries

- Customers: `{subject:"New booking" subject:"Invoice from" subject:"inspection report" subject:"Your enquiry with" from:<recent enquirer> ...}`, with up to 40 distinct inquiry emails from the last 45 days.
- All inbox: `in:inbox category:primary`.
- A search adds the typed words as a quoted phrase.

Opening a conversation removes Gmail's `UNREAD` label from it (`threads.modify`, allowed by `gmail.modify`).

### Message formats

Inquiry replies are plain-text MIME messages. Invoice and inspection sends are multipart messages with a PDF attachment.

Non-ASCII subject text is encoded with an RFC 2047 encoded word before Gmail submission.

### Ashley inbox access

Ashley can search message metadata and read a selected full message. Inbox read tools only run when a still-valid cached token exists. If not, Ashley offers a Connect Gmail button so the owner can create the required popup with a direct tap.

## Ashley and Cloudflare Workers AI

The browser calls the `mmqld-ashley` Cloudflare Worker. The Worker:

- validates origin
- validates the `X-Ashley-Key` handshake
- applies a coarse per-instance IP rate limit
- enforces request-size, message-count, tool-count and output limits
- fixes the model server-side (GLM 4.7 Flash, thinking off)
- retries once on a transient Workers AI error
- forwards only model output or a sanitised error, and never logs the conversation

There is no model key: the Worker uses Cloudflare's AI binding.

The system instructions deliberately omit the business name, app name, URL and database identity. Customer or business-operation data still reaches the model when it is needed to answer a request. The signature and business identity are attached in browser code after the model writes the message body.

## Browser local storage

| Key | Purpose | Typical lifetime |
| --- | --- | --- |
| `mmqld_settings` | local settings copy | until reset or site data is cleared |
| `mmqld_gtok` | Gmail access token and expiry | about one hour |
| `mmqld_mail_v1` | Email tab: last customer list (60 summaries, no message bodies), the business address, last refresh time and unsent replies | until replaced or site data is cleared |
| `mmqld_ashley_log` | visible Ashley chat and compact history | until cleared |
| `mmqld_ashley_endpoint` | optional endpoint override | until removed |
| `mmqld_products_cache` | invoice picker product cache | until replaced or site data is cleared |
| `mmqld_prices_draft` | unsaved price-list edits | until successful save |
| `mmqld_invoice_counter` | next local invoice sequence | persistent per browser |
| `mmqld_invoice_drafts_v2` | up to 30 invoice drafts | until deleted or site data is cleared |
| `mmqld_report_counter` | next local report sequence | persistent per browser |
| IndexedDB `mmqld-owner`, store `inspection-drafts` | up to five inspection drafts, photos included | until deleted or site data is cleared |
| `mmqld_inspection_drafts_v2` | legacy local-storage drafts, moved into IndexedDB on first open | removed after migration |
| `mmqld_sw_removed` | one-session reload guard after worker removal | current browser session |

Because counters are local, two devices can generate the same sequence number on the same date. The database row ID and unique PDF timestamp still differ, but the human invoice or report number can collide.

## Data sent outside Supabase

### To Google

- Gmail queries
- message metadata and full message reads requested by Ashley or opened on the Email tab
- marking an opened conversation as read
- outgoing email recipients, bodies and PDF attachments

### To Cloudflare Workers AI

Cloudflare runs the model in Workers AI under the Cloudflare account signed in as gursahib99888@gmail.com; there is no third-party model router in between.

- current Ashley system instructions
- the owner's question and recent conversation text
- tool schemas
- compact tool results required for the question, which can contain customer and business data

### Not sent to the model endpoint

- Supabase key
- Gmail OAuth token
- raw invoice or inspection PDF file unless represented in a tool result, which current tools do not do
- business signature details, because browser code appends them after message generation
