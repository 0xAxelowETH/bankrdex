import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ClientApp from '../../ClientApp';
import { getBankrToken, type BankrCatalogToken } from '../../../src/server/bankrTokenCatalog';
import { chainByKey, isChainKey, type ChainKey } from '../../../src/config/chains';

interface TokenPageProps {
  params: Promise<{ address: string }>;
  searchParams: Promise<{ chain?: string }>;
}

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

async function findCatalogToken(address: string, chain: ChainKey): Promise<BankrCatalogToken | null> {
  try {
    return await getBankrToken(address, chain);
  } catch {
    return null;
  }
}

function text(value: unknown, maxLength: number): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

export async function generateMetadata({ params, searchParams }: TokenPageProps): Promise<Metadata> {
  const { address } = await params;
  const { chain: chainParam } = await searchParams;
  if (!ADDRESS_PATTERN.test(address)) return {};
  const normalized = address.toLowerCase();
  const chain = isChainKey(chainParam) ? chainParam : 'base';
  const token = await findCatalogToken(normalized, chain);
  const symbol = text(token?.symbol, 24);
  const name = text(token?.name, 60);
  const title = symbol
    ? `$${symbol}${name && name !== symbol ? ` (${name})` : ''} · BankrDex`
    : `${normalized.slice(0, 6)}…${normalized.slice(-4)} · BankrDex`;
  const description = text(token?.description, 200)
    ?? `Trade ${symbol ? `$${symbol}` : 'this token'} on ${chainByKey(chain).name} with live charts on BankrDex.`;
  // The share image is the branded card from ./opengraph-image.tsx.
  return {
    title,
    description,
    alternates: { canonical: `/token/${normalized}${chain === 'base' ? '' : `?chain=${chain}`}` },
    openGraph: { title, description, type: 'website', url: `/token/${normalized}${chain === 'base' ? '' : `?chain=${chain}`}` },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default async function TokenPage({ params, searchParams }: TokenPageProps) {
  const { address } = await params;
  const { chain } = await searchParams;
  if (!ADDRESS_PATTERN.test(address)) notFound();
  return <ClientApp initialTokenAddress={address.toLowerCase()} initialTokenChain={isChainKey(chain) ? chain : 'base'} />;
}
