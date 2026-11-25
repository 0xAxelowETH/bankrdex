import { PLATFORM_FEE_RECEIVER } from '../../../../src/config/platformFee';
import { baseRpc, formatUnits, tokenMeta } from '../../../../src/server/baseRpc';
import { feeTransfersIn, nativeFeeIn, type Receipt, type Transaction } from '../../../../src/server/feeTransfers';
import { readState, writeState } from '../../../../src/server/notifyState';
import { escapeHtml, isTelegramConfigured, sendTelegram } from '../../../../src/server/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SEEN_KEY = 'fee-notified-txs';
const SEEN_LIMIT = 500;
// Shared with the scheduled job so an ETH fee reported here is not reported again from the balance change.
const ETH_KEY = 'fee-wallet-eth';
const TX_HASH = /^0x[a-f0-9]{64}$/;

const normalizeHash = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : '');

// Called by the browser after a confirmed swap with the swap hash and, when the fee was paid in its
// own transaction, that hash too. Every fee is verified on-chain (an ERC-20 Transfer to the fee
// wallet, or a plain ETH transfer to it), so the request itself cannot fake a notification.
// ETH fees taken inside the swap are internal transfers; the scheduled job reports those from
// balance changes.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { txHash?: unknown; feeTxHash?: unknown } | null;
  const txHash = normalizeHash(body?.txHash);
  const feeTxHash = normalizeHash(body?.feeTxHash);
  if (!TX_HASH.test(txHash) || (feeTxHash && !TX_HASH.test(feeTxHash))) {
    return Response.json({ error: 'txHash must be a 32-byte hex hash.' }, { status: 400 });
  }
  if (!isTelegramConfigured()) return Response.json({ notified: false, reason: 'telegram-not-configured' });

  const seen = (await readState<string[]>(SEEN_KEY)) ?? [];
  const hashes = [...new Set([txHash, feeTxHash].filter(Boolean))].filter((hash) => !seen.includes(hash));
  if (hashes.length === 0) return Response.json({ notified: false, reason: 'already-notified' });

  const lines: string[] = [];
  const reported: string[] = [];
  let nativeTotal = 0n;
  for (const hash of hashes) {
    let receipt: Receipt | null;
    let transaction: Transaction | null;
    try {
      [receipt, transaction] = await Promise.all([
        baseRpc<Receipt | null>('eth_getTransactionReceipt', [hash]),
        baseRpc<Transaction | null>('eth_getTransactionByHash', [hash]),
      ]);
    } catch {
      return Response.json({ error: 'Could not read the transaction.' }, { status: 502 });
    }
    if (!receipt) return Response.json({ notified: false, reason: 'not-mined-yet' }, { status: 202 });
    reported.push(hash);
    if (receipt.status !== '0x1') continue;

    for (const { token, amount } of feeTransfersIn(receipt, PLATFORM_FEE_RECEIVER)) {
      const meta = await tokenMeta(token);
      lines.push(`• <b>${escapeHtml(formatUnits(amount, meta.decimals))} ${escapeHtml(meta.symbol)}</b> (<code>${token.slice(0, 8)}…${token.slice(-4)}</code>)`);
    }
    const native = transaction ? nativeFeeIn(transaction, PLATFORM_FEE_RECEIVER) : 0n;
    if (native > 0n) {
      nativeTotal += native;
      lines.push(`• <b>${formatUnits(native, 18)} ETH</b>`);
    }
  }

  await writeState(SEEN_KEY, [...reported, ...seen].slice(0, SEEN_LIMIT));
  if (lines.length === 0) return Response.json({ notified: false, reason: 'no-direct-fee-transfer' });

  if (nativeTotal > 0n) {
    const baseline = await readState<string>(ETH_KEY);
    if (baseline !== null) await writeState(ETH_KEY, (BigInt(baseline) + nativeTotal).toString());
  }
  const sent = await sendTelegram([
    '☕ <b>BankrDex fee received</b>',
    ...lines,
    `<a href="https://basescan.org/tx/${feeTxHash || txHash}">View transaction on BaseScan</a>`,
  ].join('\n'));
  return Response.json({ notified: sent });
}
