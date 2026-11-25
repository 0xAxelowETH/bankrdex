import { timingSafeEqual } from 'node:crypto';
import { PLATFORM_FEE_RECEIVER } from '../../../../src/config/platformFee';
import { baseRpc, formatUnits } from '../../../../src/server/baseRpc';
import { runChecks } from '../../../../src/server/healthChecks';
import { readState, writeState } from '../../../../src/server/notifyState';
import { escapeHtml, isTelegramConfigured, sendTelegram } from '../../../../src/server/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEALTH_KEY = 'health-alert';
const ETH_KEY = 'fee-wallet-eth';
const REMIND_EVERY_MS = 60 * 60_000;
// Every increase is reported, however small.
const MIN_ETH_DELTA = 1n;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const url = new URL(request.url);
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface HealthState {
  status: 'ok' | 'degraded' | 'down';
  problems: string[];
  since: string;
  lastAlertAt: number;
}

async function checkHealth(): Promise<string> {
  const { body } = await runChecks();
  const status = body.status as HealthState['status'];
  const checks = body.checks as Record<string, { status: string; detail?: string }>;
  const problems = Object.entries(checks)
    .filter(([, check]) => check.status === 'down' || check.status === 'degraded')
    .map(([name, check]) => `${name}: ${check.status}${check.detail ? ` (${check.detail})` : ''}`);
  const previous = await readState<HealthState>(HEALTH_KEY);
  const now = Date.now();
  const changed = !previous || previous.status !== status || previous.problems.join() !== problems.join();
  const remind = previous && status !== 'ok' && now - previous.lastAlertAt > REMIND_EVERY_MS;

  if (changed || remind) {
    const recovered = status === 'ok' && previous && previous.status !== 'ok';
    // The first run only records the baseline unless something is already wrong.
    if (previous || status !== 'ok') {
      await sendTelegram(recovered
        ? `✅ <b>BankrDex recovered</b>\nAll services are healthy again.`
        : `${status === 'down' ? '🔴' : '🟠'} <b>BankrDex ${status === 'down' ? 'DOWN' : 'degraded'}</b>${remind && !changed ? ' (still)' : ''}\n${problems.map((p) => `• ${escapeHtml(p)}`).join('\n')}`);
    }
    await writeState(HEALTH_KEY, {
      status,
      problems,
      since: changed ? new Date(now).toISOString() : previous!.since,
      lastAlertAt: now,
    } satisfies HealthState);
  }
  return status;
}

async function checkEthFees(): Promise<string> {
  const balance = BigInt(await baseRpc<string>('eth_getBalance', [PLATFORM_FEE_RECEIVER, 'latest']));
  const previous = await readState<string>(ETH_KEY);
  if (previous === null) {
    await writeState(ETH_KEY, balance.toString());
    return 'baseline';
  }
  const delta = balance - BigInt(previous);
  // Follow the balance down after spending.
  if (delta < MIN_ETH_DELTA) {
    if (delta < 0n) await writeState(ETH_KEY, balance.toString());
    return 'unchanged';
  }
  await writeState(ETH_KEY, balance.toString());
  await sendTelegram([
    '🤖 <b>BankrDex ETH fee received</b>',
    `• <b>+${formatUnits(delta, 18)} ETH</b> since the last report`,
    `Balance: ${formatUnits(balance, 18)} ETH`,
    `<a href="https://basescan.org/address/${PLATFORM_FEE_RECEIVER}#internaltx">View on BaseScan</a>`,
  ].join('\n'));
  return `+${formatUnits(delta, 18)}`;
}

// Called every few minutes by an external scheduler (e.g. cron-job.org) with the CRON_SECRET.
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isTelegramConfigured()) return Response.json({ error: 'Telegram is not configured.' }, { status: 503 });
  const [health, eth] = await Promise.allSettled([checkHealth(), checkEthFees()]);
  return Response.json({
    health: health.status === 'fulfilled' ? health.value : `error: ${String(health.reason).slice(0, 100)}`,
    ethFees: eth.status === 'fulfilled' ? eth.value : `error: ${String(eth.reason).slice(0, 100)}`,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
