-- ============================================================================
--  poker-trainer · free/paid split  (P1a — entitlements + locked hands)
--  Run AFTER supabase-attempts-migration.sql, in the same project.
--  Supabase dashboard -> SQL Editor -> New query -> paste all -> Run.
--  Safe to re-run: the test fixture at the bottom only fires on packs that
--  have no locked hands yet, so a second run does NOT lock another hand.
--
--  Model (three pack formats, per WINDOW-3 P1a):
--    paid = false                 -> whole pack is free
--    paid = true,  free_hands = 0 -> whole pack is paid
--    paid = true,  free_hands = N -> first N VISIBLE hands free, rest paid
--  Free hands stay in pack.data (anon-readable, ships in packs.json).
--  Paid hands live in pack_locked and are NEVER anon-readable, so the
--  packs.json build script (which uses the anon key) cannot leak them.
-- ============================================================================

-- ---- admin identity, single source of truth ------------------------------
-- Replaces the email array copy-pasted into every pack policy. When P1b adds
-- a real roles table, only this function changes.
create or replace function public.is_admin() returns boolean
  language sql stable
  set search_path to 'public'
as $$
  select coalesce(auth.jwt() ->> 'email', '') = any (array[
    'danilakruzhkov@gmail.com',
    'daanilka@gmail.com'
  ]);
$$;

-- ---- paywall settings on the pack row ------------------------------------
-- These are COLUMNS, not keys inside data: the editor rewrites data wholesale
-- on publish, so paywall config must live where the client cannot set it.
alter table public.pack
  add column if not exists paid        boolean not null default false,
  add column if not exists free_hands  int     not null default 0,
  add column if not exists price_rub   int     not null default 49,
  add column if not exists hands_total int     not null default 0;

comment on column public.pack.paid        is 'true -> pack has locked hands behind an entitlement';
comment on column public.pack.free_hands  is 'how many VISIBLE hands play for free before the paywall (0 = whole pack paid)';
comment on column public.pack.price_rub   is 'one-off unlock price, RUB';
comment on column public.pack.hands_total is 'visible hands total (free + locked) — lets the client show "N locked" without reading them';

