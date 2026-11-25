import { getBinanceWeb3Credentials } from './binanceWeb3Credentials';
import { getOkxDexCredentials } from './okxCredentials';

// Shared by /api/health and the scheduled Telegram alerts so both judge health the same way.
export type CheckStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface CheckResult {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
}

// Core services the market view cannot work without; aggregators only affect swaps.
const CORE_CHECKS = new Set(['geckoterminal', 'bankr', 'baseRpc']);

async function timed(probe: () => Promise<Response>, isHealthy: (response: Response) => boolean = (r) => r.ok): Promise<CheckResult> {
  const startedAt = Date.now();
  try {
    const response = await probe();
    const latencyMs = Date.now() - startedAt;
    return isHealthy(response)
      ? { status: latencyMs > 3_000 ? 'degraded' : 'ok', latencyMs }
      : { status: 'down', latencyMs, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { status: 'down', latencyMs: Date.now() - startedAt, detail: error instanceof Error ? error.name : 'error' };
  }
}

const probe = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, signal: AbortSignal.timeout(5_000), cache: 'no-store' });

export async function runChecks() {
  const okx = getOkxDexCredentials();
  const binance = getBinanceWeb3Credentials();
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const entries = await Promise.all([
    ['geckoterminal', timed(() => probe('https://api.geckoterminal.com/api/v2/networks?page=1', {
      headers: { Accept: 'application/json;version=20230302' },
    }))],
    // Small public endpoint, cached 30 s by Bankr.
    ['bankr', timed(() => probe('https://api.bankr.bot/token-launches/quote-tokens?chain=base', {
      headers: { Accept: 'application/json' },
    }))],
    ['baseRpc', timed(() => probe('https://base-rpc.publicnode.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    }))],
    ['supabase', supabaseUrl && serviceRoleKey
      ? timed(() => probe(`${supabaseUrl}/rest/v1/bankrdex_token_catalog?select=token_address&limit=1`, {
          headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        }))
      : Promise.resolve<CheckResult>({ status: 'unconfigured' })],
    // Reachability only: any HTTP answer means the host is reachable from this region.
    ['okx', okx.apiKey && okx.secretKey && okx.passphrase
      ? timed(() => probe('https://web3.okx.com/api/v6/dex/aggregator/supported/chain'), () => true)
      : Promise.resolve<CheckResult>({ status: 'unconfigured' })],
    ['binanceWeb3', binance.apiKey && binance.secretKey
      ? timed(() => probe('https://web3.binance.com/'), () => true)
      : Promise.resolve<CheckResult>({ status: 'unconfigured' })],
  ].map(async ([name, check]) => [name, await check] as const));

  const checks = Object.fromEntries(entries) as Record<string, CheckResult>;
  const coreDown = [...CORE_CHECKS].some((name) => checks[name]?.status === 'down');
  const anyProblem = Object.values(checks).some((check) => check.status !== 'ok');
  const status = coreDown ? 'down' : anyProblem ? 'degraded' : 'ok';
  return {
    status: coreDown ? 503 : 200,
    body: { status, checkedAt: new Date().toISOString(), checks },
  };
}
