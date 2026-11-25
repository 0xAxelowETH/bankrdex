-- Whether a listed token really is a Bankr launch (see src/server/bankrVerification.ts), keyed by
-- `chain:address`. Positive verdicts come from Bankr's records, the on-chain launch registry or the
-- Doppler integrator; negative ones from the integrator or the missing `ba3` vanity suffix.
do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_token_verification (
      token_key text primary key check (token_key ~ '^[a-z]{2,16}:0x[0-9a-f]{40}$'),
      is_bankr boolean not null,
      method text not null check (method in ('official', 'bankr-api', 'registry', 'onchain', 'suffix')),
      checked_at timestamptz not null default now()
    )
  $ddl$;
  execute 'alter table public.bankrdex_token_verification enable row level security';
  execute 'revoke all on table public.bankrdex_token_verification from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_token_verification to service_role';
end;
$migration$;
