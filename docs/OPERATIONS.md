# Operations and deployment

## Production addresses

Canonical owner app:

- <https://mmqld-app.vercel.app/>

Ashley's model endpoint, on Cloudflare:

- <https://mmqld-ashley.todo-r2-d1.workers.dev>

Legacy GitHub Pages copies may still exist on an installed phone. They use the same Cloudflare endpoint, which accepts the GitHub Pages origin.

All non-canonical `*.vercel.app` page loads are redirected to the canonical host with path, query and hash preserved.

## Vercel configuration

The owner-app Vercel project needs no environment variables. It serves static files only.

## Ashley on Cloudflare

Ashley's model runs on Cloudflare Workers AI through the Worker in `cloudflare/ashley`:

- URL: <https://mmqld-ashley.todo-r2-d1.workers.dev>
- Model: `@cf/zai-org/glm-4.7-flash`, thinking off, one retry on transient errors
- Model access: the Worker's AI binding. There is no model API key.
- Secret: `ASHLEY_APP_KEY`, which must match the handshake in `config.js`
- Account: the Cloudflare account signed in as gursahib99888@gmail.com (account ID `7b9aacaaa3e2edf9947a8da986f1ba38`). The `todo-r2-d1` part of the URL is that account's workers.dev subdomain, not this project.
- Deploy: `npx wrangler deploy` from `cloudflare/ashley` while `npx wrangler whoami` shows that account. `wrangler` is installed in `~/Documents/MyProjects/CloudFare-Setup`.
- Rotate the handshake: `npx wrangler secret put ASHLEY_APP_KEY`, then re-ramble the same value into `_RAMBLED.ash` in `config.js`.
- Quick health check without spending allowance: a POST with no `X-Ashley-Key` must return `401 Not authorised`.
- Cost: about 17 to 22 neurons per model step, so a normal question costs 35 to 65 neurons. The free allowance is 10,000 neurons a day, resetting at 10am Brisbane time. When it runs out, Ashley says so until the reset.

## Google OAuth setup

The Google OAuth credential must be a Web application client.

Required production JavaScript origin:

```text
https://mmqld-app.vercel.app
```

Add local origins only when local Gmail testing is required. Origins contain scheme and host only, with no path.

The Gmail API must be enabled. Current scopes are Gmail modify and Gmail send. The same OAuth grant supports inquiry replies, saved-document sends, invoice and inspection sends, Ashley inbox reads, and Ashley sends.

Common failure meanings:

- `origin_mismatch`: the exact page origin is missing from the OAuth client
- popup blocked: token request did not run close enough to a direct tap, or browser popup rules blocked it
- client ID not set: `config.js` did not load or the ID is missing
- Gmail 400: inspect MIME construction, recipients and headers before changing OAuth
- repeated consent: ensure token requests use an empty prompt and the owner has granted access

## Supabase setup

Schema changes live as numbered SQL files in the website repository under `supabase/migrations/`. The ones this app depends on:

| File | Adds | State |
| --- | --- | --- |
| `20260629_005_add_address.sql` | `address` on inquiries and bookings | applied |
| `20260824_006_products.sql` | `products`, the price list | applied |
| `20260824_007_app_settings.sql` | `app_settings`, cross-device settings | not applied yet (optional) |
| `20260919_008_calendar_customer_email.sql` | `customer_email` on `calendar_events`, backfilled from inquiries and invoices | applied 19 Sep 2026 |

The original `supabase-schema.sql` creates:

- `calendar_events`
- `invoices`
- `inspection_reports`
- `invoices` bucket
- `inspections` bucket
- broad anonymous policies used by the current browser-only architecture

The current app also requires:

- `quote_submissions`, created by the public website data flow
- `products`
- `app_settings`, optional for cross-device settings but required for Settings to report full sync

The original schema file predates Products and Settings. Do not treat it as a complete fresh-environment migration.

## Home-screen installation

On iPhone:

1. Open the canonical Vercel URL in Safari.
2. Use Share, then Add to Home Screen.
3. If an old icon or old origin persists, remove the existing home-screen app and add it again.

The app does not require or register a service worker. Do not re-enable one without reproducing Supabase Storage uploads on a real iPhone first.

## Document save model

Save is successful when the database record is written. PDF upload is an additional step.

Possible user messages:

- `This invoice has been saved`: row and PDF upload succeeded
- `Invoice saved (PDF copy could not upload)`: row is safe, `pdf_path` was not updated
- `Could not save: ...`: the record write or document generation failed

