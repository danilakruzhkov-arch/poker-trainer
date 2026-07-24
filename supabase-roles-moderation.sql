-- ============================================================================
--  poker-trainer · P1(б): роль «редактор» + модерация отзывов
--  Применить в Supabase SQL editor (MCP тут read-only). Идемпотентно.
--
--  Роль «редактор» = полный CRUD по ПАКАМ (создать/править/публиковать/удалить),
--  и ничего больше: ни грантов доступа, ни ролей, ни чужих entitlement. Админ
--  (2 почты Данилы) — надмножество редактора. Игрок — любой залогиненный.
--
--  Модерация: экран отзывов (`feedback`) доступен админу и редакторам —
--  до сих пор `feedback` был insert-only (даже админ не читал его через REST,
--  только через дашборд). Добавляем чтение + пометку «решено».
--
--  ПОСЛЕ применения: добавить редактора =
--    insert into public.app_editor(email) values ('кто@то.com');
--  Клиент (v.29+) сам подхватит роль через RPC my_role() при следующем входе.
-- ============================================================================

-- ---- 1. список редакторов -------------------------------------------------
create table if not exists public.app_editor (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);
alter table public.app_editor enable row level security;
-- только админ видит список; писать — лишь дашборд/service_role (нет write-политик)
drop policy if exists app_editor_admin_read on public.app_editor;
create policy app_editor_admin_read on public.app_editor for select using (public.is_admin());

-- ---- 2. is_editor(): редактор ИЛИ админ (админ ⊇ права по пакам) -----------
create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.app_editor e
                  where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;

-- ---- 3. my_role(): клиент спрашивает свою роль ----------------------------
-- 'admin' | 'editor' | 'player'. Ничего не раскрывает о других — только про звонящего.
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then 'admin'
    when exists (select 1 from public.app_editor e
                 where lower(e.email) = lower(coalesce(auth.jwt() ->> 'email',''))) then 'editor'
    else 'player' end;
$$;
revoke execute on function public.is_editor()  from public, anon;
revoke execute on function public.my_role()    from public, anon;
grant  execute on function public.is_editor()  to authenticated;
grant  execute on function public.my_role()    to authenticated;

-- ---- 4. pack: write открыть редакторам (было — хардкод 2 почт) -------------
drop policy if exists pack_admin_ins on public.pack;
drop policy if exists pack_admin_upd on public.pack;
drop policy if exists pack_admin_del on public.pack;
drop policy if exists pack_editor_ins on public.pack;
drop policy if exists pack_editor_upd on public.pack;
drop policy if exists pack_editor_del on public.pack;
create policy pack_editor_ins on public.pack for insert with check (public.is_editor());
create policy pack_editor_upd on public.pack for update using (public.is_editor()) with check (public.is_editor());
create policy pack_editor_del on public.pack for delete using (public.is_editor());
-- pack_read (public select) остаётся как есть

-- ---- 5. pack_locked: редактор должен читать/писать платные раздачи ---------
-- Иначе редактор откроет пак без платной половины и при публикации её потеряет.
drop policy if exists packlocked_admin_read on public.pack_locked;
drop policy if exists packlocked_admin_ins  on public.pack_locked;
drop policy if exists packlocked_admin_upd  on public.pack_locked;
drop policy if exists packlocked_admin_del  on public.pack_locked;
drop policy if exists packlocked_editor_read on public.pack_locked;
drop policy if exists packlocked_editor_ins  on public.pack_locked;
drop policy if exists packlocked_editor_upd  on public.pack_locked;
drop policy if exists packlocked_editor_del  on public.pack_locked;
create policy packlocked_editor_read on public.pack_locked for select using (public.is_editor());
create policy packlocked_editor_ins  on public.pack_locked for insert with check (public.is_editor());
create policy packlocked_editor_upd  on public.pack_locked for update using (public.is_editor()) with check (public.is_editor());
create policy packlocked_editor_del  on public.pack_locked for delete using (public.is_editor());
-- packlocked_owner_read (по entitlement, для игроков) НЕ трогаем — оно осталось

-- ---- 6. pack_apply_split: пускать редактора (было — только is_admin) -------
-- Тело функции без изменений, кроме проверки в начале. Полный текст — на случай
-- если функция уже переопределялась; сверять с supabase-paywall-rpc.sql.
create or replace function public.pack_apply_split(p_slug text, p_data jsonb, p_position int,
       p_paid boolean, p_price int, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  free_arr jsonb := '[]'::jsonb;
  paid_arr jsonb := '[]'::jsonb;
  h        jsonb;
  ord      int := 0;
  n_free   int := 0;
  n_paid   int := 0;
  n_total  int := 0;
  n_cur    int := 0;
begin
  if not public.is_editor() then
    raise exception 'pack_apply_split: not an editor' using errcode = '42501';
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
end $function$;
revoke execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) from public, anon;
grant  execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) to authenticated;

-- ---- 7. модерация отзывов -------------------------------------------------
alter table public.feedback add column if not exists resolved    boolean not null default false;
alter table public.feedback add column if not exists resolved_by text;
alter table public.feedback add column if not exists resolved_at timestamptz;

drop policy if exists feedback_mod_read on public.feedback;
drop policy if exists feedback_mod_upd  on public.feedback;
create policy feedback_mod_read on public.feedback for select using (public.is_editor());
create policy feedback_mod_upd  on public.feedback for update using (public.is_editor())
  with check (public.is_editor());
grant select, update on public.feedback to authenticated;   -- RLS still gates to editors

-- ratings: let moderators read the raw 👍/👎 too (aggregate view on the screen)
drop policy if exists ratings_mod_read on public.ratings;
create policy ratings_mod_read on public.ratings for select using (public.is_editor());
grant select on public.ratings to authenticated;

-- ---- verify ---------------------------------------------------------------
select 'my_role for caller' as check, public.my_role() as value;
select tablename, policyname, cmd from pg_policies
where schemaname='public' and tablename in ('pack','pack_locked','feedback','ratings','app_editor')
order by tablename, cmd, policyname;
