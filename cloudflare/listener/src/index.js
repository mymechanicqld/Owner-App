/* ============================================================================
   The listener: a Worker that keeps an eye on the business every minute and
   tells the owner's phone when something needs him.

   Jobs, run every minute by a cron trigger:
     newEnquiries   new website enquiries from Supabase. Waits for the DIY
                    check (cloudflare/triage) so the alert can say "Likely
                    DIY", and skips spam (casino ads and the like) with one
                    cheap Clef-flash question.
     customerReplies new emails in the business inbox that belong to a
                    conversation we have already written in (a customer
                    answering us). Website notifications, newsletters and
                    bounces are ignored.
   More jobs can be added to JOBS below.

   Phones sign up from Settings > Notifications (POST /subscribe). Only a
   phone that has connected the business Gmail (it holds a device key the
   Gmail Worker recognises) can sign up, because alerts carry customer names.
   Alerts are Web Push messages, encrypted end to end (webpush.js).

   Free plan budget, by design:
     - cron once a minute: 1,440 runs a day of the 100,000 allowed
     - KV writes only when something changed (new enquiry, new mail, a phone
       signing up), a few dozen a day of the 1,000 allowed. Never per minute.
     - KV reads: about 3 a minute, 4,300 a day of the 100,000 allowed
     - CPU: almost all waiting on the network, which does not count
     - Clef-flash: one spam question per enquiry, under one neuron

   Bindings: KV (state and phone subscriptions), AI, GMAIL (service binding
   to mmqld-gmail). Secrets: SUPABASE_URL, SUPABASE_KEY, INTERNAL_KEY,
   VAPID_PRIVATE_JWK. Vars: VAPID_PUBLIC, VAPID_SUBJECT, APP_URL.
   ========================================================================== */
import { sendPush } from './webpush.js';

const ORIGINS = new Set(['https://mmqld-app.vercel.app', 'https://mymechanicqld.github.io', 'http://localhost:8771', 'http://127.0.0.1:8771']);
const cors = (origin) => {
  const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Device-Key', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (origin && ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
};
const reply = (status, data, origin) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) } });

const DIY_MIN = 0.6, STARTED_MIN = 0.8;      // same cut-offs as the app (app.js)
const SPAM_MAX = 0.7;
const ROBOT = /mailer-daemon|postmaster|no-?reply|do-?not-?reply|notifications?@|resend\.dev|bookings@mymechanicqld/i;

/* ------------------------------------------------------------- helpers -- */
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const sb = (env, path) => fetch(env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path, { headers: { apikey: env.SUPABASE_KEY } });
async function gmailInternal(env, path, body) {
  const r = await env.GMAIL.fetch('https://mmqld-gmail/internal/' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.INTERNAL_KEY },
    body: JSON.stringify(body || {}),
  });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
const label = (slug) => String(slug || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const nameOf = (from) => { const m = String(from || '').match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/); return (m && m[1].trim()) || String(from || '').replace(/[<>]/g, '').trim(); };

/* --------------------------------------------------------- subscribers -- */
// All phones in one KV key, so a run costs one read and a sign-up one write.
async function getSubs(env) { return (await env.KV.get('subs', 'json')) || []; }
async function putSubs(env, subs) { await env.KV.put('subs', JSON.stringify(subs)); }

async function notify(env, kind, data) {
  const subs = await getSubs(env);
  let changed = false, sent = 0;
  for (const s of subs) {
    if (s.prefs && s.prefs[kind] === false) continue;
    try {
      const status = await sendPush(env, s.sub, data);
      if (status === 404 || status === 410) { s.gone = true; changed = true; }
      else if (status < 300) sent++;
      else console.error('[listener] push', status);
    } catch (e) { console.error('[listener] push failed', String(e.message || e).slice(0, 120)); }
  }
  if (changed) await putSubs(env, subs.filter((s) => !s.gone));
  return sent;
}

