# BankrDex

BankrDex is a trading terminal for tokens launched with [Bankr](https://bankr.bot) on **Base**,
built with Next.js 16 and React 19. The trading UI renders in the browser; API credentials and
provider proxies stay on the server. BankrDex is an independent interface, not operated by Bankr.

## Run locally

Prerequisite: Node.js 22+.

1. `npm install`
2. Copy [.env.example](.env.example) to `.env.local` and fill in the values. Never use a
   `NEXT_PUBLIC_` prefix for secrets. Everything except WalletConnect and the aggregator keys
   is optional; without OKX / Binance Web3 keys the market works but swaps are disabled.
3. `npm run dev`, then open http://localhost:3000

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run local` | Whole local stack in one terminal: local Supabase, dev server and the on-chain indexer (restarted automatically if it stops) |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript (strict) |

## Chains

Bankr launches on **Base, Robinhood Chain, Arbitrum and Arc**; the market table has one tab per
chain plus "All chains". Chain ids, RPCs and explorers come from viem's chain definitions
([src/config/chains.ts](src/config/chains.ts)).

| Chain | Market data | Recent buys | Swaps in BankrDex |
| --- | --- | --- | --- |
| Base | GeckoTerminal (dex `bankr`) + Bankr API | Uniswap V4 logs | OKX DEX, Binance Web3 |
| Robinhood | GeckoTerminal (dex `bankr-robinhood`) + Bankr API | — | not yet (link to Bankr) |
| Arbitrum | Bankr API launches + GeckoTerminal pools | — | not yet |
| Arc | Bankr API launches + GeckoTerminal pools | — | not yet |

Token links for other chains carry the chain: `/token/<address>?chain=robinhood`. The on-chain
"All launches" registry covers Base.

## Where the data comes from

| Data | Source |
| --- | --- |
| Bankr launches (creator, fee recipient, X profile, launch post, pool id) | `GET https://api.bankr.bot/token-launches` (public, latest 50, filtered to `chain: base`) |
| Market data for every Bankr pool | GeckoTerminal, dex `bankr` on network `base` (Uniswap V4 pools, 32-byte pool ids) |
| Charts and trades | GeckoTerminal pool OHLCV / trades; Binance Web3 candles as a fallback |
| Recent buys | Uniswap V4 PoolManager `Swap` logs on Base (`0x4985…2b2b`), filtered to catalog pools |
| Holders / top-10 share | GeckoTerminal token info |
| Burned supply | `balanceOf(0x…dEaD)` over Base RPC |
| Creator fees and claims | `GET /token-launches/{token}/fees`, `POST /public/doppler/build-claim` (api.bankr.bot) |
| Token search | `GET /tokens/search?chainId=8453` (api.bankr.bot) |
| Swaps | OKX DEX and Binance Web3 aggregators, chain 8453 |

Bankr's public API only returns the most recent launches, so the catalog **accumulates**: every
refresh merges new launches and the most active GeckoTerminal `bankr` pools into the previous copy
(memory, and Supabase when configured). A bundled snapshot in
[src/data/bankrTokens.json](src/data/bankrTokens.json) is used on a cold start and when every
source is down.

**Only verified Bankr launches are listed.** GeckoTerminal's `bankr` dexes also contain other
launchpads that reuse Doppler's pools (for example tokens ending in `…1e18` on Robinhood Chain or
`…fee1` on Base), so [src/server/bankrVerification.ts](src/server/bankrVerification.ts) checks every
token before it is served:

| Verdict | How |
| --- | --- |
| Bankr (`bankr-api`) | Bankr's own launch record (token-launches list or lookup) on the same chain |
| Bankr (`registry`) | Base: in the on-chain launch registry and not flagged by the launch check |
| Bankr (`onchain`) | Base: the full launch check below; Robinhood: Bankr is the Doppler integrator |
| Bankr (`official`) | BNKR, Bankr's own coin |
| Not Bankr (`onchain`) | another Doppler integrator, or Bankr named as integrator without Bankr's launch setup |
| Not Bankr (`suffix`) | the address lacks the `ba3` suffix Bankr mines for every launch |

