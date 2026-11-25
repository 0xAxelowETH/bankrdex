// Simulates direct V4 swaps on Robinhood Chain (src/services/v4Swap.ts with the Robinhood
// deployment) with eth_call + state overrides: no wallet, no funds.
// Usage: node scripts/simulate-v4-swap-robinhood.mjs [token quote poolId] ...  (defaults below)
import { createPublicClient, decodeFunctionResult, encodeAbiParameters, http, keccak256, maxUint256, numberToHex, padHex, parseAbiParameters, fallback } from 'viem';
import { robinhood } from 'viem/chains';
import { buildBuyWithEth, buildSell, PERMIT2, poolKeyFor, quoteCall, quoterAbi, V4_DEPLOYMENTS } from '../src/services/v4Swap.ts';

const D = V4_DEPLOYMENTS.robinhood;
const client = createPublicClient({ chain: robinhood, transport: fallback([http('https://4663.rpc.thirdweb.com', { timeout: 30_000 }), http('https://robinhood.drpc.org', { timeout: 30_000 })]) });
const USER = '0x1111111111111111111111111111111111111111';
const FEE_TO = '0xe9477c650411fccf640239595dfd2687dcb6e7a1';
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
// [token, quote, label]: a WETH-paired launch and a stock-paired one.
const CASES = [
  ['0x100765a16f42636bd84ee1e86bc5107b84bcdba3', D.weth, 'CHOP / WETH'],
  ['0x91a2dae9699f0b82540b5886b0d8759c22820ba3', '0xc0d6457c16cc70d6790dd43521c899c87ce02f35', 'musebook / META'],
];

const rawCall = (tx, overrides) => client.request({ method: 'eth_call', params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value ? numberToHex(tx.value) : undefined }, 'latest', overrides] });
const mapSlot = (key, slot) => keccak256(encodeAbiParameters(parseAbiParameters('address, uint256'), [key, BigInt(slot)]));
const nestedSlot = (key, parent) => keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [key, parent]));
const OZ7201 = '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';
const layouts = [
  ...Array.from({ length: 12 }, (_, slot) => ({ name: `slot ${slot}`, balance: (o) => mapSlot(o, slot), allowance: (o, s) => nestedSlot(s, mapSlot(o, slot + 1)) })),
  { name: 'oz-7201', balance: (o) => keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [o, OZ7201])), allowance: (o, s) => nestedSlot(s, keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [o, `0x${(BigInt(OZ7201) + 1n).toString(16)}`]))) },
  { name: 'solady', balance: (o) => keccak256(`0x${o.slice(2)}${'00'.repeat(8)}87a211a2`), allowance: (o, s) => keccak256(`0x${o.slice(2)}${'00'.repeat(8)}7f5e9f20${s.slice(2)}`) },
];
async function storageLayout(token) {
  for (const layout of layouts) {
    const data = await rawCall({ to: token, data: '0x70a08231' + USER.slice(2).padStart(64, '0') }, { [token]: { stateDiff: { [layout.balance(USER)]: padHex(numberToHex(123456789n), { size: 32 }) } } }).catch(() => '0x');
    if (data !== '0x' && BigInt(data) === 123456789n) return layout;
  }
  return null;
}
const quote = async (key, tokenIn, amount) => decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data: await rawCall({ to: D.quoter, data: quoteCall(key, tokenIn, amount) }) })[0];

// Sell `amount` of tokenIn for tokenOut through Permit2 (also how quote-token buys work).
async function simulateErc20In(key, tokenIn, tokenOut, amount) {
  const layout = await storageLayout(tokenIn);
  if (!layout) return `storage layout of ${tokenIn} not recognised`;
  const out = await quote(key, tokenIn, amount - amount / 1000n);
  const tokenState = { [layout.balance(USER)]: padHex(numberToHex(amount), { size: 32 }), [layout.allowance(USER, PERMIT2)]: padHex(numberToHex(maxUint256), { size: 32 }) };
  const packed = (deadline << 160n) | amount;
  const permit2State = { [nestedSlot(D.router, nestedSlot(tokenIn, mapSlot(USER, 1)))]: padHex(numberToHex(packed), { size: 32 }) };
  const tx = buildSell({ key, token: tokenIn, quote: tokenOut, amountIn: amount, minOut: (out * 97n) / 100n, feeBps: 10, feeRecipient: FEE_TO, deadline, router: D.router, weth: D.weth, minHopPrice: D.minHopPrice });
  await rawCall({ ...tx, from: USER }, { [tokenIn]: { stateDiff: tokenState }, [PERMIT2]: { stateDiff: permit2State } });
  return `OK (${Number(amount) / 1e18} in -> ~${Number(out) / 1e18} out)`;
}

for (const [token, quoteToken, label] of CASES) {
  const key = poolKeyFor(token, quoteToken, D.hooks[0]);
  console.log(`\n== ${label}`);
  try {
    if (quoteToken === D.weth) {
      const amountIn = 1_000_000_000_000_000n;
      const out = await quote(key, D.weth, amountIn - amountIn / 1000n);
      console.log('quote 0.000999 WETH ->', Number(out) / 1e18);
      const buy = buildBuyWithEth({ key, token, amountIn, minOut: (out * 97n) / 100n, feeBps: 10, feeRecipient: FEE_TO, deadline, router: D.router, weth: D.weth, minHopPrice: D.minHopPrice });
      await rawCall({ ...buy, from: USER }, { [USER]: { balance: numberToHex(10n ** 18n) } });
      console.log('buy with ETH: OK');
      console.log('sell to ETH:', await simulateErc20In(key, token, D.weth, out / 2n));
    } else {
      console.log('buy with quote token:', await simulateErc20In(key, quoteToken, token, 10n ** 16n));
      console.log('sell to quote token:', await simulateErc20In(key, token, quoteToken, 10n ** 22n));
    }
  } catch (error) {
    console.log('FAILED:', (error.shortMessage ?? error.message).slice(0, 300));
  }
}
