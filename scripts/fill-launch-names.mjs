// Fills name / symbol for every row of bankrdex_launches that has none, reading the token
// contracts through Multicall3 (one RPC request per batch of tokens), so the All launches page
// can be searched by symbol. Resumable: only rows without a symbol are read.
//
// Usage: node scripts/fill-launch-names.mjs
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local; BASE_RPC overrides the RPC.
import { existsSync } from 'node:fs';
import { createPublicClient, erc20Abi, http } from 'viem';
import { base } from 'viem/chains';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).');
  process.exit(1);
}
const RPC = process.env.BASE_RPC || 'https://base-rpc.publicnode.com';
const BATCH = 300;
const CONCURRENCY = 3;
const client = createPublicClient({ chain: base, transport: http(RPC, { timeout: 30_000, retryCount: 4, retryDelay: 1_500 }) });
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const clean = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '';

async function nextRows(beforeBlock) {
  const params = new URLSearchParams({
    select: 'token_address,quote_address,initializer,block_number,tx_hash',
    symbol: 'is.null',
    order: 'block_number.desc',
    limit: String(BATCH),
  });
  if (beforeBlock) params.set('block_number', `lte.${beforeBlock}`);
  const response = await fetch(`${url}/rest/v1/bankrdex_launches?${params}`, { headers });
  if (!response.ok) throw new Error(`read failed (${response.status}): ${await response.text()}`);
  return response.json();
}

async function fill(rows) {
  const results = await client.multicall({
    allowFailure: true,
    contracts: rows.flatMap((row) => [
      { address: row.token_address, abi: erc20Abi, functionName: 'name' },
      { address: row.token_address, abi: erc20Abi, functionName: 'symbol' },
    ]),
  });
  // An empty string marks "read, but the contract has no symbol" so the row is not retried.
  const updates = rows.map((row, index) => ({
    ...row,
    name: clean(results[index * 2]?.result, 80) || null,
    symbol: clean(results[index * 2 + 1]?.result, 32),
    updated_at: new Date().toISOString(),
  }));
  const response = await fetch(`${url}/rest/v1/bankrdex_launches?on_conflict=token_address`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) throw new Error(`write failed (${response.status}): ${await response.text()}`);
  return updates.filter((row) => row.symbol).length;
}

const startedAt = Date.now();
let done = 0;
let named = 0;
let cursor = null;
for (;;) {
  // Read CONCURRENCY batches ahead (newest first), then resolve them in parallel.
  const batches = [];
  for (let index = 0; index < CONCURRENCY; index += 1) {
    const rows = await nextRows(cursor);
    const fresh = rows.filter((row) => !batches.flat().some((other) => other.token_address === row.token_address));
    if (fresh.length === 0) break;
    batches.push(fresh);
    cursor = fresh[fresh.length - 1].block_number;
    if (rows.length < BATCH) break;
  }
  if (batches.length === 0) break;
  const counts = await Promise.all(batches.map(fill));
  done += batches.reduce((sum, batch) => sum + batch.length, 0);
  named += counts.reduce((sum, count) => sum + count, 0);
  const rate = done / ((Date.now() - startedAt) / 1000);
  console.log(`${done.toLocaleString('en-US')} read, ${named.toLocaleString('en-US')} named, ${Math.round(rate)}/s`);
}
console.log(`done: ${done.toLocaleString('en-US')} rows read, ${named.toLocaleString('en-US')} with a symbol`);
