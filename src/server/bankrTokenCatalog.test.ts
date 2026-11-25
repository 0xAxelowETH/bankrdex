import { describe, expect, it, vi } from 'vitest';

vi.mock('./background', () => ({ runInBackground: () => undefined }));

const { fromBankrLaunch, fromGeckoPool, mergeToken, WETH_ADDRESS, BNKR_ADDRESS } = await import('./bankrTokenCatalog');

// Shape of one record from GET https://api.bankr.bot/token-launches
const launch = {
  status: 'deployed',
  launchType: 'doppler',
  tokenName: 'MiniMega',
  tokenSymbol: 'MM',
  chain: 'base',
  tokenAddress: '0x65FB2BABA81AF7BD0AD44A4E58B34693F2C20BA3',
  poolId: '0x81407661988f2ab4e3255aa4dad58ebb3d183394d1eb9638ebdc537d7f5cd1e3',
  txHash: '0x29d91a5b9265ffcd37dad363c97563617358f4f4cd30ef293c1718f6fa1945ec',
  deployer: { walletAddress: '0x10f246563614d12f32cff4a6e9596db803fc5546', xUsername: 'GeraiKerang', xProfileImageUrl: 'https://pbs.twimg.com/a.jpg' },
  feeRecipient: { walletAddress: '0x10f246563614d12f32cff4a6e9596db803fc5546' },
  tweetUrl: 'https://x.com/GeraiKerang/status/2108759894434439313',
  imageUri: 'ipfs://bafkreibyfbdtj6rwops2mehznuwwm5usxne4fjeop2xzjn2bzuucmcxa7q',
  timestamp: 1791602531629,
};

describe('fromBankrLaunch', () => {
  it('maps a deployed Base launch to a catalog token', () => {
    const token = fromBankrLaunch(launch)!;
    expect(token.address).toBe('0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3');
    expect(token.chain).toBe('base');
    expect(token.pool).toBe(launch.poolId);
    expect(token.quoteAddress).toBe(WETH_ADDRESS);
    expect(token.quoteSymbol).toBe('WETH');
    expect(token.creator).toBe('0x10f246563614d12f32cff4a6e9596db803fc5546');
    expect(token.creatorX).toEqual({ username: 'GeraiKerang', avatar: 'https://pbs.twimg.com/a.jpg' });
    expect(token.imageUrl).toBe(launch.imageUri);
    expect(token.launchedAt).toBe(launch.timestamp);
  });

  it('uses the paired token as the quote', () => {
    const token = fromBankrLaunch({ ...launch, pairedToken: { address: BNKR_ADDRESS, symbol: 'BNKR' } })!;
    expect(token.quoteAddress).toBe(BNKR_ADDRESS);
    expect(token.quoteSymbol).toBe('BNKR');
  });

  it('maps launches on other Bankr chains with their own quote asset', () => {
    const token = fromBankrLaunch({ ...launch, chain: 'robinhood' })!;
    expect(token.chain).toBe('robinhood');
    expect(token.chainId).toBe(4663);
    expect(token.quoteAddress).toBe('0x0bd7d308f8e1639fab988df18a8011f41eacad73');
    expect(fromBankrLaunch({ ...launch, chain: 'arc' })!.quoteSymbol).toBe('USDC');
  });

  it('skips unknown chains, pending launches and unsafe links', () => {
    expect(fromBankrLaunch({ ...launch, chain: 'solana' })).toBeNull();
    expect(fromBankrLaunch({ ...launch, status: 'pending' })).toBeNull();
    expect(fromBankrLaunch({ ...launch, tokenAddress: 'nope' })).toBeNull();
    const token = fromBankrLaunch({ ...launch, tweetUrl: 'javascript:alert(1)', imageUri: 'http://x/y.png' })!;
    expect(token.tweetUrl).toBeUndefined();
    expect(token.imageUrl).toBeUndefined();
  });
});