do $$ begin
  alter table public.pack add constraint pack_free_hands_nonneg check (free_hands >= 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.pack add constraint pack_price_nonneg check (price_rub >= 0);
exception when duplicate_object then null; end $$;

-- ---- entitlements --------------------------------------------------------
-- One row per (user, pack). No client writes at all: rows are inserted by
-- hand from the dashboard now, by an Edge Function with service_role once
-- payments land (Q2 layer 2). expires_at stays null for one-off unlocks and
-- carries subscriptions later without a schema change.
-- Created BEFORE pack_locked: its read policy references this table.
create table if not exists public.entitlement (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  pack_slug  text        not null references public.pack(slug) on delete cascade,
  kind       text        not null default 'pack',
  price_rub  int,
  source     text        not null default 'manual',  -- manual | stars | yookassa | ...
  note       text,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  primary key (user_id, pack_slug)
);

alter table public.entitlement enable row level security;

revoke all on public.entitlement from anon;
grant select on public.entitlement to authenticated;   -- select only: no client writes

drop policy if exists ent_own_read on public.entitlement;
create policy ent_own_read on public.entitlement
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists ent_admin_read on public.entitlement;
create policy ent_admin_read on public.entitlement
  for select to authenticated using (public.is_admin());

create index if not exists entitlement_pack_idx on public.entitlement (pack_slug);

-- ---- locked (paid) hands -------------------------------------------------
-- idx = 1-based ordinal the hand had in the original data.hands array.
-- The client rebuilds the full pack by splicing locked hands back in at
-- (idx - 1), ascending — which restores the original order exactly, even
-- when hidden hands sit between them.
create table if not exists public.pack_locked (
  slug       text        not null references public.pack(slug) on delete cascade,
  idx        int         not null,
  hand       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (slug, idx)
);

alter table public.pack_locked enable row level security;

revoke all on public.pack_locked from anon;
grant select, insert, update, delete on public.pack_locked to authenticated;

-- buyers read only what they own; anon has no policy at all -> sees nothing
drop policy if exists packlocked_owner_read on public.pack_locked;
create policy packlocked_owner_read on public.pack_locked
  for select to authenticated using (
    exists (
      select 1 from public.entitlement e
      where e.pack_slug = pack_locked.slug
        and e.user_id   = auth.uid()
        and (e.expires_at is null or e.expires_at > now())
    )
  );

drop policy if exists packlocked_admin_read on public.pack_locked;
create policy packlocked_admin_read on public.pack_locked
  for select to authenticated using (public.is_admin());

drop policy if exists packlocked_admin_ins on public.pack_locked;
create policy packlocked_admin_ins on public.pack_locked
  for insert to authenticated with check (public.is_admin());

drop policy if exists packlocked_admin_upd on public.pack_locked;
create policy packlocked_admin_upd on public.pack_locked
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists packlocked_admin_del on public.pack_locked;
create policy packlocked_admin_del on public.pack_locked
  for delete to authenticated using (public.is_admin());

-- ---- backfill hands_total for every pack ---------------------------------
-- Visible hands only: hidden hands are drafts, they never reach a player.
update public.pack p
set hands_total = (
  select count(*)
  from jsonb_array_elements(coalesce(p.data -> 'hands', '[]'::jsonb)) h
  where coalesce((h.value ->> 'hidden')::boolean, false) = false
) + (
  select count(*) from public.pack_locked l where l.slug = p.slug
);

-- ============================================================================
--  TEST FIXTURE — locks the LAST VISIBLE hand of each of the 3 open packs.
--  Purpose: exercise the paywall end to end. These hands already shipped in
--  the public packs.json, so they are a test rig, not sellable content:
--  the first real paid pack must be new material that was never public-read.
-- ============================================================================
do $$
declare
  r           record;
  last_ord    int;
  hands       jsonb;
  locked_hand jsonb;
  free_n      int;
begin
  for r in select slug from public.pack where slug in ('ft10k', 'wsopme', 'mtt16k') loop
    -- skip packs that already have locked hands, so re-running is a no-op
    if exists (select 1 from public.pack_locked l where l.slug = r.slug) then
      continue;
    end if;

    select p.data -> 'hands' into hands from public.pack p where p.slug = r.slug;

    -- last VISIBLE hand: hidden hands sit at the tail of some packs, so the
    -- last array element is often not the last one a player actually sees
    select max(t.ord)::int into last_ord
    from jsonb_array_elements(hands) with ordinality t(hand, ord)
    where coalesce((t.hand ->> 'hidden')::boolean, false) = false;

    if last_ord is null then
      continue;
    end if;

    locked_hand := hands -> (last_ord - 1);
    hands       := hands -  (last_ord - 1);

    select count(*)::int into free_n
    from jsonb_array_elements(hands) h
    where coalesce((h.value ->> 'hidden')::boolean, false) = false;

    insert into public.pack_locked (slug, idx, hand)
    values (r.slug, last_ord, locked_hand);

    -- single UPDATE: pack_bump/pack_log fire per statement, so two updates
    -- would double-bump version and write two history rows for one change.
    -- hands_total stays as backfilled: the hand changed tables, not existence.
    update public.pack p
    set data      = jsonb_set(p.data, '{hands}', hands),
        paid      = true,
        price_rub = 49,
        free_hands = free_n
    where p.slug = r.slug;
  end loop;
end $$;

-- ============================================================================
--  VERIFY — run these and send me the output.
-- ============================================================================

-- 1) paywall config per pack: locked should be 1 for the three open packs
select p.slug, p.paid, p.free_hands, p.hands_total, p.price_rub,
       (select count(*) from public.pack_locked l where l.slug = p.slug) as locked,
       jsonb_array_length(p.data -> 'hands') as hands_in_public_row
from public.pack p order by p.position;

-- 2) which hands got locked
select slug, idx, hand ->> 'title' as title from public.pack_locked order by slug, idx;

-- 3) policy sanity: pack_locked and entitlement must have NO anon policy
select tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and tablename in ('pack_locked', 'entitlement')
order by tablename, cmd;
