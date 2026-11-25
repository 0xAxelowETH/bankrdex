// Minimal JSON-RPC client for any chain Bankr launches on, with fallback across the chain's
// public endpoints (src/config/chains.ts). Base keeps its own client in baseRpc.ts.
import { CHAINS, type ChainKey } from '../config/chains';
import { baseRpc } from './baseRpc';

export async function chainRpc<T>(chain: ChainKey, method: string, params: unknown[]): Promise<T> {
  if (chain === 'base') return baseRpc<T>(method, params);
  let lastError: unknown;
  for (const endpoint of CHAINS[chain].rpcUrls) {
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
  throw lastError instanceof Error ? lastError : new Error(`All ${CHAINS[chain].name} RPC endpoints failed.`);
}