describe('fromGeckoPool', () => {
  const pool = {
    id: 'base_0x81407661988f2ab4e3255aa4dad58ebb3d183394d1eb9638ebdc537d7f5cd1e3',
    attributes: {
      address: '0x81407661988f2ab4e3255aa4dad58ebb3d183394d1eb9638ebdc537d7f5cd1e3',
      name: 'MM / WETH',
      base_token_price_usd: '0.00002',
      fdv_usd: '2000000',
      market_cap_usd: null,
      reserve_in_usd: '150000',
      volume_usd: { h24: '42000' },
      price_change_percentage: { m5: '1', h1: '-2', h24: '30' },
      transactions: { h24: { buys: 120, sells: 80 } },
      pool_created_at: '2026-10-10T03:22:11Z',
    },
    relationships: {
      base_token: { data: { id: 'base_0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3' } },
      quote_token: { data: { id: `base_${WETH_ADDRESS}` } },
    },
  };
  const included = [
    { id: 'base_0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3', attributes: { name: 'MiniMega', symbol: 'MM', image_url: 'missing.png' } },
    { id: `base_${WETH_ADDRESS}`, attributes: { symbol: 'WETH' } },
  ];

  it('reads market data and uses FDV as the market cap', () => {
    const token = fromGeckoPool(pool, included)!;
    expect(token.address).toBe('0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3');
    expect(token.pool).toBe(pool.attributes.address);
    expect(token.marketCapUsd).toBe(2_000_000);
    expect(token.volume24hUsd).toBe(42_000);
    expect(token.totalTx24h).toBe(200);
    expect(token.imageUrl).toBeUndefined();
  });

  it('picks the launched token when the pool lists it as the quote', () => {
    const inverted = {
      ...pool,
      relationships: {
        base_token: { data: { id: `base_${WETH_ADDRESS}` } },
        quote_token: { data: { id: 'base_0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3' } },
      },
    };
    const token = fromGeckoPool(inverted, included)!;
    expect(token.address).toBe('0x65fb2baba81af7bd0ad44a4e58b34693f2c20ba3');
    expect(token.totalBuys24h).toBe(80);
    expect(token.marketCapUsd).toBeUndefined();
  });

  it('picks the ba3 side when the pair is another launched or stock token', () => {
    // e.g. a Robinhood pool listed as "AMC / MEME": AMC is a stock token, MEME the Bankr launch.
    const stock = '0x05a3d1cd21d0c88145e82600e62e7e496e0f222b';
    const launched = '0x91a2dae9699f0b82540b5886b0d8759c22820ba3';
    const paired = {
      ...pool,
      relationships: {
        base_token: { data: { id: `base_${stock}` } },
        quote_token: { data: { id: `base_${launched}` } },
      },
    };
    const token = fromGeckoPool(paired, [
      { id: `base_${stock}`, attributes: { name: 'AMC Entertainment', symbol: 'amc' } },
      { id: `base_${launched}`, attributes: { name: 'musebook', symbol: 'musebook' } },
    ])!;
    expect(token.address).toBe(launched);
    expect(token.quoteAddress).toBe(stock);
  });
});

describe('mergeToken', () => {
  it('keeps the Bankr identity and pool while taking newer market data', () => {
    const identity = fromBankrLaunch(launch)!;
    const market = { ...identity, launchType: undefined, pool: `0x${'ab'.repeat(32)}`, launchedAt: 1, volume24hUsd: 9, imageUrl: 'https://img/x.png' };
    const merged = mergeToken(identity, market);
    expect(merged.pool).toBe(launch.poolId);
    expect(merged.launchedAt).toBe(launch.timestamp);
    expect(merged.volume24hUsd).toBe(9);
    expect(merged.imageUrl).toBe('https://img/x.png');
    // A later launch record must not swap the https image back to IPFS.
    expect(mergeToken(merged, identity).imageUrl).toBe('https://img/x.png');
  });
});
