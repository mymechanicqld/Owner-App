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

  /* Every default below is the wording or value the app used before it was
     editable, so a fresh phone behaves exactly as it always has. */
  const DEFAULTS = {
    // Business profile: invoices, reports, email signatures, Ashley
    business_name: 'My Mechanic QLD',
    business_tagline: 'We come to you',
    business_phone: '0451 159 954',
    business_email: 'mymechanicqld@gmail.com',
    business_abn: '85 829 529 258',
    business_website: 'www.mymechanicqld.com.au',
    website_form_url: 'https://mymechanicqld.com.au/book/',
    sender_name: 'Ashley',            // the name every email and text is signed with

    // Payments, printed on every invoice
    bank_name: 'My Mechanic Qld',
    bank_bsb: '484-799',
    bank_account: '506731007',
    invoice_show_bank: true,

    // Default prices used by the quick reply and message templates
    price_service: '369',
    price_diagnostic: '189',
    price_callout: '55',

    // Invoices
    invoice_gst_inclusive: true,
    invoice_terms_days: '7',
    invoice_default_notes: '',
    invoice_signoff: 'Drive safe, and call us if anything comes up.',
    email_invoice_subject: 'Invoice from {business}',
    email_invoice_body: 'Hi {first_name},\n\nPlease find your invoice attached. Let me know if you have any questions.',

    // Inspection reports
    report_inspector: '',
    report_statement: 'I confirm I have inspected and road-tested the above vehicle as per the findings of this report.',
    report_disclaimer: [
      'It is the responsibility of the buyer to check for any financial interest owing on the vehicle and for any write-off or stolen vehicle before purchasing the vehicle.',
      'The My Mechanic QLD inspection is not a guarantee or warranty and is valid only at the time of inspection.',
      'It is the responsibility of the buyer to conduct a visual inspection of the vehicle at the final point of sale as My Mechanic QLD can only advise on the condition of the vehicle at the time of inspection.',
      'Advice on the vehicle inspected is provided in context of the age and condition of the vehicle at the time inspected.',
      'The purchaser must take responsibility for the authenticity of the vehicle. VIN and engine numbers are recorded by our inspectors however authenticity cannot be guaranteed.',
      'The My Mechanic QLD inspection is VISUAL only. No removal of parts or components is undertaken during the inspection process.',
      'If there is a dispute about the content of this report, the purchaser must refer the vehicle back to My Mechanic QLD prior to proceeding with any repairs.',
      'This report serves to identify any visually detected problems however dismantling components may be subsequently required to provide a more accurate diagnosis.',
      'The inspection report is prepared for the person named on the report and not for use by any third party.',
    ].join('\n'),
    report_not_checked: [
      'Timing belts', 'Fuel & oil consumption', 'Trip meters / computers', 'Alarm / security system',
      'Navigation equipment / GPS', 'Operation of TV, cassette, CD or audio connections',
      'Automatic switching of wipers and lights', 'Compression of engine', 'Anti-lock braking system (ABS)',
    ].join('\n'),
    email_report_subject: 'Your vehicle inspection report',
    email_report_body: 'Hi {first_name},\n\nPlease find your vehicle inspection report attached. Happy to talk through anything in it.',

    // Quick replies to website enquiries. The greeting ("Hi Sam,") goes above
    // and the signature below automatically.
    tpl_reply_service: "We can book you in for a standard (regular) service for ${price}, completed mobile at your location.\n\nThis service includes:\n• Oil and filter change\n• Fluids inspected and topped up as required\n• Brake and safety check\n• Cooling and charging system checks\n• Filter checks\n• Spark plug checks\n• Logbook stamped\n• Labour and mobile service\n\nIf you'd like to proceed, please reply with your preferred day and address, and we'll lock in a booking.",
    tpl_reply_diagnostic: "We can book it in for diagnosis which is ${price}, find out what needs to be done and go from there.\n\nPlease let us know if you'd like to proceed with the booking.",
    // Text message templates, complete messages
    tpl_sms_website: 'Hi {first_name}, thank you for getting in touch with {business}. So we can provide an accurate quote, please share your vehicle and job details through our online form here: {form_link} . We will get back to you shortly. Kind regards, {sender}',
    tpl_sms_service: 'Hi {first_name}, thank you for reaching out to {business}. We can book you in for a standard (regular) service for ${price}, completed mobile at your location. Please reply with your preferred day and address and we will lock it in. Kind regards, {sender}',
    tpl_sms_diagnostic: 'Hi {first_name}, thank you for reaching out to {business}. We can book in a diagnostic for ${price} to find out what needs doing, then quote the repair from there. Please let us know if you would like to proceed. Kind regards, {sender}',

    // Calendar
    calendar_default_minutes: '60',
    calendar_day_start: '6',          // first hour shown on the Day timeline
    calendar_day_end: '20',           // last hour shown
    calendar_snap: '15',              // minutes a dragged booking snaps to
    calendar_default_view: 'day',

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
    CONFIG.SENDER_NAME = S.sender_name || 'Ashley';
  }

  /* ---------------------------------------------------------- helpers -- */

  const val = (k) => (S[k] !== undefined && S[k] !== null && S[k] !== '' ? S[k] : DEFAULTS[k]);
  const prettyPhone = (p) => {
    const d = String(p || '').replace(/^\+?61/, '0').replace(/\s+/g, '');
    return d.length === 10 ? d.slice(0, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : String(p || '');
  };
  /* Fill {placeholders}. Unknown ones are left as typed so a typo shows up
     in the preview instead of vanishing. */
  function fill(template, vars) {
    const all = Object.assign({
      business: val('business_name'), phone: prettyPhone(val('business_phone')), email: val('business_email'),
      website: val('business_website'), sender: val('sender_name'), form_link: val('website_form_url'),
    }, vars || {});
    return String(template == null ? '' : template).replace(/\{(\w+)\}/g, (m, k) => (all[k] != null && all[k] !== '' ? String(all[k]) : m));
  }
  /* The one signature used on every email the app sends. */
  function signature() {
    return '\n\nThank you,\n' + val('sender_name') + '\n' + val('business_name')
      + '\nM: ' + prettyPhone(val('business_phone')) + '\nE: ' + val('business_email');
  }
  /* Business details as the PDF layouts want them. */
  function business() {
    const b = {
      name: val('business_name'),
      tagline: String(val('business_tagline') || '').toUpperCase(),
      phone: val('business_phone'),
      email: val('business_email'),
      website: val('business_website'),
      abn: val('business_abn'),
      signoff: S.invoice_signoff === '' ? '' : val('invoice_signoff'),
      statement: val('report_statement'),
      bank: null,
    };
    const showBank = S.invoice_show_bank === undefined ? DEFAULTS.invoice_show_bank : (S.invoice_show_bank === true || S.invoice_show_bank === 'true');
    if (showBank && (val('bank_bsb') || val('bank_account'))) {
      b.bank = { name: val('bank_name'), bsb: val('bank_bsb'), account: val('bank_account') };
    }
    return b;
  }
  const lines = (k) => String(val(k) || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

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
    /* Resetting one page's values without touching the rest. */
    resetKeys: (keys) => save(keys.reduce((o, k) => { o[k] = DEFAULTS[k]; return o; }, {})),
    text: (key, vars) => fill(val(key), vars),
    fill,
    signature,
    business,
    lines,
    prettyPhone,
  };
})();
