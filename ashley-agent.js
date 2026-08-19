/* ============================================================================
   Ashley - the agent loop
   ----------------------------------------------------------------------------
   Talks to the model through this project's own endpoint (see
   app/api/ashley/route.ts on the website). The OpenRouter key lives there, on
   the server, and never reaches this app: the owner-app repository is public.

   The loop is the same shape that makes coding agents feel quick:

     ask the model  ->  it asks for one or more tools  ->  run them ALL AT ONCE
                    ->  hand the results back  ->  repeat until it answers

   Running the tools in parallel is the whole trick. The model routinely asks
   for three or four things in a single turn ("today's bookings" AND "new
   enquiries" AND "who owes money"), and Promise.all turns what would be four
   sequential round trips into one.

   Anything that sends or deletes pauses here and waits for the owner to press
   a button, then carries on with his answer folded in as the tool result.
   ========================================================================== */
(function () {
  'use strict';

  const MAX_STEPS = 6;        // with batching, real questions land in 1-3
  const BUDGET_MS = 90_000;   // whole-conversation ceiling
  const MAX_HISTORY = 24;     // messages kept before the oldest are dropped
  const MAX_RESULT_CHARS = 9_000;

  /* ------------------------------------------------------- system prompt -- */
  /* Deliberately does NOT name the business, the website, the app or the
     database. The model only needs to know the trade and the rules. Keeping
     the identity out means the request carries no clue about where it came
     from beyond the customer data the job genuinely requires. The signature on
     outgoing email is added by ashley-tools.js, not written by the model. */

  function systemPrompt() {
    const now = new Date();
    const today = now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const iso = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const clock = now.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

    return `You are Ashley, the assistant to the owner of a mobile mechanic business in South East Queensland.
He is out on the road doing the actual work, usually reading this on his phone between jobs, often with
dirty hands. You handle the office side: his bookings, his leads, his invoices and his inbox.

Today is ${today} (${iso}) and the time is ${clock}. Work in Australian Eastern time.

HOW TO WORK, THIS MATTERS
- You can call SEVERAL tools in ONE turn and they run at the same time. Batch them. If he asks
  "how's my week looking", call get_overview once rather than four separate lookups. If he asks about
  a customer and their invoice, call find_customer once: it returns the person, their cars, their
  bookings, their invoices and their reports together, each with its id.
- find_customer is your workhorse. Before emailing anyone, call it: it gives you their email address
  and the document ids in the same breath, so you do not need a second round trip.
- Aim to answer in one or two turns. Do not drip one tool call per turn.
- Only look things up when you actually need them. If he says "thanks", just reply.

WHAT YOU CAN DO WITHOUT ASKING
- Any lookup at all.
- Adding or changing a booking, updating an enquiry's status, marking an invoice paid.
  Do it, then tell him plainly what you changed.

WHAT ALWAYS NEEDS HIS SAY-SO
- Sending an email, texting a customer, deleting anything. Call the tool as normal; he will be shown
  exactly what is about to happen and will press a button. Never claim you have sent something until
  the tool result says it went.

SENDING A DOCUMENT
When he says something like "that job's done, send her the invoice": find the customer, pick their most
recent invoice, check it has a PDF saved and that you have an email address, then call send_email with
attach_kind and attach_id. If the email address is missing or there are two invoices it could be, ask
him which one rather than guessing. Getting this wrong means a customer gets the wrong bill.

WRITING TO CUSTOMERS
- Warm, natural, like a real person. Short. A few sentences is plenty.
- Australian spelling. NEVER use a dash as punctuation, not an em-dash and not an en-dash.
  Use a comma or a full stop. No emojis.
- Never invent a price, a date or a promise. If you are not certain, say you will confirm.
- Write only the message. No greeting sign-off, no name, no business details: the signature is
  attached automatically after you finish.

TALKING TO HIM
- Straight to the point, friendly, no preamble. He is busy.
- Plain English, never technical. Say "I checked your calendar", never mention tools, databases,
  ids, or how any of this works. Never show a raw id unless he asks for one.
- Lead with the answer. Money, times and names in bold. Short bullets when there is a list,
  never a table. No dashes as punctuation here either.
- If a lookup comes back empty, say so plainly rather than padding.
- Never mention that you are an AI, a model, or automated. You are Ashley.`;
  }

  /* ----------------------------------------------------------- transport -- */

  async function callModel(messages, tools, signal) {
    // CONFIG is a top-level `const` in config.js, so it lives in the global
    // lexical scope and is NOT a property of window. Reference it directly.
    const cfg = (typeof CONFIG !== 'undefined' && CONFIG.ASHLEY) || {};
    if (!cfg.ENDPOINT) throw new Error('Ashley is not set up yet. The assistant endpoint is missing from config.js.');

    const res = await fetch(cfg.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ashley-Key': cfg.APP_KEY || '' },
      body: JSON.stringify({ messages, tools, temperature: 0.3, max_tokens: 1600 }),
      signal,
    });

    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).error; } catch (_) {}
      if (res.status === 401) throw new Error('Ashley could not sign in to the assistant service. The app key needs updating.');
      if (res.status === 429) throw new Error(msg || 'Too many messages at once. Give it a few seconds.');
      if (res.status === 503) throw new Error('Ashley is not switched on yet. The assistant key still has to be added on the website.');
      throw new Error(msg || 'Could not reach Ashley just now. Try again in a moment.');
    }

    const json = await res.json();
    const choice = json.choices && json.choices[0];
    if (!choice || !choice.message) throw new Error('Ashley did not reply. Try again.');
    const m = choice.message;
    return {
      text: (m.content || '').trim(),
      raw: { role: 'assistant', content: m.content || null, tool_calls: m.tool_calls },
      calls: (m.tool_calls || []).map((c) => ({
        id: c.id,
        name: (c.function && c.function.name) || '',
        args: safeParse(c.function && c.function.arguments),
      })),
    };
  }

  function safeParse(s) {
    if (!s) return {};
    try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (_) { return {}; }
  }

  /* --------------------------------------------------------------- loop -- */
  /**
   * ask(question, history, handlers)
   *   handlers.onBusy(list)      tools now running, as plain-English lines
   *   handlers.onCard(card)      a shortcut or Messages button to render
   *   handlers.onConfirm(p)      -> Promise<boolean>, shows the confirm card
   *   handlers.onAnswer(text)    the final reply
   *   handlers.onError(text)
   *   handlers.signal            AbortSignal for the stop button
   * Returns the updated history so the next question keeps its context.
   */
  async function ask(question, history, h) {
    const tools = window.ASHLEY_TOOLS.defs;
    const messages = [{ role: 'system', content: systemPrompt() }]
      .concat((history || []).slice(-MAX_HISTORY))
      .concat([{ role: 'user', content: question }]);

    const deadline = Date.now() + BUDGET_MS;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (h.signal && h.signal.aborted) return trim(messages);
      if (Date.now() > deadline) {
        h.onError('That is taking longer than it should. Ask me again in a moment.');
        return trim(messages);
      }

      const turn = await callModel(messages, tools, h.signal);

      if (!turn.calls.length) {
        const answer = turn.text || 'I could not work that one out. Try asking it a different way.';
        h.onAnswer(answer);
        messages.push({ role: 'assistant', content: answer });
        return trim(messages);
      }

      messages.push(turn.raw);

      /* Show every call at once so he sees the whole batch, not a trickle. */
      h.onBusy(turn.calls.map((c) => window.ASHLEY_TOOLS.busy(c.name, c.args)));

      /* Anything needing a decision is asked one at a time, in order, so two
         confirmation cards never appear at once. Everything else fires in
         parallel while he is reading. */
      const results = await Promise.all(turn.calls.map(async (c) => {
        if (!window.ASHLEY_TOOLS.needsConfirm(c.name)) return runOne(c, h);
        const approved = await h.onConfirm(window.ASHLEY_TOOLS.preview(c.name, c.args) || { title: 'Go ahead?', rows: [], confirmLabel: 'Yes' });
        if (!approved) return { declined: true, note: 'The owner said no. Do not try this again unless he asks. Acknowledge briefly and stop.' };
        return runOne(c, h);
      }));

      turn.calls.forEach((c, i) => {
        messages.push({ role: 'tool', tool_call_id: c.id, content: String(results[i]).slice(0, MAX_RESULT_CHARS) });
      });
    }

    h.onError('That turned into more work than I expected. Try asking for one thing at a time.');
    return trim(messages);
  }

  async function runOne(c, h) {
    const out = await window.ASHLEY_TOOLS.run(c.name, c.args);
    /* A tool can ask the UI to render a button (a screen shortcut, or opening
       the Messages app). That is for the owner, not for the model. */
    if (out && out.card && h.onCard) { h.onCard(out.card); delete out.card; }
    return JSON.stringify(out);
  }

  /* Keep the system prompt out of stored history: it is rebuilt each turn so
     the date is always right, and tool chatter is dropped so the next question
     carries the conversation, not the plumbing. */
  function trim(messages) {
    return messages
      .filter((m) => m.role === 'user' || (m.role === 'assistant' && m.content))
      .slice(-MAX_HISTORY);
  }

  window.ASHLEY_AGENT = { ask };
})();
