// On-chain market indexer for Bankr tokens on Base. Long-running; keeps Postgres (local Supabase
// or a hosted one) current with:
//   - every swap in a Bankr Uniswap V4 pool (PoolManager `Swap` logs -> bankrdex_swaps)
//   - new Bankr launches (Airlock `Create` that pass the Bankr launch check in
//     src/server/bankrLaunchRules.ts -> bankrdex_launches + pool map)
//   - USD prices of the quote assets (WETH/USDC and BNKR/WETH Uniswap V3 pools -> bankrdex_prices)
// No API keys: everything is read from public Base RPCs.
//
// Usage: node scripts/indexer.mjs        (first run indexes the last 24 hours, then follows the chain)
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
import { existsSync } from 'node:fs';
import { createPublicClient, erc20Abi, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { candidatePools } from '../src/server/bankrPools.ts';
import { checkBankrLaunches } from '../src/server/bankrLaunchRules.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const SUPABASE = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE || !KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).');
  process.exit(1);
}

const RECENT_RPC = process.env.BASE_RPC || 'https://base-rpc.publicnode.com';
const ARCHIVE_RPC = process.env.BASE_ARCHIVE_RPC || 'https://gateway.tenderly.co/public/base';
const POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';
const SWAP_TOPIC = '0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f';
const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
const CREATE_TOPIC = '0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab';
const USER_OPERATION_EVENT = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f';
const WETH = '0x4200000000000000000000000000000000000006';
const BNKR = '0x22af33fe49fd1fa80c7149773dde5890d3c76f3b';
const WETH_USDC_POOL = '0xd0b53d9277642d899df5c87a3966a349a798f224'; // Uniswap V3, token0 WETH, token1 USDC
const BNKR_WETH_POOL = '0xaec085e5a5ce8d96a7bdd3eb3a62445d4f6ce703'; // Uniswap V3, token0 BNKR, token1 WETH
const CURSOR_KEY = 'indexer-cursor';
const BLOCK_TIME_S = 2;
const INITIAL_LOOKBACK = 43_200; // 24 hours of Base blocks
const RECENT_WINDOW = 1_800; // public RPC serves logs this close to the head
// Blocks per request; halved when a busy range returns more logs than the client accepts and
// grown back afterwards.
const MAX_CHUNK = 1_000;
const MIN_CHUNK = 25;
let chunk = MAX_CHUNK;
const RETENTION_DAYS = 14;

const recent = createPublicClient({ chain: base, transport: http(RECENT_RPC, { timeout: 30_000, retryCount: 4, retryDelay: 1_500 }) });
const archive = createPublicClient({ chain: base, transport: http(ARCHIVE_RPC, { timeout: 30_000, retryCount: 4, retryDelay: 2_000 }) });
const v3Abi = parseAbi(['function slot0() view returns (uint160 sqrtPriceX96, int24, uint16, uint16, uint16, uint8, bool)']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Postgres through PostgREST -------------------------------------------------------------
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path.split('?')[0]} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
  return response.status === 204 || init.method === 'DELETE' ? null : response.json().catch(() => null);
}
const upsert = (table, rows, conflict, ignore = false) => rows.length === 0 ? null : rest(`${table}?on_conflict=${conflict}`, {
  method: 'POST',
  headers: { Prefer: `resolution=${ignore ? 'ignore' : 'merge'}-duplicates,return=minimal` },
  body: JSON.stringify(rows),
});
async function readCursor() {
  const rows = await rest(`bankrdex_notify_state?select=value&key=eq.${CURSOR_KEY}`);
  return typeof rows?.[0]?.value === 'number' ? rows[0].value : null;
}
const writeCursor = (block) => upsert('bankrdex_notify_state', [{ key: CURSOR_KEY, value: block, updated_at: new Date().toISOString() }], 'key');

