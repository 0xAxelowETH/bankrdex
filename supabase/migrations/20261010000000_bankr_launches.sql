-- Every Bankr launch on Base, read from Doppler Airlock `Create` events (see
-- scripts/backfill-bankr-launches.mjs). Name / symbol are filled lazily the first time a token
-- is shown, from the token contract itself.
do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_launches (
      token_address text primary key check (token_address ~ '^0x[a-f0-9]{40}$'),
      quote_address text not null check (quote_address ~ '^0x[a-f0-9]{40}$'),
      initializer text not null check (initializer ~ '^0x[a-f0-9]{40}$'),
      block_number bigint not null,
      tx_hash text not null check (tx_hash ~ '^0x[a-f0-9]{64}$'),
      name text,
      symbol text,
      updated_at timestamptz not null default now()
    )
  $ddl$;

  execute 'create index if not exists bankrdex_launches_block_idx on public.bankrdex_launches (block_number desc)';
  execute 'create index if not exists bankrdex_launches_symbol_idx on public.bankrdex_launches (lower(symbol))';
  execute 'alter table public.bankrdex_launches enable row level security';
  execute 'revoke all on table public.bankrdex_launches from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_launches to service_role';
end;
$migration$;
