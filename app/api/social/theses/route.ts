import { getBankrToken } from '../../../../src/server/bankrTokenCatalog';
import { getIndexedStats, getLaunchRows, isMarketIndexConfigured } from '../../../../src/server/marketIndex';
import { readSession } from '../../../../src/server/session';
import {
  createThesis,
  getProfileByUsername,
  listTheses,
  SocialError,
  thesisInputSchema,
  WALLET_PATTERN,
  type ThesisInput,
} from '../../../../src/server/social';
import { failure, firstIssue, json, limitWallet, readJson, requireWriter } from '../../../../src/server/socialHttp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ?token=0x..  ?author=<username|wallet>  ?feed=following  ?sort=new|top  ?before=<iso>  ?offset=  ?limit=
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const viewer = readSession(request)?.wallet ?? null;
  try {
    const token = params.get('token')?.toLowerCase() ?? null;
    if (token && !WALLET_PATTERN.test(token)) throw new SocialError('Unknown token.');
    let author = params.get('author')?.toLowerCase().replace(/^@/, '') ?? null;
    if (author && !WALLET_PATTERN.test(author)) {
      author = (await getProfileByUsername(author))?.wallet ?? null;
      if (!author) return json({ theses: [] });
    }
    const following = params.get('feed') === 'following';
    if (following && !viewer) return json({ theses: [], needsSignIn: true });
    const before = params.get('before');
    const theses = await listTheses({
      viewer,
      token,
      author,
      following,
      sort: params.get('sort') === 'top' ? 'top' : 'new',
      before: before && !Number.isNaN(Date.parse(before)) ? new Date(before).toISOString() : null,
      offset: Number(params.get('offset')) || 0,
      limit: Number(params.get('limit')) || 20,
    });
    return json({ theses });
  } catch (error) {
    return failure(error);
  }
}

// The token must be a Bankr token BankrDex knows; its name and symbol come from the catalog or
// the on-chain launch registry, never from the request.
async function resolveToken(input: ThesisInput): Promise<{ symbol: string; name: string | null; priceUsd: number | null }> {
  const catalogToken = await getBankrToken(input.tokenAddress, input.chain).catch(() => null);
  let symbol = catalogToken?.symbol ?? null;
  let name = catalogToken?.name ?? null;
  if (!symbol && input.chain === 'base' && isMarketIndexConfigured()) {
    const [row] = await getLaunchRows([input.tokenAddress]).catch(() => []);
    symbol = row?.symbol ?? null;
    name = row?.name ?? null;
  }
  if (!symbol) throw new SocialError('Theses can only be posted for Bankr tokens listed on BankrDex.');
  let priceUsd = catalogToken?.priceUsd ?? null;
  if (input.chain === 'base' && isMarketIndexConfigured()) {
    const [stats] = await getIndexedStats([input.tokenAddress]).catch(() => []);
    if (stats?.price_usd) priceUsd = stats.price_usd;
  }
  return { symbol, name, priceUsd };
}

export async function POST(request: Request) {
  try {
    const { session } = await requireWriter(request);
    await limitWallet(session.wallet, 'thesis', 10, 60 * 60_000);
    const parsed = thesisInputSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new SocialError(firstIssue(parsed.error));
    const token = await resolveToken(parsed.data);
    const thesis = await createThesis(session.wallet, parsed.data, token, token.priceUsd);
    return json({ thesis }, 201);
  } catch (error) {
    return failure(error);
  }
}
