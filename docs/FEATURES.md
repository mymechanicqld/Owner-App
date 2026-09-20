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

The Calendar screen reads `calendar_events`. It opens in **Day** view; **Week** is a list of the seven days.

### Day view

A Google Calendar style timeline:

- hours down the left, 64 points per hour, from 6 am to 8 pm, stretched to fit anything booked earlier or later
- each booking drawn to scale with its time, title, customer and suburb, coloured by job type
- bookings that overlap sit side by side in columns so none is hidden
- a red line marks the current time on today's timeline
- all-day bookings sit in a strip above the hours

Getting around:

- the date, arrows and a Monday to Sunday strip stay pinned at the top while the hours scroll; the strip shows up to three dots per busy day
- Previous and Next move one day; Today returns to today
- tapping the date title opens the phone's own date picker to jump to any date
- on opening, the view scrolls to the current hour for today, otherwise to the first booking

Changing bookings with a finger:

- **move**: press and hold a booking for about a third of a second until it lifts, then drag. A quick swipe that starts on a booking still scrolls the page
- **resize**: drag the handle along a booking's bottom edge
- times snap to 15 minutes; the booking shows its new time range while held; holding near the top or bottom edge scrolls the timeline
- the change saves to Supabase on release. A message confirms the new time with an **Undo** button, and says when the booking now overlaps another. A failed save puts the booking back
- with a mouse, dragging starts straight away
- tapping a booking opens it; tapping empty time starts a new booking at that half hour

### Week view

The seven days of the week as a list, with a job-type legend. Each day heading opens that day's timeline. Bookings can still be swapped with the one before or after on the same day, keeping each duration.

### The booking sheet

Bookings hold title, job type, date, start time, duration, customer, **email**, phone, rego, suburb, address and notes.

- typing in Customer suggests past customers from inquiries, invoices and bookings, matching by name or rego; picking one fills email, phone, rego, suburb and address, never overwriting anything already typed
- the email is checked for a sensible format
- the + button starts a booking at 9 am on the day being viewed
- an existing booking offers Call, Message, Invoice and Inspection shortcuts; Invoice and Inspection carry the email and the linked inquiry across
- new bookings default to the duration in Settings, otherwise 60 minutes

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

If a saved invoice has no email, the app tries its linked inquiry, then the most recent inquiry with the same rego, then the most recent calendar booking with that rego.

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

Typing a person or business name opens a recent-customer picker built from website inquiries, past invoices and calendar bookings. Picking a result fills the known customer and vehicle data.

### Invoice body

- automatic invoice number
- issue date, with the due date following it unless set by hand (Settings > Invoices > Payment due)
- any number of line items
- editable quantity, unit price and line amount
- GST-inclusive or GST-exclusive calculation
- Paid or Outstanding status (see Payment below)
- one or more payment records with date, method and amount
- optional notes
- optional customer name and drawn signature

### Adding items

Items are added through one **Add items** button, which opens a sheet listing the active `products` (cached on the phone, refreshed from Supabase):

- tapping a row puts it on the invoice at once; the empty starter line is reused, and tapping the same item again raises its quantity
- added items show a green tick and "On invoice ×2", and the Done button counts what was added
- search ranks names that **start** with the typed text first, then names with a **word** starting with it, then names merely **containing** it, then description matches. Every typed word must match somewhere, and Enter adds the top result
- at the bottom there is always **Add "…" as a new item**, prefilled with the search text. It takes a name, price, quantity and optional description, adds the line, and with **Save to my price list** (ticked by default) upserts it to `products` so it appears in search next time
- unpriced items are added at zero for the owner to price on the invoice

### Printed details under a line

A product's description travels with it as the line's **details**, shown in an editable box under the line on the form. Any line can get details with **+ Add details for the customer**. On the PDF the details print as a full-width row under the line:

- plain lines print as points with a gold bullet
- a line ending in a colon starts a checklist, printed in up to three columns with navy ticks

**Standard Service** ($369) uses this for its record of work: oil and filter replaced with full synthetic, under-bonnet and underbody inspection, fluids topped up, then a 21-point "Inspected the following visually only (wherever applicable)" checklist, starting with spark plugs and the air and pollen filter.

### Payment

