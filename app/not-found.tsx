import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-surface px-4 text-center text-fg">
      <img src="/sources/bankrdex-mark.svg" alt="BankrDex" width={64} height={64} className="brand-mark-shell rounded-[28%]" />
      <div>
        <h1 className="text-xl font-bold">Page or token not found</h1>
        <p className="mt-2 max-w-sm text-sm text-muted">
          The link may be mistyped, or the token address is not a valid Base contract.
        </p>
      </div>
      <form action="/" method="get" className="w-full max-w-sm" role="search">
        <label htmlFor="not-found-search" className="sr-only">Token contract address</label>
        <input
          id="not-found-search"
          name="q"
          placeholder="Paste a token contract (0x…)"
          className="w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm outline-none placeholder:text-subtle focus:border-accent"
        />
      </form>
      <Link href="/" className="rounded-lg bg-accent px-4 py-2 text-sm font-bold text-black hover:brightness-110">
        Back to markets
      </Link>
    </main>
  );
}
