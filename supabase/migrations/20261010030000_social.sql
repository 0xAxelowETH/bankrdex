-- Social layer: wallet-signed profiles (username, avatar, banner), follows, trading theses with
-- likes and comments, plus read functions for feeds, profiles and the trader leaderboard (from
-- the on-chain swap index). Everything is service_role only: the app's API routes verify the
-- signed-in wallet (Sign-In with Ethereum) before any write.
-- A single DO block, so SQL runners that accept one statement at a time can run it.
do $migration$
begin
  execute $ddl$
    create table if not exists public.bankrdex_profiles (
      wallet text primary key check (wallet ~ '^0x[0-9a-f]{40}$'),
      username text not null check (username ~ '^[a-z0-9_]{3,20}$'),
      display_name text check (display_name is null or char_length(display_name) between 1 and 32),
      bio text check (bio is null or char_length(bio) <= 160),
      accent text check (accent is null or accent ~ '^#[0-9a-f]{6}$'),
      x_handle text check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$'),
      farcaster text check (farcaster is null or farcaster ~ '^[a-z0-9][a-z0-9.-]{0,31}$'),
      website text check (website is null or website ~ '^https://[^[:space:]]{3,200}$'),
      avatar_version integer not null default 0,
      banner_version integer not null default 0,
      hidden boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create unique index if not exists bankrdex_profiles_username_idx on public.bankrdex_profiles (username)';

  -- Avatar and banner images, kept out of the profile row so lists never load image bytes.
  execute $ddl$
    create table if not exists public.bankrdex_profile_images (
      wallet text not null references public.bankrdex_profiles (wallet) on delete cascade,
      kind text not null check (kind in ('avatar', 'banner')),
      mime text not null check (mime in ('image/webp', 'image/png', 'image/jpeg')),
      data bytea not null check (octet_length(data) between 16 and 524288),
      updated_at timestamptz not null default now(),
      primary key (wallet, kind)
    )
  $ddl$;

  -- One-time Sign-In with Ethereum nonces (consumed on verify, expire after 10 minutes).
  execute $ddl$
    create table if not exists public.bankrdex_auth_nonces (
      nonce text primary key check (nonce ~ '^[A-Za-z0-9]{16,64}$'),
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists bankrdex_auth_nonces_created_idx on public.bankrdex_auth_nonces (created_at)';

  -- Followers need a profile; any wallet can be followed (traders from the leaderboard included).
  execute $ddl$
    create table if not exists public.bankrdex_follows (
      follower text not null references public.bankrdex_profiles (wallet) on delete cascade,
      followee text not null check (followee ~ '^0x[0-9a-f]{40}$'),
      created_at timestamptz not null default now(),
      primary key (follower, followee),
      check (follower <> followee)
    )
  $ddl$;
  execute 'create index if not exists bankrdex_follows_followee_idx on public.bankrdex_follows (followee, created_at desc)';

  execute $ddl$
    create table if not exists public.bankrdex_theses (
      id uuid primary key default gen_random_uuid(),
      author text not null references public.bankrdex_profiles (wallet) on delete cascade,
      chain text not null default 'base' check (chain ~ '^[a-z]{2,16}$'),
      token_address text not null check (token_address ~ '^0x[0-9a-f]{40}$'),
      token_symbol text not null check (char_length(token_symbol) between 1 and 32),
      token_name text check (token_name is null or char_length(token_name) <= 80),
      stance text not null check (stance in ('bullish', 'bearish')),
      title text not null check (char_length(title) between 3 and 100),
      content text not null check (char_length(content) between 1 and 2000),
      timeframe text not null check (timeframe in ('24h', '3d', '1w', '1m', '3m')),
      entry_price double precision check (entry_price is null or entry_price > 0),
      target_price double precision check (target_price is null or target_price > 0),
      stop_price double precision check (stop_price is null or stop_price > 0),
      price_at_post double precision check (price_at_post is null or price_at_post > 0),
      like_count integer not null default 0,
      comment_count integer not null default 0,
      hidden boolean not null default false,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists bankrdex_theses_created_idx on public.bankrdex_theses (created_at desc) where not hidden';
  execute 'create index if not exists bankrdex_theses_token_idx on public.bankrdex_theses (token_address, created_at desc) where not hidden';
  execute 'create index if not exists bankrdex_theses_author_idx on public.bankrdex_theses (author, created_at desc)';

  execute $ddl$
    create table if not exists public.bankrdex_thesis_likes (
      thesis_id uuid not null references public.bankrdex_theses (id) on delete cascade,
      wallet text not null references public.bankrdex_profiles (wallet) on delete cascade,
      created_at timestamptz not null default now(),
      primary key (thesis_id, wallet)
    )
  $ddl$;
  execute 'create index if not exists bankrdex_thesis_likes_wallet_idx on public.bankrdex_thesis_likes (wallet)';

  execute $ddl$
    create table if not exists public.bankrdex_thesis_comments (
      id uuid primary key default gen_random_uuid(),
      thesis_id uuid not null references public.bankrdex_theses (id) on delete cascade,
      author text not null references public.bankrdex_profiles (wallet) on delete cascade,
      content text not null check (char_length(content) between 1 and 500),
      hidden boolean not null default false,
      created_at timestamptz not null default now()
    )
  $ddl$;
  execute 'create index if not exists bankrdex_thesis_comments_thesis_idx on public.bankrdex_thesis_comments (thesis_id, created_at)';

  execute 'alter table public.bankrdex_profiles enable row level security';
  execute 'alter table public.bankrdex_profile_images enable row level security';
  execute 'alter table public.bankrdex_auth_nonces enable row level security';
  execute 'alter table public.bankrdex_follows enable row level security';
  execute 'alter table public.bankrdex_theses enable row level security';
  execute 'alter table public.bankrdex_thesis_likes enable row level security';
  execute 'alter table public.bankrdex_thesis_comments enable row level security';
  execute $ddl$
    revoke all on table public.bankrdex_profiles, public.bankrdex_profile_images, public.bankrdex_auth_nonces,
      public.bankrdex_follows, public.bankrdex_theses, public.bankrdex_thesis_likes, public.bankrdex_thesis_comments
    from public, anon, authenticated
  $ddl$;
  execute $ddl$
    grant select, insert, update, delete on table public.bankrdex_profiles, public.bankrdex_profile_images,
      public.bankrdex_auth_nonces, public.bankrdex_follows, public.bankrdex_theses, public.bankrdex_thesis_likes,
      public.bankrdex_thesis_comments
    to service_role
  $ddl$;

  -- Public card for a wallet: profile fields, or null when the wallet has no (visible) profile.
  execute $ddl$
    create or replace function public.bankrdex_profile_card(p_wallet text)
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      select jsonb_build_object(
        'wallet', p.wallet, 'username', p.username, 'displayName', p.display_name,
        'avatarVersion', p.avatar_version, 'accent', p.accent
      )
      from public.bankrdex_profiles p
      where p.wallet = lower(p_wallet) and not p.hidden
    $fn$
  $ddl$;

  -- Likes: set or clear the viewer's like and return the new count.
  execute $ddl$
    create or replace function public.bankrdex_set_like(p_thesis uuid, p_wallet text, p_like boolean)
    returns jsonb
    language plpgsql
    set search_path = public
    as $fn$
    declare
      v_count integer;
    begin
      if not exists (select 1 from public.bankrdex_theses where id = p_thesis and not hidden) then
        return null;
      end if;
      if p_like then
        insert into public.bankrdex_thesis_likes (thesis_id, wallet) values (p_thesis, lower(p_wallet)) on conflict do nothing;
      else
        delete from public.bankrdex_thesis_likes where thesis_id = p_thesis and wallet = lower(p_wallet);
      end if;
      select count(*) into v_count from public.bankrdex_thesis_likes where thesis_id = p_thesis;
      update public.bankrdex_theses set like_count = v_count where id = p_thesis;
      return jsonb_build_object('liked', p_like, 'likeCount', v_count);
    end;
    $fn$
  $ddl$;

  execute $ddl$
    create or replace function public.bankrdex_add_comment(p_thesis uuid, p_wallet text, p_content text)
    returns jsonb
    language plpgsql
    set search_path = public
    as $fn$
    declare
      v_comment public.bankrdex_thesis_comments;
    begin
      if not exists (select 1 from public.bankrdex_theses where id = p_thesis and not hidden) then
        return null;
      end if;
      insert into public.bankrdex_thesis_comments (thesis_id, author, content)
      values (p_thesis, lower(p_wallet), p_content)
      returning * into v_comment;
      update public.bankrdex_theses
        set comment_count = (select count(*) from public.bankrdex_thesis_comments where thesis_id = p_thesis and not hidden)
        where id = p_thesis;
      return jsonb_build_object(
        'id', v_comment.id, 'thesisId', v_comment.thesis_id, 'content', v_comment.content,
        'createdAt', v_comment.created_at, 'author', public.bankrdex_profile_card(v_comment.author)
      );
    end;
    $fn$
  $ddl$;

  -- Comment authors and the thesis author may remove a comment.
  execute $ddl$
    create or replace function public.bankrdex_delete_comment(p_comment uuid, p_wallet text)
    returns boolean
    language plpgsql
    set search_path = public
    as $fn$
    declare
      v_thesis uuid;
    begin
      update public.bankrdex_thesis_comments c
        set hidden = true
        where c.id = p_comment and not c.hidden
          and (c.author = lower(p_wallet) or exists (
            select 1 from public.bankrdex_theses t where t.id = c.thesis_id and t.author = lower(p_wallet)))
        returning c.thesis_id into v_thesis;
      if v_thesis is null then
        return false;
      end if;
      update public.bankrdex_theses
        set comment_count = (select count(*) from public.bankrdex_thesis_comments where thesis_id = v_thesis and not hidden)
        where id = v_thesis;
      return true;
    end;
    $fn$
  $ddl$;

  -- Theses for a feed, newest first (or by likes), with author cards, the viewer's likes and the
  -- token's latest indexed price. Filters are optional; p_following limits to followed authors.
  execute $ddl$
    create or replace function public.bankrdex_theses_feed(
      p_viewer text default null,
      p_token text default null,
      p_author text default null,
      p_following boolean default false,
      p_sort text default 'new',
      p_before timestamptz default null,
      p_offset integer default 0,
      p_limit integer default 20,
      p_id uuid default null
    )
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      with picked as (
        select t.*
        from public.bankrdex_theses t
        join public.bankrdex_profiles p on p.wallet = t.author and not p.hidden
        where not t.hidden
          and (p_id is null or t.id = p_id)
          and (p_token is null or t.token_address = lower(p_token))
          and (p_author is null or t.author = lower(p_author))
          and (not p_following or t.author in (select followee from public.bankrdex_follows where follower = lower(p_viewer)))
          and (p_before is null or t.created_at < p_before)
          and (p_sort <> 'top' or t.created_at > now() - interval '30 days')
        order by
          case when p_sort = 'top' then t.like_count end desc nulls last,
          t.created_at desc
        offset greatest(p_offset, 0)
        limit least(greatest(p_limit, 1), 50)
      )
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'chain', t.chain, 'tokenAddress', t.token_address, 'tokenSymbol', t.token_symbol,
        'tokenName', t.token_name, 'stance', t.stance, 'title', t.title, 'content', t.content,
        'timeframe', t.timeframe, 'entryPrice', t.entry_price, 'targetPrice', t.target_price,
        'stopPrice', t.stop_price, 'priceAtPost', t.price_at_post, 'likeCount', t.like_count,
        'commentCount', t.comment_count, 'createdAt', t.created_at,
        'author', public.bankrdex_profile_card(t.author),
        'liked', p_viewer is not null and exists (
          select 1 from public.bankrdex_thesis_likes l where l.thesis_id = t.id and l.wallet = lower(p_viewer)),
        'priceNow', (
          select s.price_usd from public.bankrdex_swaps s
          where s.token_address = t.token_address and s.price_usd is not null
          order by s.ts desc limit 1)
      ) order by case when p_sort = 'top' then t.like_count end desc nulls last, t.created_at desc), '[]'::jsonb)
      from picked t
    $fn$
  $ddl$;

  execute $ddl$
    create or replace function public.bankrdex_thesis_comments_list(p_thesis uuid, p_limit integer default 100)
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'thesisId', c.thesis_id, 'content', c.content, 'createdAt', c.created_at,
        'author', public.bankrdex_profile_card(c.author)
      ) order by c.created_at), '[]'::jsonb)
      from (
        select c.* from public.bankrdex_thesis_comments c
        join public.bankrdex_profiles p on p.wallet = c.author and not p.hidden
        where c.thesis_id = p_thesis and not c.hidden
        order by c.created_at
        limit least(greatest(p_limit, 1), 200)
      ) c
    $fn$
  $ddl$;

  -- Per-wallet trading results from the swap index over a window: volume, trade counts and an
  -- estimated PnL on positions opened inside the window (sells beyond what was bought in the
  -- window are ignored; what is still held is valued at the token's latest price).
  execute $ddl$
    create or replace function public.bankrdex_trader_results(p_hours integer, p_wallets text[] default null)
    returns table (
      trader text, volume_usd double precision, trades bigint, buys bigint, sells bigint, tokens bigint,
      wins bigint, pnl_usd double precision, best_token text, best_token_pnl double precision, last_trade_at timestamptz
    )
    language sql
    stable
    set search_path = public
    as $fn$
      with s as (
        select sw.trader, sw.token_address,
          sum(case when sw.is_buy then sw.token_amount else 0 end) as bought,
          sum(case when sw.is_buy then 0 else sw.token_amount end) as sold,
          sum(case when sw.is_buy then coalesce(sw.volume_usd, 0) else 0 end) as buy_usd,
          sum(case when sw.is_buy then 0 else coalesce(sw.volume_usd, 0) end) as sell_usd,
          count(*) as trades,
          count(*) filter (where sw.is_buy) as buys,
          count(*) filter (where not sw.is_buy) as sells,
          max(sw.ts) as last_ts
        from public.bankrdex_swaps sw
        where sw.ts > now() - make_interval(hours => least(greatest(p_hours, 1), 336))
          and sw.trader is not null
          and (p_wallets is null or sw.trader = any (p_wallets))
        group by sw.trader, sw.token_address
      ),
      px as (
        select distinct on (sw.token_address) sw.token_address, sw.price_usd
        from public.bankrdex_swaps sw
        where sw.token_address in (select distinct token_address from s) and sw.price_usd is not null
        order by sw.token_address, sw.ts desc
      ),
      per_token as (
        select s.*,
          (case when s.sold > s.bought and s.sold > 0 then s.sell_usd * s.bought / s.sold else s.sell_usd end)
            + greatest(s.bought - s.sold, 0) * coalesce(px.price_usd, 0)
            - s.buy_usd as pnl
        from s left join px using (token_address)
      )
      select pt.trader,
        sum(pt.buy_usd + pt.sell_usd) as volume_usd,
        sum(pt.trades)::bigint as trades,
        sum(pt.buys)::bigint as buys,
        sum(pt.sells)::bigint as sells,
        count(*) as tokens,
        count(*) filter (where pt.pnl > 0) as wins,
        sum(pt.pnl) as pnl_usd,
        (array_agg(pt.token_address order by pt.pnl desc))[1] as best_token,
        max(pt.pnl) as best_token_pnl,
        max(pt.last_ts) as last_trade_at
      from per_token pt
      group by pt.trader
    $fn$
  $ddl$;

  execute $ddl$
    create or replace function public.bankrdex_leaderboard(p_hours integer default 24, p_sort text default 'pnl', p_limit integer default 50)
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      select coalesce(jsonb_agg(jsonb_build_object(
        'wallet', r.trader, 'volumeUsd', r.volume_usd, 'trades', r.trades, 'buys', r.buys, 'sells', r.sells,
        'tokens', r.tokens, 'wins', r.wins, 'pnlUsd', r.pnl_usd, 'bestToken', r.best_token,
        'bestTokenSymbol', (select l.symbol from public.bankrdex_launches l where l.token_address = r.best_token),
        'bestTokenPnl', r.best_token_pnl, 'lastTradeAt', r.last_trade_at,
        'profile', public.bankrdex_profile_card(r.trader),
        'followers', (select count(*) from public.bankrdex_follows f where f.followee = r.trader)
      ) order by r.rank_value desc), '[]'::jsonb)
      from (
        select x.*, case when p_sort = 'volume' then x.volume_usd else x.pnl_usd end as rank_value
        from public.bankrdex_trader_results(p_hours) x
        where x.volume_usd >= 10
        order by rank_value desc nulls last
        limit least(greatest(p_limit, 1), 100)
      ) r
    $fn$
  $ddl$;

  -- Latest trades from a set of wallets (followed traders) or from every wallet with a profile.
  execute $ddl$
    create or replace function public.bankrdex_social_trades(p_wallets text[] default null, p_limit integer default 50, p_before timestamptz default null)
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      select coalesce(jsonb_agg(jsonb_build_object(
        'txHash', s.tx_hash, 'trader', s.trader, 'tokenAddress', s.token_address,
        'tokenSymbol', l.symbol, 'tokenName', l.name, 'isBuy', s.is_buy, 'tokenAmount', s.token_amount,
        'priceUsd', s.price_usd, 'volumeUsd', s.volume_usd, 'ts', s.ts,
        'profile', public.bankrdex_profile_card(s.trader)
      ) order by s.ts desc, s.log_index desc), '[]'::jsonb)
      from (
        select sw.* from public.bankrdex_swaps sw
        where sw.trader is not null
          and (case when p_wallets is null
                 then sw.trader in (select wallet from public.bankrdex_profiles where not hidden)
                 else sw.trader = any (p_wallets) end)
          and (p_before is null or sw.ts < p_before)
        order by sw.ts desc, sw.log_index desc
        limit least(greatest(p_limit, 1), 100)
      ) s
      left join public.bankrdex_launches l on l.token_address = s.token_address
    $fn$
  $ddl$;

  -- Everything a profile page shows besides the theses list.
  execute $ddl$
    create or replace function public.bankrdex_wallet_summary(p_wallet text, p_viewer text default null)
    returns jsonb
    language sql
    stable
    set search_path = public
    as $fn$
      select jsonb_build_object(
        'followers', (select count(*) from public.bankrdex_follows where followee = lower(p_wallet)),
        'following', (select count(*) from public.bankrdex_follows where follower = lower(p_wallet)),
        'theses', (select count(*) from public.bankrdex_theses where author = lower(p_wallet) and not hidden),
        'likesReceived', (select coalesce(sum(like_count), 0) from public.bankrdex_theses where author = lower(p_wallet) and not hidden),
        'isFollowing', p_viewer is not null and exists (
          select 1 from public.bankrdex_follows where follower = lower(p_viewer) and followee = lower(p_wallet)),
        'stats24h', (select to_jsonb(r) from public.bankrdex_trader_results(24, array[lower(p_wallet)]) r),
        'stats7d', (select to_jsonb(r) from public.bankrdex_trader_results(168, array[lower(p_wallet)]) r)
      )
    $fn$
  $ddl$;

  execute 'revoke all on function public.bankrdex_profile_card(text) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_set_like(uuid, text, boolean) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_add_comment(uuid, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_delete_comment(uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_theses_feed(text, text, text, boolean, text, timestamptz, integer, integer, uuid) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_thesis_comments_list(uuid, integer) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_trader_results(integer, text[]) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_leaderboard(integer, text, integer) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_social_trades(text[], integer, timestamptz) from public, anon, authenticated';
  execute 'revoke all on function public.bankrdex_wallet_summary(text, text) from public, anon, authenticated';
  execute 'grant execute on function public.bankrdex_profile_card(text) to service_role';
  execute 'grant execute on function public.bankrdex_set_like(uuid, text, boolean) to service_role';
  execute 'grant execute on function public.bankrdex_add_comment(uuid, text, text) to service_role';
  execute 'grant execute on function public.bankrdex_delete_comment(uuid, text) to service_role';
  execute 'grant execute on function public.bankrdex_theses_feed(text, text, text, boolean, text, timestamptz, integer, integer, uuid) to service_role';
  execute 'grant execute on function public.bankrdex_thesis_comments_list(uuid, integer) to service_role';
  execute 'grant execute on function public.bankrdex_trader_results(integer, text[]) to service_role';
  execute 'grant execute on function public.bankrdex_leaderboard(integer, text, integer) to service_role';
  execute 'grant execute on function public.bankrdex_social_trades(text[], integer, timestamptz) to service_role';
  execute 'grant execute on function public.bankrdex_wallet_summary(text, text) to service_role';
end;
$migration$;