The status is **Paid** or **Outstanding**. Partial payments are not offered; older invoices saved as partial open as Outstanding, and Ashley can no longer set partial. Marking an invoice Paid adds a payment for the remaining balance when needed.

### The PDF

The layout is in `invoice/invoice-pdf.js`, which has no DOM access and can be rendered outside the browser. Top to bottom:

- navy header band with logo and contact details, a gold rule beneath it and the watermark behind the page
- Bill to and vehicle card on the left, Tax invoice number and dates on the right
- items table with a tinted heading row; each line's details sit directly under it
- **Please note**: the invoice notes in a red-edged card beside the totals, where the customer will read them. Notes longer than 320 characters take the full width underneath instead, so a page break cannot strand half a sentence
- totals ending in a solid navy **Total** bar with a gold edge. Paid shows "Paid in full <date> by <method>. Thank you."; owing shows the outstanding amount in red and "Please pay by <due date>"
- a payments table only when there is more than one payment, then the customer signature when signed
- **How to pay** across the foot of the invoice: account name, BSB and account number, from Settings > Payments
- navy footer strip on every page; the last page's footer carries "Drive safe, and call us if anything comes up."

A typical invoice, including a Standard Service with its full checklist, fits on one page.

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

- cover photo: one shot of the whole car, taken first. The card at the top of the form has Take photo (rear camera) and Gallery buttons, shows the photo whole at its real proportions, and offers Retake and Remove. It is stored at up to 1,600 pixels
- report number and report date
- appointment date and time window
- client contact, phone, email and address
- rego, make/model, year, location, date and odometer
- Interior, Exterior, Engine Bay, Tyres Wheels and Brakes, and Road Test assessments
- overall score slider from 0 to 100 in tens, independent of the rating. It starts as "Not scored"; Clear returns it there
- overall rating (Good, Fair, Poor or NA) and comments
- editable disclaimer and not-checked lists

Each inspection criterion defaults to Fair and can be changed to Good, Fair, Poor or NA. A complete section can be bulk-set to one grade. Reports saved when the grade was called "Repair" are converted to "Poor" whenever they are opened.

Images can be added through two distinct controls, camera capture and gallery selection. Each photo is stored in the `inspections` bucket as a 1,024 pixel master and a small thumbnail, and the report state keeps only their paths. The cover photo is stored the same way at up to 1,600 pixels.

### The PDF

The layout lives in `inspection/report-pdf.js`, which has no DOM access so it can also be rendered in Node while being tuned. The report runs:

1. Cover: the vehicle title with a "REGO" plate (a grey N/A plate when none was recorded), the report number and inspection date, then the **Prepared for** and **Vehicle** cards side by side, then the cover photo at a fixed 222 point height with its own proportions, never cropped and centred, then an at-a-glance table showing each section's Good, Fair and Poor counts and what needs attention. The table can continue onto page two for a car with many faults.
2. Inspection results: the five sections flowing continuously. A section's title repeats if it runs over a page, and its inspector notes stay with it.
3. Inspection photos: justified rows in which every photo shares the row's height, so an upright photo never stands taller than a landscape beside it. Rows flow without forced page breaks.
4. Overall assessment, **always starting on a new page**: a half-moon gauge of ten coloured segments lit up to the score with a needle, the verdict and general comments, then every item graded Poor listed by section. With no score, the verdict shows without a gauge. The score and the Good/Fair/Poor rating are set separately; neither changes the other. There is no sign-off section.
5. Terms and conditions, on their own page.

Every page has the navy header with a gold rule and a footer reading "Vehicle inspection report" with the rego. Grades print as subtle chips: green Good, amber Fair, red Poor, grey N/A. Section numbers sit in navy circles.

Typical sizes: the Mazda MX5 report with 47 photos went from 26 pages to 11, and a Hilux report with 61 photos from 33 to 12.

Filled panels are always unbreakable. pdfmake paints a filled cell's background onto the wrong page when that cell splits, which is what used to leave tinted blocks over headers.

Inspection drafts are stored on the phone in IndexedDB, up to five.

Older reports keep their old PDF until they are opened and saved again. Photos saved without their dimensions are measured before the PDF is built so they are not squashed.

Save, Open, Send and edit behaviour follows the same model as invoices.

