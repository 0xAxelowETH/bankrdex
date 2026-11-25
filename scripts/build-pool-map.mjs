// Fills bankrdex_pool_map (Uniswap V4 pool id -> Bankr token) for every launch in the backfill
// file, without any RPC call: a V4 pool id is keccak256(abi.encode(PoolKey)).
//
// See src/server/bankrPools.ts for how the candidate pool ids are derived.
//
// Usage: node scripts/build-pool-map.mjs [data/bankr-launches.ndjson]
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { candidatePools } from '../src/server/bankrPools.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).');
  process.exit(1);
}
const FILE = process.argv[2] || 'data/bankr-launches.ndjson';
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' };
async function insert(rows) {
  const response = await fetch(`${url}/rest/v1/bankrdex_pool_map?on_conflict=pool_id`, { method: 'POST', headers, body: JSON.stringify(rows) });
  if (!response.ok) throw new Error(`insert failed (${response.status}): ${await response.text()}`);
}

const startedAt = Date.now();
let buffer = [];
let written = 0;
let launches = 0;
const pending = [];
const registered = new Set();
for await (const line of createInterface({ input: createReadStream(FILE, 'utf8'), crlfDelay: Infinity })) {
  if (!line.includes('"a"')) continue;
  const record = JSON.parse(line);
  launches += 1;
  registered.add(record.a.toLowerCase());
  buffer.push(...candidatePools(record.a, record.q, record.i));
  if (buffer.length >= 2_000) {
    pending.push(insert(buffer));
    written += buffer.length;
    buffer = [];
    if (pending.length >= 4) await Promise.all(pending.splice(0));
    if (written % 100_000 < 2_000) console.log(`${launches.toLocaleString('en-US')} launches, ${written.toLocaleString('en-US')} pool ids`);
  }
}
if (buffer.length) { pending.push(insert(buffer)); written += buffer.length; }
await Promise.all(pending);

// Pools Bankr's API reported directly (catalog), in case a launch used another hook. Only tokens in
// the integrator-verified registry: GeckoTerminal-sourced entries can belong to other launchpads.
const catalog = JSON.parse(readFileSync('src/data/bankrTokens.json', 'utf8')).tokens
  .filter((token) => (token.chain ?? 'base') === 'base' && /^0x[a-f0-9]{64}$/.test(token.pool ?? '') && registered.has(token.address.toLowerCase()));
const quoteOf = (token) => (token.quoteAddress ?? '0x4200000000000000000000000000000000000006').toLowerCase();
await insert(catalog.map((token) => ({
  pool_id: token.pool,
  token_address: token.address,
  quote_address: quoteOf(token),
  token_is_currency0: BigInt(token.address) < BigInt(quoteOf(token)),
  hooks: null,
})));
console.log(`done: ${launches.toLocaleString('en-US')} launches -> ${written.toLocaleString('en-US')} candidate pool ids (+${catalog.length} from the catalog) in ${Math.round((Date.now() - startedAt) / 1000)} s`);
