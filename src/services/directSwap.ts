// Browser side of direct Uniswap V4 swaps for Bankr tokens (see v4Swap.ts for the transaction
// encoding), on every chain in V4_DEPLOYMENTS (Base, Robinhood). The pool key comes from the
// on-chain index on Base and from Bankr's pool id elsewhere; quotes from Uniswap's V4Quoter. The
// connected wallet signs everything; BankrDex never holds funds.
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData, erc20Abi, formatUnits, keccak256, parseAbiParameters, parseUnits, type Hex } from 'viem';
import { PLATFORM_FEE_BPS, PLATFORM_FEE_RECEIVER } from '../config/platformFee';
import { CHAINS, type ChainKey } from '../config/chains';
import type { PreparedTransaction } from '../utils/web3';
import {
  buildBuyWithEth,
  buildSell,
  PERMIT2,
  permit2Abi,
  permitSingleTypedData,
  platformFee,
  poolKeyFor,
  quoteCall,
  quoterAbi,
  V4_DEPLOYMENTS,
  type PoolKey,
  type V4Deployment,
} from './v4Swap';

const BASE_RPCS = ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'];

async function rpc<T>(chain: ChainKey, method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (const endpoint of chain === 'base' ? BASE_RPCS : CHAINS[chain].rpcUrls) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(12_000),
      });
      const payload = await response.json() as { result?: T; error?: { message?: string } };
      if (payload.error) throw new Error(payload.error.message || 'RPC error');
      return payload.result as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${CHAINS[chain].name} RPC unavailable.`);
}

export interface DirectPool {
  chain: ChainKey;
  key: PoolKey;
  token: string;
  quote: string;
}

export const deploymentOf = (pool: Pick<DirectPool, 'chain'>): V4Deployment => V4_DEPLOYMENTS[pool.chain];
export const supportsDirectSwap = (chain: ChainKey | undefined) => Boolean(V4_DEPLOYMENTS[chain ?? 'base']);
// True when the pool's quote asset is the chain's wrapped native coin (buys and sells use ETH).
export const isNativePaired = (pool: DirectPool) => pool.quote === deploymentOf(pool).weth;

const poolCache = new Map<string, { at: number; pool: DirectPool | null }>();

const poolIdOf = (key: PoolKey) => keccak256(encodeAbiParameters(
  parseAbiParameters('address, address, uint24, int24, address'),
  [key.currency0 as Hex, key.currency1 as Hex, key.fee, key.tickSpacing, key.hooks as Hex],
));

// The token's own V4 pool, or null when none is known. Base: from the on-chain index. Other
// chains: Bankr's pool id must match a Bankr pool key (token / quote, dynamic fee, Bankr hook).
export async function fetchDirectPool(token: string, chain: ChainKey = 'base', hint?: { poolId?: string; quote?: string }): Promise<DirectPool | null> {
  const address = token.toLowerCase();
  const cacheKey = `${chain}:${address}:${hint?.poolId?.toLowerCase() ?? ''}`;
  const cached = poolCache.get(cacheKey);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.pool;
  let pool: DirectPool | null = null;
  if (chain === 'base') {
    const response = await fetch(`/api/market/pool?token=${address}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!response.ok) return null;
    const payload = await response.json() as { pool?: { quote_address: string; hooks: string | null } | null };
    pool = payload.pool?.hooks
      ? { chain, key: poolKeyFor(address, payload.pool.quote_address, payload.pool.hooks), token: address, quote: payload.pool.quote_address.toLowerCase() }
      : null;
  } else {
    const deployment = V4_DEPLOYMENTS[chain];
    const poolId = hint?.poolId?.toLowerCase();
    const quote = hint?.quote?.toLowerCase();
    if (deployment && poolId && /^0x[0-9a-f]{64}$/.test(poolId) && quote) {
      for (const hooks of deployment.hooks) {
        const key = poolKeyFor(address, quote, hooks);
        if (poolIdOf(key) === poolId) { pool = { chain, key, token: address, quote }; break; }
      }
    }
  }
  poolCache.set(cacheKey, { at: Date.now(), pool });
  return pool;
}

