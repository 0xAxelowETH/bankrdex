import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Rocket } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { shortenAddress } from '../utils/web3';
import { chainByKey, explorerAddress, explorerTx, type ChainKey } from '../config/chains';

// Bankr launch facts for the active token: who launched it, who earns its fees, and how much
// the creator side has earned (GET api.bankr.bot/token-launches/{token}/fees). The fee
// beneficiary can claim straight from here; Bankr builds the transaction, the wallet signs it.

interface CreatorFees {
  beneficiary: string;
  share: string | null;
  lifetimeWeth: number | null;
  claimableWeth: number | null;
  claimedWeth: number | null;
  claimCount: number | null;
}

interface ClaimTransaction {
  to: string;
  data: string;
  chainId: number;
  gasEstimate?: string | number;
  description?: string;
}

const feesCache = new Map<string, { at: number; fees: CreatorFees | null }>();
const FEES_CACHE_MS = 5 * 60_000;

const toNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return value !== null && value !== undefined && value !== '' && Number.isFinite(parsed) ? parsed : null;
};

async function fetchCreatorFees(address: string, signal: AbortSignal): Promise<CreatorFees | null> {
  const cached = feesCache.get(address);
  if (cached && Date.now() - cached.at < FEES_CACHE_MS) return cached.fees;
  const response = await fetch(`/api/bankr-proxy/token-launches/${address}/fees?days=30`, {
    headers: { Accept: 'application/json' },
    signal,
  });
  // 404 = not a Doppler/Clanker launch (e.g. BNKR itself): there are no creator fees to show.
  if (response.status === 404) {
    feesCache.set(address, { at: Date.now(), fees: null });
    return null;
  }
  if (!response.ok) throw new Error(`Bankr fees request failed (${response.status}).`);
  const payload = await response.json() as Record<string, unknown>;
  const beneficiary = typeof payload.address === 'string' ? payload.address.toLowerCase() : '';
  const totals = (payload.totals ?? {}) as Record<string, unknown>;
  const token = Array.isArray(payload.tokens)
    ? (payload.tokens as Record<string, unknown>[]).find((item) => String(item.tokenAddress).toLowerCase() === address)
    : undefined;
  const fees: CreatorFees | null = /^0x[a-f0-9]{40}$/.test(beneficiary)
    ? {
        beneficiary,
        share: typeof token?.share === 'string' ? token.share : null,
        lifetimeWeth: toNumber(payload.lifetimeEarnedWeth),
        claimableWeth: toNumber(totals.claimableWeth),
        claimedWeth: toNumber(totals.claimedWeth),
        claimCount: toNumber(totals.claimCount),
      }
    : null;
  feesCache.set(address, { at: Date.now(), fees });
  return fees;
}

const formatWeth = (value: number | null) => value === null
  ? '—'
  : `${value.toLocaleString('en-US', { maximumFractionDigits: value >= 1 ? 3 : 6 })} WETH`;

function Party({ address, x, chain }: { address?: string; x?: { username: string; avatar?: string }; chain?: ChainKey }) {
  if (!address && !x) return <span className="text-subtle">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {x?.avatar && <img src={x.avatar} alt="" width={16} height={16} className="h-4 w-4 rounded-full" loading="lazy" />}
      {x ? (
        <a href={`https://x.com/${x.username}`} target="_blank" rel="noopener noreferrer nofollow" className="hover:text-fg">@{x.username}</a>
      ) : (
        <a href={explorerAddress(chain, address!)} target="_blank" rel="noopener noreferrer" className="font-mono hover:text-fg">
          {shortenAddress(address!)}
        </a>
      )}
    </span>
  );
}

