import type { Metadata } from 'next';
import ClientApp from '../ClientApp';

export const metadata: Metadata = {
  title: 'Community feed · BankrDex',
  description: 'Trading theses and live trades from Bankr token traders on Base.',
};

export default function FeedPage() {
  return <ClientApp initialView="feed" />;
}
