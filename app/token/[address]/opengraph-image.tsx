import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { getBankrToken, type BankrCatalogToken } from '../../../src/server/bankrTokenCatalog';
import { CHAINS, type ChainKey } from '../../../src/config/chains';
import { brandMarkSvg } from '../../../src/config/brandMark';
import { cachedDexProfile } from '../../../src/server/dexProfiles';
import { withLogos } from '../../../src/server/tokenLogos';

// Share card for /token/<address> (X, Telegram, Discord previews): the token's logo, name, price,
// 24h change and market figures on the BankrDex brand background.
export const runtime = 'nodejs';
export const alt = 'Token on BankrDex';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const ADDRESS = /^0x[a-f0-9]{40}$/;
// Brand fonts (OFL): Space Grotesk for the wordmark and symbol, Inter for figures.
const FONT_DIR = join(process.cwd(), 'assets', 'fonts');
const fontFiles = [
  ['Space Grotesk', 'SpaceGrotesk-Bold.woff', 700],
  ['Inter', 'Inter-Regular.woff', 400],
  ['Inter', 'Inter-Bold.woff', 700],
  ['Inter', 'Inter-ExtraBold.woff', 800],
] as const;
let fontsLoad: Promise<{ name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' }[]> | null = null;
const loadFonts = () => (fontsLoad ??= Promise.all(fontFiles.map(async ([name, file, weight]) => ({ name, data: await readFile(join(FONT_DIR, file)), weight, style: 'normal' as const }))));
const MARK = `data:image/svg+xml;base64,${Buffer.from(brandMarkSvg()).toString('base64')}`;

async function findToken(address: string): Promise<BankrCatalogToken | null> {
  for (const chain of ['base', 'robinhood'] as ChainKey[]) {
    try {
      const token = await getBankrToken(address, chain);
      if (token) return token;
    } catch {
      // try the next chain
    }
  }
  return null;
}

interface Market { priceUsd?: number; change24h?: number; marketCapUsd?: number; liquidityUsd?: number; volume24hUsd?: number }

// Market figures from DexScreener's deepest pair, for tokens the catalog has no price for (e.g. BNKR).
async function dexMarket(chain: ChainKey, address: string): Promise<Market | null> {
  try {
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/${CHAINS[chain].dexscreenerChain}/${address}`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return null;
    const pairs = await response.json() as { baseToken?: { address?: string }; priceUsd?: string; marketCap?: number; fdv?: number; liquidity?: { usd?: number }; volume?: { h24?: number }; priceChange?: { h24?: number } }[];
    const own = (Array.isArray(pairs) ? pairs : []).filter((pair) => pair.baseToken?.address?.toLowerCase() === address);
    if (own.length === 0) return null;
    const deepest = own.reduce((best, pair) => ((pair.liquidity?.usd ?? 0) > (best.liquidity?.usd ?? 0) ? pair : best));
    return {
      priceUsd: Number(deepest.priceUsd) || undefined,
      change24h: deepest.priceChange?.h24,
      marketCapUsd: deepest.marketCap ?? deepest.fdv,
      liquidityUsd: deepest.liquidity?.usd,
      volume24hUsd: own.reduce((sum, pair) => sum + (pair.volume?.h24 ?? 0), 0),
    };
  } catch {
    return null;
  }
}

// Logo bytes as a data URI (PNG / JPEG only; the renderer has no WebP), or null.
async function logoDataUri(url: string | undefined): Promise<string | null> {
  if (!url) return null;
  const source = url.startsWith('ipfs://')
    ? `https://gateway.pinata.cloud/ipfs/${url.replace(/^ipfs:\/\/(?:ipfs\/)?/, '')}`
    : url.replace('format=auto', 'format=png');
  try {
    const response = await fetch(source, { signal: AbortSignal.timeout(6_000) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!response.ok || !/^image\/(png|jpe?g)$/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.byteLength > 0 && bytes.byteLength < 3_000_000 ? `data:${type};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
}

const usd = (value: number | undefined) => {
  if (!value || !Number.isFinite(value) || value <= 0) return '—';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
};

// Price parts; tiny prices fold their leading zeros into a lowered count (0.0₄2099), drawn as a
// small number because the brand font has no subscript digits.
const priceParts = (value: number | undefined): { lead: string; zeros?: string; digits?: string } => {
  if (!value || !Number.isFinite(value) || value <= 0) return { lead: '—' };
  if (value >= 1) return { lead: `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}` };
  if (value >= 0.0001) return { lead: `$${value.toLocaleString('en-US', { maximumSignificantDigits: 4 })}` };
  const [mantissa, exponent] = value.toExponential(3).split('e');
  return { lead: '$0.0', zeros: String(-Number(exponent) - 1), digits: mantissa.replace('.', '').replace(/0+$/, '') };
};

export default async function Image({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  const found = ADDRESS.test(address) ? await findToken(address) : null;
  const token = found ? withLogos([found])[0] : null;
  const chain = token?.chain ?? 'base';
  const [logo, fallback] = await Promise.all([
    logoDataUri(cachedDexProfile(chain, address)?.imageUrl ?? token?.imageUrl),
    token?.priceUsd ? Promise.resolve(null) : dexMarket(chain, address),
  ]);
  const market: Market = token?.priceUsd ? token : fallback ?? {};
  const symbol = (token?.symbol ?? `${address.slice(0, 6)}…`).slice(0, 18);
  const name = (token?.name ?? 'Bankr launch').slice(0, 40);
  const change = market.change24h;
  const up = (change ?? 0) >= 0;
  const chainColor = CHAINS[chain].color;
  const parts = priceParts(market.priceUsd);
  const hasMarket = Boolean(market.priceUsd);

  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: 'radial-gradient(900px 500px at 0% 0%, rgba(195,255,46,0.20), transparent 60%), radial-gradient(800px 500px at 100% 100%, rgba(124,58,237,0.38), transparent 60%), #06070a', color: '#f5f7fa', fontFamily: 'Inter' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <img src={MARK} width={64} height={64} alt="" />
            <div style={{ display: 'flex', fontFamily: 'Space Grotesk', fontSize: 42, fontWeight: 700, letterSpacing: -1.5 }}>
              <span>Bankr</span><span style={{ color: '#c3ff2e' }}>Dex</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderRadius: 999, border: `2px solid ${chainColor}`, color: chainColor, fontSize: 26, fontWeight: 700 }}>
            <div style={{ display: 'flex', width: 14, height: 14, borderRadius: 999, background: chainColor }} />
            {CHAINS[chain].name}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
          {logo
            ? <img src={logo} width={168} height={168} alt="" style={{ borderRadius: 40, border: '3px solid rgba(255,255,255,0.12)', objectFit: 'cover' }} />
            : <div style={{ display: 'flex', width: 168, height: 168, borderRadius: 40, alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1f2a0a, #2a1650)', fontSize: 64, fontWeight: 800, color: '#c3ff2e' }}>{symbol.slice(0, 2).toUpperCase()}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', fontFamily: 'Space Grotesk', fontSize: 80, fontWeight: 700, letterSpacing: -2 }}>{`$${symbol}`}</div>
            <div style={{ display: 'flex', fontSize: 34, color: '#aeb6c1' }}>{name}</div>
          </div>
        </div>

        {hasMarket ? (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', fontSize: 60, fontWeight: 800 }}>
                <span>{parts.lead}</span>
                {parts.zeros && <span style={{ fontSize: 30, marginBottom: -4, color: '#aeb6c1' }}>{parts.zeros}</span>}
                {parts.digits && <span>{parts.digits}</span>}
              </div>
              {change !== undefined && Number.isFinite(change) && (
                <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, padding: '6px 14px', borderRadius: 14, color: up ? '#2ef29a' : '#ff4d6d', background: up ? 'rgba(46,242,154,0.14)' : 'rgba(255,77,109,0.14)' }}>
                  {`${up ? '+' : ''}${change.toFixed(2)}% 24h`}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 28, fontSize: 22, color: '#98a1ad' }}>
              {([['MCap', usd(market.marketCapUsd)], ['Liq', usd(market.liquidityUsd)], ['Vol 24h', usd(market.volume24hUsd)]] as const).map(([label, value]) => (
                <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <span>{label}</span>
                  <span style={{ color: '#f5f7fa', fontSize: 30, fontWeight: 700 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', fontSize: 30, color: '#98a1ad' }}>Live chart, swaps and safety checks on BankrDex</div>
        )}
      </div>
    ),
    { ...size, fonts: await loadFonts() },
  );
}
