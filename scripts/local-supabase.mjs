// Local, Docker-free stand-in for Supabase: portable PostgreSQL + PostgREST behind a small
// gateway that serves the same `/rest/v1` API and service-role key the app already uses.
//
//   node scripts/local-supabase.mjs init    create the database, roles and keys; run migrations;
//                                            write SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY to .env.local
//   node scripts/local-supabase.mjs serve   run Postgres + PostgREST + gateway (Ctrl+C stops all)
//   node scripts/local-supabase.mjs migrate run every migration again (picks up new ones)
//   node scripts/local-supabase.mjs stop    stop Postgres if it is still running
//   node scripts/local-supabase.mjs psql    open psql on the local database
//
// Binaries live in LOCAL_SUPABASE_DIR (default ../supabase-local):
//   pgsql/      PostgreSQL Windows binaries (EnterpriseDB zip)
//   postgrest/  postgrest.exe
// Everything listens on 127.0.0.1 only.
import { spawn, spawnSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = resolve(process.env.LOCAL_SUPABASE_DIR || join(ROOT, '..', 'supabase-local'));
const BIN = join(HOME, 'pgsql', 'bin');
const DATA = join(HOME, 'data');
const CONFIG = join(HOME, 'config.json');
const exe = (name) => join(BIN, `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const PG_PORT = 54322;
const POSTGREST_PORT = 54323;
const GATEWAY_PORT = 54321;
// PostgREST loads libpq from the Postgres bin folder.
const childEnv = { ...process.env, PATH: `${BIN}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` };

const base64url = (value) => Buffer.from(value).toString('base64url');
function signJwt(payload, secret) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env: childEnv, encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  }
  return result.stdout;
}

function readConfig() {
  if (!existsSync(CONFIG)) throw new Error(`Not initialised: run "node scripts/local-supabase.mjs init" first (${CONFIG}).`);
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

function psql(config, sql, database = 'postgres') {
  return run(exe('psql'), ['-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', database, '-c', sql], {
    env: { ...childEnv, PGPASSWORD: config.postgresPassword },
  });
}

function pgRunning() {
  return spawnSync(exe('pg_ctl'), ['status', '-D', DATA], { env: childEnv }).status === 0;
}

function startPostgres() {
  if (pgRunning()) return;
  // No pipes: on Windows the server inherits them and spawnSync would wait for it to exit.
  const result = spawnSync(exe('pg_ctl'), ['start', '-D', DATA, '-l', join(HOME, 'postgres.log'), '-w', '-o', `-p ${PG_PORT} -c listen_addresses=127.0.0.1`], {
    env: childEnv,
    stdio: 'ignore',
  });
  if (result.status !== 0) throw new Error(`Postgres did not start; see ${join(HOME, 'postgres.log')}.`);
}

function writeEnvLocal(url, key) {
  const file = join(ROOT, '.env.local');
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const [name, value] of [['SUPABASE_URL', url], ['SUPABASE_SERVICE_ROLE_KEY', key]]) {
    const line = `${name}=${value}`;
    text = new RegExp(`^${name}=.*$`, 'm').test(text)
      ? text.replace(new RegExp(`^${name}=.*$`, 'm'), line)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  writeFileSync(file, text);
}

async function init() {
  if (!existsSync(exe('postgres'))) throw new Error(`PostgreSQL binaries not found in ${BIN}.`);
  if (existsSync(CONFIG)) {
    console.log(`Already initialised (${CONFIG}). Delete ${HOME}\\data and config.json to start over.`);
    return;
  }
  mkdirSync(HOME, { recursive: true });
  const config = {
    postgresPassword: randomBytes(18).toString('base64url'),
    authenticatorPassword: randomBytes(18).toString('base64url'),
    jwtSecret: randomBytes(48).toString('base64url'),
  };
  const passwordFile = join(HOME, '.initdb-password');
  writeFileSync(passwordFile, config.postgresPassword);
  try {
    run(exe('initdb'), ['-D', DATA, '-U', 'postgres', '--pwfile', passwordFile, '-A', 'scram-sha-256', '-E', 'UTF8', '--locale=C']);
  } finally {
    writeFileSync(passwordFile, '');
  }
  config.serviceRoleKey = signJwt({ role: 'service_role', iss: 'bankrdex-local', iat: Math.floor(Date.now() / 1000) }, config.jwtSecret);
  config.anonKey = signJwt({ role: 'anon', iss: 'bankrdex-local', iat: Math.floor(Date.now() / 1000) }, config.jwtSecret);
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
  writeFileSync(join(HOME, 'postgrest.conf'), [
    `db-uri = "postgres://authenticator:${config.authenticatorPassword}@127.0.0.1:${PG_PORT}/postgres"`,
    'db-schemas = "public"',
    'db-anon-role = "anon"',
    `jwt-secret = "${config.jwtSecret}"`,
    'server-host = "127.0.0.1"',
    `server-port = ${POSTGREST_PORT}`,
    'db-max-rows = 1000',
    '',
  ].join('\n'));

  startPostgres();
  // The same roles Supabase has; the migrations grant table access to service_role only.
  psql(config, `
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role authenticator login noinherit password '${config.authenticatorPassword}';
    grant anon, authenticated, service_role to authenticator;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to service_role;
  `);
  migrate(config);
  writeEnvLocal(`http://127.0.0.1:${GATEWAY_PORT}`, config.serviceRoleKey);
  console.log(`Initialised in ${HOME}. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY were written to .env.local.`);
  console.log('Next: node scripts/local-supabase.mjs serve');
}

// Runs every migration in order. They are written to be re-runnable (if not exists / or replace),
// so this is also how new migrations reach an existing local database.
function migrate(config = readConfig()) {
  startPostgres();
  const migrations = join(ROOT, 'supabase', 'migrations');
  for (const file of readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) {
    run(exe('psql'), ['-v', 'ON_ERROR_STOP=1', '-q', '-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', 'postgres', '-f', join(migrations, file)], {
      env: { ...childEnv, PGPASSWORD: config.postgresPassword },
    });
    console.log(`migration ${file}`);
  }
  // PostgREST caches the schema; this makes new tables and functions visible without a restart.
  psql(config, "notify pgrst, 'reload schema'");
}

async function serve() {
  readConfig();
  startPostgres();
  console.log(`Postgres on 127.0.0.1:${PG_PORT} (data: ${DATA})`);
  const postgrest = spawn(join(HOME, 'postgrest', 'postgrest.exe'), [join(HOME, 'postgrest.conf')], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  postgrest.stdout.on('data', (chunk) => process.stdout.write(`[postgrest] ${chunk}`));
  postgrest.stderr.on('data', (chunk) => process.stderr.write(`[postgrest] ${chunk}`));

  // Supabase-compatible URL layout: /rest/v1/<table> -> PostgREST /<table>.
  const gateway = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/rest/v1')) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Only /rest/v1 is served locally.' }));
      return;
    }
    const headers = { ...request.headers, host: `127.0.0.1:${POSTGREST_PORT}` };
    delete headers.apikey;
    const upstream = http.request({
      host: '127.0.0.1',
      port: POSTGREST_PORT,
      method: request.method,
      path: `${url.pathname.slice('/rest/v1'.length) || '/'}${url.search}`,
      headers,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on('error', (error) => {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: `PostgREST unavailable: ${error.message}` }));
    });
    request.pipe(upstream);
  });
  gateway.listen(GATEWAY_PORT, '127.0.0.1', () => console.log(`Supabase-compatible REST on http://127.0.0.1:${GATEWAY_PORT}/rest/v1`));

  const shutdown = () => {
    console.log('Stopping…');
    gateway.close();
    postgrest.kill();
    spawnSync(exe('pg_ctl'), ['stop', '-D', DATA, '-m', 'fast'], { env: childEnv, stdio: 'inherit' });
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  postgrest.on('exit', (code) => {
    console.error(`PostgREST exited (${code}).`);
    shutdown();
  });
}

function stop() {
  if (!pgRunning()) {
    console.log('Postgres is not running.');
    return;
  }
  run(exe('pg_ctl'), ['stop', '-D', DATA, '-m', 'fast']);
  console.log('Postgres stopped.');
}

function shell() {
  const config = readConfig();
  spawnSync(exe('psql'), ['-h', '127.0.0.1', '-p', String(PG_PORT), '-U', 'postgres', '-d', 'postgres'], {
    env: { ...childEnv, PGPASSWORD: config.postgresPassword },
    stdio: 'inherit',
  });
}

const command = process.argv[2];
try {
  if (command === 'init') await init();
  else if (command === 'serve') await serve();
  else if (command === 'stop') stop();
  else if (command === 'migrate') migrate();
  else if (command === 'psql') shell();
  else {
    console.log('Usage: node scripts/local-supabase.mjs <init|serve|migrate|stop|psql>');
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
