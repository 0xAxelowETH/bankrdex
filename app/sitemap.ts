import type { MetadataRoute } from 'next';
import { SITE_URL } from '../src/config/site';
import { getBankrTokenCatalog } from '../src/server/bankrTokenCatalog';

// Main pages plus the token pages that trade (each has its own share card). Built per request
// from the server's cached catalog (the catalog reads are no-store, so it cannot be prerendered).
export const dynamic = 'force-dynamic';
const MAX_TOKENS = 1_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'always', priority: 1 },
    { url: `${SITE_URL}/launches`, lastModified: now, changeFrequency: 'hourly', priority: 0.8 },
    { url: `${SITE_URL}/feed`, lastModified: now, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${SITE_URL}/leaderboard`, lastModified: now, changeFrequency: 'hourly', priority: 0.7 },
    { url: `${SITE_URL}/docs`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/whitepaper`, changeFrequency: 'monthly', priority: 0.5 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];
  let tokens: MetadataRoute.Sitemap = [];
  try {
    tokens = (await getBankrTokenCatalog())
      .filter((token) => (token.volume24hUsd ?? 0) > 0 || (token.totalTx24h ?? 0) > 0)
      .sort((left, right) => (right.volume24hUsd ?? 0) - (left.volume24hUsd ?? 0))
      .slice(0, MAX_TOKENS)
      .map((token) => ({
        url: `${SITE_URL}/token/${token.address.toLowerCase()}${token.chain === 'base' ? '' : `?chain=${token.chain}`}`,
        lastModified: now,
        changeFrequency: 'hourly' as const,
        priority: 0.6,
      }));
  } catch {
    // Catalog unavailable: the main pages are still listed.
  }
  return [...pages, ...tokens];
}
