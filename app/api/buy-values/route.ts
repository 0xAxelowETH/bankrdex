import { getBuyValues, type BuySaleRef } from '../../../src/server/buyValues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_SALES = 30;
const SALE_PATTERN = /^(0x[a-f0-9]{64}):(\d{1,6}):(0x[a-f0-9]{40}):(0x(?:[a-f0-9]{64}|[a-f0-9]{40}))$/;

// GET /api/buy-values?sales=<txHash>:<logIndex>:<token>:<pool>,...
// USD value, buyer and dev flag of Bankr buys from the recent-buys feed (pool = V4 id or V2/V3 address).
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('sales') ?? '';
  const sales: BuySaleRef[] = [];
  for (const entry of raw.toLowerCase().split(',').filter(Boolean).slice(0, MAX_SALES)) {
    const match = SALE_PATTERN.exec(entry);
    if (!match) return Response.json({ error: 'Invalid sale reference.' }, { status: 400 });
    sales.push({ txHash: match[1], logIndex: Number(match[2]), tokenAddress: match[3], poolAddress: match[4] });
  }
  if (sales.length === 0) return Response.json({ values: {} });
  try {
    return Response.json({ values: await getBuyValues(sales) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Buy values are unavailable.' }, { status: 502 });
  }
}
