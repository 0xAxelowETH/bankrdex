import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '../../src/components/InfoPage';

export const metadata: Metadata = {
  title: 'BankrDex Docs',
  description: 'How to use BankrDex: Bankr tokens on Base, Robinhood, Arbitrum and Arc, markets, swap routes, fees, creator fees, safety checks, social trading, and what is coming soon.',
};

export default function DocsPage() {
  return (
    <InfoPage
      current="/docs"
      title="BankrDex Docs"
      updated="13 October 2026"
      intro={
        <>
          <p>
            BankrDex is a trading terminal for tokens launched with Bankr on Base, Robinhood Chain, Arbitrum and Arc. It
            combines Bankr&apos;s launch data with GeckoTerminal and Binance Web3 market data, reads launches and buys
            straight from the chain, and routes swaps through OKX DEX and Binance Web3 to find the best quote. BankrDex is
            non-custodial: your wallet signs every transaction. BankrDex is an independent interface and is not operated by Bankr.
          </p>
          <p className="mt-3">
            For the design behind it (data pipeline, launch verification, fee enforcement, security model and roadmap),
            read the <Link href="/whitepaper">Whitepaper</Link>.
          </p>
        </>
      }
      sections={[
        {
          id: 'getting-started',
          title: 'Getting started',
          body: (
            <ol>
              <li>Open the app. You can browse markets without a wallet.</li>
              <li>Click <strong>Connect</strong> and choose OKX Wallet, another browser wallet (MetaMask, Coinbase Wallet, Rabby, Trust), or <strong>WalletConnect QR</strong> for a phone wallet.</li>
              <li>Pick a token in the table and press <strong>Trade</strong>. When you swap, BankrDex asks your wallet to switch to the token&apos;s chain (and adds the chain if needed). You need a little native coin on that chain for gas.</li>
              <li>Accept the Terms of Service and Privacy Policy the first time you open the app.</li>
            </ol>
          ),
        },
        {
          id: 'status',
          title: 'Feature status',
          body: (
            <>
              <p>Most of BankrDex is live. Features marked <strong>Soon</strong> in the app are built but wait on the on-chain market index for Base (see <Link href="/whitepaper#roadmap">Roadmap</Link>).</p>
              <table>
                <thead><tr><th>Feature</th><th>Status</th></tr></thead>
                <tbody>
                  <tr><td>Markets, charts, launch data, All launches registry</td><td>Live</td></tr>
                  <tr><td>Pulse, indexed safety checks (snipers, bundled buys)</td><td>Fill in as the on-chain index for Base runs</td></tr>
                  <tr><td>Swaps through OKX DEX and Binance Web3 (Recommended / OKX / Binance routes)</td><td>Live on Base, Robinhood and Arbitrum; not yet on Arc (no aggregator routes Arc yet)</td></tr>
                  <tr><td>Pool direct swaps (Uniswap V4, no aggregator)</td><td>Live on Robinhood; <strong>Soon</strong> on Base</td></tr>
                  <tr><td>Quick buy (⚡) from the market table</td><td>Live on Robinhood; <strong>Soon</strong> on Base</td></tr>
                  <tr><td>Orders &amp; alerts (limit buy, take profit, stop loss, price alerts)</td><td><strong>Soon</strong></td></tr>
                  <tr><td>Creator-fee view and claim</td><td>Live</td></tr>
                  <tr><td>Profiles, theses, feed, leaderboard</td><td>Live; trade-based numbers (PnL, leaderboard, trades feed) fill in as the index runs</td></tr>
                </tbody>
              </table>
            </>
          ),
        },
        {
          id: 'sources',
          title: 'Chains and emblems',
          body: (
            <>
              <p>The small emblem on each token logo shows its chain. Use the tabs above the table (All chains, Base, Robinhood, Arbitrum, Arc) to switch chains.</p>
              <table>
                <thead><tr><th>Source</th><th>What it includes</th></tr></thead>
                <tbody>
                  <tr><td>Bankr</td><td>Tokens launched with Bankr: the latest launches from Bankr&apos;s public API plus every Bankr pool GeckoTerminal tracks, with holder, burn and creator-fee data. The list grows as new tokens trade.</td></tr>
                  <tr><td>Binance Web3</td><td>Other tokens from Binance Web3&apos;s hot list on Base.</td></tr>
                </tbody>
              </table>
              <p>The second, smaller logo next to a token is its <strong>pair</strong> token (for example WETH or BNKR), shown as <code>TOKEN / PAIR</code>.</p>
              <p><strong>Only verified Bankr launches are listed.</strong> Other launchpads reuse the same Doppler pools, so every token is checked (Bankr&apos;s own records, the on-chain launch registry, or the launch setup on-chain) before it appears. The token page shows a <em>Verified Bankr launch</em> badge.</p>
            </>
          ),
        },
        {
          id: 'table',
          title: 'Reading the market table',
          body: (
            <>
              <table>
                <thead><tr><th>Column</th><th>Meaning</th></tr></thead>
                <tbody>
                  <tr><td>Token / Age</td><td>Symbol, pair, age since launch (or since the pool was created), contract, and social links.</td></tr>
                  <tr><td>Price</td><td>Latest USD price.</td></tr>
                  <tr><td>Bought</td><td>Time since the last buy. A green dot marks a buy read from the Uniswap V4 swap log on Base; for other sources it is the last trade.</td></tr>
                  <tr><td>5m / 1h / 24h</td><td>Price change over each window. Values flash when they update.</td></tr>
                  <tr><td>MCap / Liq</td><td>Market cap and pool liquidity in USD.</td></tr>
                  <tr><td>Vol / Txns</td><td>Volume and buy / sell count for the window chosen with the <strong>5m · 1h · 4h · 24h</strong> buttons. The bar shows the buy-to-sell ratio.</td></tr>
                  <tr><td>Holders</td><td>Holder count indexed by GeckoTerminal; it may lag the chain slightly.</td></tr>
                  <tr><td>Burned / Top 10</td><td>Bankr only: tokens held by the burn address, and the share of supply held by the 10 largest wallets (this includes the pool and vesting contracts).</td></tr>
                  <tr><td>Info</td><td>DexScreener profile status (green check = paid profile) and <strong>LP</strong> when a DEX pool is live.</td></tr>
                </tbody>
              </table>
              <p><strong>Inactive tokens are hidden.</strong> Every tab lists tokens launched in the last 24 hours (traded or not) and older tokens with at least one transaction in the last 24 hours (BNKR is always listed). Hidden tokens are not deleted: they reappear as soon as they trade again. Transaction counts can lag by a few minutes.</p>
              <p>Click any column header to sort; click again to reverse, and a third time to return to the preset (Top, New, Gainers, Recent buys). Use <strong>View</strong> to change density, hide columns, or hide the banner. <strong>Filters</strong> (market cap, liquidity, volume, transactions, age, socials, fake symbols) can be saved as presets, and the <strong>★ watchlist</strong> keeps tokens you follow. These choices are remembered in your browser.</p>
            </>
          ),
        },
        {
          id: 'launches',
          title: 'All launches and Pulse',
          body: (
            <ul>
              <li><strong>All launches</strong> (<Link href="/launches">/launches</Link>) lists every Bankr launch on Base, read from Doppler&apos;s Airlock contract on-chain, newest first and searchable by symbol or address. Look-alike launches that name Bankr but lack Bankr&apos;s launch setup are left out.</li>
              <li><strong>Pulse</strong> shows New, Heating up and Trending columns, refreshed every few seconds. It reads the on-chain index for Base and fills in once the index runs.</li>
              <li>The header shows how far the on-chain index is behind the chain and warns when it falls 10+ minutes behind.</li>
            </ul>
          ),
        },
        {
          id: 'badges',
          title: 'Badges and warnings',
          body: (
            <ul>
              <li><strong>Fake symbol?</strong>: the symbol matches a major asset (ETH, USDC, BNKR, ...) but the contract is different. Check the address before trading.</li>
              <li><strong>Tax B/S%</strong>: the token contract charges a buy / sell tax, taken on top of normal fees.</li>
              <li><strong>Not burned yet</strong>: less than one token has been sent to the burn address.</li>
              <li><strong>Verified Bankr launch</strong> / <strong>Not a Bankr launch</strong>: the result of the launch verification.</li>
            </ul>
          ),
        },
        {
          id: 'safety',
          title: 'Safety checks',
          body: (
            <>
              <p>The token page has a safety card. Each line is marked <em>Info</em>, <em>Caution</em> or <em>Red flag</em>:</p>
              <ul>
                <li><strong>Sellable</strong>: a sell is simulated against the pool to catch honeypots.</li>
                <li><strong>Dev holds</strong>: how much of the supply the creator still holds, and how many tokens they have launched.</li>
                <li><strong>Snipers</strong>: wallets that bought in the first 2 blocks after trading opened, and what they still hold.</li>
                <li><strong>Bundled buys</strong>: several buys of the token in one transaction.</li>
                <li><strong>Top 10 holders</strong>, <strong>Holders</strong>, <strong>Burned</strong>, and indexed <strong>buyers / sellers</strong>.</li>
              </ul>
              <p>Checks built on indexed swaps (snipers, bundled buys, buyers / sellers) need the on-chain index for Base and stay empty until it runs. A clean card is never a guarantee: always do your own research.</p>
            </>
          ),
        },
        {
          id: 'swap',
          title: 'Swapping',
          body: (
            <>
              <p>Pick a route at the top of the swap panel:</p>
              <table>
                <thead><tr><th>Route</th><th>What it does</th></tr></thead>
                <tbody>
                  <tr><td>Recommended</td><td>Asks OKX DEX and Binance Web3 and uses the better quote; the other is kept as an automatic backup. If no aggregator serves the token, it uses the token&apos;s own pool.</td></tr>
                  <tr><td>Pool direct</td><td>Swaps straight against the token&apos;s Uniswap V4 pool through Uniswap&apos;s Universal Router, without an aggregator. Live on Robinhood; <strong>Soon</strong> on Base.</td></tr>
                  <tr><td>OKX</td><td>OKX DEX aggregator only.</td></tr>
                  <tr><td>Binance</td><td>Binance Web3 aggregator only.</td></tr>
                </tbody>
              </table>
              <ol>
                <li>Enter the amount you pay, or use 25% / 50% / 75% / MAX (MAX keeps a little for gas). You can pay with the native coin, the pool&apos;s pair token, stablecoins or other main tokens.</li>
                <li>Press <strong>Swap</strong> to open the review screen: amount paid, estimated and minimum received, price impact, slippage, platform fee, and route.</li>
                <li>Press <strong>Confirm swap</strong>, then approve in your wallet. Tokens other than the native coin first need an approval for exactly the amount you swap, never unlimited.</li>
              </ol>
              <ul>
                <li><strong>Quote validity:</strong> quotes refresh automatically and are valid for 25 seconds; an expired quote cannot be confirmed.</li>
                <li><strong>Slippage:</strong> choose 0.5%, 1%, 3%, 5%, or a custom value up to 50%. Above 5% you are warned that you may receive much less.</li>
                <li><strong>Price impact:</strong> highlighted from 3%. From 10% you must tick a box acknowledging the loss before swapping.</li>
                <li>On phones, use the <strong>Buy / Sell</strong> bar at the bottom of a token page to open the swap panel.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'orders',
          title: 'Quick buy, orders and alerts (Soon)',
          body: (
            <>
              <ul>
                <li><strong>Quick buy (⚡)</strong>: a one-click buy of a fixed ETH amount (set in the toolbar) from the market table, straight into the token&apos;s pool. Your wallet still confirms it. Live on Robinhood; <strong>Soon</strong> on Base.</li>
                <li><strong>Orders &amp; alerts</strong> (<strong>Soon</strong>): limit buy, take profit, stop loss, and price alerts above or below a level, with an expiry.</li>
              </ul>
              <p>How orders will work: they are kept in your browser, not on a server. While a BankrDex tab is open, prices are checked every few seconds; when a level is reached you get a notification and your wallet is asked to confirm the swap. BankrDex never holds funds or signs for you, so an order does not run while every BankrDex tab is closed, or if you do not confirm it.</p>
            </>
          ),
        },
        {
          id: 'fees',
          title: 'Fees',
          body: (
            <table>
              <thead><tr><th>Fee</th><th>Amount</th><th>Paid to</th></tr></thead>
              <tbody>
                <tr><td>BankrDex platform fee</td><td>0.1% of the input amount, inside the swap transaction, on every route</td><td>BankrDex</td></tr>
                <tr><td>Network gas</td><td>Set by the chain (usually a few cents or less on Base)</td><td>Network</td></tr>
                <tr><td>Bankr pool fee</td><td>Set at launch and never changed afterwards. New Doppler launches: 1.75% of each trade (creator 0.665%, liquidity 0.285%, Bankr 0.475%, BNKR buyback 0.2375%, Doppler protocol about 0.0875%); older Doppler launches keep their original rate. Bankr Launch v3 tokens (Arc and some Arbitrum launches): a 1% Uniswap v3 pool fee, split 70% creator / 30% Bankr.</td><td>Creator, LP, Bankr, BNKR buyback, Doppler</td></tr>
                <tr><td>Router / pool fees</td><td>Set by the route (shown as route fee)</td><td>Router and liquidity pools</td></tr>
                <tr><td>Token tax</td><td>Set by the token contract (Tax badge)</td><td>Token project</td></tr>
              </tbody>
            </table>
          ),
        },
        {
          id: 'bankr',
          title: 'Bankr launches and creator fees',
          body: (
            <ul>
              <li>Bankr launches on Robinhood Chain (Bankr&apos;s default), Base, Arbitrum and Arc. Doppler launches trade from the first block in a Uniswap V4 pool, paired with WETH by default and sometimes with BNKR or another asset. Bankr Launch v3 tokens (Arc and some Arbitrum launches) trade in a single Uniswap v3 pool paired with USDC. There is no bonding curve.</li>
              <li>The <strong>Bankr launch</strong> card on a token page shows who launched it (with their X profile when Bankr has it), who receives the creator fees, the launch post and transaction, and the fees earned so far.</li>
              <li>If your connected wallet is the fee recipient, <strong>Claim</strong> asks Bankr to build the claim transaction and your wallet signs it. BankrDex never holds or redirects these fees.</li>
              <li>Launch data comes from Bankr&apos;s public API (api.bankr.bot); creator-fee numbers come from the same API and may lag the chain by a few minutes.</li>
            </ul>
          ),
        },
        {
          id: 'chart',
          title: 'Charts',
          body: (
            <ul>
              <li>Candles come from GeckoTerminal for the selected pool (including Uniswap V4 pool ids), from the on-chain index on Base when it runs, or from Binance Web3 when neither has the pool yet.</li>
              <li>Switch timeframes (1m to 1D), Price or MCAP view, candles or line, and toggle EMA, RSI, volume, and buy / sell markers. A thesis can be drawn on the chart with <strong>Show on chart</strong>.</li>
              <li>Each token page has its own link (<code>/token/0x…</code>, with <code>?chain=…</code> outside Base) that you can share.</li>
            </ul>
          ),
        },
        {
          id: 'social',
          title: 'Profiles, theses, feed and leaderboard',
          body: (
            <>
              <ul>
                <li><strong>Sign in with your wallet</strong> (Sign-In with Ethereum): a free signature, not a transaction. The session lasts 7 days.</li>
                <li><strong>Profile</strong>: a unique username (3–20 characters: a–z, 0–9, _), display name, bio, color, X / Farcaster / website links, avatar and banner. Your page is at <code>/u/&lt;username&gt;</code>.</li>
                <li><strong>Theses</strong>: post a bullish or bearish idea on a Bankr token with a title, reasoning, entry / target / stop and a timeframe. Others can like and comment. The price at posting is recorded, so &quot;since post&quot; performance and the <em>Target hit</em> / <em>Stopped out</em> badges are honest.</li>
                <li><strong>Feed</strong> (<Link href="/feed">/feed</Link>): latest and top theses, theses from people you follow, and live trades from wallets with a BankrDex profile.</li>
                <li><strong>Leaderboard</strong> (<Link href="/leaderboard">/leaderboard</Link>): wallets trading Bankr pools, ranked by estimated PnL or volume over 24 hours or 7 days. Any wallet can be followed.</li>
              </ul>
              <p>What you post is public. Leaderboard PnL is an estimate from indexed swaps, not an audited result. Trade-based numbers need the on-chain index for Base.</p>
            </>
          ),
        },
        {
          id: 'portfolio',
          title: 'Portfolio and swap history',
          body: (
            <ul>
              <li>Portfolio shows your native coin, stablecoins, and token balances found among the tokens BankrDex tracks, with their USD value.</li>
              <li>Swaps you make from this browser are listed with their status and explorer link. This history is stored only on your device.</li>
            </ul>
          ),
        },
        {
          id: 'settings',
          title: 'Settings',
          body: (
            <ul>
              <li><strong>Theme</strong>: the sun / moon button in the header.</li>
              <li><strong>Language</strong>: English, 中文, 日本語 and 한국어 in Settings (gear icon).</li>
              <li><strong>Passkey / PIN lock</strong>: locks the BankrDex interface in this browser (salted hash, five-attempt lockout). It does not protect your wallet; your wallet remains the real protection.</li>
            </ul>
          ),
        },
        {
          id: 'security',
          title: 'Security tips',
          body: (
            <ul>
              <li>BankrDex never asks for your recovery phrase or private key. Anyone who does is a scammer.</li>
              <li>Always check the contract address (copy it from the token page) against the project&apos;s official channels.</li>
              <li>Read the review screen and your wallet&apos;s confirmation before signing. Signing in with your wallet is a message signature and never moves funds.</li>
              <li>Start with small amounts on new tokens; watch for high tax, low liquidity, red flags in the safety card, and the &quot;Fake symbol?&quot; badge.</li>
            </ul>
          ),
        },
        {
          id: 'faq',
          title: 'FAQ',
          body: (
            <>
              <p><strong>Why is a brand-new token so expensive to buy in its first seconds?</strong><br />Doppler launches start with an anti-snipe fee of 80% that decays to the normal rate over 14 seconds. For the first 5 minutes after a non-partner Doppler launch, no wallet may hold more than 2% of the supply; swaps that break this rule fail.</p>
              <p><strong>Why did my swap fail?</strong><br />Usually the price moved beyond your slippage, the quote expired, or you lacked gas. Refresh the quote and try again; consider higher slippage only for volatile tokens.</p>
              <p><strong>Why is Pool direct or Quick buy marked Soon?</strong><br />On Base they find the token&apos;s pool in BankrDex&apos;s on-chain index, which is being brought online. Until then, swap Base tokens with the Recommended, OKX or Binance route.</p>
              <p><strong>Why is a value shown as &quot;—&quot;?</strong><br />The data source has no value for it yet (for example a token with no recent trades).</p>
            </>
          ),
        },
        {
          id: 'legal',
          title: 'Terms and privacy',
          body: (
            <p>
              Using BankrDex means you accept the <Link href="/terms">Terms of Service</Link>. The{' '}
              <Link href="/privacy">Privacy Policy</Link> explains what data is used and where it goes.
            </p>
          ),
        },
      ]}
    />
  );
}
