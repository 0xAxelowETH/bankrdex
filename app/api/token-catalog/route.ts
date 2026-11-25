import { getBankrTokenCatalog, getNewBankrTokens, WETH_ADDRESS, BANKR_QUOTE_TOKENS, type BankrCatalogToken } from '../../../src/server/bankrTokenCatalog';
import { getActiveTokens, getLaunchRows, isMarketIndexConfigured } from '../../../src/server/marketIndex';
import { baseRpc } from '../../../src/server/baseRpc';
import { withDexSocials } from '../../../src/server/dexProfiles';
import { withLogos } from '../../../src/server/tokenLogos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_NEW_TOKENS = 50;
const INDEX_REFRESH_MS = 30_000;
let indexSnapshot: { at: number; tokens: Map<string, BankrCatalogToken> } | null = null;
let indexRequest: Promise<Map<string, BankrCatalogToken>> | null = null;

// Every Base token the on-chain index saw trade in the last 24 hours, as catalog entries.
async function loadIndexedTokens(): Promise<Map<string, BankrCatalogToken>> {
  const [active, head] = await Promise.all([
    getActiveTokens(1_440, 1_000),
    baseRpc<string>('eth_blockNumber', []).then((value) => Number.parseInt(value, 16)).catch(() => 0),
  ]);
  const launches = new Map((await getLaunchRows(active.map((row) => row.token_address))).map((row) => [row.token_address, row]));
  const tokens = new Map<string, BankrCatalogToken>();
  for (const row of active) {
    const launch = launches.get(row.token_address);
    const symbol = launch?.symbol?.trim();
    if (!launch || !symbol) continue;
    const quote = launch.quote_address || WETH_ADDRESS;
    tokens.set(row.token_address, {
      address: row.token_address,
      name: launch.name?.trim() || symbol,
      symbol,
      chain: 'base',
      chainId: 8453,
      pool: row.pool_id,
      quoteAddress: quote,
      quoteSymbol: BANKR_QUOTE_TOKENS[quote] ?? 'TOKEN',
      // Base produces one block every 2 seconds.
      launchedAt: head > 0 ? Date.now() - (head - launch.block_number) * 2_000 : undefined,
      txHash: launch.tx_hash,
      totalTx24h: row.trades,
      totalBuys24h: row.buys,
      totalSells24h: row.trades - row.buys,
      volume24hUsd: row.volume_usd,
      trendingScore: row.volume_usd,
      marketUpdatedAt: Date.now(),
      // bankrdex_launches only holds launches whose Doppler integrator is Bankr.
      verifiedBy: 'registry',
    });
  }
  indexSnapshot = { at: Date.now(), tokens };
  return tokens;
}

async function indexedTokens(): Promise<Map<string, BankrCatalogToken>> {
  if (!isMarketIndexConfigured()) return new Map();
  if (indexSnapshot && Date.now() - indexSnapshot.at < INDEX_REFRESH_MS) return indexSnapshot.tokens;
  indexRequest ??= loadIndexedTokens().finally(() => { indexRequest = null; });
  try {
    return await indexRequest;
  } catch (error) {
    console.error('Market index unavailable for the catalog:', error);
    return indexSnapshot?.tokens ?? new Map();
  }
}

// Catalog tokens plus everything the index saw trade; index counts replace cached 24h counts.
function mergeIndexed(catalog: BankrCatalogToken[], indexed: Map<string, BankrCatalogToken>): BankrCatalogToken[] {
  const seen = new Set<string>();
  const merged = catalog.map((token) => {
    if (token.chain !== 'base') return token;
    const fromIndex = indexed.get(token.address.toLowerCase());
    if (!fromIndex) return token;
    seen.add(token.address.toLowerCase());
    return {
      ...token,
      pool: token.pool ?? fromIndex.pool,
      totalTx24h: fromIndex.totalTx24h,
      totalBuys24h: fromIndex.totalBuys24h,
      totalSells24h: fromIndex.totalSells24h,
      volume24hUsd: fromIndex.volume24hUsd,
    };
  });
  for (const [address, token] of indexed) {
    if (!seen.has(address)) merged.push(token);
  }
  return merged;
}

// GET /api/token-catalog            -> every Bankr token known to this deployment
// GET /api/token-catalog?since=<ms> -> only launches after that time (small, near-live)
export async function GET(request: Request) {
  const since = Number(new URL(request.url).searchParams.get('since'));
  try {
    if (Number.isFinite(since) && since > 0) {
      const tokens = (await getNewBankrTokens(since)).slice(0, MAX_NEW_TOKENS).map((token) => ({ ...token, verifiedBy: 'bankr-api' as const }));
      return Response.json({ tokens, source: 'live' }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [catalog, indexed] = await Promise.all([getBankrTokenCatalog(), indexedTokens()]);
    // DexScreener images and paid-profile links (src/server/dexProfiles.ts), then logos for tokens
    // whose launch data has none (src/server/tokenLogos.ts).
    return Response.json({ tokens: withLogos(withDexSocials(mergeIndexed(catalog, indexed))), source: 'catalog' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Bankr token catalog request failed:', error);
    return Response.json(
      { error: 'Unable to load the Bankr token catalog.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
