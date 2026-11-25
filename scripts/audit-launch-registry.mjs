// Re-checks every row of the Bankr launch registry (bankrdex_launches) on-chain: a Bankr launch has
// Bankr's integrator in Doppler's Airlock.getAssetData. Read-only by default; with --delete, rows
// whose integrator is someone else are removed (together with their pools and indexed swaps).
// Rows that cannot be read are reported and kept.
//
// Usage: node scripts/audit-launch-registry.mjs [--delete] [--out data/registry-audit.json]
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local; BASE_RPC overrides the RPC.
import { existsSync, writeFileSync } from 'node:fs';
import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).');
  process.exit(1);
}
const DELETE = process.argv.includes('--delete');
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'data/registry-audit.json';
const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
const BANKR_INTEGRATOR = '0xf60633d02690e2a15a54ab919925f3d038df163e';
// PostgREST serves at most 1,000 rows per request (db-max-rows).
const PAGE = 1_000;
const BATCH = 500;
const CONCURRENCY = 4;
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const abi = parseAbi(['function getAssetData(address asset) view returns (address, address, address, address, address, address, address, uint256, uint256, address integrator)']);
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC || 'https://base-rpc.publicnode.com', { timeout: 30_000, retryCount: 5, retryDelay: 2_000 }) });

async function integrators(addresses) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const results = await client.multicall({
        allowFailure: true,
        contracts: addresses.map((address) => ({ address: AIRLOCK, abi, functionName: 'getAssetData', args: [address] })),
      });
      return results.map((result) => (result.status === 'success' ? String(result.result[9]).toLowerCase() : null));
    } catch (error) {
      if (attempt >= 6) return addresses.map(() => null);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    }
  }
}

async function page(after) {
  const params = new URLSearchParams({ select: 'token_address', order: 'token_address.asc', limit: String(PAGE) });
  if (after) params.set('token_address', `gt.${after}`);
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${url}/rest/v1/bankrdex_launches?${params}`, { headers }).catch(() => null);
    if (response?.ok) return (await response.json()).map((row) => row.token_address);
    if (attempt >= 5) throw new Error(`registry read failed (${response?.status ?? 'network'})`);
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

const startedAt = Date.now();
const others = new Map();
const unreadable = [];
let checked = 0;
let bankr = 0;
let after = '';
for (;;) {
  const addresses = await page(after);
  if (addresses.length === 0) break;
  after = addresses[addresses.length - 1];
  for (let index = 0; index < addresses.length; index += BATCH * CONCURRENCY) {
    const batches = [];
    for (let offset = index; offset < Math.min(addresses.length, index + BATCH * CONCURRENCY); offset += BATCH) batches.push(addresses.slice(offset, offset + BATCH));
    const results = await Promise.all(batches.map(integrators));
    batches.forEach((batch, batchIndex) => batch.forEach((address, position) => {
      const integrator = results[batchIndex][position];
      if (integrator === null) unreadable.push(address);
      else if (integrator === BANKR_INTEGRATOR) bankr += 1;
      else others.set(address, integrator);
    }));
  }
  checked += addresses.length;
  const rate = checked / ((Date.now() - startedAt) / 1000);
  if (checked % 50_000 < PAGE) console.log(`${checked.toLocaleString('en-US')} checked: ${bankr.toLocaleString('en-US')} Bankr, ${others.size} other integrator, ${unreadable.length} unreadable (${Math.round(rate)}/s)`);
}

// Unreadable rows get one more, slower pass.
if (unreadable.length > 0) {
  const retry = unreadable.splice(0);
  for (let index = 0; index < retry.length; index += 100) {
    const batch = retry.slice(index, index + 100);
    const results = await integrators(batch);
    batch.forEach((address, position) => {
      const integrator = results[position];
      if (integrator === null) unreadable.push(address);
      else if (integrator === BANKR_INTEGRATOR) bankr += 1;
      else others.set(address, integrator);
    });
  }
}

const byIntegrator = {};
for (const integrator of others.values()) byIntegrator[integrator] = (byIntegrator[integrator] ?? 0) + 1;
const report = { checkedAt: new Date().toISOString(), checked, bankr, otherIntegrator: Object.fromEntries(others), byIntegrator, unreadable };
writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
console.log(`done in ${Math.round((Date.now() - startedAt) / 1000)} s: ${bankr.toLocaleString('en-US')} Bankr, ${others.size} other integrator, ${unreadable.length} unreadable -> ${OUT}`);
if (others.size > 0) console.log('other integrators:', byIntegrator);

if (DELETE && others.size > 0) {
  const list = [...others.keys()];
  for (let index = 0; index < list.length; index += 100) {
    const filter = `in.(${list.slice(index, index + 100).join(',')})`;
    for (const table of ['bankrdex_swaps', 'bankrdex_pool_map', 'bankrdex_launches']) {
      const response = await fetch(`${url}/rest/v1/${table}?token_address=${filter}`, { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } });
      if (!response.ok) throw new Error(`${table} delete failed (${response.status})`);
    }
  }
  console.log(`deleted ${list.length} non-Bankr rows (registry, pools, swaps)`);
}
