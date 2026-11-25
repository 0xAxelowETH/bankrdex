import React from 'react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import type { BankrVerification, Token } from '../types';

export const VERIFICATION_TEXT: Record<BankrVerification, { short: string; long: string }> = {
  official: { short: 'Bankr token', long: 'BNKR, Bankr’s own coin.' },
  registry: { short: 'Verified Bankr launch', long: 'Verified on-chain: launched through Doppler with Bankr as the integrator (Bankr launch registry).' },
  onchain: { short: 'Verified Bankr launch', long: 'Verified on-chain: Bankr is the Doppler integrator of this token.' },
  'bankr-api': { short: 'Verified Bankr launch', long: 'Verified against Bankr’s own launch records.' },
};

// Green when BankrDex confirmed the token is a Bankr launch; amber for tokens opened from other
// sources (e.g. a Binance Web3 hot-token link), which are not Bankr launches.
export const BankrVerifiedBadge: React.FC<{ token: Token; className?: string }> = ({ token, className = '' }) => {
  const verifiedBy = token.bankr?.verifiedBy;
  if (verifiedBy) {
    const text = VERIFICATION_TEXT[verifiedBy];
    return (
      <span title={text.long} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-up/30 bg-up/10 px-2 py-0.5 text-[0.6875rem] font-extrabold text-up ${className}`}>
        <ShieldCheck className="h-3 w-3" /> {text.short}
      </span>
    );
  }
  if (token.externalSource) {
    return (
      <span title="This token was opened from another source and is not a Bankr launch. Check the contract before trading." className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[0.6875rem] font-extrabold text-warn ${className}`}>
        <ShieldAlert className="h-3 w-3" /> Not a Bankr launch
      </span>
    );
  }
  return null;
};
