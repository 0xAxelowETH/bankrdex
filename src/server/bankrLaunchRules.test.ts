import { describe, expect, it } from 'vitest';
import { BANKR_FEE_BENEFICIARY, BANKR_INTEGRATOR, checkBankrLaunches, HOOK_INITIALIZER, judgeBeneficiaries, judgeHookState, MULTICURVE_INITIALIZER } from './bankrLaunchRules';

const DOPPLER = '0x21e2ce70511e4fe542a97708e89520471daa7a66';
const creator = '0x5ab6c33c0a570940eb79161be6686e9fe54c6de4';
const entry = (beneficiary: string) => ({ beneficiary, shares: 1n });

describe('judgeBeneficiaries (multicurve launches)', () => {
  it('accepts the Bankr fee split', () => {
    expect(judgeBeneficiaries([entry(DOPPLER), entry(BANKR_FEE_BENEFICIARY), entry(creator), entry(BANKR_INTEGRATOR)])).toEqual({ bankr: true, reason: 'ok' });
  });
  it('rejects look-alikes that keep the fees', () => {
    expect(judgeBeneficiaries([entry(DOPPLER), entry(creator)])).toEqual({ bankr: false, reason: 'no-bankr-fee-share' });
    expect(judgeBeneficiaries([entry(DOPPLER), entry(creator), entry(BANKR_INTEGRATOR)])).toEqual({ bankr: false, reason: 'no-bankr-fee-wallet' });
  });
});

describe('judgeHookState (hook launches)', () => {
  it('accepts Bankr hooks with the Bankr pool setup', () => {
    expect(judgeHookState('0x9982538F41f2ae29ddb9d3d9307010052984fdbb', 0x800000, 200)).toEqual({ bankr: true, reason: 'ok' });
  });
  it('rejects other setups and leaves unknown hooks undecided', () => {
    expect(judgeHookState('0x0000000000000000000000000000000000000000', 100000, 30).bankr).toBe(false);
    expect(judgeHookState('0x0000000000000000000000000000000000000000', 0x800000, 200)).toEqual({ bankr: false, reason: 'no-doppler-hook' });
    expect(judgeHookState('0x1234567890123456789012345678901234567890', 0x800000, 200).bankr).toBeNull();
  });
});

describe('checkBankrLaunches', () => {
  it('reads the integrator, then the initializer setup', async () => {
    const assets: Record<string, [string, string]> = {
      '0xaaa0000000000000000000000000000000000ba3': [BANKR_INTEGRATOR, MULTICURVE_INITIALIZER],
      '0xbbb0000000000000000000000000000000000ba3': [BANKR_INTEGRATOR, HOOK_INITIALIZER],
      '0xccc0000000000000000000000000000000000ba3': ['0x0000000000000000000000000000000000000abc', MULTICURVE_INITIALIZER],
    };
    const client = {
      multicall: async ({ contracts }: { allowFailure: true; contracts: readonly unknown[] }) => (contracts as { functionName: string; args: [string] }[]).map(({ functionName, args: [token] }) => {
        if (functionName === 'getAssetData') return { status: 'success' as const, result: [0, 0, 0, 0, assets[token][1], 0, 0, 0n, 0n, assets[token][0]] };
        if (functionName === 'getBeneficiaries') return { status: 'success' as const, result: [entry(BANKR_INTEGRATOR), entry(BANKR_FEE_BENEFICIARY)] };
        return { status: 'success' as const, result: [0, 0n, '0xbf4195ab0b03e1eb3345dd1e83bed7650b1ed123', '0x', 0, { fee: 0x800000, tickSpacing: 200 }, 0] };
      }),
    };
    const checks = await checkBankrLaunches(client, Object.keys(assets));
    expect(checks.get('0xaaa0000000000000000000000000000000000ba3')).toEqual({ bankr: true, reason: 'ok' });
    expect(checks.get('0xbbb0000000000000000000000000000000000ba3')).toEqual({ bankr: true, reason: 'ok' });
    expect(checks.get('0xccc0000000000000000000000000000000000ba3')).toEqual({ bankr: false, reason: 'other-integrator' });
  });
});
