// Usage: node scripts/simulate-v4-swap.mjs  (needs the indexer data in .env.local Supabase)
// Simulates direct V4 swaps (src/services/v4Swap.ts) on Base with eth_call + state overrides.
import { createPublicClient, decodeFunctionResult, encodeAbiParameters, erc20Abi, http, keccak256, maxUint256, numberToHex, padHex, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';
import { buildBuyWithEth, buildSell, PERMIT2, poolKeyFor, quoteCall, quoterAbi, UNIVERSAL_ROUTER, V4_QUOTER, WETH } from '../src/services/v4Swap.ts';

process.loadEnvFile('.env.local');
const client = createPublicClient({ chain: base, transport: http('https://base-rpc.publicnode.com', { timeout: 30_000 }) });
const U = `${process.env.SUPABASE_URL}/rest/v1/`;
const H = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
const USER = '0x1111111111111111111111111111111111111111';
const FEE_TO = '0xe9477c650411fccf640239595dfd2687dcb6e7a1';
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

async function rawCall(tx, overrides) {
  return client.request({ method: 'eth_call', params: [{ from: tx.from, to: tx.to, data: tx.data, value: tx.value ? numberToHex(tx.value) : undefined }, 'latest', overrides] });
}
const mapSlot = (key, slot) => keccak256(encodeAbiParameters(parseAbiParameters('address, uint256'), [key, BigInt(slot)]));
const nestedSlot = (key, parent) => keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [key, parent]));

// ERC-20 storage layouts: plain mappings (slot N), OpenZeppelin v5 namespaced (ERC-7201) and Solady.
const OZ7201 = '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';
const soladyBalance = (owner) => keccak256(`0x${owner.slice(2)}${'00'.repeat(8)}87a211a2`);
const soladyAllowance = (owner, spender) => keccak256(`0x${owner.slice(2)}${'00'.repeat(8)}7f5e9f20${spender.slice(2)}`);
const layouts = [
  ...Array.from({ length: 12 }, (_, slot) => ({ name: `slot ${slot}`, balance: (owner) => mapSlot(owner, slot), allowance: (owner, spender) => nestedSlot(spender, mapSlot(owner, slot + 1)) })),
  { name: 'oz-7201', balance: (owner) => keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [owner, OZ7201])), allowance: (owner, spender) => nestedSlot(spender, keccak256(encodeAbiParameters(parseAbiParameters('address, bytes32'), [owner, `0x${(BigInt(OZ7201) + 1n).toString(16)}`]))) },
  { name: 'solady', balance: soladyBalance, allowance: soladyAllowance },
];
async function storageLayout(token) {
  for (const layout of layouts) {
    const data = await rawCall({ to: token, data: '0x70a08231' + USER.slice(2).padStart(64, '0') }, { [token]: { stateDiff: { [layout.balance(USER)]: padHex(numberToHex(123456789n), { size: 32 }) } } }).catch(() => '0x');
    if (data !== '0x' && BigInt(data) === 123456789n) return layout;
  }
  return null;
}

async function pickTokens() {
  const rows = await (await fetch(`${U}rpc/bankrdex_active_tokens`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_minutes: 1440, p_limit: 200 }) })).json();
  const picked = {};
  for (const row of rows) {
    const pool = (await (await fetch(`${U}bankrdex_pool_map?select=*&pool_id=eq.${row.pool_id}`, { headers: H })).json())[0];
    if (!pool?.hooks || pool.quote_address !== WETH) continue;
    if (!picked[pool.hooks]) picked[pool.hooks] = { token: row.token_address, pool };
    if (Object.keys(picked).length === 2) break;
  }
  return Object.values(picked);
}

for (const { token, pool } of await pickTokens()) {
  const key = poolKeyFor(token, WETH, pool.hooks);
  console.log(`\n== ${token} (hooks ${pool.hooks.slice(0, 10)})`);
  const amountIn = 1_000_000_000_000_000n; // 0.001 ETH
  const swapIn = amountIn - (amountIn * 10n) / 10_000n;
  const quoteRaw = await rawCall({ to: V4_QUOTER, data: quoteCall(key, WETH, swapIn) });
  const [quotedOut] = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data: quoteRaw });
  console.log('quote: 0.000999 WETH ->', Number(quotedOut) / 1e18, 'tokens');

  const buy = buildBuyWithEth({ key, token, amountIn, minOut: (quotedOut * 97n) / 100n, feeBps: 10, feeRecipient: FEE_TO, deadline });
  try {
    await rawCall({ ...buy, from: USER }, { [USER]: { balance: numberToHex(10n ** 18n) } });
    console.log('buy simulation: OK (0.001 ETH, 3% slippage)');
  } catch (error) {
    console.log('buy simulation FAILED:', (error.shortMessage ?? error.message).slice(0, 200));
  }

  // Sell: give the user tokens, an ERC-20 allowance to Permit2 and a Permit2 allowance to the router.
  const layout = await storageLayout(token);
  if (!layout) { console.log('sell: token storage layout not recognised'); continue; }
  console.log('token storage layout:', layout.name);
  const sellAmount = quotedOut / 2n;
  const sellSwapIn = sellAmount - (sellAmount * 10n) / 10_000n;
  const sellQuote = decodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', data: await rawCall({ to: V4_QUOTER, data: quoteCall(key, token, sellSwapIn) }) })[0];
  const tokenState = {
    [layout.balance(USER)]: padHex(numberToHex(sellAmount), { size: 32 }),
    [layout.allowance(USER, PERMIT2)]: padHex(numberToHex(maxUint256), { size: 32 }),
  };
  const packed = (BigInt(deadline) << 160n) | sellAmount; // amount | expiration << 160 | nonce 0
  const permit2State = { [nestedSlot(UNIVERSAL_ROUTER, nestedSlot(token, mapSlot(USER, 1)))]: padHex(numberToHex(packed), { size: 32 }) };
  const sell = buildSell({ key, token, quote: WETH, amountIn: sellAmount, minOut: (sellQuote * 97n) / 100n, feeBps: 10, feeRecipient: FEE_TO, deadline });
  try {
    await rawCall({ ...sell, from: USER }, { [token]: { stateDiff: tokenState }, [PERMIT2]: { stateDiff: permit2State } });
    console.log(`sell simulation: OK (${Number(sellAmount) / 1e18} tokens -> ~${Number(sellQuote) / 1e18} ETH)`);
  } catch (error) {
    console.log('sell simulation FAILED:', (error.shortMessage ?? error.message).slice(0, 300));
  }
}
