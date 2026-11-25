import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '../../src/components/InfoPage';
import { LEGAL_UPDATED } from '../../src/config/legal';

export const metadata: Metadata = {
  title: 'Terms of Service · BankrDex',
  description: 'The terms that apply when you use the BankrDex interface on Base.',
};

export default function TermsPage() {
  return (
    <InfoPage
      current="/terms"
      title="Terms of Service"
      updated={LEGAL_UPDATED}
      intro={
        <p>
          These Terms govern your use of the BankrDex website and interface (the &quot;Interface&quot;). By using the
          Interface you agree to these Terms. If you do not agree, do not use the Interface.
        </p>
      }
      sections={[
        {
          id: 'what',
          title: '1. What BankrDex is',
          body: (
            <>
              <p>
                BankrDex is a <strong>non-custodial</strong> interface that shows market data for tokens on Base and
                helps you prepare swap transactions through third-party routers (OKX DEX and Binance Web3).
              </p>
              <ul>
                <li>BankrDex never holds your funds or private keys. Every transaction is signed and sent by your own wallet.</li>
                <li>BankrDex is not an exchange, broker, custodian, or financial adviser, and does not list or endorse tokens.</li>
                <li>Tokens shown come from public sources (Bankr, GeckoTerminal, Binance Web3). Appearing in the table is not a recommendation. BankrDex is independent and is not operated or endorsed by Bankr.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'eligibility',
          title: '2. Eligibility',
          body: (
            <ul>
              <li>You must be of legal age in your jurisdiction and able to enter into these Terms.</li>
              <li>You must not use the Interface if you are subject to sanctions, or if using it is unlawful where you live.</li>
              <li>You are responsible for complying with the laws, including tax laws, that apply to you.</li>
            </ul>
          ),
        },
        {
          id: 'fees',
          title: '3. Fees',
          body: (
            <>
              <p>
                BankrDex charges a <strong>platform fee of 0.1%</strong> of the input amount on swaps made through the
                Interface. The fee is included in the swap transaction built by the router and is shown on the review
                screen before you confirm.
              </p>
              <p>
                Network (gas) fees, router fees, token taxes, and price impact are separate and are set by the network,
                the router, or the token contract, not by BankrDex.
              </p>
            </>
          ),
        },
        {
          id: 'risks',
          title: '4. Risks you accept',
          body: (
            <>
              <p>Trading crypto assets, especially newly launched memecoins, is highly risky. You may lose all of the funds you trade. In particular:</p>
              <ul>
                <li>Prices can move sharply between quote and execution; slippage and price impact can be large.</li>
                <li>Tokens can be scams, copies of other tokens, honeypots, or have high buy/sell taxes. Badges such as &quot;Fake symbol?&quot; or &quot;Tax&quot; are automatic hints, not guarantees.</li>
                <li>Newly launched Bankr tokens can carry a high anti-snipe fee for their first seconds and a per-wallet holding cap for their first minutes; swaps that break these rules fail.</li>
                <li>Smart contracts, routers, wallets, and blockchains can fail or be exploited.</li>
                <li>Market data comes from third parties and can be delayed, incomplete, or wrong.</li>
              </ul>
              <p>Always verify the contract address and review the transaction in your wallet before signing.</p>
            </>
          ),
        },
        {
          id: 'use',
          title: '5. Acceptable use',
          body: (
            <ul>
              <li>Do not attack, overload, scrape at scale, or try to bypass the rate limits or security of the Interface.</li>
              <li>Do not use the Interface for market manipulation, fraud, money laundering, or other unlawful activity.</li>
              <li>Do not misrepresent BankrDex or its relationship with you or any project.</li>
            </ul>
          ),
        },
        {
          id: 'third-parties',
          title: '6. Third-party services',
          body: (
            <p>
              The Interface relies on third-party services, including OKX DEX, Binance Web3, GeckoTerminal, DexScreener,
              Bankr, WalletConnect, and public Base RPC providers. Their terms and policies apply to
              your use of them. BankrDex is not responsible for their availability, accuracy, or conduct.
            </p>
          ),
        },
        {
          id: 'local-lock',
          title: '7. Local device lock',
          body: (
            <p>
              The optional passkey / PIN lock is a convenience feature stored only in your browser. It does not protect
              your wallet; your wallet&apos;s own confirmation remains the security boundary for every transaction.
            </p>
          ),
        },
        {
          id: 'warranty',
          title: '8. No warranty',
          body: (
            <p>
              The Interface is provided <strong>&quot;as is&quot; and &quot;as available&quot;</strong>, without warranties of any kind,
              including fitness for a particular purpose, accuracy of data, or uninterrupted operation. Nothing on the
              Interface is financial, investment, legal, or tax advice.
            </p>
          ),
        },
        {
          id: 'liability',
          title: '9. Limitation of liability',
          body: (
            <p>
              To the maximum extent permitted by law, BankrDex and its contributors are not liable for any loss of funds,
              profits, data, or any indirect or consequential damages arising from your use of the Interface, third-party
              services, tokens, or blockchain networks.
            </p>
          ),
        },
        {
          id: 'changes',
          title: '10. Changes',
          body: (
            <p>
              We may update these Terms. The &quot;Last updated&quot; date shows the current version. When the Terms change
              materially, the Interface asks you to accept them again. Continued use after an update means you accept it.
              See also the <Link href="/privacy">Privacy Policy</Link> and the <Link href="/docs">Docs</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}
