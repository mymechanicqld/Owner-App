# Feature inventory

This document describes every current owner-facing area of the PWA.

## Main shell

The main shell is `index.html`, `styles.css` and `app.js`. It owns the bottom navigation, grouped sidebar, shared customer and booking sheet, global toasts and the primary Supabase client.

The shell refreshes inquiries and calendar events every 60 seconds. Manual refresh is also available in the header.

## Dashboard

The dashboard gives a compact operating snapshot:

- inquiries still marked New
- inquiries received in the last 48 hours
- inquiries received in the last seven days
- the most common job type in the last seven days
- the five most recent inquiries

Tapping a recent inquiry opens the same detail sheet used by Inquiries and Search.

## Inquiries

The Inquiries screen reads up to 3,000 rows from `quote_submissions`, newest first.

Available time filters:

- Last 48h
- This week, implemented as the last seven days
- This month, implemented as the last 30 days
- This year, implemented as the last 365 days

Archived inquiries are hidden from this screen. Each row shows the customer, status colour, service, relative age, suburb, vehicle and rego where available.

The detail sheet can:

- show phone, email, suburb, address, vehicle, service, requested date, notes and submission time
- change status between New, Contacted, Quoted, Booked, Won, Lost and Archived
- reply by email
- call the customer
- prepare an SMS
- open a prefilled invoice
- open a prefilled inspection report
- create a prefilled calendar booking

### Inquiry email reply

The reply composer offers Logbook service, Diagnostic and Custom templates. The owner can change the price and edit the full message before sending.

The app searches Gmail by email, then rego, and replies in a matching booking or quote thread where possible. A priced template advances the inquiry to Quoted. A custom reply advances it to Contacted.

### Inquiry SMS

The Message action offers Website link, Service, Diagnostic and Custom templates. It opens the phone's messaging app with the body prefilled. The owner still presses Send in the messaging app.

## Calendar

The Calendar screen reads `calendar_events` and supports Day and Week views.

Bookings include:

- title and job type
- date, start time and duration
- customer name and phone
- rego, suburb and full address
- notes

Job types are colour-coded. A legend appears for the job types visible in the current date range.

The owner can:

- add a booking manually
- create one from an inquiry
- edit or delete a booking
- swap a booking with the one before or after it on the same day while preserving each duration
- call, message, invoice or inspect the customer from an existing booking

New bookings default to the duration configured in Settings. If no setting is available, the default is 60 minutes.

## Search

Search works across the already-loaded inquiry data. It matches:

- name
- email
- phone
- suburb
- rego
- vehicle make and model
- service label

Search results open the full inquiry detail sheet.

## Analytics

Analytics is in the sidebar rather than the bottom navigation.

It reports:

- inquiry volume over time
- busiest day of the week
- most common job types
- top suburbs

Views are Daily for 14 days, Weekly for 12 weeks and Monthly for 12 months. Analytics is based on inquiry creation time, not completed jobs or accounting revenue.

## Invoice records

The Invoices sidebar screen reads up to 1,000 saved invoices, groups them by month and supports name, rego, invoice number and vehicle search.

Each row shows customer, total, rego and payment status. Actions are:

- View the stored PDF
- Edit the saved invoice
- Send the stored PDF after confirmation
- Delete the database row and attempt to remove its PDF

If a saved invoice has no email, the app tries its linked inquiry and then the most recent inquiry with the same rego.

## Invoice generator

The invoice generator lives in `invoice/` and creates PDFs in the browser with pdfmake.

### Customer and vehicle

- Bill to a person or business
- Contact/customer name
- Customer email for sending
- Billing address
- Rego
- Make and model
- Year
- Odometer

Typing a person or business name opens a recent-customer picker built from website inquiries and past invoices. Picking a result fills the known customer and vehicle data.

### Invoice body

- automatic invoice number
- issue and due date
- any number of line items
- editable quantity, unit price and line amount
- GST-inclusive or GST-exclusive calculation
- Paid or Outstanding status (partial payments are not offered; older partial invoices open as Outstanding)
- one or more payment records with date, method and amount
- optional notes
- optional customer name and drawn signature

Marking an invoice Paid adds a payment for the remaining balance when needed.

Items are added through one **Add items** button. It opens a searchable list of active `products` (cached on the phone, refreshed from Supabase). Tapping a row puts it on the invoice at once; tapping again raises its quantity. Search ranks names that start with the typed text first, then names with a word starting with it, then names containing it, then description matches, and every typed word must match. If nothing fits, "Add a new item" takes a name, price, quantity and optional description, adds the line, and by default saves it to `products` so it appears in search next time. Unpriced items are added at zero. A product's description travels with it as the line's **printed details**, editable on the invoice (any line can also get details with "Add details for the customer"). On the PDF the details print as a full-width row under the line: plain lines become bullet points, and a line ending in a colon starts a checklist laid out in columns with ticks. The Standard Service item uses this for its service checklist.

