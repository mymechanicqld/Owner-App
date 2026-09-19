# Ashley agent harness

Ashley is the owner-facing business assistant in the fifth bottom tab. She combines model reasoning with browser-executed tools over Supabase and Gmail.

## Components

| File | Responsibility |
| --- | --- |
| `ashley-ui.js` | chat view, local history, progress text, confirmation cards and shortcut buttons |
| `ashley-agent.js` | system instructions, model transport, loop, parallel execution and history trimming |
| `ashley-tools.js` | tool schemas, implementations, confirmation previews and plain-language busy labels |
| `cloudflare/ashley/` | Cloudflare Worker that runs GLM 4.7 Flash through the Workers AI binding |

## Agent loop

Each owner message starts a fresh system instruction block containing the current local date and time.

The loop allows up to six model steps and 90 seconds. The model can return several tool calls in one step. Independent calls run with `Promise.all`, which keeps broad questions fast.

Calls that need owner approval pause on a confirmation card. Other calls in the same model batch can continue while the owner reads that card. Multiple confirmation calls are presented through their individual promises, so new tools should avoid creating several simultaneous high-impact actions in one model turn.

Tool results are capped before they are returned to the model. The model receives at most 9,000 characters from each result. The next owner turn keeps up to 24 user and final-assistant messages. Tool plumbing is removed from saved history.

The visible conversation is capped at 40 items and stored on the phone.

## Tool inventory

Ashley currently has 15 tools.

### Wide read tools

#### `get_overview`

Returns today's and tomorrow's bookings, next-seven-day booking count, inquiry counts, leads awaiting first contact, unpaid invoices, amount owing and 30-day invoiced total.

#### `find_customer`

Searches inquiries, bookings, invoices and inspections in parallel by name, business, email, phone, rego or related text. It merges results into customer cards with contact details, vehicles and document IDs.

This is the preferred first call for customer-specific work because it returns the email address and relevant record IDs together.

#### `list_inquiries`

Lists recent inquiries with optional age, status and job-type filters.

#### `list_bookings`

Lists calendar events across a date range, defaulting to the next seven days.

#### `list_documents`

Lists invoices or inspection reports with date, payment, unpaid and customer filters.

#### `get_document`

Gets one invoice or report. Invoice results include line items and totals. Inspection results summarise section shape rather than returning every criterion. Both can include the public PDF link.

#### `search_email`

Searches Gmail using normal Gmail query syntax and a newer-than window. It returns compact metadata and previews for up to 25 messages.

#### `read_email`

Reads one Gmail message by the ID returned from search. It walks the MIME tree, prefers plain text and falls back to stripped HTML.

### Routine write tools

#### `save_booking`

Creates or updates a calendar booking. Confirmation is controlled by the owner's Settings preference.

#### `update_inquiry`

Changes inquiry status or notes without confirmation.

#### `update_invoice`

Changes payment status, amount paid or notes. Marking an invoice Paid fills the total as paid when no explicit amount was supplied, then recalculates the balance.

### Confirmed tools

#### `send_email`

Always requires confirmation. It can send a normal email or attach an existing invoice or inspection PDF. Gmail threading is attempted automatically. The browser appends Ashley's business signature after the model writes the body.

#### `delete_record`

Always requires confirmation. It deletes a booking, invoice or inspection database row. The Ashley path currently deletes the row only, not the related PDF object.

#### `draft_sms`

Always requires confirmation. It produces an Open in Messages button with the SMS body prefilled. It does not press Send in the phone's messaging app.

### Navigation tool

#### `open_screen`

Adds a shortcut button to Dashboard, Inquiries, Calendar, Search, Analytics, Invoices or Inspections. It supplements Ashley's answer rather than replacing it.

## Model notes (GLM 4.7 Flash)

- Thinking is switched off; it only added cost in testing.
- GLM can describe an action as done after the owner declined it. The agent tracks declines in code: if the owner said no and nothing confirmed ran, his reply is replaced with "Okay, I have left it. Nothing was sent or changed."
- The system prompt forbids guessing ids across parallel calls and inventing days, times or job details. Drafted messages are always shown in full on the confirmation card before anything is sent.

## Confirmation policy

Always confirmed:

- email sending
- SMS preparation
- deletion

Owner preference:

- create or update a calendar booking

No confirmation:

- all reads
- inquiry status or notes update
- invoice payment update
- navigation shortcut

The system instructions and tool registry both describe this policy. The registry is authoritative because it controls whether code actually runs.

## Gmail handoff

Inbox reads cannot safely open an OAuth popup several seconds after the initial Send tap. When no valid cached token exists, the Gmail read tools return a Connect Gmail card.

The card click calls the main app's `getToken()` directly while a genuine user gesture is active. Once connected, the owner repeats the question.

Email sending happens after a confirmation button tap, so the tool asks for Gmail access before doing any document or thread lookup.

## Message style protections

The model is instructed to:

- use Australian spelling
- write briefly and naturally
- avoid emojis
- avoid dashes as punctuation
- avoid invented prices, dates and promises
- write only the message body for customers
- never mention tools, IDs, databases, models or automation to the owner

The UI and send path also clean dash punctuation. The business signature is deterministic browser code, not generated text.

## Privacy design

The system instructions do not name the business, app, site or database. The model runs inside Cloudflare Workers AI on the business's own Cloudflare account, with no third-party model router.

This reduces unnecessary project disclosure but does not make model calls data-free. Relevant customer details and tool results are sent to the model when the owner's request needs them.

## Server controls

The Cloudflare Worker enforces:

- POST or OPTIONS only
- the production app, legacy GitHub Pages or localhost origins only
- matching browser handshake
- 40 requests per minute per in-memory IP bucket
- 400,000-byte request limit
- 60-message input limit
- 30-tool input limit
- 2,000 output-token ceiling
- server-selected model with thinking off

The browser normally asks for 1,600 output tokens and uses temperature 0.3.

The IP limit is a speed bump, not a durable global quota, because Worker isolates do not share the in-memory map.

## What Ashley cannot currently do

- create a new invoice or inspection report
- generate and persist a new PDF without using the manual generator
- edit invoice line items
- edit inspection criteria
- remove a PDF object when deleting a document record
- refresh Gmail in the background without a valid browser token
- authenticate a distinct owner account in Supabase
- make changes outside the 15 registered tools

## Adding or changing a tool

1. Add the compact implementation in `ashley-tools.js`.
2. Return only fields the model needs.
3. Add the function schema, busy label and any confirmation preview.
4. Decide confirmation based on impact, not convenience.
5. Ensure the function handles missing IDs and stale rows plainly.
6. Check whether the tool output can reveal unnecessary customer data.
7. Test direct success, empty results, permission failure and owner decline.
8. Test the tool as part of a parallel batch with at least one other tool.
9. Keep the final owner-facing explanation in plain language.
