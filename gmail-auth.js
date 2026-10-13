/* ============================================================================
   Gmail sign-in that stays signed in. Shared by every page that uses Gmail.

   Browser-only Google sign-in gives a one-hour access token and no way to
   renew it quietly, so after an hour the next Send opened Google again (on an
   iPhone home-screen app, usually a full login). Now:

     1. Once per phone, from a tap: Google's popup grants offline access and
        returns a one-time code. The Gmail Worker (cloudflare/gmail) swaps it
        for a refresh token it keeps, checks it is the business mailbox, and
        gives this phone a private device key.
     2. From then on: when the one-hour token runs out, the app asks the
        Worker for a fresh one with the device key. No popup, no login.

   The refresh token never comes to the phone or into this public repo.

     MMQLD_GAUTH.getToken()   cached token, else a quiet refresh, else the
                              one-time connect (needs to run from a tap)
     MMQLD_GAUTH.quiet()      cached token or a quiet refresh; never a popup
     MMQLD_GAUTH.connected()  true when this phone can get a token quietly
     MMQLD_GAUTH.connect()    the one-time connect, from a tap
     MMQLD_GAUTH.disconnect() forget this phone

   If the Worker is not set up yet it falls back to the old one-hour sign-in,
   so nothing breaks in the meantime.
   ========================================================================== */
