import React, { useState } from 'react';
import { Token } from '../types';
import { ExternalLink, CheckCircle, ShieldAlert, X } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { useApp } from '../context/AppContext';
import { dexscreenerUrl } from '../config/chains';
import { dexSocialsOf } from '../services/dexProfiles';
import { useDexProfile } from './useDexProfile';
import { TokenSocialLinks } from './TokenSocialLinks';

const PAID_TYPE_LABELS: Record<Token['dexscreenerPaidInfo']['paidType'], string> = {
  enhanced_profile: 'Enhanced Token Info',
  community_takeover: 'Community Takeover',
  token_boost: 'Boost',
  unpaid: 'None',
  unknown: '',
};

interface DexScreenerEmblemProps {
  token: Token;
  compact?: boolean;
  // Icon-only status for dense tables: green check when paid, muted icon otherwise.
  minimal?: boolean;
}

export const DexScreenerEmblem: React.FC<DexScreenerEmblemProps> = ({ token, compact = false, minimal = false }) => {
  const { t } = useApp();
  const [showModal, setShowModal] = useState(false);
  // Paid = an approved Enhanced Token Info or Community Takeover order on DexScreener, read by the
  // server (orders/v1, cached and rate limited) together with the profile's links.
  const profile = useDexProfile(token);
  const paidStatus = profile?.paid ?? null;
  const isCheckingPaidStatus = !profile;
  const paidStatusError = Boolean(profile && profile.paid === null);
  const paidSocials = profile?.paid && profile.socials ? dexSocialsOf(profile.socials) : undefined;

  const info: Token['dexscreenerPaidInfo'] = {
    ...token.dexscreenerPaidInfo,
    hasPaid: paidStatus,
    paidType: paidStatus === true
      ? profile?.paidType === 'communityTakeover' ? 'community_takeover' : 'enhanced_profile'
      : paidStatus === false ? 'unpaid' : 'unknown',
    socialsCount: paidSocials
      ? (['twitter', 'telegram', 'discord', 'farcaster', 'website'] as const).filter((kind) => paidSocials[kind]).length + (paidSocials.links?.length ?? 0)
      : token.dexscreenerPaidInfo.socialsCount,
    hasBanner: profile?.headerUrl ? true : profile && profile.paid !== null ? false : token.dexscreenerPaidInfo.hasBanner,
  };
  const badgeLabel = info.hasPaid === true
    ? t.paidLabel
    : info.hasPaid === false
      ? t.unpaidLabel
      : isCheckingPaidStatus ? t.checkingPaidStatus : t.dexScreenerPaidNotVerified;

  return (
    <>
      {minimal ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setShowModal(true);
          }}
          title={info.hasPaid === true ? t.dexScreenerVerifiedPaid : badgeLabel}
          aria-label={`DexScreener: ${badgeLabel}`}
          className={`relative inline-flex h-6 w-6 items-center justify-center rounded-full border ${
            info.hasPaid === true ? 'border-emerald-500/60 bg-emerald-500/15' : 'border-line bg-sunken opacity-50 hover:opacity-90'
          }`}
        >
          <BrandLogo brand="dexscreener" size={13} />
          {info.hasPaid === true && <CheckCircle className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-surface text-emerald-400" />}
        </button>
      ) : info.hasPaid === true ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowModal(true);
          }}
          title={t.dexScreenerVerifiedPaid}
          className={`inline-flex items-center gap-1.5 rounded-lg border font-bold transition-all cursor-pointer ${
            compact
              ? 'px-2 py-0.5 text-[0.75rem] bg-emerald-950/40 border-emerald-500/50 text-emerald-300 hover:border-emerald-400'
              : 'px-2.5 py-1 text-xs bg-emerald-950/30 border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/50 shadow-sm'
          }`}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-emerald-400/60 bg-emerald-500/20">
            <BrandLogo brand="dexscreener" size={13} />
          </span>
          <span>{badgeLabel}</span>
          <CheckCircle className="h-3 w-3 text-emerald-400" />
        </button>
      ) : info.hasPaid === false ? (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setShowModal(true);
          }}
          title={t.noApprovedProfileOrder}
          className={`inline-flex items-center gap-1.5 rounded-lg border font-medium transition-all cursor-pointer ${
            compact
              ? 'px-2 py-0.5 text-[0.75rem] bg-rose-950/40 border-rose-500/40 text-rose-300 hover:border-rose-400'
              : 'px-2.5 py-1 text-xs bg-rose-950/30 border-rose-500/40 text-rose-300 hover:border-rose-400'
          }`}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-rose-400/50 bg-rose-500/15">
            <BrandLogo brand="dexscreener" size={13} />
          </span>
          <span>{badgeLabel}</span>
          <ShieldAlert className="h-3 w-3 text-rose-400" />
        </button>
      ) : (
        <button
          onClick={(event) => {
            event.stopPropagation();
            setShowModal(true);
          }}
          disabled={isCheckingPaidStatus}
          title={paidStatusError ? t.dexScreenerRequestFailed : t.paidProfileUnverified}
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border font-medium transition-colors disabled:cursor-wait ${compact ? 'px-2 py-0.5 text-[0.75rem]' : 'px-2.5 py-1 text-xs'} border-neutral-800 bg-neutral-950 text-neutral-400 hover:text-neutral-200`}
        >
          <BrandLogo brand="dexscreener" size={14} className="opacity-60" />
          <span>{isCheckingPaidStatus ? 'DexScreener…' : 'DexScreener ?'}</span>
        </button>
      )}

      {/* Details Modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-sm animate-in fade-in"
          onClick={() => setShowModal(false)}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl text-left"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <BrandLogo brand="dexscreener" size={24} />
                <div>
                  <h4 className="font-bold text-sm text-white">{t.dexScreenerTokenInfo}</h4>
                  <span className="text-[0.75rem] font-mono text-neutral-400">
                    ${token.symbol} · {token.address.slice(0, 8)}...
                  </span>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-4 space-y-3 text-xs">
              <div
                className={`p-3 rounded-xl border flex items-center justify-between ${
                  info.hasPaid === true
                    ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                    : info.hasPaid === false
                      ? 'border-rose-500/40 bg-rose-950/20 text-rose-300'
                      : 'border-neutral-800 bg-neutral-950 text-neutral-400'
                }`}
              >
                <div className="flex items-center gap-2">
                  {info.hasPaid === true ? (
                    <CheckCircle className="h-5 w-5 text-emerald-400" />
                  ) : info.hasPaid === false ? (
                    <ShieldAlert className="h-5 w-5 text-rose-400" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-neutral-500" />
                  )}
                  <div>
                    <span className="font-bold block text-white">
                      {info.hasPaid === true
                        ? t.dexScreenerVerifiedPaid
                        : info.hasPaid === false
                          ? t.dexScreenerNotPaid
                          : isCheckingPaidStatus ? t.checkingPaidStatus : t.dexScreenerPaidNotVerified}
                    </span>
                    <span className="text-[0.75rem] text-neutral-400">
                      {info.hasPaid === true
                        ? t.developerPaidProfile
                        : info.hasPaid === false
                          ? t.noApprovedProfileOrder
                          : paidStatusError
                            ? t.dexScreenerRequestFailed
                            : t.paidProfileUnverified}
                    </span>
                  </div>
                </div>
              </div>

              {/* Breakdown */}
              <div className="p-3 rounded-xl border border-neutral-800 bg-neutral-950 space-y-2 text-neutral-300">
                <div className="flex items-center justify-between">
                  <span>{t.registeredSocials}</span>
                  <span className="font-mono font-bold text-white">
                    {info?.socialsCount || 0} {t.accounts}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.customBannerLogo}</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {info?.hasBanner === true ? t.available : info?.hasBanner === false ? t.standard : t.unavailable}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>{t.verificationType}</span>
                  <span className="font-mono text-amber-400 uppercase">
                    {PAID_TYPE_LABELS[info.paidType] || t.unavailable.toUpperCase()}
                  </span>
                </div>
              </div>

              {paidSocials && (
                <div className="space-y-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <span className="block text-neutral-300">Links on the DexScreener profile (shown across BankrDex)</span>
                  <TokenSocialLinks socials={paidSocials} symbol={token.symbol} variant="button" withLinks />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-neutral-800">
              <a
                href={info?.dexUrl || dexscreenerUrl(token.chain, token.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:underline font-semibold"
              >
                <span>{t.openInDexScreener}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>

              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-xs font-semibold"
              >
                {t.close}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
