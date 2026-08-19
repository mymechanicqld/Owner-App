# My Mechanic QLD - Owner app

A mobile-first web app for the business owner. Hosted on GitHub Pages, no
backend. It reads customer submissions from Supabase and sends threaded replies
straight from Gmail in the browser.

## Pages (bottom nav)

- **Dashboard** - quick pulse: new leads, last 48h, this week, top job type, and recent inquiries.
- **Inquiries** - recent leads with a job-type icon, name, suburb and rego. Filter by last 48h / week / month / year (default 48h). Tap a lead to see full details and reply.
- **Search** - find any customer by name, rego, suburb, phone or email.
- **Ashley** - the assistant. Ask her anything about the business in plain English and she goes and finds it. See below.

Analytics moved into the sidebar menu (top left) to make room for Ashley. It is unchanged: bar charts of inquiries over time, busiest day of week, most common job type and top suburbs, toggled Daily / Weekly / Monthly.

## Replying (threaded Gmail)

Open a lead, tap **Reply by email**, pick **Logbook service**, **Diagnostic** or
**Custom**, adjust the price, edit the text, and **Send**. The reply goes out in
the customer's existing Gmail thread, so the inquiry, your reply and their
follow-up all stay together in one conversation.

---

## Setup

Everything is configured in **`config.js`**.

### 1. Supabase (already wired)

The current project URL and publishable key are in `config.js`. The publishable
key is safe to be public (it relies on Row Level Security). After you rotate
keys (below), paste the new values there.

### 2. Gmail (Web OAuth client)

The app sends email through the owner's Google account in the browser, which
needs a **Web** OAuth client (the existing Desktop client cannot be used here).

1. Go to <https://console.cloud.google.com> > APIs & Services > **Credentials**.
2. **Create credentials > OAuth client ID > Web application**.
3. Under **Authorised JavaScript origins**, add your GitHub Pages origin, e.g.
   `https://YOURNAME.github.io` (origin only, no path).
4. Create, copy the **Client ID**, and paste it into `config.js` as
   `GOOGLE_CLIENT_ID`.
5. Make sure the Gmail API is enabled (APIs & Services > Library > Gmail API).

The owner taps Reply, signs in with Google once, grants Gmail access, and can
send from then on.

### 3. Deploy to GitHub Pages

1. Put the contents of this `owner-app/` folder in a repo (or a `/docs` folder).
2. Repo **Settings > Pages**, set the source to that branch/folder.
3. Open the published URL on the phone. On iOS, Share > **Add to Home Screen**
   for an app-like icon (no manifest needed).

---

## Rotating keys (do this when ready)

You rotate in each provider's console, then paste the new values into
`config.js`. Nothing secret lives in this app.

- **Supabase**: Dashboard > Project Settings > API keys. Roll the **publishable**
  key, and importantly roll the **secret** key if it was ever shared. Update
  `SUPABASE_KEY` here, and update the Python email-assistant `.env` and the
  desktop dashboard with the new publishable key too.
- **Gmail**: create the Web OAuth client above. Optionally delete the old Desktop
  client and revoke old access at <https://myaccount.google.com/permissions>.
- **Resend** (used by the website form, not this app): roll the API key at
  <https://resend.com/api-keys> and update the website's environment variable.

---

## Security note

You chose **no passcode gate**, so anyone who has the URL can open the app and
see customer data (the Supabase publishable key is in the page and RLS currently
allows public reads). Keep the URL private. To add a gate later, set `GATE_PIN`
in `config.js` to any code, that is the only change needed.

## Files

```
owner-app/
  index.html    shell + CDN scripts (Supabase, Lucide, Google Identity)
  styles.css    brand styling, mobile first
  app.js        data, pages, detail + reply, Gmail send
  config.js     credentials, templates, service map  (edit this)
  sw.js         service worker (offline shell, no manifest)
```


---

## Ashley (the assistant)

Ashley is the fifth tab. Ask her something in ordinary language and she works it
out by going and looking, the same way you would:

- "What's on today?" / "What does my week look like?"
- "Who still owes me money?"
- "Tell me everything about Kim Whackett"
- "Book in a brake repair for Dave on Friday at 9, rego 123ABC, Springwood"
- "Kim's job is done, send her the invoice"
- "How many booking confirmations came in this week?"

### What she can and cannot do on her own

| She just does it | She asks first |
| --- | --- |
| Any lookup: calendar, enquiries, invoices, reports, inbox | Sending an email |
| Adding or changing a booking | Texting a customer |
| Changing an enquiry's status | Deleting anything |
| Marking an invoice paid | |

When she asks, you get a card showing exactly what is about to happen, including
the full email text, and nothing happens until you press the button.

She does not create new invoices or inspection reports. She can find, send and
mark off ones that already exist. Making a new one stays a manual job so the
numbers are always yours.

### How it works

Three files: `ashley-tools.js` (the fifteen things she can do), `ashley-agent.js`
(the loop that decides which to use) and `ashley-ui.js` (the chat screen).

She can call several tools in one go and they run at the same time, so
"how's the business going and tell me about Evren" is one round trip, not two.

### The API key

The OpenRouter key is **not in this repo**, because this repo is public and
scrapers harvest keys from GitHub within days. It lives in the website project's
Vercel environment variables, and this app calls `https://mymechanicqld.com.au/api/ashley/`
instead. See `app/api/ashley/route.ts` in the website repo.

`CONFIG.ASHLEY.APP_KEY` in `config.js` is only a handshake so that endpoint
ignores random traffic. It is obscurity, not a secret. If the endpoint is ever
abused, change `ASHLEY_APP_KEY` in Vercel and re-ramble the new value here.

Nothing identifying the business is sent to the model provider: no app name, no
URL, no attribution headers, and requests are restricted to providers that do
not retain data. The email signature is added by this app after Ashley finishes
writing, so the business name and phone number are always right and never have
to be sent to the model at all.
