// Keeps only verified Bankr launches in the bundled token list (src/data/bankrTokens.json), the
// list the app shows before the live catalog loads and the server's last-resort fallback.
// Verdicts come from bankrdex_token_verification (written by src/server/bankrVerification.ts when
// the catalog refreshes), so load the app once before running this.
//
// Usage: node scripts/clean-bundled-tokens.mjs [--dry-run]
// Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from .env.local.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const FILE = 'src/data/bankrTokens.json';
const dryRun = process.argv.includes('--dry-run');
const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
  process.exit(1);
}

const verdicts = new Map();
for (let offset = 0; ; offset += 1000) {
  const response = await fetch(`${url}/rest/v1/bankrdex_token_verification?select=token_key,is_bankr,method&order=token_key.asc&limit=1000&offset=${offset}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Verification read failed (${response.status}).`);
  const rows = await response.json();
  for (const row of rows) verdicts.set(row.token_key, row);
  if (rows.length < 1000) break;
}

const bundle = JSON.parse(readFileSync(FILE, 'utf8'));
const kept = [];
const dropped = { notBankr: [], unverified: [] };
for (const token of bundle.tokens ?? []) {
  const verdict = verdicts.get(`${token.chain || 'base'}:${String(token.address).toLowerCase()}`);
  if (verdict?.is_bankr) kept.push({ ...token, verifiedBy: verdict.method });
  else (verdict ? dropped.notBankr : dropped.unverified).push(`${token.chain || 'base'}:${token.symbol}`);
}
console.log(`kept ${kept.length}, removed ${dropped.notBankr.length} not Bankr, ${dropped.unverified.length} unverified`);
if (dropped.unverified.length) console.log('unverified:', dropped.unverified.join(', '));
if (!dryRun) {
  writeFileSync(FILE, `${JSON.stringify({ ...bundle, tokens: kept }, null, 2)}\n`);
  console.log(`wrote ${FILE}`);
}
