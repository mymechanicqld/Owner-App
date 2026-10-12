#!/usr/bin/env node
/* ============================================================================
   Cloudflare harness: drive the business Cloudflare account from this Mac.

   Zero dependencies (Node 18+ has fetch). Credentials come from .env next to
   this file, which git ignores because the Owner-App repository is public.
   Nothing here ever prints the token.

     node cf.mjs verify                     check the token and the account
     node cf.mjs account                    account name, id and plan
     node cf.mjs subdomain                  show the workers.dev subdomain
     node cf.mjs subdomain set <name>       register it (new accounts have none)
     node cf.mjs workers                    list deployed Workers
     node cf.mjs deploy <folder>            wrangler deploy into this account
     node cf.mjs secret <worker> <NAME>     set a Worker secret; value from stdin
     node cf.mjs ai "<prompt>" [model]      one small Workers AI call (frugal)
     node cf.mjs api <METHOD> <path> [json] any Cloudflare API call;
                                            ":account" in the path is replaced
   ========================================================================== */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://api.cloudflare.com/client/v4';
const DEFAULT_MODEL = '@cf/zai-org/glm-4.7-flash';

/* ------------------------------------------------------------- settings -- */
function loadEnv() {
  const file = join(HERE, '.env');
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  // A value already in the shell wins over the file.
  for (const k of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) if (process.env[k]) env[k] = process.env[k];
  return env;
}
const ENV = loadEnv();
const TOKEN = ENV.CLOUDFLARE_API_TOKEN || '';
const ACCOUNT = ENV.CLOUDFLARE_ACCOUNT_ID || '';

const hide = (s) => (TOKEN ? String(s).split(TOKEN).join('[token]') : String(s));
const out = (x) => console.log(hide(typeof x === 'string' ? x : JSON.stringify(x, null, 2)));
function die(msg) { console.error(hide('cf: ' + msg)); process.exit(1); }

function need(what) {
  if (what.includes('token') && (!TOKEN || /PASTE/.test(TOKEN))) die('CLOUDFLARE_API_TOKEN is not set. Put it in ' + join(HERE, '.env'));
  if (what.includes('account') && (!ACCOUNT || /PASTE/.test(ACCOUNT))) die('CLOUDFLARE_ACCOUNT_ID is not set. Put it in ' + join(HERE, '.env'));
}

/* ------------------------------------------------------------------ API -- */
async function cf(method, path, body, raw) {
  const url = API + path.replace(/:account\b/g, ACCOUNT);
  const r = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch (_) { j = { raw: text.slice(0, 2000) }; }
  if (raw) return { status: r.status, body: j };
  if (!r.ok || j.success === false) {
    const errs = (j.errors || []).map((e) => (e.code ? e.code + ': ' : '') + e.message).join('; ');
    throw new Error(method + ' ' + path + ' -> ' + r.status + (errs ? ' (' + errs + ')' : ''));
  }
  return j.result !== undefined ? j.result : j;
}