// Output for `amountIn` of `tokenIn` after the BankrDex fee (the swap gets amountIn - fee).
export async function quoteDirect(pool: DirectPool, tokenIn: string, amountIn: bigint): Promise<bigint> {
  const swapAmount = amountIn - platformFee(amountIn, PLATFORM_FEE_BPS);
  const data = await rpc<Hex>(pool.chain, 'eth_call', [{ to: deploymentOf(pool).quoter, data: quoteCall(pool.key, tokenIn, swapAmount) }, 'latest']);
  return decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data })[0];
}

export const minimumOut = (quoted: bigint, slippagePercent: number) =>
  (quoted * BigInt(Math.round((100 - Math.min(Math.max(slippagePercent, 0.1), 50)) * 100))) / 10_000n;

export interface WalletAccess {
  address: string;
  sendTransaction: (transaction: PreparedTransaction) => Promise<{ txHash: string; succeeded: boolean }>;
  request: (method: string, params?: unknown[]) => Promise<unknown>;
  onProgress?: (message: string) => void;
}

const toPrepared = (built: { to: string; data: Hex; value: bigint }): PreparedTransaction => ({
  to: built.to,
  data: built.data,
  value: `0x${built.value.toString(16)}`,
});
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

export interface DirectSwapResult {
  txHash: string;
  succeeded: boolean;
  quoted: bigint;
}

// Buy `ethAmount` (native coin, decimal string) worth of the token. Native-paired pools only.
export async function directBuy(pool: DirectPool, ethAmount: string, slippagePercent: number, wallet: WalletAccess): Promise<DirectSwapResult> {
  const deployment = deploymentOf(pool);
  if (!isNativePaired(pool)) throw new Error('Direct buys with ETH need a WETH-paired pool.');
  const amountIn = parseUnits(ethAmount, 18);
  if (amountIn <= 0n) throw new Error('Enter an amount.');
  wallet.onProgress?.('Getting a quote from the pool…');
  const quoted = await quoteDirect(pool, deployment.weth, amountIn);
  if (quoted <= 0n) throw new Error('The pool returned no output for this amount.');
  const built = buildBuyWithEth({
    key: pool.key,
    token: pool.token,
    amountIn,
    minOut: minimumOut(quoted, slippagePercent),
    feeBps: PLATFORM_FEE_BPS,
    feeRecipient: PLATFORM_FEE_RECEIVER,
    deadline: deadline(),
    router: deployment.router,
    weth: deployment.weth,
    minHopPrice: deployment.minHopPrice,
  });
  wallet.onProgress?.('Confirm the swap in your wallet…');
  const result = await wallet.sendTransaction(toPrepared(built));
  return { ...result, quoted };
}

