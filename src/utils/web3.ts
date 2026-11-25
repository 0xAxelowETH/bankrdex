// Web3 helpers and Base RPC integration
import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, hexToBigInt } from 'viem';
import { BaseNetworkStats } from '../types';
import type { PendingPlatformFee } from '../types';
import type { FeeProtectedSwapTransactions } from '../services/tradingApis';
import { removePendingPlatformFee, upsertPendingPlatformFee } from './platformFees';
import { CHAINS, type ChainConfig, type ChainKey } from '../config/chains';

declare global {
  interface Window {
    okxwallet?: Eip1193Provider & {
      isOkxWallet?: boolean;
    };
    ethereum?: Eip1193Provider & {
      isOKExWallet?: boolean;
      isMetaMask?: boolean;
    };
  }
}

export interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, callback: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  disconnect?: () => Promise<void>;
}

export const BASE_CHAIN_ID_DEC = 8453;
export const BASE_CHAIN_ID_HEX = '0x2105';
export { PLATFORM_FEE_BPS, PLATFORM_FEE_RECEIVER } from '../config/platformFee';
import { PLATFORM_FEE_RECEIVER } from '../config/platformFee';
const BASE_RPC_ENDPOINTS = [
  'https://base-rpc.publicnode.com',
  'https://mainnet.base.org',
  'https://base.drpc.org',
];

export const BASE_PARAMS = {
  chainId: BASE_CHAIN_ID_HEX,
  chainName: 'Base',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: BASE_RPC_ENDPOINTS,
  blockExplorerUrls: ['https://basescan.org'],
};