// ---- Pool map cache -------------------------------------------------------------------------
const poolCache = new Map(); // pool id -> row | null
async function resolvePools(ids) {
  const unknown = [...new Set(ids)].filter((id) => !poolCache.has(id));
  for (let index = 0; index < unknown.length; index += 150) {
    const batch = unknown.slice(index, index + 150);
    const rows = await rest(`bankrdex_pool_map?select=pool_id,token_address,quote_address,token_is_currency0&pool_id=in.(${batch.join(',')})`);
    const found = new Map(rows.map((row) => [row.pool_id, row]));
    batch.forEach((id) => poolCache.set(id, found.get(id) ?? null));
  }
  if (poolCache.size > 200_000) poolCache.clear();
}

// ---- Prices ---------------------------------------------------------------------------------
const quoteUsd = new Map([[WETH, null], [BNKR, null]]);
const quoteDecimals = new Map([[WETH, 18], [BNKR, 18]]);
let pricesAt = 0;
async function refreshPrices() {
  if (Date.now() - pricesAt < 60_000) return;
  const [wethSlot, bnkrSlot] = await Promise.all([
    recent.readContract({ address: WETH_USDC_POOL, abi: v3Abi, functionName: 'slot0' }),
    recent.readContract({ address: BNKR_WETH_POOL, abi: v3Abi, functionName: 'slot0' }),
  ]);
  const ratio = (sqrt) => Number(sqrt) ** 2 / 2 ** 192;
  const ethUsd = ratio(wethSlot[0]) * 1e12; // USDC (6) per WETH (18)
  const bnkrUsd = ratio(bnkrSlot[0]) * ethUsd; // WETH per BNKR (both 18 decimals)
  quoteUsd.set(WETH, ethUsd);
  quoteUsd.set(BNKR, bnkrUsd);
  pricesAt = Date.now();
  await upsert('bankrdex_prices', [
    { asset: WETH, usd: ethUsd, updated_at: new Date().toISOString() },
    { asset: BNKR, usd: bnkrUsd, updated_at: new Date().toISOString() },
  ], 'asset');
}
async function decimalsOf(token) {
  if (!quoteDecimals.has(token)) {
    const value = await recent.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18);
    quoteDecimals.set(token, Number(value));
  }
  return quoteDecimals.get(token);
}

