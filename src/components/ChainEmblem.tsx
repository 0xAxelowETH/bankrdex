import React from 'react';
import { CHAINS, type ChainKey } from '../config/chains';

// Chain logo for token avatars and the chain tabs.
export const ChainEmblem: React.FC<{ chain: ChainKey; className?: string }> = ({ chain, className = '' }) => (
  <img
    src={CHAINS[chain].logo}
    alt={CHAINS[chain].name}
    title={`On ${CHAINS[chain].name}`}
    width={16}
    height={16}
    loading="lazy"
    className={`chain-${chain} chain-ring h-4 w-4 rounded-full bg-sunken object-contain ${className}`}
  />
);
