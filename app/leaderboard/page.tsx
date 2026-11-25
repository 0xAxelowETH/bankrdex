import type { Metadata } from 'next';
import ClientApp from '../ClientApp';

export const metadata: Metadata = {
  title: 'Leaderboard · BankrDex',
  description: 'Top Bankr token traders on Base by estimated PnL and volume, from on-chain swaps.',
};

export default function LeaderboardPage() {
  return <ClientApp initialView="leaderboard" />;
}
