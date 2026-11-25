// Checks every unchecked row of the Bankr launch registry against Bankr's launch setup
// (src/server/bankrLaunchRules.ts) and records the result: rows that are not Bankr launches are
// flagged (not_bankr), left out of all listings, and lose their pools and indexed swaps.
// Resumable: only rows with checked_at = null are read; unreadable rows stay unchecked.
//
// Usage: node scripts/check-bankr-launches.mjs [--recheck] [--from 0x6] [--to 0xb]
//   --recheck clears previous results; --from / --to limit the run to a token address range
//   (lexicographic, inclusive / exclusive), so several runs can share the work across RPCs.
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local; BASE_RPC overrides the RPC.
import { existsSync } from 'node:fs';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { checkBankrLaunches } from '../src/server/bankrLaunchRules.ts';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC || 'https://base-rpc.publicnode.com', { timeout: 30_000, retryCount: 5, retryDelay: 2_000 }) });
const PAGES_PER_ROUND = 4;
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1]?.toLowerCase() : undefined);
const FROM = arg('--from');
const TO = arg('--to');

async function rest(path, init = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } }).catch(() => null);
    if (response?.ok) return response.status === 204 ? null : response.json();
    if (attempt >= 5) throw new Error(`${path.split('?')[0]} failed (${response?.status ?? 'network'}): ${response ? await response.text() : ''}`);
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
  }
}

if (process.argv.includes('--recheck')) {
  await rest('bankrdex_launches?checked_at=not.is.null', { method: 'PATCH', body: JSON.stringify({ checked_at: null, check_reason: null, not_bankr: false }), headers: { Prefer: 'return=minimal' } });
  console.log('cleared previous results');
}

// Public RPCs throttle by failing calls inside the multicall: unreadable tokens are retried with
// growing pauses before they are left for a later run.
async function check(rows) {
  const registered = new Map(rows.map((row) => [row.token_address, row.initializer]));
  const results = new Map();
  let pending = rows.map((row) => row.token_address);
  for (let attempt = 0; pending.length > 0 && attempt < 6; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 2_000 * 2 ** attempt));
    let checks;
    try {
      checks = await checkBankrLaunches(client, pending, registered);
    } catch {
      continue;
    }
    for (const [token, result] of checks) results.set(token, result);
    pending = pending.filter((token) => results.get(token)?.reason === 'unreadable');
  }
  return results;
}

const startedAt = Date.now();
const label = FROM || TO ? `[${FROM ?? '0x'}..${TO ?? 'end'}] ` : '';
const reasons = {};
let after = '';
let checked = 0;
let flagged = 0;
let undecided = 0;
for (;;) {
  const rows = [];
  for (let page = 0; page < PAGES_PER_ROUND; page += 1) {
    const params = new URLSearchParams({ select: 'token_address,initializer', checked_at: 'is.null', order: 'token_address.asc', limit: '1000' });
    if (after) params.append('token_address', `gt.${after}`);
    else if (FROM) params.append('token_address', `gte.${FROM}`);
    if (TO) params.append('token_address', `lt.${TO}`);
    const batch = await rest(`bankrdex_launches?${params}`);
    if (batch.length === 0) break;
    rows.push(...batch);
    after = batch[batch.length - 1].token_address;
    if (batch.length < 1000) break;
  }
  if (rows.length === 0) break;
  const slices = [];
  for (let index = 0; index < rows.length; index += 1000) slices.push(rows.slice(index, index + 1000));
  const results = new Map((await Promise.all(slices.map(check))).flatMap((map) => [...map]));
  const decided = rows.filter((row) => results.get(row.token_address)?.bankr !== null && results.has(row.token_address));
  for (const row of rows) {
    const result = results.get(row.token_address);
    const reason = result?.reason ?? 'unreadable';
    if (!result || result.bankr === null) { undecided += 1; reasons[reason.split(':')[0]] = (reasons[reason.split(':')[0]] ?? 0) + 1; continue; }
    if (!result.bankr) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  // Undecided "unknown hook" rows are recorded as listed (not flagged) but keep their reason.
  const unknownHooks = rows.filter((row) => results.get(row.token_address)?.reason.startsWith('unknown-hook'));
  const record = [...decided, ...unknownHooks];
  if (record.length > 0) {
    flagged += await rest('rpc/bankrdex_record_launch_checks', {
      method: 'POST',
      body: JSON.stringify({
        p_tokens: record.map((row) => row.token_address),
        p_not_bankr: record.map((row) => results.get(row.token_address).bankr === false),
        p_reasons: record.map((row) => results.get(row.token_address).reason),
      }),
    });
  }
  checked += rows.length;
  if (checked % 20_000 < rows.length) {
    const rate = checked / ((Date.now() - startedAt) / 1000);
    console.log(`${label}${checked.toLocaleString('en-US')} checked, ${flagged.toLocaleString('en-US')} not Bankr, ${undecided} undecided (${Math.round(rate)}/s)`, JSON.stringify(reasons));
  }
}
console.log(`${label}done in ${Math.round((Date.now() - startedAt) / 1000)} s: ${checked.toLocaleString('en-US')} checked, ${flagged.toLocaleString('en-US')} flagged not Bankr, ${undecided} undecided`, JSON.stringify(reasons));
