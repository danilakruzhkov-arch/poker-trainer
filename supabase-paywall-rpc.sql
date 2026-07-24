-- ============================================================================
--  poker-trainer · paywall RPC  (P1a, part 2 — editor-driven split)
--  Run AFTER supabase-paywall-migration.sql. Dashboard -> SQL Editor -> Run.
--  Safe to re-run.
--
--  Why a function instead of client-side writes: publishing a pack has to move
--  hands BETWEEN two tables. Done as separate REST calls there is a window
--  where a hand sits in both (or neither). Inside a function it is one
--  transaction, and the admin check happens server-side where the client
--  cannot skip it (Q2 section 4: never trust the client with pack shape).
-- ============================================================================

-- ---- publish a pack, splitting it by the per-hand `paid` flag -------------
-- The client sends the WHOLE pack (free + paid hands, each optionally marked
-- {"paid":true}); the server decides what is anon-readable. Marker is stripped
-- before storing: pack_locked rows hold clean hands, the client re-marks them
-- when it merges for an admin.
create or replace function public.pack_apply_split(
  p_slug text, p_data jsonb, p_position int, p_paid boolean, p_price int,
  p_force boolean default false
) returns jsonb
  language plpgsql security definer set search_path to 'public'
as $$
declare
  free_arr jsonb := '[]'::jsonb;
  paid_arr jsonb := '[]'::jsonb;   -- [{idx,hand}], staged so the guard below runs BEFORE any delete
  h        jsonb;
  ord      int := 0;
  n_free   int := 0;
  n_paid   int := 0;
  n_total  int := 0;   -- VISIBLE hands, free + paid (hidden ones are drafts)
  n_cur    int := 0;
begin
  if not public.is_admin() then
    raise exception 'pack_apply_split: not an admin' using errcode = '42501';
  end if;
  if p_slug is null or p_data is null or jsonb_typeof(p_data -> 'hands') <> 'array' then
    raise exception 'pack_apply_split: data.hands must be an array' using errcode = '22023';
  end if;

  for h in select value from jsonb_array_elements(p_data -> 'hands') loop
    ord := ord + 1;
    if not coalesce((h ->> 'hidden')::boolean, false) then n_total := n_total + 1; end if;
    if coalesce((h ->> 'paid')::boolean, false) then
      paid_arr := paid_arr || jsonb_build_array(jsonb_build_object('idx', ord, 'hand', h - 'paid'));
      n_paid := n_paid + 1;
    else
      free_arr := free_arr || jsonb_build_array(h);
      if not coalesce((h ->> 'hidden')::boolean, false) then n_free := n_free + 1; end if;
    end if;
  end loop;

  -- Data-loss guard. A client that failed to load the paid half sends a payload
  -- with zero paid hands, which would otherwise delete them for good. Dropping
  -- every paid hand is a legitimate action, so it stays possible — but only
  -- when the caller says so explicitly.
  select count(*) into n_cur from public.pack_locked where slug = p_slug;
  if n_paid = 0 and n_cur > 0 and not coalesce(p_force, false) then
    raise exception 'pack_apply_split: refusing to drop all % paid hand(s) of "%" — publish with force if that is really intended', n_cur, p_slug
      using errcode = '23514';
  end if;

  delete from public.pack_locked where slug = p_slug;
  insert into public.pack_locked (slug, idx, hand)
  select p_slug, (e ->> 'idx')::int, e -> 'hand' from jsonb_array_elements(paid_arr) e;

  insert into public.pack (slug, position, data, paid, free_hands, price_rub, hands_total)
  values (p_slug, coalesce(p_position, 0), jsonb_set(p_data, '{hands}', free_arr),
          coalesce(p_paid, n_paid > 0), n_free, greatest(coalesce(p_price, 0), 0), n_total)
  on conflict (slug) do update set
    position    = excluded.position,
    data        = excluded.data,
    paid        = excluded.paid,
    free_hands  = excluded.free_hands,
    price_rub   = excluded.price_rub,
    hands_total = excluded.hands_total;

  return jsonb_build_object('free', n_free, 'paid', n_paid, 'total', n_total);
end $$;

revoke execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) from anon;
grant  execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) to authenticated;   -- is_admin() is the real gate

-- ---- deferred grants: pay now, sign in later ------------------------------
-- entitlement.user_id references auth.users, so a buyer who has never signed
-- in cannot be granted anything yet. Park the grant on the email; it turns
-- into a real entitlement the moment that account first appears.
create table if not exists public.entitlement_pending (
  email      text        not null,
  pack_slug  text        not null references public.pack(slug) on delete cascade,
  price_rub  int,
  source     text        not null default 'manual',
  note       text,
  created_at timestamptz not null default now(),
  primary key (email, pack_slug)
);

