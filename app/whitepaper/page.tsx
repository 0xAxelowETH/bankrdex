import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '../../src/components/InfoPage';

export const metadata: Metadata = {
  title: 'BankrDex Whitepaper',
  description: 'How BankrDex works: a non-custodial trading terminal for Bankr launches, with on-chain launch verification, aggregator and direct Uniswap V4 swaps, an enforced 0.1% fee, and social trading.',
};

export default function WhitepaperPage() {
  return (
    <InfoPage
      current="/whitepaper"
      title="BankrDex Whitepaper"
      updated="13 October 2026"
      intro={
        <>
          <p>
            BankrDex is a non-custodial trading terminal for tokens launched with Bankr on Base, Robinhood Chain, Arbitrum
            and Arc. This paper describes the problem it addresses, how its data is collected and verified, how swaps are
            built and protected, the security model, and what is live today versus coming soon.
          </p>
          <p className="mt-3">
            For step-by-step usage, see the <Link href="/docs">Docs</Link>. BankrDex is an independent interface and is
            not operated by Bankr. Nothing here is financial advice.
          </p>
        </>
      }
      sections={[
        {
          id: 'abstract',
          title: '1. Abstract',
          body: (
            <p>
              Bankr launches tokens continuously; on Base alone more than a million launches name Bankr as their Doppler
              integrator. General-purpose DEX screeners list them next to look-alikes from other launchpads that reuse the
              same pools, show data that can lag the chain, and leave swapping to other tools. BankrDex puts verified Bankr
              launches, on-chain market data, safety checks, best-price swaps and a social layer in one interface, while
              the trader&apos;s wallet stays the only thing that can move funds.
            </p>
          ),
        },
        {
          id: 'problem',
          title: '2. The problem',
          body: (
            <ul>
              <li><strong>Authenticity.</strong> Doppler&apos;s integrator field is set by whoever creates the launch, and the <code>ba3</code> address suffix seen on Bankr launches (an on-chain observation, not a documented Bankr rule) can be mined by anyone. Tens of thousands of launches imitate Bankr&apos;s.</li>
              <li><strong>Fragmented data.</strong> Launch metadata, creator fees, market data and trades live in different APIs, each with its own delays and rate limits.</li>
              <li><strong>Execution.</strong> New tokens move fast, liquidity is thin, and the best route differs per token and per chain.</li>
              <li><strong>Trust.</strong> Traders should not have to hand funds or keys to a third party to get speed or convenience.</li>
            </ul>
          ),
        },
        {
          id: 'principles',
          title: '3. Design principles',
          body: (
            <ol>
              <li><strong>Non-custodial.</strong> BankrDex never holds funds or keys. Every swap, approval, claim and sign-in is signed by the user&apos;s wallet.</li>
              <li><strong>Verify, don&apos;t assume.</strong> A token is listed only after it is shown to be a Bankr launch.</li>
              <li><strong>Read the chain.</strong> Where it matters (launches, swaps, prices for social performance), data comes from the chain rather than from a third party.</li>
              <li><strong>Secrets stay on the server.</strong> Aggregator keys and database credentials never reach the browser; the browser talks to allowlisted server proxies.</li>
              <li><strong>Honest numbers.</strong> Fees are disclosed and enforced in code; features that are not backed by real data are hidden or marked <em>Soon</em>.</li>
            </ol>
          ),
        },
        {
          id: 'architecture',
          title: '4. Architecture',
          body: (
            <>
              <table>
                <thead><tr><th>Layer</th><th>Role</th></tr></thead>
                <tbody>
                  <tr><td>Browser app</td><td>Next.js / React interface: market table, terminal, charts, swap panels, wallet connection (injected wallets and WalletConnect). Builds and sends transactions through the user&apos;s wallet.</td></tr>
                  <tr><td>Server routes</td><td>Allowlisted, signed proxies to OKX DEX, Binance Web3, GeckoTerminal and Bankr&apos;s public API; the launch registry; the market index API; social API; health checks. Every route is rate limited per client.</td></tr>
                  <tr><td>Database (Supabase / Postgres)</td><td>Token catalog, launch registry, verification verdicts, swap index, social data, caches. Row-level security on every table; only the server&apos;s service role can read or write.</td></tr>
                  <tr><td>On-chain indexer</td><td>A long-running process that reads Uniswap V4 swaps in Bankr pools, new launches and quote-asset prices from public RPCs into the database.</td></tr>
                  <tr><td>Upstreams</td><td>Bankr API, GeckoTerminal, Binance Web3, OKX DEX, chain RPCs, Uniswap V4 contracts, Doppler&apos;s Airlock.</td></tr>
                </tbody>
              </table>
            </>
          ),
        },
        {
          id: 'data',
          title: '5. Data pipeline',
          body: (
            <>
              <ul>
                <li><strong>Catalog.</strong> Bankr&apos;s public API returns only the most recent launches, so the catalog accumulates: each refresh merges new launches and the most active GeckoTerminal Bankr pools into the previous copy, stored in the database. A bundled snapshot covers cold starts and outages.</li>
                <li><strong>Market data.</strong> GeckoTerminal (pools, candles, trades, holders) and Binance Web3 (prices, candles) with a shared per-minute upstream budget and a database cache with stale fallback.</li>
                <li><strong>Recent buys.</strong> Decoded from Uniswap V4 PoolManager <code>Swap</code> logs on Base, filtered to catalog pools, with one shared block cursor.</li>
                <li><strong>Launch registry.</strong> Every Bankr launch on Base, read from Doppler Airlock <code>Create</code> events and kept current by scanning new blocks. Names and symbols are read from the token contracts the first time a row is shown.</li>
                <li><strong>Creator fees.</strong> From Bankr&apos;s API; claims are built by Bankr and signed by the fee recipient&apos;s wallet.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'verification',
          title: '6. Bankr launch verification',
          body: (
            <>
              <p>Every token is checked before it is served. A token is accepted as a Bankr launch by Bankr&apos;s own launch record, by the on-chain registry, or by an on-chain check of its launch setup; it is rejected when another Doppler integrator launched it, when it names Bankr without Bankr&apos;s launch setup, or when its address lacks the <code>ba3</code> suffix that every Bankr launch in our on-chain data carries.</p>
              <p>The on-chain launch check requires Bankr&apos;s setup, not just Bankr&apos;s name: multicurve launches must name Bankr as integrator <strong>and</strong> pay Bankr&apos;s fee wallet as a fee beneficiary; hook launches must use one of Bankr&apos;s Doppler hooks with the dynamic fee and tick spacing 200.</p>
              <table>
                <thead><tr><th>Base registry (October 2026)</th><th>Launches</th></tr></thead>
                <tbody>
                  <tr><td><code>ba3</code> launches naming Bankr as integrator</td><td>1,297,546</td></tr>
                  <tr><td>Pass the launch check (listed)</td><td>1,234,194</td></tr>
                  <tr><td>Look-alikes (kept but flagged, never listed)</td><td>63,367</td></tr>
                </tbody>
              </table>
              <p>Validated against Bankr&apos;s own answers on 1,243 tokens (every Bankr launch passes; 0.17% of the rest do), and a hold-out sample agreed with Bankr&apos;s <code>bankrDeployed</code> flag on 200 of 200 tokens. Flagged launches are kept so re-imports do not bring them back, and their pools and swaps are not indexed.</p>
            </>
          ),
        },
        {
          id: 'index',
          title: '7. On-chain market index',
          body: (
            <>
              <p>For Base, BankrDex maintains its own index of every swap in a Bankr pool (kept 14 days), the pool map from Uniswap V4 pool ids to tokens, and USD prices of the quote assets (WETH, BNKR) read from on-chain pools. From it the server computes prices, 5m / 1h / 24h changes, volume, buys and sells, traders, candles, sniper and bundle signals, the trader leaderboard, and Pulse.</p>
              <p>Dust swaps (for example 1 wei for 2 wei) produce meaningless prices through integer rounding; their volume is kept but their price is ignored. The interface shows how far the index is behind the chain and warns when it falls more than 10 minutes behind.</p>
            </>
          ),
        },
        {
          id: 'swaps',
          title: '8. Swap execution',
          body: (
            <>
              <table>
                <thead><tr><th>Route</th><th>Mechanism</th></tr></thead>
                <tbody>
                  <tr><td>Recommended</td><td>Quotes OKX DEX and Binance Web3 in parallel and uses the better output; the other is the automatic backup.</td></tr>
                  <tr><td>OKX / Binance</td><td>One aggregator only, through BankrDex&apos;s signed server proxy.</td></tr>
                  <tr><td>Pool direct</td><td>Builds a Uniswap Universal Router transaction against the token&apos;s own Uniswap V4 pool, quoted with Uniswap&apos;s V4Quoter. Buys wrap ETH and swap; sells use an exact-amount Permit2 signature. No aggregator API involved.</td></tr>
              </tbody>
              </table>
              <p>Protections applied on every route:</p>
              <ul>
                <li><strong>Exact approvals</strong> for the amount being swapped, never unlimited.</li>
                <li><strong>Quote expiry</strong> of 25 seconds; expired quotes cannot be confirmed.</li>
                <li><strong>Slippage</strong> warnings above 5% (maximum 50%), and an explicit acknowledgement for price impact of 10% or more.</li>
                <li><strong>Chain switching</strong>: the wallet is moved to the token&apos;s chain before signing.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'fees',
          title: '9. Fee model',
          body: (
            <>
              <p>BankrDex charges a platform fee of <strong>0.1% (10 basis points) of the input amount</strong>, paid inside the same swap transaction to a fixed fee wallet. It is the same on every route and is enforced, not just requested:</p>
              <ul>
                <li>The server proxy rejects aggregator swap requests that do not carry exactly the 0.1% fee and the configured fee wallet.</li>
                <li>Binance Web3 quotes are accepted only when the returned fee amount, fee token and net swap amount match exactly.</li>
                <li>OKX swaps are cancelled before the wallet is asked to sign if the router calldata does not include the fee wallet.</li>
                <li>Direct pool swaps take the fee in the same Universal Router transaction.</li>
              </ul>
              <p>The Bankr pool fee (1.75% on new Doppler launches, shared by the creator, liquidity, Bankr, a BNKR buyback and the Doppler protocol; a 1% Uniswap v3 fee split 70 / 30 between creator and Bankr on Bankr Launch v3 tokens), router fees, token taxes and gas are separate and are not paid to BankrDex.</p>
            </>
          ),
        },
        {
          id: 'security',
          title: '10. Security model',
          body: (
            <ul>
              <li><strong>No custody.</strong> No server-side signer and no order executor holding user funds. A compromised server cannot move user funds; the worst case is a bad transaction proposal, which the wallet shows before signing.</li>
              <li><strong>Server-side secrets.</strong> Aggregator credentials and the database service key exist only on the server. Proxies rebuild every upstream query from an allowlist and schema rather than forwarding user input.</li>
              <li><strong>Rate limiting</strong> on every API route per client (optionally shared across instances).</li>
              <li><strong>Database isolation.</strong> Row-level security on every table; anonymous and authenticated database roles have no access.</li>
              <li><strong>Wallet sign-in.</strong> Sign-In with Ethereum (EIP-4361) with single-use nonces that expire in 10 minutes, smart-wallet signatures (ERC-1271 / ERC-6492) verified on-chain, an httpOnly HMAC-signed session cookie, origin checks and per-wallet write limits.</li>
              <li><strong>Uploads.</strong> Profile images are checked by their bytes on the server (PNG, JPEG, WebP only; no SVG) and size-capped.</li>
              <li><strong>Privacy-minded monitoring.</strong> Error reporting is opt-in and records only provider, direction and stage of failed swaps, not wallet addresses or request bodies.</li>
              <li><strong>Local lock.</strong> An optional passkey / PIN lock for the interface (salted PBKDF2, five-attempt lockout).</li>
            </ul>
          ),
        },
        {
          id: 'social',
          title: '11. Social trading',
          body: (
            <>
              <p>Traders can create a wallet-signed profile, post theses (bullish or bearish, with entry, target, stop and timeframe), follow wallets, and compare results on a leaderboard. Integrity rules:</p>
              <ul>
                <li>Theses can only be posted on Bankr tokens BankrDex knows, and the price at posting is taken from the on-chain index, so performance and <em>Target hit</em> / <em>Stopped out</em> badges cannot be backdated.</li>
                <li>Leaderboard results are estimated from indexed on-chain swaps, not self-reported.</li>
                <li>Any wallet can be followed, with or without a profile.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'roadmap',
          title: '12. Status and roadmap',
          body: (
            <>
              <table>
                <thead><tr><th>Stage</th><th>Scope</th></tr></thead>
                <tbody>
                  <tr><td><strong>Live</strong></td><td>Verified Bankr catalog on four chains; All launches registry for Base; charts and market data; aggregator swaps (OKX DEX, Binance Web3) on Base, Robinhood and Arbitrum; Pool direct and Quick buy on Robinhood; creator-fee view and claim; profiles, theses, feed and leaderboard; safety card; multi-language interface.</td></tr>
                  <tr><td><strong>Soon</strong></td><td>Running the on-chain index for Base in production, which turns on: Pool direct swaps and Quick buy on Base; Orders &amp; alerts (limit buy, take profit, stop loss, price alerts) executed in the browser with wallet confirmation; Pulse; indexed safety signals (snipers, bundled buys); trade-based leaderboard and feed numbers.</td></tr>
                </tbody>
              </table>
              <p>Items marked <em>Soon</em> are built and tested but switched off until the data behind them is live. Timelines are not guaranteed.</p>
            </>
          ),
        },
        {
          id: 'risks',
          title: '13. Risks and disclaimers',
          body: (
            <ul>
              <li>Newly launched tokens are highly volatile and can lose most or all of their value. Liquidity can be thin and price impact large.</li>
              <li>Verification shows that a token is a Bankr launch; it says nothing about the project&apos;s quality or intentions. Safety checks reduce but do not remove risk.</li>
              <li>Third-party services (aggregators, data providers, RPCs, Bankr&apos;s API) can be delayed, wrong or unavailable; smart contracts can have bugs.</li>
              <li>Browser-run orders only execute while a BankrDex tab is open and the user confirms the swap.</li>
              <li>BankrDex is an interface, not a broker, exchange or adviser. Use of BankrDex is subject to the <Link href="/terms">Terms of Service</Link> and the <Link href="/privacy">Privacy Policy</Link>.</li>
            </ul>
          ),
        },
      ]}
    />
  );
}
