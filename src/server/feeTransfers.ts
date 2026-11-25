const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export interface Receipt {
  status: string;
  logs: { address: string; topics: string[]; data: string }[];
}

export interface Transaction {
  to: string | null;
  value: string;
}

// ERC-20 Transfer events in a receipt whose recipient is `wallet`. ERC-721 transfers (4 topics)
// are ignored.
export function feeTransfersIn(receipt: Receipt, wallet: string): { token: string; amount: bigint }[] {
  const recipient = `0x${wallet.slice(2).toLowerCase().padStart(64, '0')}`;
  return receipt.logs
    .filter((log) => log.topics.length === 3
      && log.topics[0]?.toLowerCase() === TRANSFER_TOPIC
      && log.topics[2]?.toLowerCase() === recipient)
    .map((log) => ({ token: log.address.toLowerCase(), amount: BigInt(log.data && log.data !== '0x' ? log.data : 0) }))
    .filter((transfer) => transfer.amount > 0n);
}

// ETH sent straight to `wallet` by the transaction itself (a separate fee transfer).
export function nativeFeeIn(transaction: Transaction, wallet: string): bigint {
  if (transaction.to?.toLowerCase() !== wallet.toLowerCase()) return 0n;
  return BigInt(transaction.value || '0x0');
}
