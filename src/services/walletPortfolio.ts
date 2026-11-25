import type { Address } from 'viem';
import type { Token } from '../types';

const MULTICALL_CHUNK_SIZE = 400;
const MULTICALL_CONCURRENCY = 3;
const MULTICALL_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11' as Address;

async function createReadClient() {
  const { createPublicClient, formatUnits, http, parseAbi } = await import('viem');

  return {
    publicClient: createPublicClient({
      transport: http('https://base-rpc.publicnode.com', { timeout: 15_000, retryCount: 1 }),
    }),
    formatUnits,
    erc20Abi: parseAbi([
      'function balanceOf(address owner) view returns (uint256)',
      'function decimals() view returns (uint8)',
    ]),
  };
}

let readClientPromise: ReturnType<typeof createReadClient> | undefined;

function getReadClient() {
  return readClientPromise ??= createReadClient();
}

export interface WalletTokenHolding {
  token: Token;
  balance: number;
}

export async function fetchAddressTokenBalance(ownerAddress: string, tokenAddress: string): Promise<number> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(ownerAddress) || !/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) {
    throw new Error('Invalid wallet or token address for balance lookup.');
  }

  const { publicClient, formatUnits, erc20Abi } = await getReadClient();
  const [balance, decimals] = await publicClient.multicall({
    authorizationList: undefined,
    contracts: [
      {
        address: tokenAddress.toLowerCase() as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerAddress.toLowerCase() as Address],
      },
      {
        address: tokenAddress.toLowerCase() as Address,
        abi: erc20Abi,
        functionName: 'decimals',
      },
    ],
    allowFailure: true,
    multicallAddress: MULTICALL_ADDRESS,
  });

  if (balance.status !== 'success' || decimals.status !== 'success') {
    throw new Error('Failed to read token balance from Base.');
  }

  const formattedBalance = Number(formatUnits(balance.result, decimals.result));
  if (!Number.isFinite(formattedBalance)) {
    throw new Error('Received token balance is invalid.');
  }

  return formattedBalance;
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export async function fetchWalletTokenHoldings(
  ownerAddress: string,
  registryTokens: Token[]
): Promise<WalletTokenHolding[]> {
  const { publicClient, formatUnits, erc20Abi } = await getReadClient();
  const owner = ownerAddress.toLowerCase() as Address;
  const tokensByAddress = new Map<string, Token>();

  for (const token of registryTokens) {
    const address = token.address.toLowerCase();
    if (/^0x[a-f0-9]{40}$/.test(address)) tokensByAddress.set(address, token);
  }

  const candidates = [...tokensByAddress.values()];
  const tokenChunks = chunk(candidates, MULTICALL_CHUNK_SIZE);
  const positiveBalances: { token: Token; rawBalance: bigint }[] = [];

  for (let index = 0; index < tokenChunks.length; index += MULTICALL_CONCURRENCY) {
    const batchResults = await Promise.all(tokenChunks.slice(index, index + MULTICALL_CONCURRENCY).map((tokens) =>
      publicClient.multicall({
        authorizationList: undefined,
        contracts: tokens.map((token) => ({
          address: token.address.toLowerCase() as Address,
          abi: erc20Abi,
          functionName: 'balanceOf' as const,
          args: [owner] as const,
        })),
        allowFailure: true,
        batchSize: 100_000,
        multicallAddress: MULTICALL_ADDRESS,
      })
    ));

    batchResults.forEach((results, batchIndex) => {
      results.forEach((result, tokenIndex) => {
        if (result.status === 'success' && result.result > 0n) {
          positiveBalances.push({
            token: tokenChunks[index + batchIndex][tokenIndex],
            rawBalance: result.result,
          });
        }
      });
    });
  }

  const holdings: WalletTokenHolding[] = [];
  const positiveChunks = chunk(positiveBalances, MULTICALL_CHUNK_SIZE);

  for (let index = 0; index < positiveChunks.length; index += MULTICALL_CONCURRENCY) {
    const batchResults = await Promise.all(positiveChunks.slice(index, index + MULTICALL_CONCURRENCY).map((batch) =>
      publicClient.multicall({
        authorizationList: undefined,
        contracts: batch.map(({ token }) => ({
          address: token.address.toLowerCase() as Address,
          abi: erc20Abi,
          functionName: 'decimals' as const,
        })),
        allowFailure: true,
        batchSize: 100_000,
        multicallAddress: MULTICALL_ADDRESS,
      })
    ));

    batchResults.forEach((results, batchIndex) => {
      results.forEach((result, tokenIndex) => {
        if (result.status !== 'success') return;
        const holding = positiveChunks[index + batchIndex][tokenIndex];
        const balance = Number(formatUnits(holding.rawBalance, result.result));
        if (Number.isFinite(balance) && balance > 0) holdings.push({ token: holding.token, balance });
      });
    });
  }

  return holdings.sort((left, right) =>
    right.balance * right.token.priceUsd - left.balance * left.token.priceUsd
  );
}