## Leaving a form with unsaved work

The invoice and inspection pages use `leave-guard.js`. When the form differs from how it was last loaded, saved or started, leaving asks first in a window centred on the screen:

- **Keep editing**: the main button; closes the window. Tapping outside it or pressing Escape does the same
- **Save draft and leave**: keeps a draft on the phone (the folder icon lists drafts), then returns to the main app. If the draft cannot be saved, the owner stays on the page
- **Discard and leave**: returns to the main app without saving

It catches the logo link, the phone's back gesture or button, and closing or reloading the tab. The last only shows the browser's own prompt, because browsers do not allow a custom one there. An untouched form leaves without asking.

## Price list

The price list is a mobile-first editor for `products`.

It holds 44 items, 22 priced, originally carried over from the owner's previous app. Items created from an invoice's Add items sheet are added here too. The screen can:

- search by name or description
- filter all, need a price, priced or changed items
- edit names, prices and descriptions
- add an item
- remove an item
- keep an unfinished draft on the phone
- upsert changed rows to Supabase by stable product code

Saved active products feed the invoice's Add items picker on its next refresh. A product's description becomes the printed details of any invoice line it is added to.

## Settings

Rebuilt on 19 September 2026 in the style of iOS Settings: grouped lists on system grey, coloured icon tiles, pages that slide in and out, a search bar, iOS switches and tick-mark pickers. Every change **saves as it is made**; a green "Saved" tick appears in the top bar. There is no Save button. Each page has its own address (`#/invoices`), so the phone's back gesture works.

The settings are stored on the phone and, once `app_settings` exists in Supabase, synced to every device. Every default is the wording or value the app used before it was editable.

| Page | What it controls | Where it takes effect |
| --- | --- | --- |
| Business profile | name, tagline, ABN, phone, email, website, booking link, "Sign as" name | invoice and report PDF headers, the signature on every email and text, Ashley's emails |
| Payments | show bank details on invoices, account name, BSB, account number, with a live preview | the "How to pay" panel on every invoice |
| Invoices | prices include GST, payment due (on receipt by default, or 7, 14 or 30 days), default notes, next invoice number, footer sign-off, email subject and message | new invoices, the PDF footer, the Send email |
| Inspection reports | next report number, disclaimer, not-checked list, email subject and message | new reports, the PDF terms, the Send email |
| Messages | standard service, diagnostic and call-out prices; service and diagnostic email replies; website-link, service and diagnostic texts | the inquiry Reply and Message sheets |
| Price list | shortcut with the item count | the price list page |
| Calendar | default job length, drag snap (15 or 30 minutes), day start and end hours, open in Day or Week | the calendar |
| Ashley | on or off, ask before changing bookings; emails, texts and deletions always ask (shown locked) | Ashley |
| Gmail | status, connect or reconnect | all sending |
| Passcode | optional numeric passcode | the app's opening prompt on this phone |
| Storage on this phone | invoice and inspection draft counts with clear buttons, refresh the price list, clear Ashley's conversation, reset all settings | this phone only |
| About | address, sync status, price list size, assistant | information |

Message wording is edited on its own page: a text box, buttons that insert placeholders (`{first_name}`, `{price}`, `{business}`, `{sender}`, `{form_link}`, `{number}`, `{rego}`), a live preview with sample values in which a mistyped placeholder shows in red, and **Restore original wording**. Email templates preview with the signature; text templates preview as a message bubble.

Search finds any row on any page by its label or common words ("bsb", "due", "gst", "signature") and opens that page with the row highlighted.

Invoice and report numbers count up separately on each phone; the Next number rows set that phone's next number.

## Ashley

Ashley is the assistant in the fifth tab. Her model is GLM 4.7 Flash on Cloudflare Workers AI. She looks things up, updates routine records, and prepares emails, texts and deletions that always wait for the owner's confirmation. See `ASHLEY.md`.

## Installed app behaviour

The manifest provides standalone portrait display, theme colours and 192/512 pixel icons. Apple touch icons are supplied for iPhone home-screen installation.

The app deliberately has no active service worker, so it is not an offline application. Old service workers and caches are removed on page load to avoid the iOS cross-origin upload failure that previously blocked Supabase PDF saves.
