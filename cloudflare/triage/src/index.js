/* ============================================================================
   Inquiry triage: is this a "likely DIY" job?
   ----------------------------------------------------------------------------
   Every minute, picks up website inquiries from the last WINDOW_HOURS that
   have not been checked yet, asks Cloudflare's Clef-flash decision model how
   likely it is that the customer is supplying their own parts and only wants
   them fitted, and writes the probability back to the inquiry:

     ai_diy_score    0 to 1 (the owner app labels 0.6 and above "Likely DIY")
     ai_checked_at   when it was checked
     ai_model        which model scored it

   The business does not fit customer-supplied parts, so these can be
   declined quickly (the app has a ready reply, and Ashley can see the flag).

   Clef-flash is a decision model, not a chatbot: it takes the inquiry text
   ("state") and a typed question, and returns a calibrated probability. It
   bills input tokens only: an inquiry is about 200 tokens, under one neuron.
   Checked on 400 real inquiries (Oct 2026): every inquiry scoring 0.76 or
   more said they had or would supply the part; the next score down was 0.33.

   Secrets: SUPABASE_URL, SUPABASE_KEY (the publishable key the app uses; the
   anon role may update inquiries), RUN_KEY (POST /run to trigger a pass now).
   ========================================================================== */

const MODEL = '@cf/cloudflare/clef-flash';
const BATCH = 25;

const QUESTIONS = {
  diy: {
    type: 'noul',
    instructions: 'Does the customer say they already have, or will supply, their own parts and only want us to fit or install them?',
  },
};

const rest = (env, path) => env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/' + path;
const sbHeaders = (env, extra) => ({ apikey: env.SUPABASE_KEY, 'Content-Type': 'application/json', ...(extra || {}) });

function stateFor(row) {
  const service = String(row.service_needed || 'not given').replace(/-/g, ' ');
  return 'Service requested: ' + service + '\nCustomer notes: ' + (String(row.symptoms || '').trim() || '(none)');
}

async function pass(env) {
  const since = new Date(Date.now() - Number(env.WINDOW_HOURS || 48) * 3600e3).toISOString();
  const q = 'quote_submissions?select=id,service_needed,symptoms&ai_checked_at=is.null&created_at=gte.'
    + encodeURIComponent(since) + '&order=created_at.asc&limit=' + BATCH;
  const r = await fetch(rest(env, q), { headers: sbHeaders(env) });
  if (!r.ok) throw new Error('read inquiries ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const rows = await r.json();
  const done = [];
  for (const row of rows) {
    try {
      const res = await env.AI.run(MODEL, { state: stateFor(row), questions: QUESTIONS });
      const p = res && res.answers && res.answers.diy && res.answers.diy.noul;
      if (typeof p !== 'number') throw new Error('no answer');
      const u = await fetch(rest(env, 'quote_submissions?id=eq.' + encodeURIComponent(row.id)), {
        method: 'PATCH',
        headers: sbHeaders(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ ai_diy_score: Math.round(p * 1000) / 1000, ai_checked_at: new Date().toISOString(), ai_model: MODEL }),
      });
      if (!u.ok) throw new Error('save ' + u.status);
      done.push({ id: row.id, diy: Math.round(p * 1000) / 1000 });
    } catch (e) {
      // Left unchecked, so the next minute tries again. Log the kind of failure, never the inquiry.
      console.error('[triage] skipped one inquiry:', String((e && e.message) || e).slice(0, 120));
    }
  }
  return { found: rows.length, checked: done.length, results: done };
}

export default {
  async scheduled(event, env, ctx) {
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
    ctx.waitUntil(pass(env).catch((e) => console.error('[triage]', String(e.message || e).slice(0, 200))));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/run') {
      if (!env.RUN_KEY || request.headers.get('X-Run-Key') !== env.RUN_KEY) return new Response('Not authorised', { status: 401 });
      try {
        return Response.json(await pass(env));
      } catch (e) {
        return Response.json({ error: String(e.message || e).slice(0, 300) }, { status: 502 });
      }
    }
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
  },
};
