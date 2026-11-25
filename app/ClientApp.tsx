'use client';

import dynamic from 'next/dynamic';
import type { ChainKey } from '../src/config/chains';
import type { InitialView } from '../src/App';

// The trading UI depends on browser-only APIs (wallets, storage, canvas), so it is
// rendered on the client; pages around it can still be server components.
const BankrDexApp = dynamic(() => import('../src/App'), {
  ssr: false,
  loading: () => (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#06070a]" aria-busy="true" aria-label="Loading BankrDex">
      <img src="/sources/bankrdex-mark.svg" alt="" width={72} height={72} className="splash-mark rounded-[28%]" />
      <span className="font-display text-xl font-bold tracking-[-0.04em] text-[#f5f7fa]">Bankr<span className="text-gradient">Dex</span></span>
      <span className="splash-track"><span /></span>
    </main>
  ),
});

export default function ClientApp({ initialTokenAddress, initialTokenChain, initialView }: { initialTokenAddress?: string; initialTokenChain?: ChainKey; initialView?: InitialView }) {
  return <BankrDexApp initialTokenAddress={initialTokenAddress} initialTokenChain={initialTokenChain} initialView={initialView} />;
}
