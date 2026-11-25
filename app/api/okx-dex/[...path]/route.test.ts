import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLATFORM_FEE_RECEIVER } from '../../../../src/config/platformFee';
import { GET, POST } from './route';

const USDT = '0x55d398326f99059ff775485246999027b3197955';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const WALLET = '0x1111111111111111111111111111111111111111';

const call = (path: string, query: Record<string, string>, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
  const url = `http://localhost/api/okx-dex/${path}?${new URLSearchParams(query)}`;
  const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { params: Promise.resolve({ path: path.split('/') }) };
  return method === 'GET' ? GET(request, context) : POST(request, context);
};

const swapQuery = {
  chainIndex: '8453',
  fromTokenAddress: NATIVE,
  toTokenAddress: USDT,
  amount: '10000000000000000',
  swapMode: 'exactIn',
  slippagePercent: '1',
  userWalletAddress: WALLET,
  feePercent: '0.1',
  fromTokenReferrerWalletAddress: PLATFORM_FEE_RECEIVER,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OKX DEX proxy validation', () => {
  it('rejects unknown routes', async () => {
    expect((await call('wallet/balance', {})).status).toBe(404);
  });

  it('rejects swaps without the platform fee', async () => {
    const { feePercent: _fee, ...withoutFee } = swapQuery;
    const response = await call('aggregator/swap', withoutFee);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/feePercent/);
  });

  it('rejects swaps that pay the fee to another wallet', async () => {
    const response = await call('aggregator/swap', { ...swapQuery, fromTokenReferrerWalletAddress: WALLET });
    expect(response.status).toBe(400);
  });

  it('rejects other chains', async () => {
    expect((await call('aggregator/swap', { ...swapQuery, chainIndex: '1' })).status).toBe(400);
  });

  it('accepts every chain BankrDex routes', async () => {
    vi.stubEnv('OKX_DEX_API_KEY', 'key');
    vi.stubEnv('OKX_DEX_SECRET_KEY', 'secret');
    vi.stubEnv('OKX_DEX_PASSPHRASE', 'pass');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"0","data":[]}', { status: 200 })));
    for (const chainIndex of ['8453', '4663', '42161', '5042']) {
      expect((await call('aggregator/swap', { ...swapQuery, chainIndex })).status).toBe(200);
    }
  });

  it('rejects the wrong HTTP method', async () => {
    expect((await call('market/price-info', {}, 'GET')).status).toBe(405);
  });

  it('forwards only schema fields to OKX, signed', async () => {
    vi.stubEnv('OKX_DEX_API_KEY', 'key');
    vi.stubEnv('OKX_DEX_SECRET_KEY', 'secret');
    vi.stubEnv('OKX_DEX_PASSPHRASE', 'pass');
    const fetchMock = vi.fn(async () => new Response('{"code":"0","data":[]}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await call('aggregator/swap', { ...swapQuery, chainIndex: '8453', injected: 'evil' });
    expect(response.status).toBe(200);
    const [upstreamUrl, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(upstreamUrl).toContain('https://web3.okx.com/api/v6/dex/aggregator/swap?');
    expect(upstreamUrl).not.toContain('injected');
    expect(upstreamUrl).toContain(`fromTokenReferrerWalletAddress=${PLATFORM_FEE_RECEIVER}`);
    expect((init.headers as Record<string, string>)['OK-ACCESS-SIGN']).toBeTruthy();
  });
});