Verdicts are stored in `bankrdex_token_verification` (migration `20261010040000`); tokens proven
not to be Bankr's are removed from the catalog, and undecided ones stay hidden until a check
succeeds. Doppler Airlocks and the integrator are in
[src/config/bankrDoppler.ts](src/config/bankrDoppler.ts). After a catalog refresh,
`node scripts/clean-bundled-tokens.mjs` keeps the bundled list to verified launches only. The
token page shows a *Verified Bankr launch* badge (or *Not a Bankr launch* for tokens opened from
another source).

## Every Bankr launch (on-chain registry)

The market table lists tokens with trading activity; the **All launches** tab (and `/launches`)
lists **every** Bankr launch on Base, read from the chain. Bankr launches go through Doppler's
Airlock (`0x660e…8d12`, event `Create`):

- Bankr mines its token addresses to end in `ba3`, so `ba3` assets are the candidates.
- A few other deployers mine the same suffix (about 0.15% of candidates), so each candidate must
  name Bankr as its Doppler **integrator** (`Airlock.getAssetData`, `0xf606…163e`).
- The integrator field is set by whoever calls `Airlock.create`, and some accounts launched tens
  of thousands of `ba3` tokens naming Bankr as integrator that Bankr never deployed (Bankr's
  `GET /tokens/search` has no `bankrDeployed` flag for them). So every launch is also checked
  against Bankr's launch setup ([src/server/bankrLaunchRules.ts](src/server/bankrLaunchRules.ts)):
  multicurve launches (initializer `0xd59c…`) must have Bankr's integrator **and** Bankr's fee
  wallet `0x2cdd…6fd1` as fee beneficiaries; hook launches (initializer `0xbdf9…`) must use one of
  Bankr's Doppler hooks with the dynamic fee and tick spacing 200. Validated against Bankr's own
  answers on 1,243 tokens: every Bankr launch passes, 0.17% of the rest do. Rows that fail are
  kept but flagged (`not_bankr`), never listed, and their pools and swaps are not indexed; the
  launch page shows how many were left out.
- Bankr's API (`GET /token-launches/{address}`) answers 404 for some genuine launches (Bankr hides
  banned launches); `GET /tokens/search?query=<address>` still marks them `bankrDeployed`.

Bankr started launching through Doppler on Base around February 2026; the history holds about
1.3 million tokens, so it lives in Supabase, not in the bundle.

1. Run the `bankrdex_launches` and `bankrdex_notify_state` migrations.
2. Backfill (about 20 minutes over the public Tenderly archive gateway; resumable):
   `node scripts/backfill-bankr-launches.mjs data/bankr-launches.ndjson 40000000`
