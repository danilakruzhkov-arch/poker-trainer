-- ============================================================================
--  poker-trainer · P2.1: Telegram Mini App — связка Telegram-юзера с Supabase
--  Применить в Supabase SQL editor (MCP тут read-only). Идемпотентно.
--
--  Что делает: таблица telegram_link (telegram_id -> auth.users.id). Её пишет
--  ТОЛЬКО Edge Function tg-auth под service_role — RLS без write-политик = запись
--  извне запрещена (как entitlement). Пользователь может прочитать свою строку.
--
--  Доступ к платному после оплаты Stars пишет Edge Function tg-webhook прямой
--  вставкой в entitlement под service_role (RLS обходится) — отдельная миграция
--  не нужна, entitlement уже есть.
--
--  ПОСЛЕ применения: см. deploy/TELEGRAM-SETUP.md (бот, секреты, деплой функций).
-- ============================================================================

create table if not exists public.telegram_link (
  telegram_id  bigint primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  username     text,
  first_name   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists telegram_link_user_id_key on public.telegram_link(user_id);

alter table public.telegram_link enable row level security;
-- писать может только service_role (Edge Function). Нет write-политик → anon/authenticated не пишут.
drop policy if exists tglink_own_read on public.telegram_link;
create policy tglink_own_read on public.telegram_link for select using ((select auth.uid()) = user_id);
grant select on public.telegram_link to authenticated;   -- RLS всё равно ограничивает своей строкой

-- ---- verify ---------------------------------------------------------------
select 'telegram_link ready' as check,
       (select count(*) from pg_policies where schemaname='public' and tablename='telegram_link') as policies;
