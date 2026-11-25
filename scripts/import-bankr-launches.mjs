// Uploads the output of backfill-bankr-launches.mjs into Supabase (table bankrdex_launches) and
// sets the live-sync cursor to the last scanned block, so the app continues from there.
//
// Usage: node scripts/import-bankr-launches.mjs data/bankr-launches.ndjson
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .env.local.
import { existsSync, readFileSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2];
if (!url || !key || !file) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then: node scripts/import-bankr-launches.mjs <file.ndjson>');
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=minimal',
};
const records = [];
let scannedTo = 0;
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  if (entry.scannedTo) {
    scannedTo = Math.max(scannedTo, entry.scannedTo);
    continue;
  }
  records.push({
    token_address: entry.a,
    quote_address: entry.q,
    initializer: entry.i,
    block_number: entry.b,
    tx_hash: entry.t,
  });
}
console.log(`importing ${records.length} launches (scanned to block ${scannedTo})`);

for (let index = 0; index < records.length; index += 1_000) {
  const response = await fetch(`${url}/rest/v1/bankrdex_launches?on_conflict=token_address`, {
    method: 'POST',
    headers,
    body: JSON.stringify(records.slice(index, index + 1_000)),
  });
  if (!response.ok) {
    console.error(`batch ${index} failed (${response.status}): ${await response.text()}`);
    process.exit(1);
  }
  if ((index / 1_000) % 20 === 0) console.log(`${Math.min(index + 1_000, records.length)}/${records.length}`);
}

// Live sync (src/server/bankrRegistry.ts) resumes after this block.
const cursor = await fetch(`${url}/rest/v1/bankrdex_notify_state?on_conflict=key`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ key: 'bankr-registry-cursor', value: scannedTo, updated_at: new Date().toISOString() }),
});
console.log(cursor.ok ? `done; live sync continues after block ${scannedTo}` : `done, but the cursor was not saved (${cursor.status}); run the notify_state migration`);
