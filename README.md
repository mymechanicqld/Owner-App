# My Mechanic QLD - Owner app

A mobile-first web app for the business owner. Hosted on GitHub Pages, no
backend. It reads customer submissions from Supabase and sends threaded replies
straight from Gmail in the browser.

## Pages (bottom nav)

- **Dashboard** - quick pulse: new leads, last 48h, this week, top job type, and recent inquiries.
- **Inquiries** - recent leads with a job-type icon, name, suburb and rego. Filter by last 48h / week / month / year (default 48h). Tap a lead to see full details and reply.
- **Search** - find any customer by name, rego, suburb, phone or email.
- **Analytics** - bar charts of inquiries over time, busiest day of week, most common job type and top suburbs, toggled Daily / Weekly / Monthly.

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
