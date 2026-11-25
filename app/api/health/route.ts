import { runChecks } from '../../../src/server/healthChecks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESULT_TTL_MS = 30_000;
let cached: { at: number; body: Record<string, unknown>; status: number } | null = null;
let inFlight: Promise<{ body: Record<string, unknown>; status: number }> | null = null;

export async function GET() {
  if (!cached || Date.now() - cached.at > RESULT_TTL_MS) {
    inFlight ??= runChecks().finally(() => { inFlight = null; });
    const result = await inFlight;
    cached = { at: Date.now(), ...result };
  }
  return Response.json(cached.body, {
    status: cached.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
