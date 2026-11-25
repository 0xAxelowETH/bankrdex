// Signed requests to OKX's DEX API (web3.okx.com) for server code. The /api/okx-dex proxy adds
// schema checks, a request queue and caching on top of the same signing.
import { createHmac } from 'node:crypto';
import { getOkxDexCredentials } from './okxCredentials';

export const isOkxConfigured = () => {
  const { apiKey, secretKey, passphrase } = getOkxDexCredentials();
  return Boolean(apiKey && secretKey && passphrase);
};

export function okxHeaders(method: 'GET' | 'POST', requestPath: string, body = ''): Record<string, string> {
  const { apiKey, secretKey, passphrase, projectId } = getOkxDexCredentials();
  if (!apiKey || !secretKey || !passphrase) throw new Error('OKX DEX credentials are not configured on the server.');
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', secretKey).update(`${timestamp}${method}${requestPath}${body}`).digest('base64');
  return {
    'OK-ACCESS-KEY': apiKey,
    'OK-ACCESS-SIGN': signature,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': passphrase,
    Accept: 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(projectId ? { 'OK-ACCESS-PROJECT': projectId } : {}),
  };
}

// chainIndex values OKX's aggregator swaps on (GET /api/v6/dex/aggregator/supported/chain).
export async function fetchOkxSupportedChainIndexes(): Promise<string[]> {
  const requestPath = '/api/v6/dex/aggregator/supported/chain';
  const response = await fetch(`https://web3.okx.com${requestPath}`, {
    headers: okxHeaders('GET', requestPath),
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null) as { code?: unknown; data?: unknown } | null;
  if (!response.ok || String(payload?.code) !== '0' || !Array.isArray(payload?.data)) {
    throw new Error(`OKX supported chains request failed (${response.status}).`);
  }
  return payload.data
    .map((item) => (item && typeof item === 'object' ? String((item as { chainIndex?: unknown; chainId?: unknown }).chainIndex ?? (item as { chainId?: unknown }).chainId ?? '') : ''))
    .filter(Boolean);
}
