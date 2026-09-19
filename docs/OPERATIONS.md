# Operations and deployment

## Production addresses

Canonical owner app:

- <https://mmqld-app.vercel.app/>

Legacy GitHub Pages copies may still exist on an installed phone. `config.js` directs a GitHub Pages copy to the canonical Vercel Ashley endpoint because GitHub Pages cannot host the server function.

All non-canonical `*.vercel.app` page loads are redirected to the canonical host with path, query and hash preserved.

## Vercel configuration

The owner-app Vercel project needs no environment variables. It serves static files only.

## Ashley on Cloudflare

Ashley's model runs on Cloudflare Workers AI through the Worker in `cloudflare/ashley`:

- URL: <https://mmqld-ashley.todo-r2-d1.workers.dev>
- Model: `@cf/zai-org/glm-4.7-flash`, thinking off, one retry on transient errors
- Model access: the Worker's AI binding. There is no model API key.
- Secret: `ASHLEY_APP_KEY`, which must match the handshake in `config.js`
- Deploy: `npx wrangler deploy` from `cloudflare/ashley`, logged in to the Cloudflare account that owns the Worker
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

Asset query strings are currently versioned as `v=36`. When a script or stylesheet changes, update its query string on every page that loads it. This remains useful for browser and home-screen cache separation even with Vercel's revalidation headers.

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
4. Calendar moves between Day and Week and opens an existing booking.
5. Invoice and inspection record lists load.
6. New Invoice loads products in Saved items.
7. New Inspection exposes separate camera and gallery controls.
8. Price list loads current Supabase rows.
9. Settings reports whether cross-device sync exists.
10. Ashley renders starters and accepts a harmless lookup.

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
9. Test one invoice and one inspection PDF visually.
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

### Ashley is unavailable

- confirm the app is on the canonical deployment
- confirm the Worker answers: a POST without the key should return 401
- confirm the Worker's `ASHLEY_APP_KEY` secret matches `config.js`
- check Workers AI usage in the Cloudflare dashboard; the daily free allowance may be used up
