-- Launch checks for the Bankr launch registry. Doppler's integrator field can be set by anyone, so
-- every registry row is also checked against Bankr's launch setup (src/server/bankrLaunchRules.ts).
-- Rows that fail are kept (so re-imports do not bring them back) but flagged, left out of every
-- listing, and their pools and indexed swaps are removed.
do $migration$
begin
  execute 'alter table public.bankrdex_launches add column if not exists not_bankr boolean not null default false';
  execute 'alter table public.bankrdex_launches add column if not exists check_reason text';
  execute 'alter table public.bankrdex_launches add column if not exists checked_at timestamptz';
  execute 'create index if not exists bankrdex_launches_listed_idx on public.bankrdex_launches (block_number desc) where not not_bankr';
  execute 'create index if not exists bankrdex_launches_unchecked_idx on public.bankrdex_launches (token_address) where checked_at is null';
  execute 'create index if not exists bankrdex_launches_flagged_idx on public.bankrdex_launches (token_address) where not_bankr';

  -- Records one batch of check results; flagged tokens lose their pool map rows and swaps.
  execute $ddl$
    create or replace function public.bankrdex_record_launch_checks(p_tokens text[], p_not_bankr boolean[], p_reasons text[])
    returns integer
    language plpgsql
    set search_path = public
    as $fn$
    declare
      v_flagged text[];
    begin
      update public.bankrdex_launches l
        set not_bankr = c.not_bankr, check_reason = c.reason, checked_at = now()
        from unnest(p_tokens, p_not_bankr, p_reasons) as c(token, not_bankr, reason)
        where l.token_address = c.token;
      select coalesce(array_agg(c.token), '{}') into v_flagged
        from unnest(p_tokens, p_not_bankr) as c(token, not_bankr)
        where c.not_bankr;
      if array_length(v_flagged, 1) > 0 then
        delete from public.bankrdex_swaps where token_address = any (v_flagged);
        delete from public.bankrdex_pool_map where token_address = any (v_flagged);
      end if;
      return coalesce(array_length(v_flagged, 1), 0);
    end;
    $fn$
  $ddl$;
  execute 'revoke all on function public.bankrdex_record_launch_checks(text[], boolean[], text[]) from public, anon, authenticated';
  execute 'grant execute on function public.bankrdex_record_launch_checks(text[], boolean[], text[]) to service_role';
end;
$migration$;
