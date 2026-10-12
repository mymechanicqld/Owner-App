# Cloudflare harness

A small command-line tool for running the business Cloudflare account from this Mac, without `wrangler login` and without an MCP connection. It powers Ashley's model endpoint (`../ashley`) and is meant for the other Cloudflare jobs that come later.

`cf.mjs` has no dependencies. Credentials live in `.env` in this folder. **`.env` is git-ignored because the Owner-App repository is public.** Never put the token anywhere else in the repo.

## Setup

1. Copy `.env.example` to `.env` (already done once on the Mac that set this up).
2. Fill in:
   - `CLOUDFLARE_ACCOUNT_ID`: the long hex id in the dashboard address (`dash.cloudflare.com/<id>`), also under Workers & Pages.
   - `CLOUDFLARE_API_TOKEN`: dashboard > My Profile > API Tokens > Create Token.
3. Check it: `node cf.mjs verify`

### Token permissions

Start from the **Edit Cloudflare Workers** template, then add **Workers AI: Edit**. Restrict it to the business account.

| Permission | Why |
| --- | --- |
| Account > Workers Scripts > Edit | deploy Workers, set their secrets, register the workers.dev subdomain |
| Account > Workers AI > Edit | run models (Ashley, `cf.mjs ai`) |
| Account > Account Settings > Read | wrangler needs to read the account |
| User > User Details > Read, User > Memberships > Read | wrangler start-up checks |
| Account > Workers KV Storage, Workers R2 Storage > Edit | included in the template; for later jobs |
| Account > D1 > Edit (optional) | if a later job needs a database |

`node cf.mjs verify` lists what the token can actually reach.

## Commands

Run from this folder (`owner-app/cloudflare/harness`):

```bash
node cf.mjs verify                       # token, accounts it can see, what it can read
node cf.mjs account                      # account name and id
node cf.mjs subdomain                    # the account's workers.dev subdomain
node cf.mjs subdomain set <name>         # register one (a new account has none)
node cf.mjs workers                      # deployed Workers
node cf.mjs deploy ../ashley             # wrangler deploy into this account
echo -n "$VALUE" | node cf.mjs secret mmqld-ashley ASHLEY_APP_KEY
node cf.mjs ai "Say hello in five words" # one small Workers AI call
node cf.mjs api GET /accounts/:account/workers/scripts   # any API call
```

`.env` also holds `TRIAGE_RUN_KEY`, which triggers a pass of the likely DIY check on demand (see `../triage` and docs/OPERATIONS.md).

`deploy` runs `npx wrangler@4 deploy` with the token and account from `.env`, so it always lands in this account whatever wrangler login the Mac has. `secret` reads the value from stdin so it never appears in shell history. Output never prints the token.

## Notes

- Workers AI free allowance: 10,000 neurons a day per account, resetting 00:00 UTC (10am Brisbane). An Ashley question costs about 40 neurons.
- A Worker's address is `https://<worker>.<subdomain>.workers.dev`. Moving Ashley to a new account changes the subdomain, so `ASHLEY.ENDPOINT` in `config.js` changes with it.
