-- Token logos found for tokens whose launch data has none (src/server/tokenLogos.ts): from the
-- paid DexScreener profile, Bankr's launch record (imageUri) or the token's IPFS metadata.
-- image_url null = looked up, nothing found (rechecked after a day).
-- A single DO block, so SQL runners that accept one statement at a time can run it.
do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_token_logos (
      chain text not null,
      token_address text not null check (token_address ~ '^0x[a-f0-9]{40}$'),
      image_url text,
      source text,
      checked_at timestamptz not null default now(),
      primary key (chain, token_address)
    )
  $ddl$;
  execute 'alter table public.bankrdex_token_logos enable row level security';
  execute 'revoke all on table public.bankrdex_token_logos from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_token_logos to service_role';
  execute $ddl$notify pgrst, 'reload schema'$ddl$;
end;
$migration$;
