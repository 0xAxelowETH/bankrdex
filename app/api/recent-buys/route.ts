import { getRecentBankrSales } from '../../../src/server/bankrSales';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/recent-buys -> latest buys of Bankr tokens on Base (Uniswap V4 swap logs).
export async function GET() {
  try {
    const { sales, status } = await getRecentBankrSales();
    return Response.json({ status, sales }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Bankr recent buys failed:', error);
    return Response.json(
      { status: 'unavailable', sales: [] },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
