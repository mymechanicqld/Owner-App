/* ============================================================================
   Ashley model endpoint, on Cloudflare Workers AI
   ----------------------------------------------------------------------------
   The browser runs Ashley's agent loop and her tools itself; this Worker only
   answers "given this conversation and these tools, what next?". It replaces
   the old Vercel /api/ashley proxy and its third-party model provider.

   The model runs through the Worker's AI binding, so there is no model API
   key anywhere: not in the browser, not in this public repository, not in an
   environment variable.

   Model: GLM 4.7 Flash (@cf/zai-org/glm-4.7-flash). Quirks handled here, from
   documents/glm-4.7-flash-tool-calling-on-cloudflare.md:
     - thinking is on by default and only costs tokens, so it is switched off
     - valid requests are occasionally refused (error 1031): retry once
     - an assistant turn must carry string content, and each tool result its
       tool name, or later turns can be rejected

   Secret (wrangler secret put ASHLEY_APP_KEY):
     ASHLEY_APP_KEY   shared handshake the app sends as X-Ashley-Key. It is
                      in the app's public code, so it is a filter against
                      casual use, not a real secret. Rotate it if abused.
   ========================================================================== */

const MODEL = '@cf/zai-org/glm-4.7-flash';

/* Origin is trivially forged outside a browser, so this is a filter and not
   the security boundary; the app key and the rate limit are. */
const ORIGINS = new Set([
  'https://mmqld-app.vercel.app',
  'https://mymechanicqld.github.io',
  'http://localhost:8771',
  'http://127.0.0.1:8771',
]);

const MAX_MESSAGES = 60;
const MAX_TOOLS = 30;
const MAX_BODY_BYTES = 400000;
const MAX_OUTPUT_TOKENS = 2000;

/* Per-IP speed bump against a runaway loop. Isolates do not share memory, so
   this is not a hard quota. */
const WINDOW_MS = 60000;
const MAX_PER_WINDOW = 40;
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return recent.length > MAX_PER_WINDOW;
}

function cors(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Ashley-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const reply = (status, data, origin) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) },
});

/* Shape the conversation the way GLM expects it on Workers AI. */
function tidy(messages) {
  const names = {};
  return messages.map((m) => {
    if (!m || typeof m !== 'object') return m;
    if (m.role === 'assistant') {
      (m.tool_calls || []).forEach((c) => { if (c && c.id && c.function) names[c.id] = c.function.name; });
      return { ...m, content: typeof m.content === 'string' ? m.content : '' };
    }
    if (m.role === 'tool') {
      return { ...m, name: m.name || names[m.tool_call_id] || 'tool', content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) };
    }
    return m;
  });
}

async function runModel(env, input) {
  try {
    return await env.AI.run(MODEL, input);
  } catch (_) {
    await new Promise((r) => setTimeout(r, 500));
    return env.AI.run(MODEL, input);       // one retry only: each attempt costs
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' }, origin);
    if (origin && !ORIGINS.has(origin)) return reply(403, { error: 'Origin not allowed' }, origin);

    if (!env.ASHLEY_APP_KEY || !env.AI) return reply(503, { error: 'Assistant is not configured yet' }, origin);
    if (request.headers.get('X-Ashley-Key') !== env.ASHLEY_APP_KEY) return reply(401, { error: 'Not authorised' }, origin);

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip)) return reply(429, { error: 'Too many requests, give it a moment' }, origin);

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'Conversation too large' }, origin);
    let incoming;
    try { incoming = JSON.parse(raw); } catch (_) { return reply(400, { error: 'Malformed request' }, origin); }

    const messages = incoming && incoming.messages;
    if (!Array.isArray(messages) || !messages.length) return reply(400, { error: 'No messages supplied' }, origin);
    if (messages.length > MAX_MESSAGES) return reply(400, { error: 'Conversation too long' }, origin);
    const tools = Array.isArray(incoming.tools) ? incoming.tools.slice(0, MAX_TOOLS) : [];

    // The model and the ceilings are fixed here, never taken from the caller.
    const input = {
      messages: tidy(messages),
      temperature: typeof incoming.temperature === 'number' ? Math.min(Math.max(incoming.temperature, 0), 1) : 0.3,
      max_completion_tokens: Math.min(Number(incoming.max_tokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
      chat_template_kwargs: { enable_thinking: false },
    };
    if (tools.length) input.tools = tools;

    try {
      const result = await runModel(env, input);
      const choice = result && result.choices && result.choices[0];
      if (!choice || !choice.message) return reply(502, { error: 'The model returned nothing, try again' }, origin);
      // Only what the app reads: never echo the request back.
      return reply(200, {
        choices: [{
          message: {
            role: 'assistant',
            content: choice.message.content || '',
            tool_calls: choice.message.tool_calls || undefined,
          },
          finish_reason: choice.finish_reason || null,
        }],
        usage: result.usage ? { neurons: result.usage.neurons, prompt_tokens: result.usage.prompt_tokens, completion_tokens: result.usage.completion_tokens } : undefined,
      }, origin);
    } catch (err) {
      const msg = String((err && err.message) || err);
      // Log the kind of failure only, never the conversation.
      console.error('[ashley] model call failed:', msg.slice(0, 200));
      const daily = /neuron|quota|limit|4006|capacity/i.test(msg);
      return reply(daily ? 429 : 502, {
        error: daily ? 'Ashley has used up today\'s free allowance. It resets at 10am Brisbane time.' : 'The model is having trouble, try again shortly',
      }, origin);
    }
  },
};