Every invoice prints a **Payment details** block with the bank transfer details (account name, BSB, account number) and the invoice number as the reference. When money is owing it shows the amount and due date; when paid it says so. The bank details live in `BUSINESS.bank` in `invoice/app.js`. The printed layout itself is in `invoice/invoice-pdf.js`, which has no DOM access and can be rendered outside the browser.

### Invoice actions

- Save: keeps a local draft, creates or updates the Supabase record, then attempts to upload the PDF.
- Open: opens a newly generated PDF without saving.
- Send: gets Gmail access first, generates and emails the PDF, then saves or updates the invoice record.

Saved invoices retain the full generator state in the `state` JSON field so they can be reopened without losing receipts, signature or form choices. Older rows without `state` are reconstructed from the searchable columns as far as possible.

## Inspection records

The Inspection reports sidebar screen mirrors invoice records. It supports search, month grouping, PDF view, edit, send and delete.

## Inspection generator

The inspection generator lives in `inspection/` and also uses pdfmake.

The form includes:

- cover photo: one landscape shot of the whole car, printed large on page one
- report number and report date
- appointment date and time window
- client contact, phone, email and address
- rego, make/model, year, location, date and odometer
- Interior, Exterior, Engine Bay, Tyres Wheels and Brakes, and Road Test assessments
- overall score slider from 0 to 100 in tens, which also suggests the overall rating
- overall rating (Good, Fair, Poor or NA) and comments
- sign-off name, date and drawn signature
- editable disclaimer and not-checked lists

Each inspection criterion defaults to Fair and can be changed to Good, Fair, Poor or NA. A complete section can be bulk-set to one grade. Reports saved when the grade was called "Repair" are converted to "Poor" whenever they are opened.

Images can be added through two distinct controls, camera capture and gallery selection. Each photo is stored in the `inspections` bucket as a 1,024 pixel master and a small thumbnail, and the report state keeps only their paths. The cover photo is stored the same way at up to 1,600 pixels.

### The PDF

The layout lives in `inspection/report-pdf.js`, which has no DOM access so it can also be rendered in Node while being tuned. The report runs:

1. Cover: the vehicle with its rego plate (N/A when none was recorded), customer details then vehicle details, the cover photo at a fixed height with its own proportions and never cropped, and an at-a-glance table of each section with what needs attention.
2. Inspection results: the five sections flowing continuously. A section's title repeats if it runs over a page, and its inspector notes stay with it.
3. Inspection photos: justified rows in which every photo shares the row's height, so an upright photo never stands taller than a landscape beside it. Rows flow without forced page breaks.
4. Overall assessment: a half-moon gauge of the score, the verdict, every item graded Poor grouped by section, then the sign-off.
5. Terms and conditions.

Filled panels are always unbreakable. pdfmake paints a filled cell's background onto the wrong page when that cell splits, which is what used to leave tinted blocks over headers.

Inspection drafts are stored on the phone in IndexedDB.

Save, Open, Send and edit behaviour follows the same model as invoices.

## Leaving a form with unsaved work

The invoice and inspection pages use `leave-guard.js`. When the form differs from how it was last loaded or saved, tapping the logo, using the phone's back gesture or button, or closing the tab asks first. The window offers **Keep editing**, **Save draft and leave** and **Discard and leave**. An untouched form leaves without asking.

## Price list

The price list is a mobile-first editor for `products`.

It currently starts from 46 items carried over from the owner's previous app. The screen can:

- search by name or description
- filter all, need a price, priced or changed items
- edit names, prices and descriptions
- add an item
- remove an item
- keep an unfinished draft on the phone
- upsert changed rows to Supabase by stable product code

Saved active products automatically feed the invoice Saved items picker on its next refresh.

## Settings

Settings are read synchronously from local storage and then refreshed from the single shared `app_settings` row when that table exists.

The page currently exposes:

- business name, phone, email, ABN and website
- standard service, diagnostic and call-out defaults
- invoice GST default and payment terms
- shortcut and status for the price list
- default calendar duration
- Ashley visibility
- optional confirmation before Ashley changes a booking
- optional client-side app passcode
- Gmail connection status and connect/reconnect action
- clear invoice drafts
- clear Ashley conversation
- reset settings

Emails, SMS preparation and deletion always require owner confirmation in Ashley and cannot be disabled.

See `CURRENT_LIMITATIONS.md` for settings that are displayed but not yet consumed by every generator path.

## Installed app behaviour

The manifest provides standalone portrait display, theme colours and 192/512 pixel icons. Apple touch icons are supplied for iPhone home-screen installation.

The app deliberately has no active service worker, so it is not an offline application. Old service workers and caches are removed on page load to avoid the iOS cross-origin upload failure that previously blocked Supabase PDF saves.
