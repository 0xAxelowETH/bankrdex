-- On-chain market indexer for Bankr pools on Base (scripts/indexer.mjs).
--   bankrdex_pool_map   Uniswap V4 pool id -> Bankr token (two candidate ids per launch; see the indexer)
--   bankrdex_swaps      every swap in a Bankr pool (kept 14 days)
--   bankrdex_prices     USD price of quote assets (WETH, BNKR), read from on-chain pools
-- plus read functions used by the API routes. Everything is service_role only.
do $migration$
declare
  v_table text;
begin
  execute $ddl$
    create table if not exists public.bankrdex_pool_map (
      pool_id text primary key check (pool_id ~ '^0x[a-f0-9]{64}$'),
      token_address text not null check (token_address ~ '^0x[a-f0-9]{40}$'),
      quote_address text not null check (quote_address ~ '^0x[a-f0-9]{40}$'),
      token_is_currency0 boolean not null,
      hooks text
    )
  $ddl$;
  execute 'alter table public.bankrdex_pool_map add column if not exists hooks text';
  execute 'create index if not exists bankrdex_pool_map_token_idx on public.bankrdex_pool_map (token_address)';

  execute $ddl$
    create table if not exists public.bankrdex_swaps (
      block_number bigint not null,
      log_index integer not null,
      pool_id text not null,
      token_address text not null,
      tx_hash text not null,
      trader text,
      is_buy boolean not null,
      token_amount double precision not null,
      quote_amount double precision not null,
      price_quote double precision not null,
      price_usd double precision,
      volume_usd double precision,
      ts timestamptz not null,
      primary key (block_number, log_index)
    )
  $ddl$;
  execute 'create index if not exists bankrdex_swaps_token_ts_idx on public.bankrdex_swaps (token_address, ts desc)';
  execute 'create index if not exists bankrdex_swaps_ts_idx on public.bankrdex_swaps (ts desc)';
  execute 'create index if not exists bankrdex_swaps_trader_idx on public.bankrdex_swaps (trader, ts desc)';

  execute $ddl$
    create table if not exists public.bankrdex_prices (
      asset text primary key,
      usd double precision not null,
      updated_at timestamptz not null default now()
    )
  $ddl$;

  -- Market stats per token over the indexed swaps.
  execute $fn$
    create or replace function public.bankrdex_token_stats(addresses text[])
    returns table (
      token_address text, price_usd double precision, price_quote double precision,
      change_5m double precision, change_1h double precision, change_24h double precision,
      volume_5m double precision, volume_1h double precision, volume_24h double precision,
      buys_5m integer, sells_5m integer, buys_1h integer, sells_1h integer, buys_24h integer, sells_24h integer,
      traders_24h integer, last_trade_at timestamptz, first_trade_at timestamptz
    )
    language sql stable as $body$
      with recent as (
        select * from public.bankrdex_swaps s
        where s.token_address = any(addresses) and s.ts > now() - interval '24 hours'
      ),
      last_price as (
        select distinct on (s.token_address) s.token_address, s.price_usd, s.price_quote, s.ts
        from public.bankrdex_swaps s where s.token_address = any(addresses)
        order by s.token_address, s.block_number desc, s.log_index desc
      ),
      price_at as (
        select a.token_address,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.ts <= now() - interval '5 minutes' order by s.ts desc limit 1) as p5m,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.ts <= now() - interval '1 hour' order by s.ts desc limit 1) as p1h,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.ts <= now() - interval '24 hours' order by s.ts desc limit 1) as p24h,
          (select min(s.ts) from public.bankrdex_swaps s where s.token_address = a.token_address) as first_ts
        from (select unnest(addresses) as token_address) a
      )
      select
        l.token_address, l.price_usd, l.price_quote,
        case when p.p5m > 0 then (l.price_usd / p.p5m - 1) * 100 end,
        case when p.p1h > 0 then (l.price_usd / p.p1h - 1) * 100 end,
        case when p.p24h > 0 then (l.price_usd / p.p24h - 1) * 100 end,
        coalesce(sum(r.volume_usd) filter (where r.ts > now() - interval '5 minutes'), 0),
        coalesce(sum(r.volume_usd) filter (where r.ts > now() - interval '1 hour'), 0),
        coalesce(sum(r.volume_usd), 0),
        (count(*) filter (where r.is_buy and r.ts > now() - interval '5 minutes'))::int,
        (count(*) filter (where not r.is_buy and r.ts > now() - interval '5 minutes'))::int,
        (count(*) filter (where r.is_buy and r.ts > now() - interval '1 hour'))::int,
        (count(*) filter (where not r.is_buy and r.ts > now() - interval '1 hour'))::int,
        (count(*) filter (where r.is_buy))::int,
        (count(*) filter (where not r.is_buy))::int,
        (count(distinct r.trader))::int,
        l.ts, p.first_ts
      from last_price l
      join price_at p on p.token_address = l.token_address
      left join recent r on r.token_address = l.token_address
      group by l.token_address, l.price_usd, l.price_quote, l.ts, p.p5m, p.p1h, p.p24h, p.first_ts
    $body$
  $fn$;

  -- OHLCV candles (USD price; volume in USD) for one token.
  execute $fn$
    create or replace function public.bankrdex_ohlcv(p_token text, p_bucket_seconds integer, p_limit integer)
    returns table (bucket bigint, open double precision, high double precision, low double precision, close double precision, volume double precision)
    language sql stable as $body$
      select * from (
        select
          (floor(extract(epoch from s.ts) / p_bucket_seconds) * p_bucket_seconds)::bigint as bucket,
          (array_agg(s.price_usd order by s.block_number, s.log_index))[1],
          max(s.price_usd), min(s.price_usd),
          (array_agg(s.price_usd order by s.block_number desc, s.log_index desc))[1],
          coalesce(sum(s.volume_usd), 0)
        from public.bankrdex_swaps s
        where s.token_address = p_token and s.price_usd is not null
          and s.ts > now() - make_interval(secs => p_bucket_seconds::double precision * greatest(p_limit, 1))
        group by 1
      ) c order by c.bucket desc limit greatest(p_limit, 1)
    $body$
  $fn$;

  -- Launch-time risk signals from the indexed swaps: snipers (bought in the first 2 blocks after
  -- the first trade), bundled buys (several buys of the token in one transaction), traders.
  execute $fn$
    create or replace function public.bankrdex_token_risk(p_token text)
    returns table (first_block bigint, sniper_wallets text[], bundled_txs integer, buyers integer, sellers integer)
    language sql stable as $body$
      with first_trade as (select min(block_number) as b from public.bankrdex_swaps where token_address = p_token)
      select
        f.b,
        coalesce(array_agg(distinct s.trader) filter (where s.is_buy and s.block_number <= f.b + 1 and s.trader is not null), '{}'),
        (select count(*)::int from (select tx_hash from public.bankrdex_swaps where token_address = p_token and is_buy group by tx_hash having count(*) > 1) bundles),
        (count(distinct s.trader) filter (where s.is_buy))::int,
        (count(distinct s.trader) filter (where not s.is_buy))::int
      from first_trade f
      left join public.bankrdex_swaps s on s.token_address = p_token
      group by f.b
    $body$
  $fn$;

  -- Tokens with the most activity in a window, for the Pulse view and the market catalog.
  execute 'drop function if exists public.bankrdex_active_tokens(integer, integer)';
  execute $fn$
    create function public.bankrdex_active_tokens(p_minutes integer, p_limit integer)
    returns table (token_address text, trades integer, buys integer, volume_usd double precision, last_trade_at timestamptz, pool_id text)
    language sql stable as $body$
      select s.token_address, count(*)::int, (count(*) filter (where s.is_buy))::int, coalesce(sum(s.volume_usd), 0), max(s.ts), max(s.pool_id)
      from public.bankrdex_swaps s
      where s.ts > now() - make_interval(mins => p_minutes)
      group by s.token_address
      order by count(*) desc
      limit greatest(p_limit, 1)
    $body$
  $fn$;

  foreach v_table in array array['bankrdex_pool_map', 'bankrdex_swaps', 'bankrdex_prices'] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select, insert, update, delete on table public.%I to service_role', v_table);
  end loop;
  execute 'revoke all on function public.bankrdex_token_stats(text[]) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_ohlcv(text, integer, integer) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_token_risk(text) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_active_tokens(integer, integer) from public, anon, authenticated';
  execute 'grant execute on function public.bankrdex_token_stats(text[]) to service_role';
  execute 'grant execute on function public.bankrdex_ohlcv(text, integer, integer) to service_role';
  execute 'grant execute on function public.bankrdex_token_risk(text) to service_role';
  execute 'grant execute on function public.bankrdex_active_tokens(integer, integer) to service_role';
end;
$migration$;
