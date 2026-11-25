// Removes look-alike tokens from the Bankr launch registry.
//
// The backfill selects Doppler launches whose address ends in `ba3` (Bankr mines that suffix).
// A few other deployers mine the same suffix, so every token is checked on-chain: a Bankr launch
// has Bankr's integrator in Airlock.getAssetData (the address Doppler pays integrator fees to).
// Rows with another integrator are deleted from Supabase and from the local backfill file.
//
// Usage: node scripts/verify-launch-integrators.mjs [data/bankr-launches.ndjson]
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local (skipped when unset).
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const FILE = process.argv[2] || 'data/bankr-launches.ndjson';
const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
const BANKR_INTEGRATOR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
const BATCH = 500;
const CONCURRENCY = 4;
const abi = parseAbi(['function getAssetData(address asset) view returns (address, address, address, address, address, address, address, uint256, uint256, address integrator)']);
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC || 'https://base-rpc.publicnode.com', { timeout: 30_000, retryCount: 5, retryDelay: 2_000 }) });

// null = could not be read (kept, reported); otherwise the integrator address.
async function integrators(addresses) {
  const results = await client.multicall({
    allowFailure: true,
    contracts: addresses.map((address) => ({ address: AIRLOCK, abi, functionName: 'getAssetData', args: [address] })),
  });
  return results.map((result) => result.status === 'success' ? String(result.result[9]).toLowerCase() : null);
}

if (!existsSync(FILE)) {
  console.error(`Backfill file not found: ${FILE}`);
  process.exit(1);
}
const lines = readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
const addresses = lines.filter((line) => line.includes('"a"')).map((line) => JSON.parse(line).a);
console.log(`checking ${addresses.length.toLocaleString('en-US')} tokens`);

const rejected = new Map();
let unreadable = 0;
let checked = 0;
const startedAt = Date.now();
for (let index = 0; index < addresses.length; index += BATCH * CONCURRENCY) {
  const batches = [];
  for (let offset = index; offset < Math.min(addresses.length, index + BATCH * CONCURRENCY); offset += BATCH) {
    batches.push(addresses.slice(offset, offset + BATCH));
  }
  const results = await Promise.all(batches.map(integrators));
  batches.forEach((batch, batchIndex) => batch.forEach((address, position) => {
    const integrator = results[batchIndex][position];
    if (integrator === null) unreadable += 1;
    else if (integrator !== BANKR_INTEGRATOR) rejected.set(address, integrator);
  }));
  checked += batches.reduce((sum, batch) => sum + batch.length, 0);
  if ((index / (BATCH * CONCURRENCY)) % 25 === 0 || checked === addresses.length) {
    const rate = checked / ((Date.now() - startedAt) / 1000);
    console.log(`${checked.toLocaleString('en-US')} checked, ${rejected.size} not Bankr, ${unreadable} unreadable, ${Math.round(rate)}/s`);
  }
}

const byIntegrator = new Map();
rejected.forEach((integrator) => byIntegrator.set(integrator, (byIntegrator.get(integrator) ?? 0) + 1));
console.log(`not Bankr: ${rejected.size} tokens from ${byIntegrator.size} other integrators; top:`, [...byIntegrator.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5));
writeFileSync('data/non-bankr-ba3.json', JSON.stringify(Object.fromEntries(rejected), null, 1));

// Local backfill file: rewrite without the rejected tokens.
const kept = lines.filter((line) => !line.includes('"a"') || !rejected.has(JSON.parse(line).a));
writeFileSync(`${FILE}.tmp`, `${kept.join('\n')}\n`);
renameSync(`${FILE}.tmp`, FILE);
console.log(`backfill file: removed ${lines.length - kept.length} rows`);

// Supabase: delete the same rows.
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (url && key) {
  const list = [...rejected.keys()];
  for (let index = 0; index < list.length; index += 200) {
    const filter = `in.(${list.slice(index, index + 200).join(',')})`;
    const response = await fetch(`${url}/rest/v1/bankrdex_launches?token_address=${encodeURIComponent(filter)}`, {
      method: 'DELETE',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' },
    });
    if (!response.ok) throw new Error(`Supabase delete failed (${response.status}): ${await response.text()}`);
  }
  console.log(`Supabase: deleted ${list.length} rows`);
} else {
  console.log('Supabase not configured; only the file was cleaned.');
}
if (unreadable > 0) console.log(`${unreadable} tokens could not be read and were kept; run again to retry them.`);
