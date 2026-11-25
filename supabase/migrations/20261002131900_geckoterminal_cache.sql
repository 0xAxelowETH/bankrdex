do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_gecko_cache (
      cache_key text primary key check (char_length(cache_key) <= 4096),
      status_code smallint not null check (status_code between 200 and 299),
      response_body text not null,
      expires_at timestamptz not null,
      cached_at timestamptz not null default now()
    )
  $ddl$;

  execute $ddl$
    create index if not exists bankrdex_gecko_cache_expires_at_idx
      on public.bankrdex_gecko_cache (expires_at)
  $ddl$;

  execute 'alter table public.bankrdex_gecko_cache enable row level security';
  execute 'revoke all on table public.bankrdex_gecko_cache from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_gecko_cache to service_role';
end;
$migration$;
