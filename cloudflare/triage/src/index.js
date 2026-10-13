/* ============================================================================
   Inquiry triage: is this a "likely DIY" job? Two checks in one call.
   ----------------------------------------------------------------------------
   Every minute, picks up website inquiries from the last WINDOW_HOURS that
   have not been checked yet, asks Cloudflare's Clef-flash decision model two
   questions and writes both probabilities back to the inquiry:

     ai_diy_score      own parts: they supply some or all of the parts for us
                       to fit; the higher of two questions (the app labels
                       0.6 and above "Likely DIY")
     ai_started_score  started it themselves: they began the repair and want
                       it finished (the app labels 0.8 and above)
     ai_checked_at     when it was checked
     ai_model          which model scored it

   The business takes on neither, so these can be declined quickly (the app
   has a ready reply for each, and Ashley can see the flag).

   Clef-flash is a decision model, not a chatbot: it takes the inquiry text
   ("state") and a typed question, and returns a calibrated probability. It
   bills input tokens only: an inquiry is about 200 tokens, under one neuron.
   Checked on 400 real inquiries (Oct 2026). Own parts: every inquiry scoring
   0.76 or more said they had or would supply the part; the next was 0.33.
   Started it themselves: 0.84 and above were all genuine (stuck mid-job,
   parts already off); 0.5 to 0.8 were mostly normal diagnoses after a simple
   swap, hence the stricter 0.8 cut-off.

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
  started: {
    type: 'noul',
    instructions: 'Has the customer (or a friend) already started this repair themselves, taken parts off or tried to do the job, and now wants a mechanic to finish it or fix what they began?',
  },
  // Added 13 Oct 2026: "diy" misses customers who have some parts but also want
  // other work ("two boxes of shock absorbers to put on, but no brake pads yet").
  // It flags a few extra jobs ("has new tyres"), which the owner accepted.
  owned: {
    type: 'noul',
    instructions: 'Does the customer mention parts they already own or have bought, which they want a mechanic to put on or install?',
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
  const tail = '&created_at=gte.' + encodeURIComponent(since) + '&order=created_at.asc&limit=' + BATCH;
  // Unchecked, or checked before the second question existed.
  let started = true;
  let r = await fetch(rest(env, 'quote_submissions?select=id,service_needed,symptoms&or=(ai_checked_at.is.null,ai_started_score.is.null)' + tail), { headers: sbHeaders(env) });
  if (r.status === 400 && /ai_started_score/.test(await r.clone().text())) {
    // Migration 011 not run yet: keep doing the own-parts check alone.
    started = false;
    r = await fetch(rest(env, 'quote_submissions?select=id,service_needed,symptoms&ai_checked_at=is.null' + tail), { headers: sbHeaders(env) });
  }
  if (!r.ok) throw new Error('read inquiries ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const rows = await r.json();
  const questions = started ? QUESTIONS : { diy: QUESTIONS.diy, owned: QUESTIONS.owned };
  const done = [];
  for (const row of rows) {
    try {
      const res = await env.AI.run(MODEL, { state: stateFor(row), questions });
      const a = (res && res.answers) || {};
      // Own parts is the stronger of the two own-parts questions.
      const p = Math.max(a.diy ? a.diy.noul : 0, a.owned ? a.owned.noul : 0);
      const st = a.started && a.started.noul;
      if (!a.diy || (started && typeof st !== 'number')) throw new Error('no answer');
      const r3 = (x) => Math.round(x * 1000) / 1000;
      const patch = { ai_diy_score: r3(p), ai_checked_at: new Date().toISOString(), ai_model: MODEL };
      if (started) patch.ai_started_score = r3(st);
      const u = await fetch(rest(env, 'quote_submissions?id=eq.' + encodeURIComponent(row.id)), {
        method: 'PATCH',
        headers: sbHeaders(env, { Prefer: 'return=minimal' }),
        body: JSON.stringify(patch),
      });
      if (!u.ok) throw new Error('save ' + u.status);
      done.push({ id: row.id, diy: patch.ai_diy_score, started: started ? patch.ai_started_score : null });
    } catch (e) {
      // Left unchecked, so the next minute tries again. Log the kind of failure, never the inquiry.
      console.error('[triage] skipped one inquiry:', String((e && e.message) || e).slice(0, 120));
    }
  }
  return { found: rows.length, checked: done.length, started_check: started, results: done };
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
