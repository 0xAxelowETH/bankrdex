import { after } from 'next/server';

// Runs work after the response is sent. On Vercel a plain un-awaited promise is frozen with the
// function once the response is returned, so stale-while-revalidate refreshes would never finish;
// `after` keeps the function alive until the work settles. Outside a request (tests, scripts)
// it falls back to a fire-and-forget call.
export function runInBackground(task: () => Promise<unknown>): void {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}
