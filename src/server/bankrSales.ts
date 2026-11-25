// Recent buys of Bankr tokens on Base, read straight from Uniswap V4 PoolManager `Swap` logs.
// Bankr has no public trade feed, so one shared cursor scans new blocks for swaps in catalog
// pools and keeps the latest buys in memory. Every visitor reads the same buffer.
import { baseRpc } from './baseRpc';
import { getBaseBankrTokens, type BankrCatalogToken } from './bankrTokenCatalog';

export const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
// Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1,
//      uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)
export const V4_SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';

const BLOCK_TIME_MS = 2_000; // Base produces a block every 2 seconds.
const INITIAL_LOOKBACK_BLOCKS = 1_800; // one hour
const MAX_RANGE_BLOCKS = 900;
const POOLS_PER_REQUEST = 200;
const FRESH_MS = 4_000;
const MAX_SALES = 400;

export interface BankrSale {
  tokenAddress: string;
  poolAddress: string;
  time: number;
  transactionHash: string;
  logIndex: number;
  blockNumber: number;
}

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  removed?: boolean;
}

const word = (data: string, index: number) => data.slice(2 + index * 64, 2 + (index + 1) * 64);
const toSigned = (hex: string) => BigInt.asIntN(256, BigInt(`0x${hex || '0'}`));

// V4 deltas are from the swapper's side: negative = paid into the pool, positive = received.
// Returns the quote amount paid, or null when the swap is not a buy of the launched token.
export function decodeV4Buy(data: string, tokenIsCurrency0: boolean): bigint | null {
  const amount0 = toSigned(word(data, 0));
  const amount1 = toSigned(word(data, 1));
  const [tokenDelta, quoteDelta] = tokenIsCurrency0 ? [amount0, amount1] : [amount1, amount0];
  return tokenDelta > 0n && quoteDelta < 0n ? -quoteDelta : null;
}

export interface V4PoolInfo {
  token: string;
  quote: string;
  tokenIsCurrency0: boolean;
  creator?: string;
}

// pool id -> token, for every catalog token that trades in a V4 pool.
export function v4Pools(tokens: BankrCatalogToken[]): Map<string, V4PoolInfo> {
  const pools = new Map<string, V4PoolInfo>();
  for (const token of tokens) {
    const pool = token.pool?.toLowerCase();
    if (!pool || !/^0x[a-f\d]{64}$/.test(pool)) continue;
    const address = token.address.toLowerCase();
    const quote = (token.quoteAddress || '0x4200000000000000000000000000000000000006').toLowerCase();
    pools.set(pool, { token: address, quote, tokenIsCurrency0: BigInt(address) < BigInt(quote), creator: token.creator });
  }
  return pools;
}

let sales: BankrSale[] = [];
let cursor = 0;
let refreshedAt = 0;
let refresh: Promise<void> | null = null;

async function scan(): Promise<void> {
  const pools = v4Pools(await getBaseBankrTokens());
  if (pools.size === 0) return;
  const head = Number.parseInt(await baseRpc<string>('eth_blockNumber', []), 16);
  if (!Number.isSafeInteger(head) || head <= 0) throw new Error('Invalid Base block number.');
  const scannedAt = Date.now();
  const from = Math.max(cursor + 1, head - INITIAL_LOOKBACK_BLOCKS);
  if (from > head) return;
  const poolIds = [...pools.keys()];
  const found: BankrSale[] = [];
  // Newest range first, so a slow first scan still shows the latest buys.
  for (let end = head; end >= from; end -= MAX_RANGE_BLOCKS) {
    const start = Math.max(from, end - MAX_RANGE_BLOCKS + 1);
    for (let index = 0; index < poolIds.length; index += POOLS_PER_REQUEST) {
      const logs = await baseRpc<RpcLog[]>('eth_getLogs', [{
        fromBlock: `0x${start.toString(16)}`,
        toBlock: `0x${end.toString(16)}`,
        address: POOL_MANAGER,
        topics: [V4_SWAP_TOPIC, poolIds.slice(index, index + POOLS_PER_REQUEST)],
      }]);
      for (const log of logs) {
        if (log.removed) continue;
        const poolId = log.topics[1]?.toLowerCase();
        const pool = poolId ? pools.get(poolId) : undefined;
        if (!pool || decodeV4Buy(log.data, pool.tokenIsCurrency0) === null) continue;
        const blockNumber = Number.parseInt(log.blockNumber, 16);
        found.push({
          tokenAddress: pool.token,
          poolAddress: poolId!,
          // Derived from Base's fixed 2 s block time instead of one RPC call per block.
          time: scannedAt - (head - blockNumber) * BLOCK_TIME_MS,
          transactionHash: log.transactionHash.toLowerCase(),
          logIndex: Number.parseInt(log.logIndex, 16),
          blockNumber,
        });
      }
    }
  }
  cursor = head;
  const seen = new Set<string>();
  sales = [...found, ...sales]
    .filter((sale) => {
      const key = `${sale.transactionHash}:${sale.logIndex}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.blockNumber - left.blockNumber || right.logIndex - left.logIndex)
    .slice(0, MAX_SALES);
}

export async function getRecentBankrSales(): Promise<{ sales: BankrSale[]; status: 'ok' | 'stale' }> {
  if (Date.now() - refreshedAt < FRESH_MS) return { sales, status: 'ok' };
  refresh ??= scan()
    .then(() => { refreshedAt = Date.now(); })
    .finally(() => { refresh = null; });
  try {
    await refresh;
    return { sales, status: 'ok' };
  } catch (error) {
    if (sales.length > 0) return { sales, status: 'stale' };
    throw error;
  }
}
