import type { Metadata } from 'next';
import { AdminStats } from '../../../src/components/AdminStats';

export const metadata: Metadata = {
  title: 'Visitor stats · BankrDex',
  robots: { index: false, follow: false },
};

export default function AdminStatsPage() {
  return <AdminStats />;
}