(function () {
  'use strict';

  const TOK_KEY = 'mmqld_gtok';      // { t: access token, e: expiry ms }, shared by all pages
  const DEV_KEY = 'mmqld_gdev';      // this phone's device key for the Gmail Worker
  const SCOPE = 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) {} },
  };
  const cfg = () => (typeof CONFIG === 'undefined' ? {} : CONFIG);
  const endpoint = () => String((cfg().GMAIL_AUTH && cfg().GMAIL_AUTH.ENDPOINT) || '').replace(/\/+$/, '');

  function cached() {
    try { const o = JSON.parse(ls.get(TOK_KEY) || 'null'); if (o && o.t && Date.now() < o.e) return o.t; } catch (_) {}
    return '';
  }
  function store(token, expiresAt) {
    // A minute early, so a request never goes out with a token about to lapse.
    ls.set(TOK_KEY, JSON.stringify({ t: token, e: Number(expiresAt) - 60e3 }));
    return token;
  }

  /* ----------------------------------------------- Google script loading -- */
  const gisReady = () => !!(window.google && google.accounts && google.accounts.oauth2);
  let gisWait = null;
  function ensureGis(timeoutMs) {
    if (gisReady()) return Promise.resolve();
    if (gisWait) return gisWait;
    gisWait = new Promise((resolve, reject) => {
      if (!document.querySelector('script[src^="' + GIS_SRC + '"]')) {
        const s = document.createElement('script');
        s.src = GIS_SRC; s.async = true; s.defer = true;
        document.head.appendChild(s);
      }
      const deadline = Date.now() + (timeoutMs || 15000);
      (function poll() {
        if (gisReady()) return resolve();
        if (Date.now() > deadline) { gisWait = null; return reject(new Error('Google sign-in could not load. Check your connection and try again.')); }
        setTimeout(poll, 150);
      })();
    });
    return gisWait;
  }
  /* Google rejects a sign-in from an address that is not on the OAuth client's
     list, and from the browser that looks like the owner closing the pop-up. */
  function gErr(type) {
    if (type === 'popup_failed_to_open') return 'Google sign-in was blocked. Allow pop-ups for this site, then try again.';
    if (type === 'popup_closed' || type === 'popup_closed_by_user') {
      return 'Google sign-in did not finish. If a Google error page appeared, this app\'s address (' + location.origin + ') still has to be added to the Google sign-in settings.';
    }
    return 'Google sign-in did not complete (' + (type || 'unknown') + ').';
  }
  function clientId() {
    const id = cfg().GOOGLE_CLIENT_ID;
    if (!id || String(id).indexOf('PASTE_') === 0) throw new Error('Google sign-in is not set up yet: GOOGLE_CLIENT_ID is missing from config.js');
    return id;
  }

  /* --------------------------------------------------- Worker requests -- */
  async function worker(path, opts) {
    const r = await fetch(endpoint() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) },
      body: JSON.stringify((opts && opts.body) || {}),
    });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  }

  /* Quiet refresh with the device key. '' when this phone is not connected. */
  let quietWait = null;
  async function quietRefresh() {
    const key = ls.get(DEV_KEY);
    if (!key || !endpoint()) return '';
    if (quietWait) return quietWait;       // several Gmail calls at once share one refresh
    quietWait = (async () => {
      try {
        const { status, j } = await worker('/token', { headers: { 'X-Device-Key': key } });
        if (status === 200 && j.access_token) return store(j.access_token, j.expires_at);
        // Unknown phone, or Google withdrew access: this phone must connect again.
        if (status === 401) ls.del(DEV_KEY);
        return '';
      } catch (_) {
        return '';                          // offline: the caller decides what to say
      } finally {
        setTimeout(() => { quietWait = null; }, 0);
      }
    })();
    return quietWait;
  }

  async function quiet() {
    return cached() || (await quietRefresh());
  }

  /* --------------------------------------------- the one-time connect -- */
  let codeClient = null, pending = null;
  async function connect() {
    if (!endpoint()) return legacyToken();
    await ensureGis();
    if (!codeClient) {
      codeClient = google.accounts.oauth2.initCodeClient({
        client_id: clientId(),
        scope: SCOPE,
        ux_mode: 'popup',
        callback: (r) => {
          if (r.error) return pending && pending.reject(new Error(gErr(r.error)));
          pending && pending.resolve(r.code);
        },
        error_callback: (e) => pending && pending.reject(new Error(gErr((e && e.type) || ''))),
      });
    }
    const code = await new Promise((resolve, reject) => { pending = { resolve, reject }; codeClient.requestCode(); });
    const { status, j } = await worker('/connect', { body: { code } });
    if (status === 200 && j.device_key) {
      ls.set(DEV_KEY, j.device_key);
      return store(j.access_token, j.expires_at);
    }
    if (j.error === 'wrong_account') throw new Error('That was ' + (j.account || 'a different Google account') + '. Sign in with the business Gmail.');
    if (j.error === 'no_refresh_token') {
      throw new Error('Google did not give lasting access. Open myaccount.google.com/permissions, remove this app, then connect again.');
    }
    if (j.error === 'not_configured') return legacyToken();
    throw new Error('Could not connect Gmail (' + (j.error || status) + ')');
  }

  /* --------------------------- old one-hour sign-in, until the Worker is up -- */
  let tokenClient = null, tPending = null;
  async function legacyToken() {
    await ensureGis();
    if (!tokenClient) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId(),
        scope: SCOPE,
        callback: (r) => {
          if (r.error) return tPending && tPending.reject(new Error(gErr(r.error)));
          tPending && tPending.resolve(store(r.access_token, Date.now() + (r.expires_in || 3600) * 1000));
        },
        error_callback: (e) => tPending && tPending.reject(new Error(gErr((e && e.type) || ''))),
      });
    }
    return new Promise((resolve, reject) => { tPending = { resolve, reject }; tokenClient.requestAccessToken({ prompt: '' }); });
  }

  async function getToken() {
    const c = cached();
    if (c) return c;
    if (ls.get(DEV_KEY) && endpoint()) {
      const t = await quietRefresh();
      if (t) return t;
      // The quiet refresh failed, and Safari only lets Google's window open
      // straight after a tap, not after a network wait. Ask for one more tap:
      // with the device key gone, that tap goes straight to Google.
      if (!ls.get(DEV_KEY)) throw new Error('Gmail needs connecting again. Tap the button once more to sign in.');
      throw new Error('Could not reach Gmail. Check your connection and try again.');
    }
    return connect();
  }

  async function disconnect() {
    const key = ls.get(DEV_KEY);
    ls.del(DEV_KEY); ls.del(TOK_KEY);
    if (key && endpoint()) { try { await worker('/disconnect', { headers: { 'X-Device-Key': key } }); } catch (_) {} }
  }

  /* A Gmail call came back 401: drop the access token so the next call
     refreshes quietly (the device key stays). */
  function expire() { ls.del(TOK_KEY); }

  const connected = () => !!cached() || !!(ls.get(DEV_KEY) && endpoint());
  const lasting = () => !!(ls.get(DEV_KEY) && endpoint());

  // Warm Google's script so a first connect does not wait on it.
  if (!gisReady()) ensureGis(20000).catch(() => {});

  window.MMQLD_GAUTH = { getToken, quiet, connect, disconnect, expire, connected, lasting, cached, ensureGis };
})();
