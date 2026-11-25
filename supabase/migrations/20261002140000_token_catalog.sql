do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_token_catalog (
      -- "chain:0x…" (multi-chain catalog); plain addresses are legacy Base rows.
      token_address text primary key check (token_address ~ '^([a-z]+:)?0x[a-f0-9]{40}$'),
      token_data jsonb not null,
      updated_at timestamptz not null default now()
    )
  $ddl$;

  execute 'create index if not exists bankrdex_token_catalog_updated_at_idx on public.bankrdex_token_catalog (updated_at desc)';
  execute 'alter table public.bankrdex_token_catalog enable row level security';
  execute 'revoke all on table public.bankrdex_token_catalog from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_token_catalog to service_role';
end;
$migration$;
