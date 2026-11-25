import { getBankrTokenCatalog } from '../../../src/server/bankrTokenCatalog';
import { getMarketSources } from '../../../src/server/marketSources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [result, catalog] = await Promise.all([
      getMarketSources(),
      getBankrTokenCatalog().catch(() => []),
    ]);
    // Bankr is the primary source: never duplicate its tokens from other feeds.
    const bankrAddresses = new Set(catalog.map((token) => String(token.address).toLowerCase()));
    return Response.json(
      { ...result, tokens: result.tokens.filter((token) => !bankrAddresses.has(token.address)) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Market sources unavailable:', error);
    return Response.json({ error: 'External market sources are unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
