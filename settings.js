/* ============================================================================
   Shared settings
   ----------------------------------------------------------------------------
   Loaded on every page, immediately after config.js and before anything else.

   The trick that keeps this simple: saved values are written straight onto the
   CONFIG object at load time. Everything downstream already reads CONFIG for
   the business name, phone, email and default prices, so changing a setting
   reaches the invoice PDF, Ashley's email signature and the SMS templates
   without any of them knowing settings exist.

   Storage is the phone first, Supabase second:
     - localStorage is read synchronously, so CONFIG is correct before app.js
       runs. No flash of stale details on a PDF.
     - Supabase is read a moment later and, being shared, wins. That is what
       makes settings follow the owner to a second device.
   If the app_settings table has not been created yet, everything still works
   locally; it simply does not sync.
   ========================================================================== */
(function () {
  'use strict';

  const LS_KEY = 'mmqld_settings';

  const DEFAULTS = {
    // Business details, shown on invoices, reports and outgoing email
    business_name: 'My Mechanic QLD',
    business_phone: '0451 159 954',
    business_email: 'mymechanicqld@gmail.com',
    business_abn: '85 829 529 258',
    business_website: 'www.mymechanicqld.com.au',
    website_form_url: 'https://mymechanicqld.com.au/book/',

    // Default prices used by the quick reply and message templates
    price_service: '369',
    price_diagnostic: '189',
    price_callout: '55',

    // Invoicing
    invoice_gst_inclusive: true,
    invoice_terms_days: '7',

    // Calendar
    calendar_default_minutes: '60',

    // Ashley
    ashley_confirm_bookings: false,   // she may add and change bookings unprompted
    ashley_enabled: true,

    // Security
    passcode: '',                     // empty = no lock
  };

  let S = Object.assign({}, DEFAULTS);

  /* Push the values onto CONFIG so the rest of the app picks them up for free.
     CONFIG is a top-level `const`, so it is NOT on window; reference it
     directly. Its properties are still mutable. */
  function applyToConfig() {
    if (typeof CONFIG === 'undefined') return;
    CONFIG.BUSINESS_NAME = S.business_name;
    CONFIG.BUSINESS_PHONE = S.business_phone;
    CONFIG.BUSINESS_EMAIL = S.business_email;
    CONFIG.BUSINESS_ABN = S.business_abn;
    CONFIG.BUSINESS_WEBSITE = S.business_website;
    CONFIG.WEBSITE_FORM_URL = S.website_form_url;
    CONFIG.DEFAULT_SERVICE_PRICE = S.price_service;
    CONFIG.DEFAULT_DIAGNOSTIC_PRICE = S.price_diagnostic;
    CONFIG.DEFAULT_CALLOUT_PRICE = S.price_callout;
    CONFIG.GATE_PIN = S.passcode || '';
  }

  function readLocal() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (raw && typeof raw === 'object') S = Object.assign({}, DEFAULTS, raw);
    } catch (_) {}
    applyToConfig();
  }

  function writeLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (_) {}
  }

  const endpoint = () => CONFIG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/app_settings';
  const headers = () => ({ apikey: CONFIG.SUPABASE_KEY, 'Content-Type': 'application/json' });

  /* Pull the shared copy. Returns true if anything actually changed, so callers
     can re-render rather than repainting on every load. */
  async function refresh() {
    try {
      const r = await fetch(endpoint() + '?id=eq.1&select=data', { headers: headers() });
      if (!r.ok) return false;                       // table missing, stay local
      const rows = await r.json();
      const remote = rows && rows[0] && rows[0].data;
      if (!remote || typeof remote !== 'object' || !Object.keys(remote).length) return false;
      const before = JSON.stringify(S);
      S = Object.assign({}, DEFAULTS, remote);
      applyToConfig();
      writeLocal();
      const changed = before !== JSON.stringify(S);
      if (changed) document.dispatchEvent(new CustomEvent('mmqld:settings'));
      return changed;
    } catch (_) { return false; }
  }

  /* Save locally first so the owner never loses a change to a flaky connection,
     then push. Returns {synced:boolean} so the UI can be honest about it. */
  async function save(patch) {
    S = Object.assign({}, S, patch || {});
    applyToConfig();
    writeLocal();
    document.dispatchEvent(new CustomEvent('mmqld:settings'));
    try {
      const r = await fetch(endpoint() + '?on_conflict=id', {
        method: 'POST',
        headers: Object.assign({}, headers(), { Prefer: 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify([{ id: 1, data: S }]),
      });
      return { synced: r.ok, status: r.status };
    } catch (e) {
      return { synced: false, error: String((e && e.message) || e) };
    }
  }

  readLocal();
  // Non-blocking: the shared copy lands a beat later and wins if it differs.
  refresh();

  window.MMQLD_SETTINGS = {
    DEFAULTS,
    all: () => Object.assign({}, S),
    get: (k) => (S[k] !== undefined ? S[k] : DEFAULTS[k]),
    num: (k) => Number(S[k] !== undefined ? S[k] : DEFAULTS[k]) || 0,
    bool: (k) => S[k] === true || S[k] === 'true',
    save,
    refresh,
    reset: () => save(Object.assign({}, DEFAULTS)),
  };
})();
