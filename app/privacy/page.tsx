import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '../../src/components/InfoPage';
import { LEGAL_UPDATED } from '../../src/config/legal';

export const metadata: Metadata = {
  title: 'Privacy Policy · BankrDex',
  description: 'What data the BankrDex interface uses, where it is stored, and which services receive it.',
};

export default function PrivacyPage() {
  return (
    <InfoPage
      current="/privacy"
      title="Privacy Policy"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          BankrDex is designed to work without accounts. This page explains what data the Interface uses, where it
          stays, and which third parties receive it so the Interface can work.
        </p>
      }
      sections={[
        {
          id: 'no-account',
          title: '1. No account, no identity checks',
          body: (
            <p>
              You do not need an account to trade and we do not ask for your name, email, phone number, or identity
              documents. BankrDex never receives your private keys or recovery phrase. Social features (profiles,
              theses, follows) are optional: you sign in by signing a message with your wallet, which costs nothing.
            </p>
          ),
        },
        {
          id: 'collected',
          title: '2. Data the Interface uses',
          body: (
            <table>
              <thead>
                <tr><th>Data</th><th>Why</th><th>Where it goes</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Public wallet address</td>
                  <td>Show balances, build swap quotes and transactions</td>
                  <td>Your browser; our server forwards it to the swap router (OKX DEX or Binance Web3) when you request a quote or swap; public Base RPC providers</td>
                </tr>
                <tr>
                  <td>Optional public profile: username, display name, bio, links, avatar and banner images, theses, comments, likes and follows</td>
                  <td>Show your profile, theses and trades to other users</td>
                  <td>Our database (Supabase); public to everyone. Delete a thesis or comment at any time; ask us to remove your profile</td>
                </tr>
                <tr>
                  <td>Sign-in cookie (httpOnly, 7 days) holding your wallet address</td>
                  <td>Keep you signed in to post, like and follow</td>
                  <td>Your browser only; signed by our server, cleared when you sign out</td>
                </tr>
                <tr>
                  <td>IP address</td>
                  <td>Rate limiting and abuse prevention</td>
                  <td>Kept in short-lived (about 60 second) rate-limit counters; standard request logs of our hosting provider</td>
                </tr>
                <tr>
                  <td>Anonymous visitor ID (a random code created in your browser), the time of your last visit, and your public wallet address if you connect one</td>
                  <td>Count visitors (online now, unique visitors per day) without counting the same browser or wallet twice</td>
                  <td>Our database (Supabase), sent about once a minute while a BankrDex tab is open, only after you accept these policies. It contains no name, email, or IP address</td>
                </tr>
                <tr>
                  <td>Token addresses you view or search</td>
                  <td>Load prices, charts, and token data</td>
                  <td>Market data providers listed below</td>
                </tr>
              </tbody>
            </table>
          ),
        },
        {
          id: 'local',
          title: '3. Stored only in your browser',
          body: (
            <>
              <p>These stay in your browser&apos;s local storage and are never sent to BankrDex servers:</p>
              <ul>
                <li>Preferences: theme, language, table layout, sound.</li>
                <li>Your swap history on this device.</li>
                <li>The optional device lock: a salted PIN hash and a passkey credential ID.</li>
                <li>Your acceptance of these policies (date and version).</li>
              </ul>
              <p>The anonymous visitor ID is also kept here; it is the one item sent to BankrDex (see section 2).</p>
              <p>Clearing your browser data removes them. BankrDex does not set tracking cookies.</p>
            </>
          ),
        },
        {
          id: 'third-parties',
          title: '4. Third-party services',
          body: (
            <>
              <p>To show data and build swaps, requests are sent to:</p>
              <ul>
                <li><strong>Swap routing:</strong> OKX DEX, Binance Web3.</li>
                <li><strong>Market data:</strong> GeckoTerminal, DexScreener, Bankr (api.bankr.bot), Binance Web3, DefiLlama (ETH and quote-token prices), public IPFS gateways (token artwork).</li>
                <li><strong>Blockchain access:</strong> public Base RPC providers; WalletConnect / Reown if you connect by QR code.</li>
                <li><strong>Hosting and storage:</strong> Vercel (hosting) and Supabase (cached public market data and anonymous visitor statistics).</li>
                <li><strong>Fonts:</strong> Google Fonts.</li>
              </ul>
              <p>
                Optional, only when enabled by the operator: error reports (Sentry), which exclude wallet addresses,
                request headers, bodies, and query strings; and privacy-friendly page analytics (Vercel Web Analytics).
              </p>
              <p>Each service handles data under its own privacy policy.</p>
            </>
          ),
        },
        {
          id: 'blockchain',
          title: '5. Public blockchain data',
          body: (
            <p>
              Transactions you sign are recorded publicly and permanently on Base. BankrDex cannot change or delete
              on-chain data.
            </p>
          ),
        },
        {
          id: 'sharing',
          title: '6. Sale and sharing',
          body: <p>We do not sell personal data and do not use it for advertising.</p>,
        },
        {
          id: 'choices',
          title: '7. Your choices',
          body: (
            <ul>
              <li>You can use the market pages without connecting a wallet.</li>
              <li>You can disconnect your wallet and clear local data at any time from your browser.</li>
              <li>Swap history can be cleared from the Portfolio window.</li>
            </ul>
          ),
        },
        {
          id: 'changes',
          title: '8. Changes',
          body: (
            <p>
              We may update this policy; the date above shows the current version, and material changes are shown to you
              again in the Interface. See also the <Link href="/terms">Terms of Service</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
