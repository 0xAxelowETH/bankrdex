// Minimal JSON-RPC client for Base with fallback across public endpoints.
const ENDPOINTS = ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.drpc.org'];

export async function baseRpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(6_000),
        cache: 'no-store',
      });
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message || 'RPC error');
      return payload.result as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('All Base RPC endpoints failed.');
}

const tokenMetaCache = new Map<string, { symbol: string; decimals: number }>();

function decodeString(hex: string): string {
  const data = hex.replace(/^0x/, '');
  if (data.length >= 192) {
    const length = parseInt(data.slice(64, 128), 16);
    return Buffer.from(data.slice(128, 128 + length * 2), 'hex').toString('utf8');
  }
  // bytes32-style symbols
  return Buffer.from(data, 'hex').toString('utf8').replace(/\0+$/, '');
}

export async function tokenMeta(address: string): Promise<{ symbol: string; decimals: number }> {
  const key = address.toLowerCase();
  const cached = tokenMetaCache.get(key);
  if (cached) return cached;
  const [symbolHex, decimalsHex] = await Promise.all([
    baseRpc<string>('eth_call', [{ to: key, data: '0x95d89b41' }, 'latest']).catch(() => '0x'),
    baseRpc<string>('eth_call', [{ to: key, data: '0x313ce567' }, 'latest']).catch(() => '0x12'),
  ]);
  const meta = {
    symbol: (decodeString(symbolHex).replace(/[^\p{L}\p{N}$._-]/gu, '').slice(0, 16)) || 'TOKEN',
    decimals: Math.min(36, parseInt(decimalsHex, 16) || 18),
  };
  tokenMetaCache.set(key, meta);
  return meta;
}

export function formatUnits(raw: bigint, decimals: number): string {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`;
}
