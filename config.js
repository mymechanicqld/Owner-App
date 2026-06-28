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
};

const CONFIG = {
  // --- Supabase (read customer submissions), un-rambled client side -------
  SUPABASE_URL: _unramble(_RAMBLED.url),
  SUPABASE_KEY: _unramble(_RAMBLED.key),

  // --- Google Web OAuth client id (send threaded Gmail replies) -----------
  GOOGLE_CLIENT_ID: _unramble(_RAMBLED.cid),

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
const MSG_TEMPLATES = {
  website: {
    label: 'Website link',
    build: (first) =>
`Hi ${first}, thanks for reaching out to My Mechanic QLD. The quickest way for us to get you a price is to pop your car and job details in here: ${CONFIG.WEBSITE_FORM_URL} . Takes a minute and we will get straight back to you. Thanks, Ashley`,
  },
  callback: {
    label: 'Quick call',
    build: (first) =>
`Hi ${first}, it is Ashley from My Mechanic QLD returning your enquiry. Are you free for a quick call to sort out your booking? Thanks.`,
  },
  custom: { label: 'Custom', build: () => '' },
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

/* Quick-reply templates. {greeting} and {price} are filled in by the app.
   These mirror the owner's official wording from the email-assistant rulebook. */
const TEMPLATES = {
  service: {
    label: 'Logbook service',
    price: CONFIG.DEFAULT_SERVICE_PRICE,
    build: (g, price) =>
`${g}

We can book you in for a standard (regular) service for $${price}, completed mobile at your location.

This service includes:
• Oil and filter change
• Fluids inspected and topped up as required
• Brake and safety check
• Cooling and charging system checks
• Filter checks
• Spark plug checks
• Logbook stamped
• Labour and mobile service

If you'd like to proceed, please reply with your preferred day and address, and we'll lock in a booking.

Thank you,
Ashley
${CONFIG.BUSINESS_NAME}
M: ${CONFIG.BUSINESS_PHONE}
E: ${CONFIG.BUSINESS_EMAIL}`,
  },
  diagnostic: {
    label: 'Diagnostic',
    price: CONFIG.DEFAULT_DIAGNOSTIC_PRICE,
    build: (g, price) =>
`${g}

We can book it in for diagnosis which is $${price}, find out what needs to be done and go from there.

Please let us know if you'd like to proceed with the booking.

Thank you,
Ashley
${CONFIG.BUSINESS_NAME}
M: ${CONFIG.BUSINESS_PHONE}
E: ${CONFIG.BUSINESS_EMAIL}`,
  },
  custom: {
    label: 'Custom',
    price: '',
    build: (g) => `${g}

`,
  },
}
