// What a Bankr launch looks like on Base, beyond Doppler's integrator field. Anyone can call
// Airlock.create with Bankr as the integrator and mine a `ba3` address, and some accounts did
// (tens of thousands of tokens Bankr never deployed), so a launch must also carry Bankr's setup:
//   DecayMulticurveInitializer launches: Bankr's integrator and Bankr's fee wallet are both fee
//     beneficiaries (Bankr launches split fees creator / Bankr / Doppler).
//   DopplerHookInitializer launches: one of Bankr's Doppler hooks, dynamic fee, tick spacing 200.
// Checked against Bankr's own answers (GET /tokens/search `bankrDeployed`, GET /token-launches) on
// 1,243 tokens: every Bankr launch passes; 2 of 52 non-Bankr tokens pass (0.17% of all checked).
// Imported by server code and, through Node's type stripping, by scripts/*.mjs (only `viem` here).
import { parseAbi } from 'viem';

export const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
export const BANKR_INTEGRATOR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
export const BANKR_FEE_BENEFICIARY = '0x2cdd33d6ff2a897180c7f4e5a20f018bf0c16fd1';
export const MULTICURVE_INITIALIZER = '0xd59ce43e53d69f190e15d9822fb4540dccc91178';
export const HOOK_INITIALIZER = '0xbdf938149ac6a781f94faa0ed45e6a0e984c6544';
export const BANKR_DOPPLER_HOOKS = new Set([
  '0x9982538f41f2ae29ddb9d3d9307010052984fdbb',
  '0xbf4195ab0b03e1eb3345dd1e83bed7650b1ed123',
  '0x6ab5ae3191c914de8437431091776fc90f314be4',
]);
const DYNAMIC_FEE = 0x800000;
const TICK_SPACING = 200;
const ZERO = '0x0000000000000000000000000000000000000000';

// bankr: true = Bankr launch; false = not Bankr's (reason says why); null = undecided (the chain
// could not be read, or a configuration Bankr may have started using since: ask Bankr's API).
export type LaunchCheck = { bankr: boolean | null; reason: string };

export const launchAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'function getAssetData(address asset) view returns (address numeraire, address timelock, address governance, address liquidityMigrator, address poolInitializer, address pool, address migrationPool, uint256 numTokensToSell, uint256 totalSupply, address integrator)',
  'function getBeneficiaries(address asset) view returns ((address beneficiary, uint96 shares)[])',
  'function getState(address asset) view returns (address numeraire, uint256 totalTokensOnBondingCurve, address dopplerHook, bytes graduationDopplerHookCalldata, uint8 status, PoolKey poolKey, int24 farTick)',
]);

export function judgeBeneficiaries(beneficiaries: readonly { beneficiary: string; shares: bigint }[]): LaunchCheck {
  const list = beneficiaries.map((entry) => entry.beneficiary.toLowerCase());
  if (list.includes(BANKR_INTEGRATOR) && list.includes(BANKR_FEE_BENEFICIARY)) return { bankr: true, reason: 'ok' };
  if (!list.includes(BANKR_INTEGRATOR)) return { bankr: false, reason: 'no-bankr-fee-share' };
  return { bankr: false, reason: 'no-bankr-fee-wallet' };
}

export function judgeHookState(dopplerHook: string, fee: number, tickSpacing: number): LaunchCheck {
  const hook = dopplerHook.toLowerCase();
  if (fee !== DYNAMIC_FEE || tickSpacing !== TICK_SPACING) return { bankr: false, reason: `pool-config:${fee}/${tickSpacing}` };
  if (BANKR_DOPPLER_HOOKS.has(hook)) return { bankr: true, reason: 'ok' };
  if (hook === ZERO) return { bankr: false, reason: 'no-doppler-hook' };
  return { bankr: null, reason: `unknown-hook:${hook}` };
}

interface MulticallClient {
  multicall(args: { allowFailure: true; contracts: readonly unknown[] }): Promise<readonly ({ status: 'success'; result: unknown } | { status: 'failure'; error: unknown })[]>;
}

// Full on-chain check for Base tokens: Doppler integrator, then the initializer-specific setup.
// `registered` (token -> pool initializer) skips the integrator read for registry rows, whose
// integrator was confirmed when they were recorded.
export async function checkBankrLaunches(
  client: MulticallClient,
  tokens: string[],
  registered: Map<string, string> = new Map(),
): Promise<Map<string, LaunchCheck>> {
  const checks = new Map<string, LaunchCheck>();
  const pending: { token: string; initializer: string }[] = tokens
    .filter((token) => registered.has(token))
    .map((token) => ({ token, initializer: registered.get(token)!.toLowerCase() }));
  const unregistered = tokens.filter((token) => !registered.has(token));
  for (let index = 0; index < unregistered.length; index += 500) {
    const batch = unregistered.slice(index, index + 500);
    const reads = await client.multicall({
      allowFailure: true,
      contracts: batch.map((token) => ({ address: AIRLOCK, abi: launchAbi, functionName: 'getAssetData', args: [token] })),
    });
    batch.forEach((token, position) => {
      const read = reads[position];
      if (read.status !== 'success') { checks.set(token, { bankr: null, reason: 'unreadable' }); return; }
      const asset = read.result as readonly unknown[];
      if (String(asset[9]).toLowerCase() !== BANKR_INTEGRATOR) { checks.set(token, { bankr: false, reason: 'other-integrator' }); return; }
      pending.push({ token, initializer: String(asset[4]).toLowerCase() });
    });
  }
  for (let index = 0; index < pending.length; index += 500) {
    const batch = pending.slice(index, index + 500);
    const reads = await client.multicall({
      allowFailure: true,
      contracts: batch.map(({ token, initializer }) => initializer === HOOK_INITIALIZER
        ? { address: HOOK_INITIALIZER, abi: launchAbi, functionName: 'getState', args: [token] }
        : { address: initializer, abi: launchAbi, functionName: 'getBeneficiaries', args: [token] }),
    });
    batch.forEach(({ token, initializer }, position) => {
      const read = reads[position];
      if (initializer !== HOOK_INITIALIZER && initializer !== MULTICURVE_INITIALIZER) {
        checks.set(token, { bankr: false, reason: `initializer:${initializer}` });
        return;
      }
      if (read.status !== 'success') { checks.set(token, { bankr: null, reason: 'unreadable' }); return; }
      if (initializer === HOOK_INITIALIZER) {
        const state = read.result as readonly unknown[];
        const key = state[5] as { fee: number; tickSpacing: number };
        checks.set(token, judgeHookState(String(state[2]), Number(key.fee), Number(key.tickSpacing)));
      } else {
        checks.set(token, judgeBeneficiaries(read.result as readonly { beneficiary: string; shares: bigint }[]));
      }
    });
  }
  return checks;
}
