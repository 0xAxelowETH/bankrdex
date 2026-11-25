-- Dust swaps (for example 1 wei of token for 2 wei of WETH) have no usable price: integer
-- rounding makes it thousands of times off and it spiked the charts. Their volume stays; the price
-- in USD is cleared so OHLCV, last price and stats skip them. The indexer no longer prices such swaps.
-- A single DO block, so SQL runners that accept one statement at a time can run it.
do $migration$
begin
  execute $ddl$
    update public.bankrdex_swaps
    set price_usd = null
    where (token_amount < 1e-12 or quote_amount < 1e-12)
      and price_usd is not null
  $ddl$;

  -- Prices (last, and 5m / 1h / 24h ago) come from the latest swap that has a USD price, so an
  -- unpriced dust swap never blanks the price or the changes. last_trade_at still counts every swap.
  execute $ddl$
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
        select distinct on (s.token_address) s.token_address, s.price_usd, s.price_quote
        from public.bankrdex_swaps s where s.token_address = any(addresses) and s.price_usd is not null
        order by s.token_address, s.block_number desc, s.log_index desc
      ),
      price_at as (
        select a.token_address,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.price_usd is not null and s.ts <= now() - interval '5 minutes' order by s.ts desc limit 1) as p5m,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.price_usd is not null and s.ts <= now() - interval '1 hour' order by s.ts desc limit 1) as p1h,
          (select s.price_usd from public.bankrdex_swaps s where s.token_address = a.token_address and s.price_usd is not null and s.ts <= now() - interval '24 hours' order by s.ts desc limit 1) as p24h,
          (select max(s.ts) from public.bankrdex_swaps s where s.token_address = a.token_address) as last_ts,
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
        p.last_ts, p.first_ts
      from last_price l
      join price_at p on p.token_address = l.token_address
      left join recent r on r.token_address = l.token_address
      group by l.token_address, l.price_usd, l.price_quote, p.last_ts, p.p5m, p.p1h, p.p24h, p.first_ts
    $body$
  $ddl$;
  execute 'revoke all on function public.bankrdex_token_stats(text[]) from public, anon, authenticated';
  execute 'grant execute on function public.bankrdex_token_stats(text[]) to service_role';
end;
$migration$;
