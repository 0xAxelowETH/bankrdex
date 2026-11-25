// One command for the local stack: `npm run local`
//   [db]       local Supabase (scripts/local-supabase.mjs serve), when it is set up
//   [web]      Next.js dev server on http://localhost:3000
//   [indexer]  on-chain index (scripts/indexer.mjs), restarted automatically when it stops
// Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const children = new Set();
let stopping = false;
const COLORS = { db: 36, web: 32, indexer: 35, local: 33 };
const log = (name, line) => process.stdout.write(`\x1b[${COLORS[name] ?? 37}m[${name}]\x1b[0m ${line}\n`);

function run(name, args, { restart = false } = {}) {
  let attempts = 0;
  const start = () => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const startedAt = Date.now();
    for (const stream of [child.stdout, child.stderr]) {
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        lines.filter((line) => line.trim()).forEach((line) => log(name, line));
      });
    }
    child.on('exit', (code) => {
      children.delete(child);
      if (stopping) return;
      log(name, `exited with code ${code}`);
      if (!restart) return;
      // A run that lasted a while resets the backoff; quick crashes back off up to a minute.
      attempts = Date.now() - startedAt > 120_000 ? 1 : attempts + 1;
      const delay = Math.min(60_000, 2_000 * 2 ** (attempts - 1));
      log(name, `restarting in ${Math.round(delay / 1000)}s`);
      setTimeout(() => { if (!stopping) start(); }, delay);
    });
  };
  start();
}

function supabaseUrl() {
  try {
    const env = readFileSync(join(ROOT, '.env.local'), 'utf8');
    return env.match(/^SUPABASE_URL=["']?([^"'\r\n]+)/m)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return false;
}

function stopAll() {
  if (stopping) return;
  stopping = true;
  log('local', 'stopping…');
  for (const child of children) {
    // Windows: end the whole process tree (Next.js and Postgres start their own children).
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 1_500);
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);

const dbUrl = supabaseUrl();
const localDb = dbUrl && /127\.0\.0\.1|localhost/.test(dbUrl) && existsSync(join(ROOT, 'scripts', 'local-supabase.mjs'));
if (localDb) {
  run('db', ['scripts/local-supabase.mjs', 'serve']);
  log('local', `waiting for Supabase at ${dbUrl}…`);
  if (!await waitFor(`${dbUrl}/rest/v1/`, 90_000)) log('local', 'Supabase did not answer in 90s; starting the rest anyway');
} else {
  log('local', dbUrl ? `using Supabase at ${dbUrl}` : 'no SUPABASE_URL in .env.local: the index and social features stay off');
}

run('web', [join('node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '0.0.0.0', '--port', '3000']);
if (dbUrl) run('indexer', ['scripts/indexer.mjs'], { restart: true });
log('local', 'BankrDex: http://localhost:3000  (Ctrl+C to stop)');
