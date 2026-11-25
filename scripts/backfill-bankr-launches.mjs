// Backfills every Bankr launch on Base from the chain.
//
// Bankr's public API only lists the 50 most recent launches, so the full history is read from
// Doppler's Airlock `Create` events instead. Bankr mines its token addresses to end in `ba3`
// (verified against GET api.bankr.bot/token-launches/{address}: every `ba3` asset is a Bankr
// launch, no other Doppler asset is), which separates Bankr from other Doppler integrators.
//
// Output: newline-delimited JSON, one compact record per launch:
//   {"a": token, "q": quote (numeraire), "i": initializer, "b": block, "t": tx hash}
// The scan resumes from the last block already in the output file.
//
// Usage: node scripts/backfill-bankr-launches.mjs <out.ndjson> [fromBlock] [toBlock]
// Needs an RPC that serves archive eth_getLogs; BASE_ARCHIVE_RPC overrides the default
// (Tenderly's public gateway, 1,000 blocks per request).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const RPC = process.env.BASE_ARCHIVE_RPC || 'https://gateway.tenderly.co/public/base';
const AIRLOCK = '0x660eaaedebc968f8f3694354fa8ec0b4c5ba8d12';
const CREATE_TOPIC = '0x68ff1cfcdcf76864161555fc0de1878d8f83ec6949bf351df74d8a4a1a2679ab';
// First Bankr (ba3) Doppler launch is after this block (Airlock deployment, April 2025).
const AIRLOCK_DEPLOY_BLOCK = 28_415_516;
const RANGE = Number(process.env.BACKFILL_RANGE || 1_000);
const CONCURRENCY = Number(process.env.BACKFILL_CONCURRENCY || 4);

const [out, fromArg, toArg] = process.argv.slice(2);
if (!out) {
  console.error('Usage: node scripts/backfill-bankr-launches.mjs <out.ndjson> [fromBlock] [toBlock]');
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function rpc(method, params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429) throw new Error('rate limited');
      const payload = await response.json();
      if (payload.error) throw new Error(JSON.stringify(payload.error));
      return payload.result;
    } catch (error) {
      if (attempt >= 8) throw error;
      await sleep(Math.min(30_000, 1_000 * 2 ** attempt));
    }
  }
}

let start = Number(fromArg || AIRLOCK_DEPLOY_BLOCK);
if (!fromArg && existsSync(out)) {
  const lines = readFileSync(out, 'utf8').trim().split('\n').filter(Boolean);
  const last = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
  if (last?.scannedTo) start = last.scannedTo + 1;
}
const end = Number(toArg || Number.parseInt(await rpc('eth_blockNumber', []), 16));
console.log(`scanning ${start}..${end} (${Math.ceil((end - start + 1) / RANGE)} requests) via ${new URL(RPC).host}`);

let next = start;
let found = 0;
let done = 0;
const total = Math.ceil((end - start + 1) / RANGE);
const results = new Map();
let flushed = start;
const startedAt = Date.now();

// Chunks finish out of order; write them in block order so the file can be resumed safely.
function flush() {
  while (results.has(flushed)) {
    const { to, records } = results.get(flushed);
    results.delete(flushed);
    const lines = records.map((record) => JSON.stringify(record));
    lines.push(JSON.stringify({ scannedTo: to }));
    appendFileSync(out, `${lines.join('\n')}\n`);
    flushed = to + 1;
  }
}

async function worker() {
  while (next <= end) {
    const from = next;
    const to = Math.min(end, from + RANGE - 1);
    next = to + 1;
    const logs = await rpc('eth_getLogs', [{ fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, address: AIRLOCK, topics: [CREATE_TOPIC] }]);
    const records = logs.flatMap((log) => {
      const asset = `0x${log.data.slice(26, 66)}`.toLowerCase();
      if (!asset.endsWith('ba3') || log.removed) return [];
      return [{
        a: asset,
        q: `0x${log.topics[1].slice(26)}`.toLowerCase(),
        i: `0x${log.data.slice(90, 130)}`.toLowerCase(),
        b: Number.parseInt(log.blockNumber, 16),
        t: log.transactionHash.toLowerCase(),
      }];
    });
    found += records.length;
    results.set(from, { to, records });
    flush();
    done += 1;
    if (done % 200 === 0 || done === total) {
      const rate = done / ((Date.now() - startedAt) / 1000);
      console.log(`${done}/${total} chunks, ${found} Bankr launches, ~${Math.round((total - done) / rate / 60)} min left`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(`done: ${found} Bankr launches between blocks ${start} and ${end}`);