export const BankrLaunchCard: React.FC = () => {
  const { activeToken: token, wallet, networkStats, sendWalletTransaction, setIsWalletConnectModalOpen } = useApp();
  const address = token.address.toLowerCase();
  const isBankrToken = (token.source ?? 'bankr') === 'bankr' && token.externalSource !== 'market';
  const [fees, setFees] = useState<CreatorFees | null>(null);
  const [feesState, setFeesState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [claimStatus, setClaimStatus] = useState<{ kind: 'working' | 'done' | 'error'; message: string; txHash?: string } | null>(null);

  useEffect(() => {
    setFees(null);
    setClaimStatus(null);
    if (!isBankrToken) return;
    const controller = new AbortController();
    setFeesState('loading');
    fetchCreatorFees(address, controller.signal)
      .then((result) => { setFees(result); setFeesState('ready'); })
      .catch(() => { if (!controller.signal.aborted) setFeesState('error'); });
    return () => controller.abort();
  }, [address, isBankrToken]);

  if (!isBankrToken) return null;
  const launch = token.bankr;
  const launchedAt = token.launchedAt ?? Date.parse(token.createdAt);
  const isBeneficiary = Boolean(fees && wallet.isConnected && wallet.address.toLowerCase() === fees.beneficiary);
  const ethPrice = networkStats.ethPriceUsd;

  const claim = async () => {
    if (!fees || !isBeneficiary) return;
    setClaimStatus({ kind: 'working', message: 'Preparing the claim with Bankr…' });
    try {
      const response = await fetch('/api/bankr-proxy/public/doppler/build-claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ beneficiaryAddress: fees.beneficiary, tokenAddresses: [address] }),
      });
      const payload = await response.json().catch(() => null) as { transactions?: ClaimTransaction[]; errors?: { error?: string }[] } | null;
      if (!response.ok) throw new Error(`Bankr could not prepare the claim (${response.status}).`);
      const chain = chainByKey(token.chain);
      const transactions = (payload?.transactions ?? []).filter((tx) => Number(tx.chainId) === chain.chainId);
      if (transactions.length === 0) {
        throw new Error(payload?.errors?.[0]?.error || 'There is nothing to claim for this token right now.');
      }
      let lastHash = '';
      for (const [index, tx] of transactions.entries()) {
        setClaimStatus({ kind: 'working', message: `Confirm claim ${index + 1} of ${transactions.length} in your wallet…` });
        const gas = toNumber(tx.gasEstimate);
        const result = await sendWalletTransaction({
          to: tx.to,
          data: tx.data,
          ...(gas && gas > 0 ? { gas: `0x${Math.ceil(gas).toString(16)}` } : {}),
        }, chain.key);
        lastHash = result.txHash;
        if (!result.succeeded) throw Object.assign(new Error(`The claim transaction failed on ${chain.name}.`), { txHash: result.txHash });
      }
      feesCache.delete(address);
      setClaimStatus({ kind: 'done', message: 'Fees claimed.', txHash: lastHash });
    } catch (error) {
      const txHash = (error as { txHash?: string })?.txHash;
      setClaimStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The claim failed.', txHash });
    }
  };

  const rows: [string, React.ReactNode][] = [
    ['Launched via', launch?.launchType === 'bankr_v3' ? 'Bankr Launch v3' : launch?.launchType === 'doppler' || token.poolAddress?.length === 66 ? 'Bankr · Doppler (Uniswap V4)' : 'Bankr'],
    ['Launched', Number.isFinite(launchedAt) && launchedAt > 0
      ? new Date(launchedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '—'],
    ['Chain', chainByKey(token.chain).name],
    ['Creator', <Party key="creator" address={token.creator || undefined} x={launch?.creatorX} chain={token.chain} />],
  ];
  const feeRecipient = launch?.feeRecipient ?? fees?.beneficiary;
  if (feeRecipient && feeRecipient !== token.creator?.toLowerCase()) {
    rows.push(['Fee recipient', <Party key="fees" address={feeRecipient} x={launch?.feeRecipientX} chain={token.chain} />]);
  }
  if (fees) {
    rows.push(['Creator share', fees.share ?? '—']);
    rows.push(['Earned (lifetime)', (
      <span key="lifetime" title={ethPrice > 0 && fees.lifetimeWeth !== null ? `≈ $${(fees.lifetimeWeth * ethPrice).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : undefined}>
        {formatWeth(fees.lifetimeWeth)}
      </span>
    )]);
    rows.push(['Claimable', formatWeth(fees.claimableWeth)]);
  }

  return (
    <section aria-label={`${token.symbol} Bankr launch`} className="bd-card p-4 text-xs">
      <div className="mb-3 flex items-center gap-2">
        <img src="/sources/bankr.png" alt="" width={18} height={18} className="h-[18px] w-[18px] rounded-full" />
        <h3 className="text-sm font-bold text-fg">Bankr launch</h3>
        {feesState === 'loading' && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted" aria-label="Loading creator fees" />}
      </div>
      <dl className="space-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right text-fg-soft">{value}</dd>
          </div>
        ))}
      </dl>
      {feesState === 'error' && <p className="mt-2 text-subtle">Creator fees are unavailable right now.</p>}

      {fees && (fees.claimableWeth ?? 0) > 0 && (
        <div className="mt-3 border-t border-line pt-3">
          {isBeneficiary ? (
            <button
              type="button"
              onClick={() => void claim()}
              disabled={claimStatus?.kind === 'working'}
              className="btn-trade inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-extrabold disabled:opacity-60"
            >
              {claimStatus?.kind === 'working' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Claim {formatWeth(fees.claimableWeth)}
            </button>
          ) : !wallet.isConnected ? (
            <button
              type="button"
              onClick={() => setIsWalletConnectModalOpen(true)}
              className="w-full rounded-lg border border-line px-3 py-2 text-xs text-fg-soft hover:border-accent/60 hover:text-fg"
            >
              Fee recipient? Connect your wallet to claim
            </button>
          ) : (
            <p className="text-subtle">Only the fee recipient ({shortenAddress(fees.beneficiary)}) can claim these fees.</p>
          )}
          {claimStatus && claimStatus.kind !== 'working' && (
            <p role="status" className={`mt-2 ${claimStatus.kind === 'done' ? 'text-up' : 'text-down'}`}>
              {claimStatus.message}
              {claimStatus.txHash && (
                <a href={explorerTx(token.chain, claimStatus.txHash)} target="_blank" rel="noopener noreferrer" className="ml-1 underline">View</a>
              )}
            </p>
          )}
          {claimStatus?.kind === 'working' && <p role="status" className="mt-2 text-muted">{claimStatus.message}</p>}
        </div>
      )}

      {(launch?.tweetUrl || launch?.txHash) && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          {launch.tweetUrl && (
            <a href={launch.tweetUrl} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-fg-soft hover:border-accent/60 hover:text-fg">
              Launch post <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {launch.txHash && (
            <a href={explorerTx(token.chain, launch.txHash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 font-semibold text-fg-soft hover:border-accent/60 hover:text-fg">
              Launch tx <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}
    </section>
  );
};