// Swap `amount` (decimal string) of an ERC-20 in the pool for the other side, through Permit2:
// selling the token, or buying it with the pool's quote token when that is not WETH.
async function swapErc20In(pool: DirectPool, tokenIn: string, tokenOut: string, amount: string, slippagePercent: number, wallet: WalletAccess): Promise<DirectSwapResult> {
  const deployment = deploymentOf(pool);
  const amountIn = parseUnits(amount, 18);
  if (amountIn <= 0n) throw new Error('Enter an amount.');
  const owner = wallet.address.toLowerCase();
  wallet.onProgress?.('Getting a quote from the pool…');
  const quoted = await quoteDirect(pool, tokenIn, amountIn);
  if (quoted <= 0n) throw new Error('The pool returned no output for this amount.');

  // 1. The token must let Permit2 pull exactly this amount (never an unlimited approval).
  const allowanceHex = await rpc<Hex>(pool.chain, 'eth_call', [{ to: tokenIn, data: encodeFunctionData({ abi: erc20Abi, functionName: 'allowance', args: [owner as Hex, PERMIT2] }) }, 'latest']);
  if (BigInt(allowanceHex) < amountIn) {
    wallet.onProgress?.('Approve the token for this swap…');
    const approval = await wallet.sendTransaction({
      to: tokenIn,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, amountIn] }),
      value: '0x0',
    });
    if (!approval.succeeded) throw new Error('The approval was not confirmed; nothing was swapped.');
  }

  // 2. Permit2 must let the Universal Router pull it: a signed permit, included in the swap.
  const allowance = decodeFunctionResult({
    abi: permit2Abi,
    functionName: 'allowance',
    data: await rpc<Hex>(pool.chain, 'eth_call', [{ to: PERMIT2, data: encodeFunctionData({ abi: permit2Abi, functionName: 'allowance', args: [owner as Hex, tokenIn as Hex, deployment.router as Hex] }) }, 'latest']),
  });
  const now = Math.floor(Date.now() / 1000);
  let permit: Parameters<typeof buildSell>[0]['permit'];
  if (allowance[0] < amountIn || allowance[1] < now + 60) {
    const expiration = now + 30 * 60;
    const sigDeadline = BigInt(now + 30 * 60);
    const typed = permitSingleTypedData({ token: tokenIn, amount: amountIn, nonce: allowance[2], expiration, sigDeadline, chainId: deployment.chainId, spender: deployment.router });
    wallet.onProgress?.('Sign the permit for this swap…');
    // Wallets such as MetaMask expect the domain type to be spelled out.
    const request = {
      ...typed,
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        ...typed.types,
      },
    };
    const signature = await wallet.request('eth_signTypedData_v4', [owner, JSON.stringify(request, (_, value) => typeof value === 'bigint' ? value.toString() : value)]) as Hex;
    permit = { details: { token: tokenIn, amount: amountIn, expiration, nonce: allowance[2] }, spender: deployment.router, sigDeadline, signature };
  }

  const built = buildSell({
    key: pool.key,
    token: tokenIn,
    quote: tokenOut,
    amountIn,
    minOut: minimumOut(quoted, slippagePercent),
    feeBps: PLATFORM_FEE_BPS,
    feeRecipient: PLATFORM_FEE_RECEIVER,
    deadline: deadline(),
    permit,
    router: deployment.router,
    weth: deployment.weth,
    minHopPrice: deployment.minHopPrice,
  });
  wallet.onProgress?.('Confirm the swap in your wallet…');
  const result = await wallet.sendTransaction(toPrepared(built));
  return { ...result, quoted };
}

// Sell `tokenAmount` of the token for ETH (or the pool's quote asset).
export const directSell = (pool: DirectPool, tokenAmount: string, slippagePercent: number, wallet: WalletAccess) =>
  swapErc20In(pool, pool.token, pool.quote, tokenAmount, slippagePercent, wallet);

// Buy the token with the pool's quote token (pools not paired with WETH).
export const directBuyWithQuote = (pool: DirectPool, quoteAmount: string, slippagePercent: number, wallet: WalletAccess) =>
  swapErc20In(pool, pool.quote, pool.token, quoteAmount, slippagePercent, wallet);

export async function tokenBalance(token: string, owner: string, chain: ChainKey = 'base'): Promise<bigint> {
  const data = await rpc<Hex>(chain, 'eth_call', [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner as Hex] }) }, 'latest']);
  return BigInt(data);
}

export async function nativeBalance(owner: string, chain: ChainKey = 'base'): Promise<bigint> {
  return BigInt(await rpc<Hex>(chain, 'eth_getBalance', [owner, 'latest']));
}

export const formatAmount = (raw: bigint, decimals = 18, digits = 6) => {
  const value = Number(formatUnits(raw, decimals));
  return value.toLocaleString('en-US', { maximumFractionDigits: value >= 1 ? 2 : digits });
};