// ---- Traders --------------------------------------------------------------------------------
// The trader is the ERC-4337 account whose UserOperation contains the swap, or the sender of a
// plain transaction (the Swap event's own `sender` is the router).
// Receipts: publicnode treats them as archive requests, so batches go to Base's public RPC (which
// rate-limits part of each batch); whatever is still missing is read one by one from Tenderly.
const RECEIPT_RPC = process.env.BASE_RECEIPT_RPC || 'https://mainnet.base.org';
async function receipts(hashes) {
  const result = new Map();
  let missing = [...hashes];
  for (let attempt = 0; attempt < 4 && missing.length; attempt += 1) {
    for (let index = 0; index < missing.length; index += 20) {
      const batch = missing.slice(index, index + 20);
      const body = batch.map((hash, id) => ({ jsonrpc: '2.0', id, method: 'eth_getTransactionReceipt', params: [hash] }));
      try {
        const response = await fetch(RECEIPT_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
        const replies = await response.json();
        if (Array.isArray(replies)) replies.forEach((reply) => { if (reply.result) result.set(batch[reply.id], reply.result); });
      } catch {
        // retried below
      }
      await sleep(150);
    }
    missing = missing.filter((hash) => !result.has(hash));
    if (missing.length) await sleep(1_000 * (attempt + 1));
  }
  for (const hash of missing.slice(0, 60)) {
    const receipt = await archive.request({ method: 'eth_getTransactionReceipt', params: [hash] }).catch(() => null);
    if (receipt) result.set(hash, receipt);
  }
  return result;
}

function traderOf(receipt, logIndex) {
  if (!receipt) return null;
  const operation = receipt.logs
    .filter((log) => log.topics[0] === USER_OPERATION_EVENT && Number.parseInt(log.logIndex, 16) > logIndex)
    .sort((left, right) => Number.parseInt(left.logIndex, 16) - Number.parseInt(right.logIndex, 16))[0];
  return (operation ? `0x${operation.topics[2].slice(26)}` : receipt.from).toLowerCase();
}

async function hasBankrRecord(address) {
  const response = await fetch(`https://api.bankr.bot/token-launches/${address}`, { headers: { Accept: 'application/json', 'User-Agent': 'BankrDex-indexer/1.0' }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Bankr launch lookup failed (${response.status})`);
  const launch = (await response.json()).launch;
  return launch?.chain === 'base' && launch.status === 'deployed';
}

// ---- One block range ------------------------------------------------------------------------
const signed = (word) => BigInt.asIntN(256, BigInt(`0x${word}`));
async function indexRange(from, to, head, headTimestamp) {
  const client = head - from > RECENT_WINDOW ? archive : recent;
  const blocks = { fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}` };
  const [swapLogs, createLogs] = await Promise.all([
    client.request({ method: 'eth_getLogs', params: [{ address: POOL_MANAGER, topics: [SWAP_TOPIC], ...blocks }] }),
    client.request({ method: 'eth_getLogs', params: [{ address: AIRLOCK, topics: [CREATE_TOPIC], ...blocks }] }),
  ]);

  // New launches first, so swaps in their pools in this same range are recognised.
  const candidates = createLogs
    .map((log) => ({ a: `0x${log.data.slice(26, 66)}`.toLowerCase(), q: `0x${log.topics[1].slice(26)}`.toLowerCase(), i: `0x${log.data.slice(90, 130)}`.toLowerCase(), b: Number(BigInt(log.blockNumber)), t: log.transactionHash.toLowerCase() }))
    .filter((launch) => launch.a.endsWith('ba3'));
  let launches = 0;
  if (candidates.length) {
    // Integrator plus Bankr's launch setup: look-alikes set Bankr as integrator too. A setup Bankr
    // may have started using since (unknown hook) is confirmed through Bankr's own record.
    const checks = await checkBankrLaunches(recent, candidates.map((launch) => launch.a));
    const bankr = [];
    for (const launch of candidates) {
      const check = checks.get(launch.a);
      if (!check || check.reason === 'unreadable') throw new Error(`launch check failed for ${launch.a}`);
      if (check.bankr) bankr.push({ ...launch, reason: check.reason });
      else if (check.bankr === null && await hasBankrRecord(launch.a)) bankr.push({ ...launch, reason: `bankr-record:${check.reason}` });
    }
    const checkedAt = new Date().toISOString();
    await upsert('bankrdex_launches', bankr.map((launch) => ({ token_address: launch.a, quote_address: launch.q, initializer: launch.i, block_number: launch.b, tx_hash: launch.t, not_bankr: false, check_reason: launch.reason, checked_at: checkedAt, updated_at: checkedAt })), 'token_address', true);
    const poolRows = bankr.flatMap((launch) => candidatePools(launch.a, launch.q, launch.i));
    await upsert('bankrdex_pool_map', poolRows, 'pool_id', true);
    poolRows.forEach((row) => poolCache.set(row.pool_id, row));
    launches = bankr.length;
  }

  await resolvePools(swapLogs.map((log) => log.topics[1].toLowerCase()));
  const bankrSwaps = swapLogs.filter((log) => poolCache.get(log.topics[1].toLowerCase()) && !log.removed);
  const txReceipts = await receipts([...new Set(bankrSwaps.map((log) => log.transactionHash))]);
  const rows = [];
  for (const log of bankrSwaps) {
    const pool = poolCache.get(log.topics[1].toLowerCase());
    const data = log.data.slice(2);
    const amount0 = signed(data.slice(0, 64));
    const amount1 = signed(data.slice(64, 128));
    // V4 deltas are from the swapper's side: positive = received from the pool.
    const [tokenDelta, quoteDelta] = pool.token_is_currency0 ? [amount0, amount1] : [amount1, amount0];
    if (tokenDelta === 0n || quoteDelta === 0n) continue;
    const decimals = await decimalsOf(pool.quote_address);
    const tokenAmount = Math.abs(Number(tokenDelta)) / 1e18;
    const quoteAmount = Math.abs(Number(quoteDelta)) / 10 ** decimals;
    const priceQuote = quoteAmount / tokenAmount;
    // Dust swaps (a few wei) have no usable price: integer rounding puts it thousands of times off.
    const dust = tokenAmount < 1e-12 || quoteAmount < 1e-12;
    const usd = quoteUsd.get(pool.quote_address) ?? null;
    const block = Number(BigInt(log.blockNumber));
    const logIndex = Number(BigInt(log.logIndex));
    rows.push({
      block_number: block,
      log_index: logIndex,
      pool_id: log.topics[1].toLowerCase(),
      token_address: pool.token_address,
      tx_hash: log.transactionHash.toLowerCase(),
      trader: traderOf(txReceipts.get(log.transactionHash), logIndex),
      is_buy: tokenDelta > 0n,
      token_amount: tokenAmount,
      quote_amount: quoteAmount,
      price_quote: priceQuote,
      price_usd: usd === null || dust ? null : priceQuote * usd,
      volume_usd: usd === null ? null : quoteAmount * usd,
      ts: new Date((headTimestamp - (head - block) * BLOCK_TIME_S) * 1000).toISOString(),
    });
  }
  for (let index = 0; index < rows.length; index += 1_000) {
    await upsert('bankrdex_swaps', rows.slice(index, index + 1_000), 'block_number,log_index', true);
  }
  return { swaps: rows.length, allSwaps: swapLogs.length, launches };
}

// Swaps stored before their receipt could be read get their trader filled in later.
async function fillMissingTraders() {
  const rows = await rest('bankrdex_swaps?select=*&trader=is.null&order=ts.desc&limit=200');
  if (!rows?.length) return 0;
  const found = await receipts([...new Set(rows.map((row) => row.tx_hash))]);
  const updated = rows
    .map((row) => ({ ...row, trader: traderOf(found.get(row.tx_hash), row.log_index) }))
    .filter((row) => row.trader);
  await upsert('bankrdex_swaps', updated, 'block_number,log_index');
  return updated.length;
}

// ---- Main loop ------------------------------------------------------------------------------
let prunedAt = 0;
async function prune() {
  if (Date.now() - prunedAt < 3_600_000) return;
  prunedAt = Date.now();
  const before = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  await rest(`bankrdex_swaps?ts=lt.${before}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

// Separate loop: the main loop rarely idles (Base makes a block every 2 seconds).
(async () => {
  for (;;) {
    try {
      const filled = await fillMissingTraders();
      if (filled) console.log(`${new Date().toISOString()} filled ${filled} missing traders`);
      await sleep(filled ? 1_000 : 30_000);
    } catch (error) {
      console.error(`${new Date().toISOString()} trader fill error:`, error instanceof Error ? error.message.split(String.fromCharCode(10))[0] : error);
      await sleep(10_000);
    }
  }
})();

let cursor = await readCursor();
console.log(`indexer starting; cursor ${cursor ?? 'none (indexing the last 24 hours first)'}`);
for (;;) {
  try {
    await refreshPrices();
    const headBlock = await recent.getBlock();
    const head = Number(headBlock.number);
    const headTimestamp = Number(headBlock.timestamp);
    if (cursor === null) cursor = head - INITIAL_LOOKBACK;
    if (cursor >= head) {
      await sleep(2_000);
      continue;
    }
    const from = cursor + 1;
    const to = Math.min(head, cursor + chunk);
    const startedAt = Date.now();
    const result = await indexRange(from, to, head, headTimestamp);
    cursor = to;
    await writeCursor(cursor);
    chunk = Math.min(MAX_CHUNK, Math.ceil(chunk * 1.5));
    if (result.swaps || result.launches || head - to > 0) {
      console.log(`${new Date().toISOString()} blocks ${from}-${to} (${head - to} behind): ${result.swaps}/${result.allSwaps} Bankr swaps, ${result.launches} launches, ${Date.now() - startedAt} ms`);
    }
    await prune();
    if (head - to <= 0) await sleep(2_000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/size limit|too large|exceed|response size|query returned more/i.test(message) && chunk > MIN_CHUNK) {
      chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2));
      console.warn(`${new Date().toISOString()} range too large; retrying with ${chunk} blocks`);
      continue;
    }
    console.error(`${new Date().toISOString()} indexer error:`, message.split(String.fromCharCode(10))[0]);
    await sleep(5_000);
  }
}
