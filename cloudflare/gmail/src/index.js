/* ============================================================================
   Gmail connection keeper
   ----------------------------------------------------------------------------
   The app signs in to Gmail in the browser. Browser-only Google sign-in only
   ever gives a one-hour access token with no way to renew it quietly, so
   after an hour every Send opened Google's sign-in again (on an iPhone home
   screen app, often a full login). This Worker fixes that:

     POST /connect     { code }  one-time, from a tap. Swaps Google's
                       authorisation code (offline access) for a refresh
                       token, checks it is the business mailbox, stores the
                       refresh token encrypted, and gives this phone a device
                       key plus a first access token.
     POST /token       header X-Device-Key. Returns a fresh one-hour access
                       token, no popup. Reuses one until 5 minutes before it
                       expires so Google is not asked on every send.
     POST /disconnect  header X-Device-Key. Forgets this phone.
     POST /forget-all  header X-Device-Key. Forgets every phone and the
                       refresh token (sign in again from scratch).

   The refresh token never leaves Cloudflare. A phone only holds its device
   key, a random secret this Worker made at connect time; only a phone that
   signed in to the business Google account gets one. Device keys are stored
   as SHA-256 hashes.

   Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_KEY. Var:
   ALLOWED_EMAIL. KV: refresh token (AES-GCM encrypted), cached access
   token, device hashes.
   ========================================================================== */

const ORIGINS = new Set([
  'https://mmqld-app.vercel.app',
  'https://mymechanicqld.github.io',
  'http://localhost:8771',
  'http://127.0.0.1:8771',
]);

function cors(origin) {
  const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Key', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (origin && ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const reply = (status, data, origin) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) } });

/* ------------------------------------------------------------- crypto -- */
const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
async function sha256(s) { return b64u(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function aesKey(env) { return crypto.subtle.importKey('raw', unb64u(env.TOKEN_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']); }
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(text));
  return b64u(iv) + '.' + b64u(ct);
}
async function open(env, sealed) {
  const [iv, ct] = sealed.split('.');
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(env), unb64u(ct)));
}

/* ------------------------------------------------------------- google -- */
async function google(env, params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}
async function mailboxOf(accessToken) {
  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: 'Bearer ' + accessToken } });
  if (!r.ok) return '';
  return String((await r.json()).emailAddress || '').toLowerCase();
}

async function cacheAccess(env, token, expiresIn) {
  const e = Date.now() + (Number(expiresIn) || 3600) * 1000;
  await env.KV.put('gmail:access', JSON.stringify({ t: token, e }), { expirationTtl: Math.max(60, (Number(expiresIn) || 3600) - 60) });
  return { access_token: token, expires_at: e };
}

/* A fresh access token from the stored refresh token. */
async function freshAccess(env) {
  const cached = await env.KV.get('gmail:access', 'json');
  if (cached && cached.t && cached.e - Date.now() > 5 * 60e3) return { access_token: cached.t, expires_at: cached.e };
  const sealed = await env.KV.get('gmail:refresh');
  if (!sealed) return { error: 'not_connected' };
  const g = await google(env, { grant_type: 'refresh_token', refresh_token: await open(env, sealed) });
  if (!g.ok) {
    // invalid_grant: the owner removed access in Google, changed the password,
    // or the OAuth app is still in Testing (refresh tokens last 7 days there).
    if (g.j.error === 'invalid_grant') { await env.KV.delete('gmail:refresh'); await env.KV.delete('gmail:access'); return { error: 'not_connected' }; }
    return { error: 'google_' + (g.j.error || g.status) };
  }
  return cacheAccess(env, g.j.access_token, g.j.expires_in);
}

async function deviceOk(env, key) {
  if (!key || key.length < 20) return false;
  return !!(await env.KV.get('dev:' + (await sha256(key))));
}

/* ------------------------------------------------------------- routes -- */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' }, origin);
    if (origin && !ORIGINS.has(origin)) return reply(403, { error: 'Origin not allowed' }, origin);
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_KEY || !env.KV) return reply(503, { error: 'not_configured' }, origin);
    const path = new URL(request.url).pathname;

    try {
      if (path === '/connect') {
        const body = await request.json().catch(() => ({}));
        if (!body.code) return reply(400, { error: 'missing_code' }, origin);
        // "postmessage" is the redirect for Google's popup code flow.
        const g = await google(env, { grant_type: 'authorization_code', code: body.code, redirect_uri: 'postmessage' });
        if (!g.ok) return reply(400, { error: 'google_' + (g.j.error || g.status), detail: g.j.error_description || '' }, origin);
        const who = await mailboxOf(g.j.access_token);
        if (who !== String(env.ALLOWED_EMAIL).toLowerCase()) return reply(403, { error: 'wrong_account', account: who }, origin);
        if (g.j.refresh_token) {
          await env.KV.put('gmail:refresh', await seal(env, g.j.refresh_token));
        } else if (!(await env.KV.get('gmail:refresh'))) {
          // Google only hands out a refresh token the first time offline access is granted.
          return reply(409, { error: 'no_refresh_token' }, origin);
        }
        const key = b64u(crypto.getRandomValues(new Uint8Array(32)));
        await env.KV.put('dev:' + (await sha256(key)), JSON.stringify({ at: new Date().toISOString(), ua: String(request.headers.get('User-Agent') || '').slice(0, 160) }));
        const acc = await cacheAccess(env, g.j.access_token, g.j.expires_in);
        return reply(200, { device_key: key, account: who, ...acc }, origin);
      }

      const key = request.headers.get('X-Device-Key') || '';
      if (!(await deviceOk(env, key))) return reply(401, { error: 'unknown_device' }, origin);

      if (path === '/token') {
        const r = await freshAccess(env);
        if (r.error) return reply(r.error === 'not_connected' ? 401 : 502, r, origin);
        return reply(200, r, origin);
      }
      if (path === '/disconnect') {
        await env.KV.delete('dev:' + (await sha256(key)));
        return reply(200, { ok: true }, origin);
      }
      if (path === '/forget-all') {
        const list = await env.KV.list({ prefix: 'dev:' });
        await Promise.all(list.keys.map((k) => env.KV.delete(k.name)));
        await env.KV.delete('gmail:refresh'); await env.KV.delete('gmail:access');
        return reply(200, { ok: true, devices: list.keys.length }, origin);
      }
      return reply(404, { error: 'not_found' }, origin);
    } catch (e) {
      console.error('[gmail]', String((e && e.message) || e).slice(0, 200));
      return reply(500, { error: 'server_error' }, origin);
    }
  },
};
