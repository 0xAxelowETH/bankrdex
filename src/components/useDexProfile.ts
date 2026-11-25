import { useEffect, useState } from 'react';
import type { Token } from '../types';
import { cachedDexProfile, loadDexProfile, type DexProfile } from '../services/dexProfiles';

const RETRIES = 4;
const RETRY_MS = 15_000;

// The token's DexScreener profile (logo, banner, paid status, paid links). While the paid status
// is still unknown the hook asks again a few times.
export function useDexProfile(token: Pick<Token, 'address' | 'chain'>): DexProfile | undefined {
  const chain = token.chain ?? 'base';
  const address = token.address.toLowerCase();
  const key = `${chain}:${address}`;
  const [state, setState] = useState(() => ({ key, profile: cachedDexProfile(chain, address) }));

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    setState({ key: `${chain}:${address}`, profile: cachedDexProfile(chain, address) });
    const load = () => {
      attempts += 1;
      void loadDexProfile(chain, address).then((value) => {
        if (!active) return;
        if (value) setState({ key: `${chain}:${address}`, profile: value });
        if ((!value || value.paid === null) && attempts <= RETRIES) timer = setTimeout(load, RETRY_MS);
      });
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [chain, address]);

  // Right after the token changes the state still holds the previous token's profile.
  return state.key === key ? state.profile : cachedDexProfile(chain, address);
}
