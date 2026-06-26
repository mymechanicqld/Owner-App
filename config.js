/* ============================================================================
   My Mechanic QLD - Owner app configuration
   ----------------------------------------------------------------------------
   Edit this one file to point the app at your accounts. It is safe for the
   Supabase publishable key and the Google client id to be public (they rely on
   Row Level Security and OAuth consent). Never put a Supabase SECRET key or any
   API secret in here, this file ships to the browser.
   ========================================================================== */

const CONFIG = {
  // --- Supabase (read customer submissions) -------------------------------
  // After you rotate keys, paste the new URL + publishable key here.
  SUPABASE_URL: 'https://depduvjclelykqcnhlsm.supabase.co',
  SUPABASE_KEY: 'sb_publishable_cgK1KYRlLrYrn1YjhQTVcg_hSJzcOxr',

  // --- Google (send threaded Gmail replies from the browser) --------------
  // Create a "Web application" OAuth client (see README), add your GitHub Pages
  // URL as an authorised JavaScript origin, then paste the client id here.
  GOOGLE_CLIENT_ID: 'PASTE_YOUR_WEB_OAUTH_CLIENT_ID.apps.googleusercontent.com',

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
