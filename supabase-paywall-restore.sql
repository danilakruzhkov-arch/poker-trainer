-- ============================================================================
--  poker-trainer · RESTORE after the pack_locked duplication incident
--  (2026-07-24). Run once in the Supabase SQL editor.
--
--  WHAT HAPPENED
--    loadLocked() reset LOCKED={} synchronously but filled it after an await.
--    Two overlapping calls (boot refreshOwned() + the onAuthStateChange
--    callback) pushed both responses into the same object, so every paid hand
--    was counted twice. mergeLockedIntoCols() spliced the inflated list into
--    COLS, the debounced auto-publish wrote that back, and the next page load
--    started from the already-inflated state. Net effect per pack:
--      mtt16k   pack.data 35 (all hidden)  + pack_locked 108 = 3 hands x 36
--      ft10k    pack.data 33               + pack_locked  54 = 1 hand  x 54
--      wsopme   pack.data 30               + pack_locked  54 = 1 hand  x 54
--    Nothing was lost — only duplicated. pack_version kept clean snapshots.
--
--  RESTORE POINT — last snapshot before the paywall migration (2026-07-24 00:09:28Z)
--      mtt16k  v6  38 hands, 3 visible
--      ft10k   v4  34 hands, 5 visible
--      wsopme  v3  31 hands, 16 visible
--
--  This script rebuilds pack.data from those snapshots and re-applies the
--  intended test split: exactly ONE paid hand per pack — the last visible one.
--      mtt16k  ord 4   «Туз-дама: ненужный бет ривера»
--      ft10k   ord 34  «Финал: 44 против A10 за титул»
--      wsopme  ord 16  «Вторая пара против сета валетов»
--
--  price_rub stays 0 (demo: any signed-in user can self-unlock).
--  Existing entitlements are untouched.
--
--  The client fix ships in APP_VER 2026-07-24.27 — deploy it BEFORE reopening
--  the editor, otherwise an old tab republishes its stale localStorage copy.
-- ============================================================================

begin;

do $$
declare
  r          record;
  v_data     jsonb;
  free_arr   jsonb;
  lock_hand  jsonb;
  lock_ord   int;
  n_vis      int;
  n_free     int;
begin
  for r in select * from (values ('mtt16k'::text, 6), ('ft10k', 4), ('wsopme', 3)) as t(slug, ver)
  loop
    select data into v_data from public.pack_version where slug = r.slug and version = r.ver;
    if v_data is null or jsonb_typeof(v_data -> 'hands') <> 'array' then
      raise exception 'restore: snapshot % v% missing or malformed', r.slug, r.ver;
    end if;

    -- the paid hand is the LAST VISIBLE one; idx is its 1-based position in the
    -- FULL array (hidden hands included) — that is what the client splices back on
    select max(e.ord)::int into lock_ord
      from jsonb_array_elements(v_data -> 'hands') with ordinality e(val, ord)
     where not coalesce((e.val ->> 'hidden')::boolean, false);
    if lock_ord is null then
      raise exception 'restore: % has no visible hand to lock', r.slug;
    end if;

    select coalesce(jsonb_agg(e.val - 'paid' order by e.ord) filter (where e.ord <> lock_ord), '[]'::jsonb),
           count(*) filter (where not coalesce((e.val ->> 'hidden')::boolean, false)),
           count(*) filter (where not coalesce((e.val ->> 'hidden')::boolean, false) and e.ord <> lock_ord),
           (array_agg(e.val - 'paid' order by e.ord) filter (where e.ord = lock_ord))[1]
      into free_arr, n_vis, n_free, lock_hand
      from jsonb_array_elements(v_data -> 'hands') with ordinality e(val, ord);

    delete from public.pack_locked where slug = r.slug;
    insert into public.pack_locked (slug, idx, hand) values (r.slug, lock_ord, lock_hand);

    update public.pack
       set data        = jsonb_set(v_data, '{hands}', free_arr),
           paid        = true,
           free_hands  = n_free,
           hands_total = n_vis,
           price_rub   = 0
     where slug = r.slug;

    raise notice '% restored: % visible (% free + 1 paid at ord %)', r.slug, n_vis, n_free, lock_ord;
  end loop;
end $$;

commit;

-- ---- verify: free + locked must add back up to the original totals ---------
-- expected: mtt16k 37+1=38 (3 visible) · ft10k 33+1=34 (5) · wsopme 30+1=31 (16)
select p.slug,
       jsonb_array_length(p.data -> 'hands')                              as n_free_rows,
       (select count(*) from public.pack_locked l where l.slug = p.slug)  as n_locked,
       jsonb_array_length(p.data -> 'hands')
         + (select count(*) from public.pack_locked l where l.slug = p.slug) as n_total,
       p.paid, p.free_hands, p.hands_total, p.price_rub,
       (select count(*) from jsonb_array_elements(p.data -> 'hands') h
         where coalesce((h ->> 'paid')::boolean, false))                  as paid_marks_leaked
from public.pack p
where p.slug in ('mtt16k','ft10k','wsopme')
order by p.slug;

-- ---- verify: no duplicates left in the paid half --------------------------
-- expected: one row per pack, n = 1
select slug, count(*) as n, count(distinct md5(hand::text)) as n_unique_hands
from public.pack_locked group by slug order by slug;
