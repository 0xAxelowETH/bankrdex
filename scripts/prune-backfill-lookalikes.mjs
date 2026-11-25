// Removes launches flagged by scripts/check-bankr-launches.mjs (not_bankr) from the local backfill
// file, so the no-Supabase fallback (src/server/localLaunchIndex.ts) never lists them either.
// The removed addresses are written to data/non-bankr-lookalikes.json.
//
// Usage: node scripts/prune-backfill-lookalikes.mjs [data/bankr-launches.ndjson]
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
import { createReadStream, existsSync, renameSync, writeFileSync, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const FILE = process.argv[2] || 'data/bankr-launches.ndjson';
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !existsSync(FILE)) {
  console.error('Needs SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY and the backfill file.');
  process.exit(1);
}

const flagged = new Map();
let after = '';
for (;;) {
  const params = new URLSearchParams({ select: 'token_address,check_reason', not_bankr: 'is.true', order: 'token_address.asc', limit: '1000' });
  if (after) params.set('token_address', `gt.${after}`);
  const response = await fetch(`${url}/rest/v1/bankrdex_launches?${params}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`registry read failed (${response.status})`);
  const rows = await response.json();
  for (const row of rows) flagged.set(row.token_address, row.check_reason);
  if (rows.length < 1000) break;
  after = rows[rows.length - 1].token_address;
}
console.log(`${flagged.size.toLocaleString('en-US')} flagged launches in the registry`);

const temporary = `${FILE}.tmp`;
const output = createWriteStream(temporary);
let kept = 0;
let removed = 0;
for await (const line of createInterface({ input: createReadStream(FILE, 'utf8'), crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  if (line.includes('"a"') && flagged.has(JSON.parse(line).a)) { removed += 1; continue; }
  if (!output.write(`${line}\n`)) await new Promise((resolve) => output.once('drain', resolve));
  kept += 1;
}
await new Promise((resolve) => output.end(resolve));
renameSync(temporary, FILE);
writeFileSync('data/non-bankr-lookalikes.json', `${JSON.stringify(Object.fromEntries(flagged))}\n`);
console.log(`kept ${kept.toLocaleString('en-US')} lines, removed ${removed.toLocaleString('en-US')} look-alikes from ${FILE}`);
