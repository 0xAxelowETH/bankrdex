import { PLATFORM_FEE_RECEIVER } from '../config/platformFee';

export interface AggregatorTransactionLike {
  to: string;
  data: string;
  value: string;
}

// OKX encodes partner commission (including the referrer wallet) into the router calldata.
// If the receiver is absent, OKX silently dropped the fee for this route, so refuse to submit.
export function assertOkxSwapIncludesFee(
  swap: AggregatorTransactionLike,
  isNativeInput: boolean,
  grossInputAmount: bigint
): void {
  if (!swap.data.toLowerCase().includes(PLATFORM_FEE_RECEIVER.slice(2).toLowerCase())) {
    throw new Error('OKX returned a route without the 0.1% platform fee. The swap was cancelled and no transaction was sent.');
  }
  if (swap.to.toLowerCase() === PLATFORM_FEE_RECEIVER.toLowerCase()) {
    throw new Error('OKX returned an invalid swap target. The swap was cancelled.');
  }
  if (BigInt(swap.value) > (isNativeInput ? grossInputAmount : 0n)) {
    throw new Error('OKX swap would send more ETH than the requested amount. The swap was cancelled.');
  }
}
