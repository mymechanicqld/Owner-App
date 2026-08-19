/* ============================================================================
   Ashley model proxy
   ----------------------------------------------------------------------------
   A Vercel serverless function that ships with this app, so the browser calls
   /api/ashley on its own origin. Everything else here exists because this
   repository is PUBLIC:

     - The OpenRouter key stays server side, in this Vercel project's
       environment variables. A key committed to a public repo gets scraped and
       drained within days.
     - No attribution headers. OpenRouter's optional "HTTP-Referer" and
       "X-Title" would put this app's name and URL on their dashboard and
       public rankings, so they are deliberately omitted.
     - provider.data_collection: "deny" keeps the request on providers that do
       not retain or train on it. Customer names and email addresses travel in
       these conversations, so this is not optional.
     - The model and the token ceiling are fixed here, never taken from the
       caller, so a tampered client cannot swap in something expensive.

   Environment variables (Vercel > Settings > Environment Variables):
     OPENROUTER_API_KEY   required, the sk-or-v1-... key
     ASHLEY_APP_KEY       required, shared handshake the app sends back
     ASHLEY_MODEL         optional, defaults to google/gemini-3.7-flash
   ========================================================================== */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-3.7-flash';

/* Same-origin is the normal case. The others cover the old GitHub Pages copy
   of this app while it is still around, and local development. Origin is
   trivially forged outside a browser, so it is a filter and not the security
   boundary; ASHLEY_APP_KEY is. */
const EXTRA_ORIGINS = new Set([
  'https://mymechanicqld.github.io',
  'http://localhost:8771',
  'http://127.0.0.1:8771',
]);

const MAX_MESSAGES = 60;
const MAX_TOOLS = 30;
const MAX_BODY_BYTES = 400000;
const MAX_OUTPUT_TOKENS = 2000;

/* Coarse per-IP throttle. Vercel may run several instances, so this is a speed
   bump against a runaway loop rather than a hard quota. Real abuse is answered
   by rotating ASHLEY_APP_KEY. */
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 40;
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  }
  return recent.length > MAX_PER_WINDOW;
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return null;                       // same-origin request with no Origin header
  try {
    if (new URL(origin).host === req.headers.host) return origin;   // same origin
  } catch (_) { /* malformed Origin */ }
  return EXTRA_ORIGINS.has(origin) ? origin : false;
}

function setCors(res, origin) {
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Ashley-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

module.exports = async function handler(req, res) {
  const origin = allowedOrigin(req);
  setCors(res, origin || undefined);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (origin === false) return res.status(403).json({ error: 'Origin not allowed' });

  const appKey = process.env.ASHLEY_APP_KEY;
  const orKey = process.env.OPENROUTER_API_KEY;
  if (!appKey || !orKey) return res.status(503).json({ error: 'Assistant is not configured yet' });
  if (req.headers['x-ashley-key'] !== appKey) return res.status(401).json({ error: 'Not authorised' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many requests, give it a moment' });

  const incoming = typeof req.body === 'string' ? safeJson(req.body) : req.body;
  if (!incoming) return res.status(400).json({ error: 'Malformed request' });
  if (JSON.stringify(incoming).length > MAX_BODY_BYTES) return res.status(413).json({ error: 'Conversation too large' });

  const messages = incoming.messages;
  if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'No messages supplied' });
  if (messages.length > MAX_MESSAGES) return res.status(400).json({ error: 'Conversation too long' });

  const tools = Array.isArray(incoming.tools) ? incoming.tools.slice(0, MAX_TOOLS) : undefined;

  const body = {
    model: process.env.ASHLEY_MODEL || DEFAULT_MODEL,
    messages,
    temperature: typeof incoming.temperature === 'number' ? Math.min(Math.max(incoming.temperature, 0), 1) : 0.3,
    max_tokens: Math.min(Number(incoming.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    provider: { data_collection: 'deny' },
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50000);
  try {
    const upstream = await fetch(OPENROUTER_URL, {
      method: 'POST',
      // No HTTP-Referer / X-Title on purpose. See the header comment.
      headers: { Authorization: 'Bearer ' + orKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      // Surface the shape of the failure, never the provider's body: it can
      // quote the request back, customer details and all.
      console.error('[ashley] OpenRouter %d: %s', upstream.status, text.slice(0, 300));
      return res.status(upstream.status === 429 ? 429 : 502).json({
        error: upstream.status === 429
          ? 'The model is rate limited right now, try again shortly'
          : 'The model provider is having trouble, try again shortly',
      });
    }
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(text);
  } catch (err) {
    const aborted = err && err.name === 'AbortError';
    console.error('[ashley] request failed:', err);
    return res.status(504).json({ error: aborted ? 'The model took too long, try again' : 'Could not reach the model' });
  } finally {
    clearTimeout(timer);
  }
};

function safeJson(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}
