-- Anonymous visitor statistics: one row per browser (random ID kept in its local storage),
-- one row per browser per active day, plus functions to record a heartbeat and read totals.
-- A single DO block, so SQL runners that accept one statement at a time can run it.
do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_visitors (
      visitor_id uuid primary key,
      wallet text check (wallet is null or wallet ~ '^0x[0-9a-f]{40}$'),
      first_seen timestamptz not null default now(),
      last_seen timestamptz not null default now(),
      heartbeats integer not null default 1
    )
  $ddl$;
  execute 'create index if not exists bankrdex_visitors_last_seen_idx on public.bankrdex_visitors (last_seen desc)';
  execute 'create index if not exists bankrdex_visitors_wallet_idx on public.bankrdex_visitors (wallet) where wallet is not null';

  execute $ddl$
    create table if not exists public.bankrdex_visitor_days (
      visitor_id uuid not null,
      day date not null,
      primary key (day, visitor_id)
    )
  $ddl$;

  execute 'alter table public.bankrdex_visitors enable row level security';
  execute 'alter table public.bankrdex_visitor_days enable row level security';
  execute 'revoke all on table public.bankrdex_visitors, public.bankrdex_visitor_days from public, anon, authenticated';
  execute 'grant select, insert, update, delete on table public.bankrdex_visitors, public.bankrdex_visitor_days to service_role';

  -- Records one heartbeat. A wallet, once seen, stays linked to the browser.
  execute $ddl$
    create or replace function public.bankrdex_touch_visitor(p_visitor_id uuid, p_wallet text default null)
    returns void
    language sql
    security invoker
    set search_path = public
    as $fn$
      insert into public.bankrdex_visitors as v (visitor_id, wallet)
      values (p_visitor_id, lower(p_wallet))
      on conflict (visitor_id) do update
        set last_seen = now(),
            heartbeats = v.heartbeats + 1,
            wallet = coalesce(lower(p_wallet), v.wallet);
      insert into public.bankrdex_visitor_days (visitor_id, day)
      values (p_visitor_id, (now() at time zone 'utc')::date)
      on conflict do nothing;
    $fn$
  $ddl$;

  -- Totals for the admin dashboard. "People" merges browsers that connected the same wallet.
  execute $ddl$
    create or replace function public.bankrdex_visitor_stats(p_days integer default 14)
    returns jsonb
    language sql
    stable
    security invoker
    set search_path = public
    as $fn$
      with v as (
        select visitor_id, first_seen, last_seen, coalesce(wallet, visitor_id::text) as person, wallet
        from public.bankrdex_visitors
      )
      select jsonb_build_object(
        'onlineNow', (select count(distinct person) from v where last_seen > now() - interval '2 minutes'),
        'today', (select count(distinct person) from v where last_seen >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
        'last7d', (select count(distinct person) from v where last_seen > now() - interval '7 days'),
        'last30d', (select count(distinct person) from v where last_seen > now() - interval '30 days'),
        'allTime', (select count(distinct person) from v),
        'newToday', (select count(*) from v where first_seen >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
        'walletsToday', (select count(distinct wallet) from v where wallet is not null and last_seen >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
        'walletsAllTime', (select count(distinct wallet) from v where wallet is not null),
        'daily', coalesce((
          select jsonb_agg(jsonb_build_object('day', d.day, 'visitors', d.visitors, 'new', d.new_visitors) order by d.day)
          from (
            select days.day,
                   count(distinct coalesce(bv.wallet, vd.visitor_id::text)) as visitors,
                   count(*) filter (where (bv.first_seen at time zone 'utc')::date = days.day) as new_visitors
            from public.bankrdex_visitor_days vd
            join public.bankrdex_visitors bv using (visitor_id)
            join (
              select generate_series(
                (now() at time zone 'utc')::date - (greatest(p_days, 1) - 1),
                (now() at time zone 'utc')::date,
                interval '1 day'
              )::date as day
            ) days on days.day = vd.day
            group by days.day
          ) d
        ), '[]'::jsonb)
      );
    $fn$
  $ddl$;

  execute 'revoke all on function public.bankrdex_touch_visitor(uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_visitor_stats(integer) from public, anon, authenticated';
  execute 'grant execute on function public.bankrdex_touch_visitor(uuid, text) to service_role';
  execute 'grant execute on function public.bankrdex_visitor_stats(integer) to service_role';
end;
$migration$;
