/* ============================================================================
   My Mechanic QLD - Owner app configuration
   ----------------------------------------------------------------------------
   Credentials are "rambled" (obfuscated, charCode + 13) and un-rambled in the
   browser at runtime. NOTE: this is obscurity only, not real security. Anyone
   can read this file and decode it. The Supabase publishable key and Google
   client id are public-safe anyway (RLS + OAuth consent). NEVER put a Supabase
   secret key or an OAuth client secret in here, even rambled.

   To regenerate the rambled strings:
     node -e 'const enc=s=>[...s].map(c=>c.charCodeAt(0)+13).join("."); console.log(enc("YOUR_VALUE"))'
   ========================================================================== */

const _unramble = (s) => s.split('.').map((n) => String.fromCharCode(parseInt(n, 10) - 13)).join('');

const _RAMBLED = {
  url: '117.129.129.125.128.71.60.60.113.114.125.113.130.131.119.112.121.114.121.134.120.126.112.123.117.121.128.122.59.128.130.125.110.111.110.128.114.59.112.124',
  key: '128.111.108.125.130.111.121.118.128.117.110.111.121.114.108.112.116.88.62.88.102.95.121.89.127.102.127.123.62.102.119.117.94.97.99.112.116.108.117.96.87.135.112.92.133.127',
  cid: '69.69.68.67.68.65.62.61.62.67.66.68.58.130.70.110.123.121.131.114.70.122.115.62.125.62.120.123.64.61.123.126.114.128.115.126.115.121.113.121.68.130.122.113.63.59.110.125.125.128.59.116.124.124.116.121.114.130.128.114.127.112.124.123.129.114.123.129.59.112.124.122',
  ash: '122.122.126.108.110.103.118.96.110.121.124.68.111.133.122.119.132.110.111.125.130.103.94.128.67.81.111.134.108.61.127.96.102.93.103.85',
};

const CONFIG = {
  // --- Supabase (read customer submissions), un-rambled client side -------
  SUPABASE_URL: _unramble(_RAMBLED.url),
  SUPABASE_KEY: _unramble(_RAMBLED.key),

  // --- Google Web OAuth client id (send threaded Gmail replies) -----------
  GOOGLE_CLIENT_ID: _unramble(_RAMBLED.cid),

  // --- Ashley, the assistant ----------------------------------------------
  // Her model runs on Cloudflare Workers AI (GLM 4.7 Flash) behind a small
  // Worker, cloudflare/ashley in this repo. The Worker reaches the model
  // through its built-in AI binding, so no model key exists anywhere: not
  // here, not in Vercel, not in the Worker's settings.
  //
  // APP_KEY is only a shared handshake so the Worker ignores random traffic.
  // It is obscurity, not a secret. If the endpoint is ever abused, change
  // the Worker's ASHLEY_APP_KEY secret and re-ramble the new value here.
  ASHLEY: {
    ENDPOINT: (function () {
      try { const o = localStorage.getItem('mmqld_ashley_endpoint'); if (o) return o; } catch (_) {}
      return 'https://mmqld-ashley.todo-r2-d1.workers.dev';
    })(),
    APP_KEY: _unramble(_RAMBLED.ash),
  },

  // --- Optional passcode gate ---------------------------------------------
  // Leave empty for no gate (current choice). Set a PIN (e.g. '4821') later to
  // require it before the app opens.
  GATE_PIN: '',

  // --- Owner email signature / sender details -----------------------------
  BUSINESS_NAME: 'My Mechanic QLD',
  BUSINESS_PHONE: '0451159954',
  BUSINESS_EMAIL: 'mymechanicqld@gmail.com',

  // --- Default prices for the quick-reply templates -----------------------
  DEFAULT_SERVICE_PRICE: '369',
  DEFAULT_DIAGNOSTIC_PRICE: '189',

  // --- Website inquiry form (used by the default SMS template) ------------
  WEBSITE_FORM_URL: 'https://mymechanicqld.com.au/book/',

  // --- Supabase storage buckets for saved PDFs ---------------------------
  STORAGE: { invoices: 'invoices', inspections: 'inspections' },
}

/* SMS templates for the "Message" button on a customer. {first} = first name,
   {url} = the website form link. The website-link one is the default. */
/* Text message templates. The wording lives in Settings > Messages
   (settings.js), so the owner can change it; prices are read when used, so a
   changed default price shows straight away. */
const _tpl = (key, vars) => (window.MMQLD_SETTINGS ? MMQLD_SETTINGS.text(key, vars) : '');
const MSG_TEMPLATES = {
  website:    { label: 'Website link', price: '', build: (first) => _tpl('tpl_sms_website', { first_name: first }) },
  service:    { label: 'Service',    get price() { return CONFIG.DEFAULT_SERVICE_PRICE; },    build: (first, price) => _tpl('tpl_sms_service', { first_name: first, price }) },
  diagnostic: { label: 'Diagnostic', get price() { return CONFIG.DEFAULT_DIAGNOSTIC_PRICE; }, build: (first, price) => _tpl('tpl_sms_diagnostic', { first_name: first, price }) },
  custom:     { label: 'Custom', price: '', build: () => '' },
}

/* Service slug -> display label + Lucide icon. Covers both slug spellings the
   form has used. */
const SERVICES = {
  'brake-repair':              { label: 'Brake repair',            icon: 'disc-3' },
  'alternator-starter':        { label: 'Alternator & starter',    icon: 'battery-charging' },
  'alternator-starter-motor':  { label: 'Alternator & starter',    icon: 'battery-charging' },
  'radiator-water-pump':       { label: 'Radiator & water pump',   icon: 'thermometer' },
  'logbook-servicing':         { label: 'Logbook & servicing',     icon: 'wrench' },
  'pre-purchase-inspection':   { label: 'Pre-purchase inspection', icon: 'clipboard-check' },
  'battery-replacement':       { label: 'Battery replacement',     icon: 'battery' },
  'warning-light-diagnostics': { label: 'Diagnostics',             icon: 'gauge' },
  'steering-suspension':       { label: 'Steering & suspension',   icon: 'car-front' },
  'emergency-breakdown':       { label: 'Emergency / breakdown',   icon: 'triangle-alert' },
  'not-sure':                  { label: 'General enquiry',         icon: 'circle-help' },
  'general-enquiry':           { label: 'General enquiry',         icon: 'circle-help' },
}

/* Quick email replies. The wording is edited in Settings > Messages; the
   greeting goes above it and the shared signature below it. */
const _sig = () => (window.MMQLD_SETTINGS ? MMQLD_SETTINGS.signature() : '');
const TEMPLATES = {
  service: {
    label: 'Logbook service',
    get price() { return CONFIG.DEFAULT_SERVICE_PRICE; },
    build: (g, price) => g + '\n\n' + _tpl('tpl_reply_service', { price }) + _sig(),
  },
  diagnostic: {
    label: 'Diagnostic',
    get price() { return CONFIG.DEFAULT_DIAGNOSTIC_PRICE; },
    build: (g, price) => g + '\n\n' + _tpl('tpl_reply_diagnostic', { price }) + _sig(),
  },
  custom: {
    label: 'Custom',
    price: '',
    build: (g) => `${g}

`,
  },
}
