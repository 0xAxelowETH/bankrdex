do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_notify_state (
      key text primary key check (char_length(key) <= 200),
      value jsonb not null,
      updated_at timestamptz not null default now()
    )
  $ddl$;

  execute 'alter table public.bankrdex_notify_state enable row level security';
  execute 'revoke all on table public.bankrdex_notify_state from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_notify_state to service_role';
end;
$migration$;
