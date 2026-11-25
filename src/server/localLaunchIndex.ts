// In-memory index of the backfill file (scripts/backfill-bankr-launches.mjs), used for the launch
// registry when Supabase is not configured. 1.3M launches fit in ~75 MB as packed buffers:
// 20-byte addresses, 32-byte tx hashes, 4-byte block numbers, 1-byte quote index.
import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

export interface LocalLaunch {
  address: string;
  quote: string;
  block: number;
  txHash: string;
}

export interface LocalLaunchIndex {
  count: number;
  scannedTo: number;
  at(index: number): LocalLaunch;
  // Index of the first launch with block >= `block` (records are in block order).
  lowerBound(block: number): number;
  find(address: string): number;
}

const FILE = process.env.BANKR_LAUNCHES_FILE || join(process.cwd(), 'data', 'bankr-launches.ndjson');
let loading: Promise<LocalLaunchIndex | null> | null = null;

const hex = (buffer: Buffer, offset: number, length: number) => `0x${buffer.toString('hex', offset, offset + length)}`;

async function load(): Promise<LocalLaunchIndex | null> {
  if (!existsSync(FILE)) return null;
  const startedAt = Date.now();
  let capacity = 1 << 20;
  let addresses = Buffer.alloc(capacity * 20);
  let txs = Buffer.alloc(capacity * 32);
  let blocks = new Uint32Array(capacity);
  let quotes = new Uint8Array(capacity);
  const quoteTable: string[] = [];
  const quoteIds = new Map<string, number>();
  let count = 0;
  let scannedTo = 0;

  const grow = () => {
    capacity *= 2;
    const nextAddresses = Buffer.alloc(capacity * 20);
    addresses.copy(nextAddresses);
    addresses = nextAddresses;
    const nextTxs = Buffer.alloc(capacity * 32);
    txs.copy(nextTxs);
    txs = nextTxs;
    const nextBlocks = new Uint32Array(capacity);
    nextBlocks.set(blocks);
    blocks = nextBlocks;
    const nextQuotes = new Uint8Array(capacity);
    nextQuotes.set(quotes);
    quotes = nextQuotes;
  };

  const lines = createInterface({ input: createReadStream(FILE, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const record = JSON.parse(line) as { a?: string; q?: string; b?: number; t?: string; scannedTo?: number };
    if (record.scannedTo) {
      scannedTo = Math.max(scannedTo, record.scannedTo);
      continue;
    }
    if (!record.a || !record.q || !record.t || !record.b) continue;
    if (count === capacity) grow();
    addresses.write(record.a.slice(2), count * 20, 'hex');
    txs.write(record.t.slice(2), count * 32, 'hex');
    blocks[count] = record.b;
    let quoteId = quoteIds.get(record.q);
    if (quoteId === undefined && quoteTable.length < 255) {
      quoteId = quoteTable.push(record.q) - 1;
      quoteIds.set(record.q, quoteId);
    }
    quotes[count] = quoteId ?? 0;
    count += 1;
  }
  console.log(`Loaded ${count.toLocaleString('en-US')} Bankr launches from ${FILE} in ${Date.now() - startedAt} ms.`);

  return {
    count,
    scannedTo,
    at(index) {
      return {
        address: hex(addresses, index * 20, 20),
        quote: quoteTable[quotes[index]] ?? '0x4200000000000000000000000000000000000006',
        block: blocks[index],
        txHash: hex(txs, index * 32, 32),
      };
    },
    lowerBound(block) {
      let low = 0;
      let high = count;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (blocks[middle] < block) low = middle + 1;
        else high = middle;
      }
      return low;
    },
    find(address) {
      const needle = Buffer.from(address.slice(2).toLowerCase(), 'hex');
      if (needle.length !== 20) return -1;
      for (let from = 0; ;) {
        const position = addresses.indexOf(needle, from);
        if (position < 0 || position >= count * 20) return -1;
        if (position % 20 === 0) return position / 20;
        from = position + 1;
      }
    },
  };
}

// Loads the backfill file once per server process; null when there is no file.
export function getLocalLaunchIndex(): Promise<LocalLaunchIndex | null> {
  loading ??= load().catch((error: unknown) => {
    console.error('Unable to load the local Bankr launch file:', error);
    loading = null;
    return null;
  });
  return loading;
}