/* ---------------------------------------------------- job: enquiries -- */
async function newEnquiries(env) {
  const state = await env.KV.get('state:enq', 'json');
  if (!state) {
    // First run: start from now, so switching this on does not replay history.
    await env.KV.put('state:enq', JSON.stringify({ after: new Date().toISOString() }));
    return { started: true };
  }
  const r = await sb(env, 'quote_submissions?select=id,created_at,full_name,service_needed,suburb,symptoms,vehicle_rego,ai_diy_score,ai_started_score,ai_checked_at'
    + '&created_at=gt.' + encodeURIComponent(state.after) + '&order=created_at.asc&limit=10');
  if (!r.ok) throw new Error('supabase ' + r.status);
  const rows = await r.json();
  let after = state.after, sent = 0, skipped = 0;
  for (const row of rows) {
    // Give the DIY check up to three minutes so the alert can carry its result.
    if (!row.ai_checked_at && Date.now() - new Date(row.created_at).getTime() < 3 * 60e3) break;
    after = row.created_at;
    if (await looksLikeSpam(env, row)) { skipped++; continue; }
    const diy = (row.ai_diy_score >= DIY_MIN) || (row.ai_started_score >= STARTED_MIN);
    const bits = [label(row.service_needed), row.suburb, diy ? 'Likely DIY' : ''].filter(Boolean).join(' · ');
    sent += await notify(env, 'enquiries', {
      title: 'New enquiry: ' + clip(row.full_name || 'Someone', 40),
      body: bits + (row.symptoms ? '\n' + clip(row.symptoms, 110) : ''),
      url: '/?open=' + encodeURIComponent(row.id),
      tag: 'enq-' + row.id,
    });
  }
  if (after !== state.after) await env.KV.put('state:enq', JSON.stringify({ after }));
  return { found: rows.length, sent, spam: skipped };
}

async function looksLikeSpam(env, row) {
  try {
    const state = 'Name: ' + (row.full_name || '') + '\nService requested: ' + label(row.service_needed) + '\nSuburb: ' + (row.suburb || '') + '\nMessage: ' + clip(row.symptoms || '(none)', 600);
    const res = await env.AI.run('@cf/cloudflare/clef-flash', { state, questions: { spam: { type: 'noul', instructions: 'Is this spam, advertising, or a message that is not a genuine person asking a mechanic about their vehicle?' } } });
    return res.answers.spam.noul >= SPAM_MAX;
  } catch (_) { return false; }            // when in doubt, tell the owner
}

/* ------------------------------------------------ job: customer replies -- */
async function customerReplies(env) {
  const t = await gmailInternal(env, 'token');
  if (t.status !== 200 || !t.j.access_token) return { skipped: 'gmail not connected' };
  const g = (path) => fetch('https://gmail.googleapis.com/gmail/v1/users/me' + path, { headers: { Authorization: 'Bearer ' + t.j.access_token } });

  const state = await env.KV.get('state:gmail', 'json');
  if (!state) {
    const p = await (await g('/profile')).json();
    await env.KV.put('state:gmail', JSON.stringify({ history: p.historyId, me: String(p.emailAddress || '').toLowerCase() }));
    return { started: true };
  }
  const h = await g('/history?historyTypes=messageAdded&labelId=INBOX&startHistoryId=' + state.history);
  if (h.status === 404) {
    // Too old to resume (about a week offline): start again from now.
    const p = await (await g('/profile')).json();
    await env.KV.put('state:gmail', JSON.stringify({ ...state, history: p.historyId }));
    return { reset: true };
  }
  if (!h.ok) throw new Error('gmail history ' + h.status);
  const hist = await h.json();
  const ids = [];
  for (const rec of hist.history || []) for (const a of rec.messagesAdded || []) {
    const m = a.message;
    if (m && (m.labelIds || []).includes('INBOX') && !(m.labelIds || []).includes('SENT') && !ids.find((x) => x.id === m.id)) ids.push(m);
  }
  if (!ids.length) return { found: 0 };     // nothing new: no KV write

  let sent = 0;
  for (const m of ids.slice(0, 10)) {       // stays well inside 50 subrequests a run
    const meta = await (await g('/messages/' + m.id + '?format=metadata&metadataHeaders=From&metadataHeaders=Subject')).json();
    const hd = {}; ((meta.payload && meta.payload.headers) || []).forEach((x) => { hd[x.name.toLowerCase()] = x.value; });
    const from = String(hd.from || '');
    if (ROBOT.test(from) || from.toLowerCase().includes(state.me)) continue;
    // A reply to us: the conversation already has something we sent.
    const th = await (await g('/threads/' + meta.threadId + '?format=minimal')).json();
    if (!(th.messages || []).some((x) => (x.labelIds || []).includes('SENT'))) continue;
    sent += await notify(env, 'replies', {
      title: 'Reply from ' + clip(nameOf(from), 40),
      body: clip(meta.snippet || hd.subject || '', 140),
      url: '/?thread=' + encodeURIComponent(meta.threadId),
      tag: 'mail-' + meta.threadId,
    });
  }
  await env.KV.put('state:gmail', JSON.stringify({ ...state, history: hist.historyId || state.history }));
  return { found: ids.length, sent };
}