3. Import: `node scripts/import-bankr-launches.mjs data/bankr-launches.ndjson`
   (reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`).
4. Verify: `node scripts/verify-launch-integrators.mjs` checks every token's Doppler integrator
   and removes look-alikes from Supabase and the backfill file (about 12 minutes).
5. Check: run the `20261010050000_launch_checks` migration, then
   `node scripts/check-bankr-launches.mjs` flags launches without Bankr's launch setup (resumable;
   `--from 0x6 --to 0xb` splits the address range so several runs can use different RPCs via
   `BASE_RPC`). `node scripts/prune-backfill-lookalikes.mjs` then drops the flagged launches from
   the backfill file too. `node scripts/audit-launch-registry.mjs` re-reads every row's integrator
   (read-only report).

Result on Base (October 2026): 1,297,546 `ba3` launches name Bankr as integrator; 1,234,194 pass
the launch check and 63,367 are look-alikes (57,983 keep the fees for themselves, 4,756 lack
Bankr's fee wallet, 621 use another pool setup, 7 used an early test initializer). A hold-out
sample agreed with Bankr's `bankrDeployed` flag on 200 of 200 tokens.

After that the server keeps the registry current on its own (new blocks are scanned at most
every 30 seconds while the site is used). Token names and symbols are read from the token
contracts (Multicall3) the first time a row is displayed. Without Supabase, `/launches` only
shows launches seen since the server started. Set `BASE_ARCHIVE_RPC` to use another
archive-capable RPC for catching up after long downtime.

## Local Supabase (no Docker)

For local development the app can use a Docker-free stand-in for Supabase: portable PostgreSQL +
PostgREST behind a small gateway that serves the same `/rest/v1` API and service-role key.

1. Put the binaries in `../supabase-local` (or set `LOCAL_SUPABASE_DIR`):
   - `pgsql/` from the EnterpriseDB PostgreSQL Windows zip (`bin`, `lib`, `share`)
   - `postgrest/postgrest.exe` from the PostgREST GitHub release
2. `npm run db:init` creates the database (127.0.0.1:54322), the Supabase roles (`anon`,
   `authenticated`, `service_role`), a JWT secret and service key, runs every migration, and
   writes `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`.
3. `npm run db:serve` runs Postgres + PostgREST + the gateway on `http://127.0.0.1:54321`
   (Ctrl+C stops all). In VS Code: **Terminal → Run Task → BankrDex: start all**.
   Or `npm run local` to start the database, the dev server and the indexer together; the header
   then shows how far the index is behind the chain, with a warning when it falls 10+ minutes behind.
4. Optional data: `npm run db:import` (the backfill file), then
   `node scripts/fill-launch-names.mjs` to read every token's name and symbol so the All launches
   page can be searched by symbol.

`npm run db:psql` opens a SQL shell; `npm run db:stop` stops Postgres. Everything listens on
127.0.0.1 only; passwords and keys are in `../supabase-local/config.json`.

## Trading features

- **On-chain indexer** (`npm run indexer`, needs Supabase): reads every Uniswap V4 `Swap` in a
  Bankr pool on Base plus new launches and quote prices (WETH/USDC, BNKR/WETH V3 pools) straight
  from public RPCs. It powers prices, 5m/1h/24h changes, volume, buys/sells, traders, candles,
  trades, Pulse and the safety checks for Base tokens, and lists every Base token that traded in
  the last 24 hours. Pool ids are derived from the launch data: run
  `node scripts/build-pool-map.mjs` once after importing the backfill. GeckoTerminal remains the
  source for liquidity and for the other chains.
- **Direct swaps** (no aggregator keys): Bankr tokens on Base are bought and sold straight
  against their own Uniswap V4 pool through Uniswap's Universal Router, with the 0.1% BankrDex
  fee in the same transaction. Sells use an exact-amount approval plus a Permit2 signature.
  `node scripts/simulate-v4-swap.mjs` simulates a buy and a sell on Base with state overrides.
- **Quick buy** (⚡) on every Base row, with the ETH amount set in the toolbar.
- **Safety checks** on the token page: sell simulation against the pool (honeypot check), dev
  holdings, snipers and their remaining holdings, bundled buys, top-10 share, burn, and how many
  tokens the creator has launched.
- **Pulse**: New / Heating up / Trending columns, refreshed every 5 seconds.
- **Filters** (market cap, liquidity, volume, transactions, age, socials, fake symbols) with
  saved presets, and a **watchlist** (★) kept in the browser.
- **Orders & alerts**: limit buy, take profit, stop loss and price alerts. They are kept in the
  browser and run while a BankrDex tab is open: when the price is reached the wallet is asked
  to confirm the swap (non-custodial; there is no server-side executor).

## Swap routers on every chain

Bankr tokens on Base with a Uniswap V4 pool can swap straight against the pool (**Pool direct**) or
through the aggregators (**Aggregator**). Every other token, on Base, Robinhood, Arbitrum and Arc, goes
through **OKX DEX** and **Binance Web3**: both are quoted, the better route is used (or the one the
trader picks), with ETH or USDC (Base, Arbitrum) on the other side. The wallet is switched to the
token's chain first, approvals are for the exact amount, and the 0.1% fee is enforced in every route.

Set `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE` (optional `OKX_PROJECT_ID`) and
`BINANCE_WEB3_API_KEY`, `BINANCE_WEB3_SECRET_KEY`. `GET /api/routers/status` tells the app which router
serves which chain; OKX's list comes from its own `aggregator/supported/chain` endpoint, so a chain
OKX does not serve yet is shown as such instead of failing at swap time.

## Social trading

Needs Supabase (migration `20261010030000_social.sql`) and `SESSION_SECRET` in `.env.local`
(32+ random characters; changing it signs everyone out).

- **Sign in with your wallet** (Sign-In with Ethereum, EIP-4361): a free signature, no transaction.
  Nonces are single-use and expire after 10 minutes; smart wallets (ERC-1271/6492) are verified
  through a Base RPC call. The session is an httpOnly, HMAC-signed cookie (7 days); writes must
  come from a BankrDex page (Origin check) and have per-wallet rate limits.
- **Profiles**: unique username (3–20 `a-z 0-9 _`, staff/brand names reserved), display name, bio,
  profile color, X / Farcaster / website, avatar and banner. Images are cropped and compressed to
  WebP in the browser and checked by their bytes on the server (PNG, JPEG, WebP only; no SVG).
- **Theses** in the token terminal (*Trades | Thesis* tabs, or *+ Create thesis* on the chart):
  bullish or bearish, title, reasoning, entry / target / stop and a timeframe. The token must be a
  Bankr token BankrDex knows, and the price at posting comes from the on-chain index, so the
  "since post" performance, *Target hit* and *Stopped out* badges are honest. Likes, comments,
  share links and *Show on chart* (draws the levels on the chart).
- **Feed** (`/feed`): latest and top theses, theses from people you follow, and live trades from
  wallets with a BankrDex profile.
- **Leaderboard** (`/leaderboard`): every wallet trading Bankr pools, ranked by estimated PnL or
  volume over 24 h / 7 d from the swap index. Any wallet can be followed; their swaps then show
  up in your feed.
- **Trader pages** (`/u/<username>` or `/u/<wallet>`): profile, followers, 24 h / 7 d results,
  theses and trades. Trades in the terminal show the trader's username and avatar.

## Routes

- `/` market list, `/token/<address>` trading terminal for one token (server-rendered title and
  Open Graph metadata, shareable). The token page includes a **Bankr launch** card with the
  creator, fee recipient, creator-fee earnings and a claim button for the fee recipient.
- `/api/token-catalog` the Bankr catalog; `?since=<ms>` returns only newer launches (near-live).
- `/api/bankr-proxy/*` allowlisted public api.bankr.bot endpoints (`token-launches`,
  `token-launches/{token}`, `/fees`, `/vesting`, `quote-tokens`, `tokens/search`,
  `public/doppler/claimable-fees`, `creator-fees`, and `POST public/doppler/build-claim`).
  Queries are rebuilt from an allowlist; responses are cached with stale fallback.
- `/launches` every Bankr launch, newest first, searchable by symbol or address.
- `/api/bankr-launches?before=<block>&limit=&q=` the on-chain launch registry, paginated;
  `/api/bankr-launches/<address>` whether a token is a Bankr launch, with its records.
- `/api/market/{stats,ohlcv,trades,risk,pulse,pool}` the on-chain market index for Base.
- `/api/recent-buys` latest Bankr buys decoded from Uniswap V4 swap logs (one shared block cursor).
- `/api/buy-values` USD value, buyer and dev flag of individual buys (V4 and V2/V3 pools).
- `/api/token-stats/<address>` holder count, top-10 share and burned supply.
- `/api/token-logo/<cid>` IPFS artwork proxy (raster images only, size-capped, immutable cache).
- `/api/okx-dex/*` signed OKX DEX proxy. Each route rebuilds its upstream query from a schema;
  `/aggregator/swap` requires the 0.1% platform fee and the configured fee wallet.
- `/api/binance-web3/*` signed Binance Web3 proxy, limited to Base tokens in the catalog or the
  market table.
- `/api/geckoterminal/*` GeckoTerminal pool data (20-byte pools and 32-byte V4 pool ids) with
  memory + Supabase cache. The proxy and the catalog share one per-minute upstream budget.
- `/api/market-sources` Binance Web3 hot tokens on Base outside Bankr, plus live Binance stats
  for the most-traded Bankr tokens.
- `/feed`, `/leaderboard`, `/u/<username|wallet>` social pages (see *Social trading*).
- `/api/social/*` sign-in (`auth/nonce`, `auth/verify`, `auth/logout`), `me` (profile, images),
  `profiles`, `follow`, `theses` (+ `like`, `comments`), `leaderboard`, `trades`, `image`.
- `/api/health` upstream status (GeckoTerminal, Bankr API, Base RPC, Supabase, OKX, Binance
  Web3). Returns 503 when a core source is down; cached for 30 seconds.

All `/api/*` routes are rate limited per client IP in [proxy.ts](proxy.ts). Set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to share limits across instances.

## Monitoring

- Error reporting is opt-in: set `NEXT_PUBLIC_SENTRY_DSN` (browser) and `SENTRY_DSN`
  (server). Failed swaps are reported with provider, direction and stage tags only; no
  wallet addresses, headers, bodies or query strings are collected.
- Vercel Web Analytics: enable it in the Vercel dashboard, then set
  `NEXT_PUBLIC_VERCEL_ANALYTICS=1`.

## Telegram alerts (optional)

- **Token fees**: after a confirmed swap the browser posts the tx hash to `/api/notify/swap`;
  the server reads the receipt on Base and only alerts when it contains an ERC-20 `Transfer`
  to the fee wallet.
- **ETH fees and outages**: an external scheduler (e.g. cron-job.org, every 5 minutes) calls
  `GET /api/cron/notify` with `Authorization: Bearer <CRON_SECRET>`. It alerts when the fee
  wallet's ETH balance on Base increases and when `/api/health` changes state.
- Setup: set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET`, and run the
  `bankrdex_notify_state` migration.

## Visitor statistics

- Each browser gets a random visitor ID (local storage); while a tab is visible and the policies
  are accepted it posts a heartbeat to `/api/presence` once a minute. Bots are ignored.
- `/admin/stats` (key: `STATS_SECRET`, or `CRON_SECRET` when unset) shows online now, unique
  visitors today / 7 / 30 days, new visitors, connected wallets, and a 14-day chart.
- Setup: run the `bankrdex_visitors` migration.

## Supabase

Run the migrations in [supabase/migrations](supabase/migrations) (each file is one `DO` block).
Every table has row-level security and is only accessible to `service_role`. GeckoTerminal rows
older than 24 hours are pruned automatically. Catalog rows are kept (the catalog accumulates).

## Platform fee

The platform fee is **0.1% (10 BPS) of the input asset**, paid to the wallet in
[src/config/platformFee.ts](src/config/platformFee.ts) inside the swap transaction:

- Binance Web3 quotes are accepted only when the returned fee amount, fee token, and net
  swap amount match exactly.
- OKX swaps are cancelled before the wallet is asked to sign if the router calldata does
  not include the fee wallet.

An ERC-20 input may still need a one-time approval transaction (exact amount, never
unlimited). The Bankr pool fee (about 1.75% on new Doppler launches) is charged by the pool
itself and is separate from the platform fee.

## Local lock

The passkey/PIN lock protects the UI on this browser only. The PIN is stored as a salted
PBKDF2 hash with a five-attempt lockout. Wallets still confirm every transaction.

## License

MIT. Independent project; not affiliated with or operated by Bankr. Tokens shown here are created
by third parties. Nothing here is financial advice.
