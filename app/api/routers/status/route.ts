import { CHAIN_KEYS, CHAINS, type ChainKey } from '../../../../src/config/chains';
import { getBinanceWeb3Credentials } from '../../../../src/server/binanceWeb3Credentials';
import { fetchOkxSupportedChainIndexes, isOkxConfigured } from '../../../../src/server/okxDex';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouterStatus {
  // API keys are set on this server.
  configured: boolean;
  // Chains the router is used on. `verified`: confirmed by the router's own supported-chain list.
  chains: ChainKey[];
  verified: boolean;
}

let okxCache: { at: number; indexes: string[] } | null = null;

// Which swap routers serve which chain: { okx, binance }. The swap panel offers a router on a
// chain only when it is configured here and listed for that chain.
export async function GET() {
  const okxChains = CHAIN_KEYS.filter((chain) => CHAINS[chain].okxChainIndex);
  const okx: RouterStatus = { configured: isOkxConfigured(), chains: okxChains, verified: false };
  if (okx.configured) {
    try {
      if (!okxCache || Date.now() - okxCache.at > 60 * 60_000) okxCache = { at: Date.now(), indexes: await fetchOkxSupportedChainIndexes() };
      okx.chains = okxChains.filter((chain) => okxCache!.indexes.includes(CHAINS[chain].okxChainIndex!));
      okx.verified = true;
    } catch (error) {
      console.warn('OKX supported chains unavailable:', error instanceof Error ? error.message : error);
    }
  }
  const binanceCredentials = getBinanceWeb3Credentials();
  // Binance Web3 publishes no supported-chain list: unsupported chains fail at quote time.
  const binance: RouterStatus = {
    configured: Boolean(binanceCredentials.apiKey && binanceCredentials.secretKey),
    chains: CHAIN_KEYS.filter((chain) => CHAINS[chain].binanceChainId),
    verified: false,
  };
  return Response.json({ okx, binance }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