The same distinction applies to inspection reports.

If a record exists without a PDF:

1. open Records
2. edit the document
3. press Save again
4. confirm the PDF path appears by using View

## Cache and release behaviour

Vercel serves HTML, JavaScript, CSS and JSON with immediate revalidation. Image files use a one-year immutable cache.

Every script and stylesheet is loaded with a `?v=` query string. When a file changes, raise its number on every page that loads it. The numbers now differ per file and per page; for example the main page loads `config.js?v=44` and `ashley-agent.js?v=45`, while the invoice page loads `invoice-pdf.js?v=43`. Pick any number higher than the one the page currently uses. This matters most on an installed iPhone app, which holds on to old files longer than Safari does.

The head script unregisters old workers and clears old Cache Storage. A session guard prevents endless reload after removal.

## Local verification

Start an HTTP server inside this folder:

```bash
python3 -m http.server 8771
```

Core smoke check:

1. Dashboard loads current inquiry totals.
2. Inquiries can be filtered and one detail sheet opens.
3. Search finds a known rego.
4. Calendar Day view shows the hour timeline, the week strip moves days, the date title opens a date picker, and Week view opens an existing booking.
5. Invoice and inspection record lists load.
6. New Invoice: Add items opens the picker, typing ranks names that start with the text first, and a tapped item lands on the invoice.
7. New Inspection shows the cover photo card, separate camera and gallery controls, and the score slider in Overall rating.
8. Changing an invoice or inspection and tapping the logo shows Keep editing, Save draft and leave, Discard and leave.
9. Price list loads current Supabase rows.
10. Settings reports whether cross-device sync exists.
11. Ashley renders starters and accepts a harmless lookup. Each question uses Workers AI allowance, so keep it to one or two.

Do not send email, delete records or save test records during a smoke check unless the test plan includes explicit cleanup.

## Release verification

Before calling a release complete:

1. Run syntax checks on every standalone JavaScript file.
2. Search for accidental secrets and private environment values.
3. Confirm no active service-worker registration exists.
4. Verify the canonical redirect preserves invoice and inspection edit query parameters.
5. Test the production URL on a real iPhone, not only desktop emulation.
6. Test Supabase row creation separately from PDF upload.
7. Test Google connection from Settings.
8. Test a threaded inquiry reply.
9. Test one invoice and one inspection PDF visually. The layouts are in `invoice/invoice-pdf.js` and `inspection/report-pdf.js`; both run in Node with pdfmake 0.2.10, so real saved rows can be rendered and checked before release.
10. Test Ashley's overview, customer lookup, Gmail-connect card, confirmed send preview and declined action.
11. Remove any test rows, test PDFs and test emails that are safe to remove.
12. Confirm the deployed commit rather than relying only on a successful build.

## Safe configuration rules

- Supabase publishable key may be in browser code only while restrictive RLS is the security boundary.
- Supabase secret and service-role keys must never be in browser code.
- Google OAuth client ID may be in browser code.
- Google OAuth client secret must never be in browser code.
- No model key exists. Keep Cloudflare API tokens out of the repository and out of browser code.
- The Ashley browser handshake may be rotated but must not be described as a secret.
- Do not log customer data or upstream model responses from failed requests.

## Operational recovery

### Owner sees old code

- close and reopen the installed app
- open the canonical URL in Safari and refresh
- remove and re-add the home-screen app if the origin or icon changed
- confirm there is no controlling service worker

### PDF Save shows an upload warning

- check that the database row exists in Records
- reopen and save from the canonical Vercel origin
- verify bucket policies and object access
- confirm no old service worker controls the page

### Gmail connection fails

- confirm the sidebar footer shows the canonical host
- confirm that exact origin is authorised in Google Cloud
- use Settings to reconnect Gmail from a direct tap
- check that the GIS script loaded
- do not add a client secret to the app

### A booking drag did not stick

- the move saves straight away; a red "Could not move it" message means the save failed and the booking was put back
- check the phone has signal, then drag again
- the Undo button on the confirmation reverses the last move

### Ashley is unavailable

- confirm the app is on the canonical deployment
- confirm the Worker answers: a POST without the key should return 401
- confirm the Worker's `ASHLEY_APP_KEY` secret matches `config.js`
- check Workers AI usage in the Cloudflare dashboard; the daily free allowance may be used up
