import { createHmac } from 'node:crypto';
import { getBinanceWeb3Credentials } from '../../../../../src/server/binanceWeb3Credentials';
import { PLATFORM_FEE_BPS, PLATFORM_FEE_RECEIVER } from '../../../../../src/config/platformFee';
import { BINANCE_CHAIN_IDS } from '../../../../../src/server/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const routes = new Set(['quote', 'swap', 'approve-transaction']);
const evmAddressPattern = /^0x[a-f\d]{40}$/i;
const nativeTokenAddress = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

function invalidRequest(message: string, status = 400) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function isPositiveInteger(value: string | null): value is string {
  return Boolean(value && /^\d{1,78}$/.test(value) && BigInt(value) > 0n);
}

function validateRequest(route: string, incoming: URLSearchParams): URLSearchParams | string {
  const params = new URLSearchParams();
  const chainId = incoming.get('binanceChainId');
  if (!chainId || !BINANCE_CHAIN_IDS.includes(chainId)) return `Binance Web3 swaps are enabled for chains ${BINANCE_CHAIN_IDS.join(', ')}.`;
  params.set('binanceChainId', chainId);

  if (route === 'approve-transaction') {
    const token = incoming.get('tokenContractAddress');
    const amount = incoming.get('approveAmount');
    if (!token || !evmAddressPattern.test(token) || !isPositiveInteger(amount)) {
      return 'Binance Web3 approval requires a valid token address and positive integer amount.';
    }
    params.set('tokenContractAddress', token);
    params.set('approveAmount', amount);
    return params;
  }

  const amount = incoming.get('amount');
  const fromToken = incoming.get('fromTokenAddress');
  const toToken = incoming.get('toTokenAddress');
  if (
    !isPositiveInteger(amount) ||
    !fromToken ||
    !toToken ||
    !(evmAddressPattern.test(fromToken) || fromToken.toLowerCase() === nativeTokenAddress) ||
    !(evmAddressPattern.test(toToken) || toToken.toLowerCase() === nativeTokenAddress) ||
    fromToken.toLowerCase() === toToken.toLowerCase()
  ) {
    return 'Binance Web3 requires valid token addresses and a positive integer input amount.';
  }
  params.set('amount', amount);
  params.set('fromTokenAddress', fromToken);
  params.set('toTokenAddress', toToken);

  if (
    incoming.get('feePercent') !== String(PLATFORM_FEE_BPS / 100) ||
    incoming.get('fromTokenReferrerWalletAddress')?.toLowerCase() !== PLATFORM_FEE_RECEIVER.toLowerCase()
  ) {
    return 'Binance Web3 swaps must include the configured 0.1% platform fee and revenue wallet.';
  }
  params.set('feePercent', String(PLATFORM_FEE_BPS / 100));
  params.set('fromTokenReferrerWalletAddress', PLATFORM_FEE_RECEIVER);

  if (route === 'quote') {
    if (incoming.get('feeSource') !== 'FROM_TOKEN') {
      return 'Binance Web3 quotes must collect the platform fee from the input token.';
    }
    params.set('feeSource', 'FROM_TOKEN');
    const wallet = incoming.get('userWalletAddress');
    if (wallet) {
      if (!evmAddressPattern.test(wallet)) return 'Binance Web3 quote wallet address is invalid.';
      params.set('userWalletAddress', wallet);
    }
    return params;
  }

  const wallet = incoming.get('userWalletAddress');
  const quoteId = incoming.get('quoteId');
  const slippage = Number(incoming.get('slippagePercent'));
  if (
    !wallet ||
    !evmAddressPattern.test(wallet) ||
    !quoteId ||
    !/^[a-z\d-]{8,100}$/i.test(quoteId) ||
    !Number.isFinite(slippage) ||
    slippage <= 0 ||
    slippage > 50
  ) {
    return 'Binance Web3 swap requires a valid wallet, live quote ID, and slippage from 0 to 50%.';
  }
  params.set('userWalletAddress', wallet);
  params.set('quoteId', quoteId);
  params.set('slippagePercent', String(slippage));
  return params;
}

export async function GET(request: Request, context: { params: Promise<{ route: string }> }) {
  const { route } = await context.params;
  if (!routes.has(route)) return invalidRequest('Unsupported Binance Web3 aggregator route.', 404);

  const url = new URL(request.url);
  const params = validateRequest(route, url.searchParams);
  if (typeof params === 'string') return invalidRequest(params);

  const credentials = getBinanceWeb3Credentials();
  if (!credentials.apiKey || !credentials.secretKey) {
    return invalidRequest('Binance Web3 API credentials are not configured on the server.', 503);
  }
  const { apiKey, secretKey } = credentials;
  const method = 'GET';
  const requestPath = `/build/api/v1/dex/aggregator/${route}?${params.toString()}`;
  const timestamp = new Date().toISOString();
  const signature = createHmac('sha256', secretKey)
    .update(`${timestamp}${method}${requestPath}`, 'utf8')
    .digest('base64');

  try {
    const upstream = await fetch(`https://web3.binance.com${requestPath}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-OC-APIKEY': apiKey,
        'X-OC-SIGN': signature,
        'X-OC-TIMESTAMP': timestamp,
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    // Binance answers blocked networks and regions with an HTML challenge page, not JSON.
    if (!(upstream.headers.get('content-type') ?? '').includes('json')) {
      return invalidRequest(`Binance Web3 is blocked from this server's network or region (HTTP ${upstream.status}).`, 502);
    }
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Binance Web3 aggregator request failed:', error);
    return invalidRequest('Unable to reach the Binance Web3 aggregator.', 502);
  }
}
