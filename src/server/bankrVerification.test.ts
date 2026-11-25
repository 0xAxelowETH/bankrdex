import { afterEach, describe, expect, it, vi } from 'vitest';

// No database and no chain access in tests: the registry and the Airlock reads are stubbed.
vi.mock('./marketIndex', () => ({
  isMarketIndexConfigured: () => true,
  getLaunchRows: async (addresses: string[]) => addresses
    .filter((address) => address === '0x1111111111111111111111111111111111111ba3')
    .map((address) => ({ token_address: address })),
}));
const MULTICURVE = '0xd59ce43e53d69f190e15d9822fb4540dccc91178';
const BANKR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
const BANKR_FEE = '0x2cdd33d6ff2a897180c7f4e5a20f018bf0c16fd1';
// Airlock data per token: [integrator, beneficiaries]. 0x2222 is a Bankr launch, 0x8888 sets Bankr
// as integrator without Bankr's fee split (a look-alike), 0x3333 has another integrator.
const chain: Record<string, [string, string[]]> = {
  '0x2222222222222222222222222222222222222ba3': [BANKR, [BANKR, BANKR_FEE, '0x0000000000000000000000000000000000000c0e']],
  '0x8888888888888888888888888888888888888ba3': [BANKR, ['0x0000000000000000000000000000000000000c0e']],
  '0x3333333333333333333333333333333333333fee': ['0x0000000000000000000000000000000000000abc', []],
};
vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>();
  return {
    ...actual,
    createPublicClient: () => ({
      multicall: async ({ contracts }: { contracts: { functionName: string; args: [string] }[] }) => contracts.map(({ functionName, args: [address] }) => {
        const entry = chain[address];
        if (!entry) return { status: 'failure', error: new Error('reverted') };
        if (functionName === 'getAssetData') return { status: 'success', result: [0, 0, 0, 0, MULTICURVE, 0, 0, 0n, 0n, entry[0]] };
        return { status: 'success', result: entry[1].map((beneficiary) => ({ beneficiary, shares: 1n })) };
      }),
    }),
  };
});

const { verifyTokens, verdictOf } = await import('./bankrVerification');
const token = (address: string, chain: 'base' | 'robinhood' | 'arbitrum' = 'base', extra = {}) =>
  ({ address, chain, chainId: 1, name: 'T', symbol: 'T', ...extra });

afterEach(() => vi.unstubAllGlobals());

describe('verifyTokens', () => {
  it('accepts Bankr records, the registry, BNKR and the on-chain integrator', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await verifyTokens([
      token('0x22af33fe49fd1fa80c7149773dde5890d3c76f3b'),
      token('0x4444444444444444444444444444444444444ba3', 'base', { launchType: 'doppler' }),
      token('0x1111111111111111111111111111111111111ba3'),
      token('0x2222222222222222222222222222222222222ba3'),
    ]);
    expect(verdictOf('base', '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b')).toEqual({ bankr: true, method: 'official' });
    expect(verdictOf('base', '0x4444444444444444444444444444444444444ba3')).toEqual({ bankr: true, method: 'bankr-api' });
    expect(verdictOf('base', '0x1111111111111111111111111111111111111ba3')).toEqual({ bankr: true, method: 'registry' });
    expect(verdictOf('base', '0x2222222222222222222222222222222222222ba3')).toEqual({ bankr: true, method: 'onchain' });
  });

  it('rejects another integrator, look-alikes and addresses without the ba3 suffix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await verifyTokens([
      token('0x8888888888888888888888888888888888888ba3'),
      token('0x3333333333333333333333333333333333333fee'),
      token('0x5555555555555555555555555555555555551e18', 'arbitrum'),
    ]);
    expect(verdictOf('base', '0x8888888888888888888888888888888888888ba3')).toEqual({ bankr: false, method: 'onchain' });
    expect(verdictOf('base', '0x3333333333333333333333333333333333333fee')).toEqual({ bankr: false, method: 'onchain' });
    expect(verdictOf('arbitrum', '0x5555555555555555555555555555555555551e18')).toEqual({ bankr: false, method: 'suffix' });
  });

  it('asks Bankr about undecided ba3 tokens and keeps unknown ones undecided', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('0x6666666666666666666666666666666666666ba3')
      ? Response.json({ launch: { chain: 'arbitrum', status: 'deployed', tokenAddress: '0x6666666666666666666666666666666666666ba3' } })
      : new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    await verifyTokens([
      token('0x6666666666666666666666666666666666666ba3', 'arbitrum'),
      token('0x7777777777777777777777777777777777777ba3', 'arbitrum'),
    ]);
    expect(verdictOf('arbitrum', '0x6666666666666666666666666666666666666ba3')).toEqual({ bankr: true, method: 'bankr-api' });
    expect(verdictOf('arbitrum', '0x7777777777777777777777777777777777777ba3')).toBeUndefined();
  });
});