const JOBS = { newEnquiries, customerReplies };

async function runJobs(env) {
  const out = {};
  for (const [name, job] of Object.entries(JOBS)) {
    try { out[name] = await job(env); } catch (e) { out[name] = { error: String(e.message || e).slice(0, 160) }; console.error('[listener]', name, out[name].error); }
  }
  return out;
}

/* ------------------------------------------------------------- routes -- */
async function deviceHash(env, request) {
  const key = request.headers.get('X-Device-Key') || '';
  if (key.length < 20) return null;
  const r = await gmailInternal(env, 'device', { device_key: key });
  return r.j && r.j.ok ? r.j.hash : null;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runJobs(env));
  },

  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/') return new Response('ok');
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' }, origin);
    if (origin && !ORIGINS.has(origin)) return reply(403, { error: 'Origin not allowed' }, origin);

    // Operator check from the harness: run the jobs now and see the result.
    if (path === '/run' && env.INTERNAL_KEY && request.headers.get('X-Internal-Key') === env.INTERNAL_KEY) return reply(200, await runJobs(env), origin);

    const dev = await deviceHash(env, request);
    if (!dev) return reply(401, { error: 'connect_gmail_first' }, origin);
    const body = await request.json().catch(() => ({}));

    if (path === '/subscribe') {
      const sub = body.subscription;
      if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return reply(400, { error: 'bad_subscription' }, origin);
      const prefs = { enquiries: body.prefs ? body.prefs.enquiries !== false : true, replies: body.prefs ? body.prefs.replies !== false : true };
      const id = await sha256(sub.endpoint);
      const subs = (await getSubs(env)).filter((s) => s.id !== id);
      subs.push({ id, dev, sub: { endpoint: sub.endpoint, keys: sub.keys }, prefs, at: new Date().toISOString() });
      await putSubs(env, subs);
      return reply(200, { ok: true, prefs }, origin);
    }
    if (path === '/unsubscribe') {
      const id = body.endpoint ? await sha256(body.endpoint) : '';
      const subs = await getSubs(env);
      const keep = subs.filter((s) => s.id !== id);
      if (keep.length !== subs.length) await putSubs(env, keep);
      return reply(200, { ok: true }, origin);
    }
    if (path === '/test') {
      const id = body.endpoint ? await sha256(body.endpoint) : '';
      const s = (await getSubs(env)).find((x) => x.id === id);
      if (!s) return reply(404, { error: 'not_subscribed' }, origin);
      const status = await sendPush(env, s.sub, { title: 'Notifications are on', body: 'New enquiries and customer replies will show up here.', url: '/', tag: 'test' }, 600);
      return reply(status < 300 ? 200 : 502, { push_status: status }, origin);
    }
    if (path === '/run') return reply(200, await runJobs(env), origin);   // a connected phone may trigger a check
    return reply(404, { error: 'not_found' }, origin);
  },
};