alter table public.entitlement_pending enable row level security;
revoke all on public.entitlement_pending from anon, authenticated;   -- dashboard / service_role only

create or replace function public.claim_pending_for(p_uid uuid, p_email text)
  returns int language plpgsql security definer set search_path to 'public'
as $$
declare n int := 0;
begin
  if p_email is null then return 0; end if;
  insert into public.entitlement (user_id, pack_slug, price_rub, source, note)
  select p_uid, p.pack_slug, p.price_rub, p.source, p.note
  from public.entitlement_pending p
  where lower(p.email) = lower(p_email)
  on conflict (user_id, pack_slug) do nothing;
  get diagnostics n = row_count;
  delete from public.entitlement_pending p where lower(p.email) = lower(p_email);
  return n;
end $$;

revoke execute on function public.claim_pending_for(uuid, text) from anon, authenticated;

-- materialise pending grants at signup (extends the existing profile trigger)
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  perform public.claim_pending_for(new.id, new.email);   -- pay-before-signup grants land here
  return new;
end; $function$;

-- ---- one-call manual fulfilment ------------------------------------------
-- select public.grant_pack('buyer@example.com', 'mtt16k');
-- Grants immediately if that account exists, parks it otherwise.
create or replace function public.grant_pack(p_email text, p_slug text)
  returns text language plpgsql security definer set search_path to 'public'
as $$
declare u uuid; pr int;
begin
  select price_rub into pr from public.pack where slug = p_slug;
  if pr is null then raise exception 'grant_pack: no such pack: %', p_slug; end if;
  select id into u from auth.users where lower(email) = lower(p_email) order by created_at limit 1;
  if u is null then
    insert into public.entitlement_pending (email, pack_slug, price_rub, source, note)
    values (lower(p_email), p_slug, pr, 'manual', 'granted before first sign-in')
    on conflict (email, pack_slug) do nothing;
    return 'pending: ' || p_email || ' -> ' || p_slug || ' (lands on their first sign-in)';
  end if;
  insert into public.entitlement (user_id, pack_slug, price_rub, source, note)
  values (u, p_slug, pr, 'manual', 'granted by hand')
  on conflict (user_id, pack_slug) do nothing;
  return 'granted: ' || p_email || ' -> ' || p_slug;
end $$;

revoke execute on function public.grant_pack(text, text) from anon, authenticated;

-- ---- demo mode: price 0 means any signed-in user can self-unlock ----------
-- Lets real people exercise the whole buy->unlock path on the web build while
-- no payment rail exists. Setting a non-zero price turns this off by itself.
create or replace function public.claim_free_pack(p_slug text)
  returns boolean language plpgsql security definer set search_path to 'public'
as $$
declare u uuid := auth.uid(); pr int; is_paid boolean;
begin
  if u is null then raise exception 'claim_free_pack: sign in required' using errcode = '42501'; end if;
  select price_rub, paid into pr, is_paid from public.pack where slug = p_slug;
  if pr is null then raise exception 'claim_free_pack: no such pack' using errcode = '22023'; end if;
  if not is_paid then return true; end if;                       -- nothing to unlock
  if pr <> 0 then raise exception 'claim_free_pack: pack is not free' using errcode = '42501'; end if;
  insert into public.entitlement (user_id, pack_slug, price_rub, source, note)
  values (u, p_slug, 0, 'free-demo', 'self-claimed while the price is 0')
  on conflict (user_id, pack_slug) do nothing;
  return true;
end $$;

revoke execute on function public.claim_free_pack(text) from anon;
grant  execute on function public.claim_free_pack(text) to authenticated;

-- ---- demo pricing + the grant you asked for -------------------------------
update public.pack set price_rub = 0 where slug in ('ft10k', 'wsopme', 'mtt16k');
select public.grant_pack('hellgaquiet@gmail.com', 'ft10k');
select public.grant_pack('hellgaquiet@gmail.com', 'wsopme');
select public.grant_pack('hellgaquiet@gmail.com', 'mtt16k');

-- ============================================================================
--  VERIFY
-- ============================================================================
select slug, paid, free_hands, hands_total, price_rub from public.pack order by position;
select * from public.entitlement_pending;
select e.pack_slug, u.email from public.entitlement e join auth.users u on u.id = e.user_id order by u.email, e.pack_slug;
