// The chains Bankr launches on (GET api.bankr.bot/token-launches `chain` field). Chain id, RPC,
// native currency and explorer come from viem's chain definitions; the rest is how BankrDex
// reads and trades each chain. Shared by browser code and server routes.
import { arbitrum, arc, base, robinhood } from 'viem/chains';

export type ChainKey = 'base' | 'robinhood' | 'arbitrum' | 'arc';
export const CHAIN_KEYS: ChainKey[] = ['base', 'robinhood', 'arbitrum', 'arc'];

export interface ChainConfig {
  key: ChainKey;
  name: string;
  chainId: number;
  hexChainId: `0x${string}`;
  nativeSymbol: string;
  nativeName: string;
  // Wrapped native token / default quote asset of Bankr launches on this chain.
  wrappedNative: { address: string; symbol: string };
  rpcUrls: string[];
  explorer: string;
  // GeckoTerminal network id, and its dex id(s) for Bankr pools on that network.
  geckoNetwork: string;
  geckoBankrDexes: string[];
  dexscreenerChain: string;
  // Ids the swap aggregators use for this chain (null = never routed). Whether a router really
  // serves the chain right now comes from /api/routers/status (OKX's supported-chain list).
  okxChainIndex: string | null;
  binanceChainId: string | null;
  logo: string;
  // Brand color of the chain (tabs, chips, charts). Text uses the .chain-<key> CSS variables.
  color: string;
}

const TRUST = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains';

const config = (
  chain: typeof base | typeof robinhood | typeof arbitrum | typeof arc,
  rest: Omit<ChainConfig, 'chainId' | 'hexChainId' | 'nativeSymbol' | 'nativeName' | 'rpcUrls' | 'explorer' | 'name'> & { name?: string; extraRpcs?: string[] },
): ChainConfig => {
  const { extraRpcs = [], name, ...fields } = rest;
  return {
    ...fields,
    name: name ?? chain.name,
    chainId: chain.id,
    hexChainId: `0x${chain.id.toString(16)}`,
    nativeSymbol: chain.nativeCurrency.symbol,
    nativeName: chain.nativeCurrency.name,
    rpcUrls: [...extraRpcs, ...chain.rpcUrls.default.http],
    explorer: chain.blockExplorers.default.url,
  };
};

export const CHAINS: Record<ChainKey, ChainConfig> = {
  base: config(base, {
    key: 'base',
    wrappedNative: { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH' },
    extraRpcs: ['https://base-rpc.publicnode.com'],
    geckoNetwork: 'base',
    geckoBankrDexes: ['bankr'],
    dexscreenerChain: 'base',
    okxChainIndex: '8453',
    binanceChainId: '8453',
    logo: `${TRUST}/base/info/logo.png`,
    color: '#0052ff',
  }),
  robinhood: config(robinhood, {
    key: 'robinhood',
    name: 'Robinhood',
    wrappedNative: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', symbol: 'WETH' },
    // The official RPC is unreachable from some networks; these public ones serve eth_call too.
    extraRpcs: ['https://4663.rpc.thirdweb.com', 'https://robinhood.drpc.org'],
    geckoNetwork: 'robinhood',
    geckoBankrDexes: ['bankr-robinhood'],
    dexscreenerChain: 'robinhood',
    okxChainIndex: '4663',
    binanceChainId: '4663',
    logo: 'https://cdn.simpleicons.org/robinhood/00C805',
    color: '#00c805',
  }),
  arbitrum: config(arbitrum, {
    key: 'arbitrum',
    name: 'Arbitrum',
    wrappedNative: { address: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH' },
    geckoNetwork: 'arbitrum',
    geckoBankrDexes: [],
    dexscreenerChain: 'arbitrum',
    okxChainIndex: '42161',
    binanceChainId: '42161',
    logo: `${TRUST}/arbitrum/info/logo.png`,
    color: '#28a0f0',
  }),
  arc: config(arc, {
    key: 'arc',
    wrappedNative: { address: '0x3600000000000000000000000000000000000000', symbol: 'USDC' },
    geckoNetwork: 'arc',
    geckoBankrDexes: [],
    dexscreenerChain: 'arc',
    okxChainIndex: '5042',
    binanceChainId: '5042',
    logo: `${TRUST}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`,
    color: '#8b93a7',
  }),
};

export const DEFAULT_CHAIN: ChainKey = 'base';

export function isChainKey(value: unknown): value is ChainKey {
  return typeof value === 'string' && (CHAIN_KEYS as string[]).includes(value);
}

export function chainByKey(key: string | undefined | null): ChainConfig {
  return isChainKey(key) ? CHAINS[key] : CHAINS[DEFAULT_CHAIN];
}

export function chainById(chainId: number | undefined): ChainConfig | undefined {
  return Object.values(CHAINS).find((chain) => chain.chainId === chainId);
}

export const explorerTx = (chain: ChainKey | undefined, hash: string) => `${chainByKey(chain).explorer}/tx/${hash}`;
export const explorerToken = (chain: ChainKey | undefined, address: string) => `${chainByKey(chain).explorer}/token/${address}`;
export const explorerAddress = (chain: ChainKey | undefined, address: string) => `${chainByKey(chain).explorer}/address/${address}`;
export const dexscreenerUrl = (chain: ChainKey | undefined, address: string) => `https://dexscreener.com/${chainByKey(chain).dexscreenerChain}/${address}`;
// BankrDex routes swaps only where an aggregator is wired up for that chain.
export const canSwapOn = (chain: ChainKey | undefined) => chainByKey(chain).okxChainIndex !== null;
