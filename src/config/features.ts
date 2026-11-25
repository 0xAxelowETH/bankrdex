// Features hidden until they are backed by real data. Flip to true to show them again.
export const FEATURES = {
  // Community theses (stored in Supabase, posted by signed-in wallet profiles).
  tradingThesis: true,
  // Direct Uniswap V4 swaps and quick buys on Base find the token's pool in the on-chain index
  // (scripts/indexer.mjs). Shown as "Soon" until the indexer runs for this deployment.
  baseDirectSwap: false,
  // Limit buy, take-profit, stop-loss and price alerts read prices from the same index and swap
  // through the direct pool. Shown as "Soon" until the indexer runs.
  limitOrders: false,
} as const;