export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';
export const BASE_USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const BASE_STABLECOINS = [
  { symbol: 'USDC', name: 'USD Coin', address: BASE_USDC_ADDRESS },
  { symbol: 'USDT', name: 'Tether USD', address: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2' },
  { symbol: 'USDbC', name: 'USD Base Coin', address: '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca' },
  { symbol: 'DAI', name: 'Dai Stablecoin', address: '0x50c5725949a6f0c72e6c4a641f24049a917db0cb' },
] as const;

export function getBaseStablecoin(address: string | undefined) {
  return BASE_STABLECOINS.find((stablecoin) =>
    stablecoin.address.toLowerCase() === address?.toLowerCase()
  );
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}` as `0x${string}`;
}

async function fetchTokenDecimals(provider: Eip1193Provider, tokenAddress: string): Promise<number> {
  const raw = await provider.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data: '0x313ce567' }, 'latest'],
  });
  if (typeof raw !== 'string' || !/^0x[0-9a-f]+$/i.test(raw)) {
    throw new Error(`Unable to read decimals for token ${tokenAddress}.`);
  }
  const decimals = hexToBigInt(raw as `0x${string}`);
  if (decimals > 255n) throw new Error(`Token ${tokenAddress} returned invalid decimals.`);
  return Number(decimals);
}

export async function fetchBaseTokenDecimals(tokenAddress: string): Promise<number> {
  return fetchTokenDecimals(publicBaseProvider, tokenAddress);
}

export async function fetchChainTokenDecimals(chain: ChainKey, tokenAddress: string): Promise<number> {
  return fetchTokenDecimals(publicProviderFor(chain), tokenAddress);
}

// Native or ERC-20 balance (raw units) of an address on a chain.
export async function fetchChainBalanceRaw(chain: ChainKey, owner: string, tokenAddress: string): Promise<bigint> {
  return readOutputBalanceRaw(owner, tokenAddress, chain);
}

export interface ConnectedAccount {
  address: string;
  networkId: number;
  ethBalance: number;
}

// Format short address: 0x1234...5678
export function shortenAddress(addr: string): string {
  if (!addr) return '';
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// Live Base network stats (block height, gas price, ETH price)
async function callBaseRpc(payload: unknown): Promise<Record<string, unknown> | null> {
  return callRpc(BASE_RPC_ENDPOINTS, payload);
}

async function callRpc(endpoints: readonly string[], payload: unknown): Promise<Record<string, unknown> | null> {
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) continue;
      const result = await response.json();
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        return result as Record<string, unknown>;
      }
    } catch {
      // Try the next public Base RPC.
    }
  }
  return null;
}

const publicBaseProvider: Eip1193Provider = {
  request: async ({ method, params }) => {
    const response = await callBaseRpc({ jsonrpc: '2.0', id: 1, method, params: params || [] });
    if (!response || response.error) throw new Error(`Base RPC ${method} failed.`);
    return response.result;
  },
};

// Read-only provider over a chain's public RPCs (Base keeps its tuned endpoint list).
const publicProviders = new Map<ChainKey, Eip1193Provider>([['base', publicBaseProvider]]);
export function publicProviderFor(chain: ChainKey = 'base'): Eip1193Provider {
  let provider = publicProviders.get(chain);
  if (!provider) {
    const endpoints = CHAINS[chain].rpcUrls;
    provider = {
      request: async ({ method, params }) => {
        const response = await callRpc(endpoints, { jsonrpc: '2.0', id: 1, method, params: params || [] });
        if (!response || response.error) throw new Error(`${CHAINS[chain].name} RPC ${method} failed.`);
        return response.result;
      },
    };
    publicProviders.set(chain, provider);
  }
  return provider;
}

interface ConfirmedTransactionReceipt {
  succeeded: boolean;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
}

async function waitForTransactionReceiptDetails(
  txHash: string,
  timeoutMs = 120_000,
  chain: ChainKey = 'base'
): Promise<ConfirmedTransactionReceipt | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await publicProviderFor(chain).request({
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      });
      if (receipt && typeof receipt === 'object') {
        const data = receipt as Record<string, unknown>;
        const gasUsed = data.gasUsed;
        const effectiveGasPrice = data.effectiveGasPrice;
        if (typeof gasUsed !== 'string' || typeof effectiveGasPrice !== 'string') return null;
        return {
          succeeded: String(data.status).toLowerCase() === '0x1',
          gasUsed: BigInt(gasUsed),
          effectiveGasPrice: BigInt(effectiveGasPrice),
        };
      }
    } catch {
      // Retry through the next RPC endpoint on the next poll.
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  return null;
}

async function waitForTransactionReceipt(txHash: string, timeoutMs = 120_000, chain: ChainKey = 'base'): Promise<boolean> {
  return (await waitForTransactionReceiptDetails(txHash, timeoutMs, chain))?.succeeded === true;
}

async function readOutputBalanceRaw(userAddress: string, tokenAddress: string, chain: ChainKey = 'base'): Promise<bigint> {
  const publicProvider = publicProviderFor(chain);
  if (tokenAddress.toLowerCase() === 'native') {
    const balance = await publicProvider.request({
      method: 'eth_getBalance',
      params: [userAddress, 'latest'],
    });
    if (typeof balance !== 'string') throw new Error('Unable to read ETH balance for fee calculation.');
    return BigInt(balance);
  }

  const balanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [userAddress as `0x${string}`],
  });
  const result = await publicProvider.request({
    method: 'eth_call',
    params: [{ to: tokenAddress, data: balanceData }, 'latest'],
  });
  return decodeFunctionResult({
    abi: erc20Abi,
    functionName: 'balanceOf',
    data: result as `0x${string}`,
  });
}

async function finishSwapAndCollectPlatformFee(
  provider: Eip1193Provider,
  userAddress: string,
  outputTokenAddress: string,
  balanceBefore: bigint,
  swapTxHash: string,
  onProgress: ((message: string) => void) | undefined,
  feeIncludedInSwap: boolean,
  feeTokenAddress: string,
  feeRaw: bigint,
  feeTokenDecimals: number,
  chain: ChainKey = 'base'
): Promise<{
  success: boolean;
  txHash: string;
  message: string;
  feeAmount: number;
  feeCollected: boolean;
  feeGasEth: number;
  swapGasEth: number;
  outputAmount?: number;
  feeTxHash?: string;
  pendingPlatformFee?: PendingPlatformFee;
}> {
  const chainName = CHAINS[chain].name;
  const publicProvider = publicProviderFor(chain);
  const swapReceipt = await waitForTransactionReceiptDetails(swapTxHash, undefined, chain);
  if (!swapReceipt) {
    return {
      success: false,
      txHash: swapTxHash,
      message: `The swap transaction was submitted but is not yet confirmed. Check the ${chainName} explorer before retrying.`,
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth: 0,
    };
  }
  if (!swapReceipt.succeeded) {
    return {
      success: false,
      txHash: swapTxHash,
      message: `The swap transaction failed on ${chainName}.`,
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth: 0,
    };
  }
  const swapGasEth = Number(swapReceipt.gasUsed * swapReceipt.effectiveGasPrice) / 1e18;
  const isNativeOutput = outputTokenAddress.toLowerCase() === 'native';
  let outputAmountRaw: bigint;
  let outputDecimals = 18;
  let outputBalanceAfterSwap: bigint;
  try {
    if (!isNativeOutput) outputDecimals = await fetchTokenDecimals(publicProvider, outputTokenAddress);
    outputBalanceAfterSwap = await readOutputBalanceRaw(userAddress, outputTokenAddress, chain);
    outputAmountRaw = outputBalanceAfterSwap - balanceBefore;
  } catch (error) {
    console.error('Unable to calculate platform fee after confirmed swap:', error);
    return {
      success: true,
      txHash: swapTxHash,
      message: 'The swap was confirmed, but the fee could not be calculated and was not charged.',
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth,
    };
  }
  if (isNativeOutput) {
    outputAmountRaw += swapReceipt.gasUsed * swapReceipt.effectiveGasPrice;
  }
  if (outputAmountRaw <= 0n) {
    return {
      success: true,
      txHash: swapTxHash,
      message: 'The swap was confirmed, but the actual output amount could not be calculated for the fee.',
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth,
      outputAmount: 0,
    };
  }

  if (feeRaw === 0n) {
    return {
      success: true,
      txHash: swapTxHash,
      message: 'The swap was confirmed. The 0.1% fee is below the input asset’s smallest unit.',
      feeAmount: 0,
      feeCollected: true,
      feeGasEth: 0,
      swapGasEth,
      outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
    };
  }

  const pendingFeeRecord: PendingPlatformFee = {
    id: swapTxHash.toLowerCase(),
    walletAddress: userAddress,
    feeTokenAddress,
    amountRaw: feeRaw.toString(),
    amount: formatUnits(feeRaw, feeTokenDecimals),
    decimals: feeTokenDecimals,
    swapTxHash,
    createdAt: Date.now(),
  };
  const persistPendingFee = (fee: PendingPlatformFee): boolean => {
    try {
      upsertPendingPlatformFee(fee);
      return true;
    } catch (error) {
      console.error('Unable to persist pending platform fee:', error);
      return false;
    }
  };
  if (feeIncludedInSwap) {
    return {
      success: true,
      txHash: swapTxHash,
      message: '',
      feeAmount: Number(formatUnits(feeRaw, feeTokenDecimals)),
      feeCollected: true,
      feeGasEth: 0,
      swapGasEth,
      outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
    };
  }

  let feeRequest: Record<string, string>;
  const isNativeFeeToken = feeTokenAddress.toLowerCase() === 'native';
  try {
    if (isNativeFeeToken) {
      feeRequest = {
        from: userAddress,
        to: PLATFORM_FEE_RECEIVER,
        value: toHex(feeRaw),
        data: '0x',
      };
    } else {
      feeRequest = {
        from: userAddress,
        to: feeTokenAddress,
        value: '0x0',
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [PLATFORM_FEE_RECEIVER as `0x${string}`, feeRaw],
        }),
      };
    }
  } catch (error) {
    console.error('Unable to prepare platform fee transfer:', error);
    const persisted = persistPendingFee(pendingFeeRecord);
    return {
      success: true,
      txHash: swapTxHash,
      message: `The swap was confirmed, but the fee transfer could not be prepared and was not charged.${persisted ? '' : ' Keep the swap hash and fee amount; saving the pending fee failed.'}`,
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth,
      outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
      ...(persisted ? { pendingPlatformFee: pendingFeeRecord } : {}),
    };
  }

  let submittedFeeTxHash: string | undefined;
  try {
    onProgress?.('Swap succeeded. Confirm the 0.1% platform fee transfer in your wallet…');
    const [gasEstimate, gasPrice] = await Promise.all([
      publicProvider.request({ method: 'eth_estimateGas', params: [feeRequest] }) as Promise<string>,
      publicProvider.request({ method: 'eth_gasPrice' }) as Promise<string>,
    ]);
    submittedFeeTxHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        ...feeRequest,
        gas: toHex((BigInt(gasEstimate) * 120n) / 100n),
        gasPrice,
      }],
    }) as string;
    const feeReceipt = await waitForTransactionReceiptDetails(submittedFeeTxHash, undefined, chain);
    const feeGasEth = feeReceipt
      ? Number(feeReceipt.gasUsed * feeReceipt.effectiveGasPrice) / 1e18
      : 0;
    if (!feeReceipt?.succeeded) {
      const pendingFee = {
        ...pendingFeeRecord,
        ...(submittedFeeTxHash ? { feeTxHash: submittedFeeTxHash } : {}),
      };
      const persisted = persistPendingFee(pendingFee);
      return {
        success: true,
        txHash: swapTxHash,
        message: `The swap succeeded, but the 0.1% fee transfer is not confirmed and has not been recorded.${persisted ? '' : ' Saving the pending fee failed; keep the swap transaction hash.'}`,
        feeAmount: 0,
        feeCollected: false,
        feeGasEth,
        swapGasEth,
        outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
        feeTxHash: submittedFeeTxHash,
        ...(persisted ? { pendingPlatformFee: pendingFee } : {}),
      };
    }
    return {
      success: true,
      txHash: swapTxHash,
      message: `The swap succeeded and the 0.1% fee (${formatUnits(feeRaw, feeTokenDecimals)} ${isNativeFeeToken ? 'ETH' : 'input token'}) was sent.`,
      feeAmount: Number(formatUnits(feeRaw, feeTokenDecimals)),
      feeCollected: true,
      feeGasEth,
      swapGasEth,
      outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
      feeTxHash: submittedFeeTxHash,
    };
  } catch (error) {
    console.error('Platform fee transfer failed after confirmed swap:', error);
    const pendingFee = {
      ...pendingFeeRecord,
      ...(submittedFeeTxHash ? { feeTxHash: submittedFeeTxHash } : {}),
    };
    const persisted = persistPendingFee(pendingFee);
    const feeAmount = formatUnits(feeRaw, feeTokenDecimals);
    const feeToken = feeTokenAddress.toLowerCase() === 'native' ? 'ETH' : 'token You Pay';
    const failureReason = error instanceof Error && error.message
      ? ` Detail: ${error.message.slice(0, 200)}`
      : '';
    return {
      success: true,
      txHash: swapTxHash,
      message: `The swap succeeded, but the 0.1% fee (${feeAmount} ${feeToken}) was not sent or recorded. Do not repeat the swap; check your gas balance and wallet.${persisted ? '' : ' Saving the pending fee failed; keep the swap transaction hash.'}${failureReason}`,
      feeAmount: 0,
      feeCollected: false,
      feeGasEth: 0,
      swapGasEth,
      outputAmount: Number(formatUnits(outputAmountRaw, outputDecimals)),
      feeTxHash: submittedFeeTxHash,
      ...(persisted ? { pendingPlatformFee: pendingFee } : {}),
    };
  }
}

export async function payPendingPlatformFee(
  fee: PendingPlatformFee,
  provider: Eip1193Provider,
  currentWalletAddress: string
): Promise<{ feeTxHash: string }> {
  if (fee.walletAddress.toLowerCase() !== currentWalletAddress.toLowerCase()) {
    throw new Error('Connect the wallet that made the swap to pay its pending fee.');
  }
  const chainId = await provider.request({ method: 'eth_chainId' });
  const chainNumber = typeof chainId === 'string' && chainId.startsWith('0x')
    ? Number.parseInt(chainId, 16)
    : Number(chainId);
  if (chainNumber !== BASE_CHAIN_ID_DEC) throw new Error('Switch your wallet to Base before paying the fee.');
  if (fee.feeTxHash) {
    const priorReceipt = await waitForTransactionReceiptDetails(fee.feeTxHash, 3_000);
    if (priorReceipt?.succeeded) {
      removePendingPlatformFee(fee.id);
      return { feeTxHash: fee.feeTxHash };
    }
    if (!priorReceipt) {
      const existingReceipt = await publicBaseProvider.request({
        method: 'eth_getTransactionReceipt',
        params: [fee.feeTxHash],
      });
      if (!existingReceipt) throw new Error('The previous fee transaction is still pending. Do not resend the fee; wait or check BaseScan.');
      if (typeof existingReceipt === 'object' && existingReceipt !== null) {
        const status = (existingReceipt as Record<string, unknown>).status;
        if (String(status).toLowerCase() === '0x1') {
          removePendingPlatformFee(fee.id);
          return { feeTxHash: fee.feeTxHash };
        }
        if (String(status).toLowerCase() !== '0x0') {
          throw new Error('The previous fee transaction status could not be determined. Check BaseScan before retrying.');
        }
      }
    }
  }

  const feeRaw = BigInt(fee.amountRaw);
  const feeRequest: Record<string, string> = fee.feeTokenAddress.toLowerCase() === 'native'
    ? {
        from: currentWalletAddress,
        to: PLATFORM_FEE_RECEIVER,
        value: toHex(feeRaw),
        data: '0x',
      }
    : {
        from: currentWalletAddress,
        to: fee.feeTokenAddress,
        value: '0x0',
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: 'transfer',
          args: [PLATFORM_FEE_RECEIVER as `0x${string}`, feeRaw],
        }),
      };
  const [gasEstimate, gasPrice] = await Promise.all([
    publicBaseProvider.request({ method: 'eth_estimateGas', params: [feeRequest] }) as Promise<string>,
    publicBaseProvider.request({ method: 'eth_gasPrice' }) as Promise<string>,
  ]);
  const feeTxHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      ...feeRequest,
      gas: toHex((BigInt(gasEstimate) * 120n) / 100n),
      gasPrice,
    }],
  }) as string;
  upsertPendingPlatformFee({ ...fee, feeTxHash });
  const receipt = await waitForTransactionReceiptDetails(feeTxHash);
  if (!receipt?.succeeded) {
    throw new Error(`Fee transfer is not confirmed. Transaction hash: ${feeTxHash}`);
  }
  removePendingPlatformFee(fee.id);
  return { feeTxHash };
}

async function fetchEthSpotPriceUsd(): Promise<number | null> {
  try {
    const response = await fetch('https://coins.llama.fi/prices/current/coingecko:ethereum', {
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const price = Number(payload?.coins?.['coingecko:ethereum']?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function fetchLiveBaseStats(): Promise<BaseNetworkStats> {
  const startedAt = performance.now();
  const [ethPrice, blockResponse, gasResponse] = await Promise.all([
    fetchEthSpotPriceUsd(),
    callBaseRpc({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
    callBaseRpc({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
  ]);

  const blockResult = String(blockResponse?.result || '0x0');
  const gasResult = String(gasResponse?.result || '0x0');
  const blockNumber = Number.parseInt(blockResult, 16) || 0;
  const gasPriceGwei = Number(BigInt(gasResult)) / 1e9;

  return {
    blockNumber,
    gasPriceGwei: Number.isFinite(gasPriceGwei) && gasPriceGwei > 0 ? Number(gasPriceGwei.toPrecision(3)) : 0,
    ethPriceUsd: ethPrice || 0,
    rpcLatencyMs: Math.round(performance.now() - startedAt),
    isOnline: blockNumber > 0,
    lastUpdated: Date.now(),
  };
}

// On-chain ETH balance for any address on Base
export async function fetchAddressEthBalance(address: string): Promise<number> {
  if (!address || !address.startsWith('0x') || address.length !== 42) {
    return 0;
  }
  try {
    const data = await callBaseRpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getBalance',
      params: [address, 'latest'],
    });
    if (data && typeof data.result === 'string') {
      const wei = BigInt(data.result);
      return Number(wei) / 1e18;
    }
  } catch (err) {
    console.warn('Failed to fetch on-chain balance:', err);
  }
  return 0;
}

// Connect to injected browser Web3 provider (OKX Wallet / MetaMask / Trust / Binance Web3)
export async function connectInjectedWeb3(providerOverride?: Eip1193Provider): Promise<ConnectedAccount | null> {
  if (typeof window === 'undefined' && !providerOverride) {
    return null;
  }

  const provider = providerOverride || window.okxwallet || window.ethereum;
  if (!provider) {
    return null;
  }

  try {
    const accounts = (await provider.request({
      method: 'eth_requestAccounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
      return null;
    }

    const address = accounts[0];

    // Check chain
    let networkId = BASE_CHAIN_ID_DEC;
    try {
      const chainIdHex = (await provider.request({
        method: 'eth_chainId',
      })) as string;
      networkId = parseInt(chainIdHex, 16);

      // If not on Base, request a switch
      if (networkId !== BASE_CHAIN_ID_DEC) {
        try {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_ID_HEX }],
          });
          networkId = BASE_CHAIN_ID_DEC;
        } catch (switchError: unknown) {
          const err = switchError as { code?: number };
          if (err.code === 4902) {
            await provider.request({
              method: 'wallet_addEthereumChain',
              params: [BASE_PARAMS],
            });
            networkId = BASE_CHAIN_ID_DEC;
          }
        }
      }
    } catch {
      // Chain query warning
    }

    // Query the balance directly on Base
    let ethBalance = 0;
    try {
      const balanceHex = (await provider.request({
        method: 'eth_getBalance',
        params: [address, 'latest'],
      })) as string;
      const wei = BigInt(balanceHex);
      ethBalance = Number(wei) / 1e18;
    } catch {
      ethBalance = await fetchAddressEthBalance(address);
    }

    if (networkId !== BASE_CHAIN_ID_DEC) {
      return null;
    }

    return {
      address,
      networkId,
      ethBalance: +ethBalance.toFixed(8),
    };
  } catch (error) {
    console.warn('Web3 connection error:', error);
    return null;
  }
}

// Switches the wallet to `chain` (adding the network first when the wallet does not know it).
export async function ensureChain(provider: Eip1193Provider, chain: ChainConfig): Promise<void> {
  const rawChainId = await provider.request({ method: 'eth_chainId' });
  const currentChainId = typeof rawChainId === 'string'
    ? rawChainId.startsWith('0x') ? Number.parseInt(rawChainId, 16) : Number(rawChainId)
    : Number(rawChainId);
  if (currentChainId === chain.chainId) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chain.hexChainId }] });
  } catch (switchError: unknown) {
    const errorCode = switchError && typeof switchError === 'object' && 'code' in switchError
      ? Number((switchError as { code: unknown }).code)
      : undefined;
    if (errorCode !== 4902) throw switchError;
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: chain.hexChainId,
        chainName: chain.name,
        nativeCurrency: { name: chain.nativeName, symbol: chain.nativeSymbol, decimals: 18 },
        rpcUrls: chain.rpcUrls,
        blockExplorerUrls: [chain.explorer],
      }],
    });
  }
}

export async function ensureBaseChain(provider: Eip1193Provider): Promise<void> {
  return ensureChain(provider, CHAINS.base);
}

// Polls a chain's public RPCs for a receipt; true when the transaction succeeded.
async function waitForReceiptOn(chain: ChainConfig, txHash: string, timeoutMs = 120_000): Promise<boolean> {
  if (chain.key === 'base') return waitForTransactionReceipt(txHash, timeoutMs);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const endpoint of chain.rpcUrls) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [txHash] }),
          signal: AbortSignal.timeout(6_000),
        });
        const payload = await response.json() as { result?: { status?: string } | null };
        if (payload.result) return String(payload.result.status).toLowerCase() === '0x1';
        break;
      } catch {
        // Try the next endpoint.
      }
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  return false;
}

export interface PreparedTransaction {
  to: string;
  data: string;
  value?: string;
  gas?: string;
}

// Sends one prepared transaction from the connected wallet on `chain` and waits for its receipt.
export async function sendPreparedTransaction(
  provider: Eip1193Provider,
  from: string,
  transaction: PreparedTransaction,
  chainKey: ChainKey = 'base',
): Promise<{ txHash: string; succeeded: boolean }> {
  const chain = CHAINS[chainKey];
  if (!/^0x[a-fA-F0-9]{40}$/.test(transaction.to) || !/^0x(?:[a-fA-F0-9]{2})*$/.test(transaction.data)) {
    throw new Error('The transaction to sign is invalid.');
  }
  await ensureChain(provider, chain);
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{
      from,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value ?? '0x0',
      ...(transaction.gas ? { gas: transaction.gas } : {}),
    }],
  }) as string;
  return { txHash, succeeded: await waitForReceiptOn(chain, txHash) };
}

async function needsTokenApproval(
  provider: Eip1193Provider,
  userAddress: string,
  approval: NonNullable<FeeProtectedSwapTransactions['approval']>
): Promise<boolean> {
  const data = approval.data;
  if (!data.toLowerCase().startsWith('0x095ea7b3') || data.length < 138) return true;
  const spender = `0x${data.slice(34, 74)}` as `0x${string}`;
  const approvedAmount = BigInt(`0x${data.slice(74, 138)}`);
  const allowanceData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'allowance',
    args: [userAddress as `0x${string}`, spender],
  });
  const rawAllowance = await provider.request({
    method: 'eth_call',
    params: [{ to: approval.to, data: allowanceData }, 'latest'],
  });
  if (typeof rawAllowance !== 'string') throw new Error('Unable to check the token allowance for the selected DEX route.');
  const allowance = decodeFunctionResult({
    abi: erc20Abi,
    functionName: 'allowance',
    data: rawAllowance as `0x${string}`,
  });
  return allowance < approvedAmount;
}

export async function executeFeeProtectedAggregatorSwap(
  transactions: FeeProtectedSwapTransactions,
  userAddress: string,
  outputTokenAddress: string,
  providerOverride?: Eip1193Provider,
  onProgress?: (message: string) => void,
  chain: ChainKey = 'base'
): Promise<{
  success: boolean;
  txHash: string;
  message: string;
  feeAmount?: number;
  feeCollected?: boolean;
  feeGasEth?: number;
  swapGasEth?: number;
  outputAmount?: number;
  feeTxHash?: string;
  pendingPlatformFee?: PendingPlatformFee;
}> {
  if (transactions.feeIncluded !== true) {
    return {
      success: false,
      txHash: '',
      message: 'Swap cancelled: the 0.1% fee must be included in the swap transaction. No transaction was submitted.',
    };
  }

  const provider = providerOverride || (typeof window === 'undefined' ? undefined : window.okxwallet || window.ethereum);
  if (!provider || !userAddress) {
    return { success: false, txHash: '', message: `Connect a wallet on ${CHAINS[chain].name} before swapping.` };
  }

  try {
    await ensureChain(provider, CHAINS[chain]);

    if (transactions.approval && await needsTokenApproval(provider, userAddress, transactions.approval)) {
      onProgress?.(`Waiting for token approval for ${transactions.provider === 'binance' ? 'Binance Web3' : 'OKX DEX'}…`);
      const approval = transactions.approval;
      const approvalHash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{
          from: userAddress,
          to: approval.to,
          data: approval.data,
          value: approval.value,
          ...(approval.gas ? { gas: approval.gas } : {}),
          ...(approval.gasPrice ? { gasPrice: approval.gasPrice } : {}),
        }],
      }) as string;
      if (!await waitForTransactionReceipt(approvalHash, undefined, chain)) {
        return {
          success: false,
          txHash: approvalHash,
          message: 'OKX DEX approval was not confirmed; the swap was not submitted.',
        };
      }
    }

    onProgress?.(`Waiting for swap confirmation through ${transactions.provider === 'binance' ? 'Binance Web3' : 'OKX DEX'}…`);
    const swap = transactions.swap;
    const outputBalanceBefore = await readOutputBalanceRaw(userAddress, outputTokenAddress, chain);
    const txHash = await provider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: userAddress,
        to: swap.to,
        data: swap.data,
        value: swap.value,
        ...(swap.gas ? { gas: swap.gas } : {}),
        ...(swap.gasPrice ? { gasPrice: swap.gasPrice } : {}),
      }],
    }) as string;
    return finishSwapAndCollectPlatformFee(
      provider,
      userAddress,
      outputTokenAddress,
      outputBalanceBefore,
      txHash,
      onProgress,
      transactions.feeIncluded,
      transactions.feeTokenAddress,
      BigInt(transactions.feeAmountRaw),
      transactions.feeDecimals,
      chain
    );
  } catch (error) {
    return {
      success: false,
      txHash: '',
      message: error instanceof Error ? error.message : 'The selected DEX transaction could not be submitted.',
    };
  }
}

// Format numbers nicely
export function formatCurrency(num: number, isUsd = true, maxDecimals = 4): string {
  if (num === 0) return isUsd ? '$0.00' : '0.00';
  const prefix = isUsd ? '$' : '';

  if (Math.abs(num) >= 1_000_000_000) {
    return `${prefix}${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (Math.abs(num) >= 1_000_000) {
    return `${prefix}${(num / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(num) >= 1_000) {
    return `${prefix}${(num / 1_000).toFixed(2)}K`;
  }
  if (Math.abs(num) < 0.0001) {
    return `${prefix}${num.toExponential(2)}`;
  }
  if (Math.abs(num) < 0.01) {
    return `${prefix}${num.toFixed(6)}`;
  }
  return `${prefix}${num.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: maxDecimals,
  })}`;
}
