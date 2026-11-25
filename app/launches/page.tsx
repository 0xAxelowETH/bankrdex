import type { Metadata } from 'next';
import Link from 'next/link';
import { AllLaunches } from '../../src/components/AllLaunches';

export const metadata: Metadata = {
  title: 'All Bankr launches · BankrDex',
  description: 'Every token launched with Bankr on Base, read from the chain, newest first.',
};

export default function LaunchesPage() {
  return (
    <div className="min-h-screen text-fg">
      <header className="site-header sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="BankrDex home">
            <img src="/sources/bankrdex-mark.svg" alt="" width={30} height={30} className="brand-mark-shell rounded-[28%]" />
            <span className="font-display text-[1.05rem] font-bold tracking-[-0.04em] text-fg">Bankr<span className="text-gradient">Dex</span></span>
          </Link>
          <nav aria-label="Pages" className="flex items-center gap-1 text-xs sm:text-sm">
            <Link href="/docs" className="rounded px-2 py-1.5 text-muted hover:text-fg sm:px-3">Docs</Link>
            <Link href="/" className="btn-gradient ml-1 rounded-xl px-3 py-1.5 font-extrabold sm:px-4">Open app</Link>
          </nav>
        </div>
      </header>
      <AllLaunches />
    </div>
  );
}