/* ------------------------------------------------------------- commands -- */
const commands = {
  async verify() {
    need('token');
    // User tokens and account-owned tokens verify at different addresses.
    let v = await cf('GET', '/user/tokens/verify', undefined, true);
    let kind = 'user token';
    if (!(v.body && v.body.success) && ACCOUNT) {
      v = await cf('GET', '/accounts/' + ACCOUNT + '/tokens/verify', undefined, true);
      kind = 'account token';
    }
    if (!(v.body && v.body.success)) die('token rejected: ' + JSON.stringify(v.body.errors || v.body));
    out({ token: kind, status: v.body.result.status, expires: v.body.result.expires_on || 'never' });
    const accts = await cf('GET', '/accounts?per_page=50').catch((e) => ({ error: e.message }));
    if (Array.isArray(accts)) {
      out({ accounts_this_token_can_see: accts.map((a) => ({ id: a.id, name: a.name })) });
      if (ACCOUNT && !accts.some((a) => a.id === ACCOUNT)) console.error('cf: warning, CLOUDFLARE_ACCOUNT_ID is not among them');
    } else out(accts);
    if (ACCOUNT) {
      // Probe what the token can do for the jobs we use, without changing anything.
      const probe = async (label, path) => {
        const r = await cf('GET', path, undefined, true);
        return [label, r.status === 200 && r.body.success !== false ? 'ok' : 'no (' + r.status + ')'];
      };
      const checks = await Promise.all([
        probe('Workers scripts', '/accounts/:account/workers/scripts'),
        probe('workers.dev subdomain', '/accounts/:account/workers/subdomain'),
        probe('Workers AI models', '/accounts/:account/ai/models/search?per_page=1'),
        probe('KV namespaces', '/accounts/:account/storage/kv/namespaces?per_page=1'),
        probe('D1 databases', '/accounts/:account/d1/database?per_page=1'),
        probe('R2 buckets', '/accounts/:account/r2/buckets'),
      ]);
      out({ can_read: Object.fromEntries(checks) });
    }
  },

  async account() {
    need('token account');
    const a = await cf('GET', '/accounts/:account');
    out({ id: a.id, name: a.name, type: a.type, created: a.created_on });
  },

  async subdomain(action, name) {
    need('token account');
    if (action === 'set') {
      if (!name || !/^[a-z0-9-]{1,63}$/.test(name)) die('usage: subdomain set <lowercase-name>');
      const r = await cf('PUT', '/accounts/:account/workers/subdomain', { subdomain: name });
      return out({ subdomain: r.subdomain, workers_dev: 'https://<worker>.' + r.subdomain + '.workers.dev' });
    }
    const r = await cf('GET', '/accounts/:account/workers/subdomain', undefined, true);
    if (r.status === 200 && r.body.result) out({ subdomain: r.body.result.subdomain, workers_dev: 'https://<worker>.' + r.body.result.subdomain + '.workers.dev' });
    else out({ subdomain: null, note: 'None registered yet. Run: node cf.mjs subdomain set <name>' });
  },

  async workers() {
    need('token account');
    const list = await cf('GET', '/accounts/:account/workers/scripts');
    out(list.map((w) => ({ name: w.id, modified: w.modified_on })));
  },

  /* wrangler reads CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID, so a
     deploy goes to this account with no `wrangler login` and no MCP. */
  async deploy(folder, ...rest) {
    need('token account');
    if (!folder) die('usage: deploy <folder containing wrangler.jsonc>');
    const dir = resolve(process.cwd(), folder);
    if (!existsSync(join(dir, 'wrangler.jsonc')) && !existsSync(join(dir, 'wrangler.toml'))) die('no wrangler config in ' + dir);
    const r = spawnSync('npx', ['--yes', 'wrangler@4', 'deploy', ...rest], {
      cwd: dir,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: TOKEN, CLOUDFLARE_ACCOUNT_ID: ACCOUNT, WRANGLER_SEND_METRICS: 'false' },
      encoding: 'utf8',
    });
    out((r.stdout || '') + (r.stderr || ''));
    if (r.status !== 0) process.exit(r.status || 1);
  },

  /* The value is read from stdin so it never appears in a command line. */
  async secret(worker, name) {
    need('token account');
    if (!worker || !name) die('usage: echo -n VALUE | node cf.mjs secret <worker> <NAME>');
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const text = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
    if (!text) die('no value on stdin');
    await cf('PUT', '/accounts/:account/workers/scripts/' + encodeURIComponent(worker) + '/secrets', { name, text, type: 'secret_text' });
    out({ worker, secret: name, set: true });
  },

  async ai(prompt, model) {
    need('token account');
    if (!prompt) die('usage: ai "<prompt>" [model]');
    const r = await cf('POST', '/accounts/:account/ai/run/' + (model || DEFAULT_MODEL), {
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: 80,
      chat_template_kwargs: { enable_thinking: false },
    });
    const c = r.choices ? r.choices[0].message.content : (r.response || r);
    out({ model: model || DEFAULT_MODEL, reply: c, usage: r.usage });
  },

  async api(method, path, json) {
    need('token');
    if (!method || !path) die('usage: api <METHOD> <path> [json]');
    if (path.includes(':account')) need('account');
    out(await cf(method.toUpperCase(), path, json ? JSON.parse(json) : undefined, true));
  },

  help() {
    out(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 20).join('\n'));
  },
};

const [cmd, ...args] = process.argv.slice(2);
const fn = commands[cmd || 'help'];
if (!fn) die('unknown command "' + cmd + '". Try: node cf.mjs help');
Promise.resolve(fn(...args)).catch((e) => die(e.message));
