import Link from 'next/link';
import type { ReactNode } from 'react';

export interface InfoSection {
  id: string;
  title: string;
  body: ReactNode;
}

const NAV = [
  { href: '/docs', label: 'Docs' },
  { href: '/whitepaper', label: 'Whitepaper' },
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
];

// Shared shell for the static Docs / Terms / Privacy pages (server-rendered, no app state).
export function InfoPage({ title, intro, updated, current, sections }: {
  title: string;
  intro: ReactNode;
  updated: string;
  current: '/docs' | '/whitepaper' | '/terms' | '/privacy';
  sections: InfoSection[];
}) {
  return (
    <div className="min-h-screen text-fg">
      <header className="site-header sticky top-0 z-20">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="BankrDex home">
            <img src="/sources/bankrdex-mark.svg" alt="" width={30} height={30} className="brand-mark-shell rounded-[28%]" />
            <span className="font-display text-[1.05rem] font-bold tracking-[-0.04em] text-fg">Bankr<span className="text-gradient">Dex</span></span>
          </Link>
          <nav aria-label="Information pages" className="flex items-center gap-1 text-xs sm:text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={item.href === current ? 'page' : undefined}
                className="nav-link px-2 sm:px-3"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/" className="btn-gradient ml-1 rounded-xl px-3 py-1.5 font-extrabold sm:px-4">Open app</Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-20 space-y-1 text-sm">
            <p className="mb-2 text-[0.75rem] font-semibold uppercase tracking-wide text-subtle">On this page</p>
            {sections.map((section) => (
              <a key={section.id} href={`#${section.id}`} className="block rounded-lg border-l-2 border-transparent px-2.5 py-1 text-muted hover:border-accent hover:bg-raised/60 hover:text-fg">
                {section.title}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mt-1 text-xs text-subtle">Last updated {updated}</p>
          <div className="mt-4 text-[0.9375rem] leading-relaxed text-fg-soft">{intro}</div>

          <details className="mt-6 rounded-lg border border-line bg-panel p-3 text-sm lg:hidden">
            <summary className="cursor-pointer font-semibold">Contents</summary>
            <ol className="mt-2 space-y-1">
              {sections.map((section) => (
                <li key={section.id}><a href={`#${section.id}`} className="text-muted hover:text-fg">{section.title}</a></li>
              ))}
            </ol>
          </details>

          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-20 border-t border-line pt-6 mt-8 first-of-type:mt-8">
              <h2 className="text-lg font-bold text-fg sm:text-xl">{section.title}</h2>
              <div className="info-prose mt-3 space-y-3 text-[0.9375rem] leading-relaxed text-fg-soft">{section.body}</div>
            </section>
          ))}

          <footer className="mt-12 border-t border-line pt-6 text-xs text-subtle">
            BankrDex is a non-custodial interface for Bankr tokens. Nothing on this site is financial advice.
          </footer>
        </main>
      </div>
    </div>
  );
}
