// How a Bankr launch is recognised on-chain. Bankr launches tokens through Doppler: the Airlock
// contract records each launch, and Airlock.getAssetData(token).integrator is the address Doppler
// pays integrator fees to, which is Bankr's for every Bankr launch (same address on every chain).
// Bankr also mines every token address to end in `ba3`; other launchpads that reuse Doppler (and
// that GeckoTerminal files under its "bankr" dexes) do not.
import type { ChainKey } from './chains';

export const BANKR_INTEGRATOR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
export const BANKR_TOKEN_SUFFIX = 'ba3';
// BNKR, Bankr's own coin: not a launchpad token, listed as the ecosystem's quote asset.
export const BNKR_TOKEN = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b';

// Doppler Airlock per chain (Robinhood's read from a Bankr launch transaction; Arbitrum and Arc
// launches are confirmed through Bankr's own records until their Airlock is known).
export const DOPPLER_AIRLOCK: Partial<Record<ChainKey, string>> = {
  base: '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12',
  robinhood: '0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862',
};

export const hasBankrSuffix = (address: string) => address.toLowerCase().endsWith(BANKR_TOKEN_SUFFIX);
