-- ============================================================================
--  poker-trainer · feedback schema
--  Run this in a NEW Supabase project — NOT ClipPoints dev/prod.
--  How: Supabase dashboard → SQL Editor → New query → paste all → Run.
--  Safe to re-run (guards with "if not exists" / "drop policy if exists").
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- table --------------------------------------------------------------
create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  pack        text,          -- pack id  (e.g. 'wsopme')
  pack_title  text,          -- pack title as shown to the player
  hand        text,          -- hand title
  street      text,          -- preflop / flop / turn / river
  q_index     int,           -- question number within the hand (1-based)
  q_total     int,           -- total questions in the hand
  pick_label  text,          -- what the player answered
  pick_grade  text,          -- best / ok / mistake
  hero_label  text,          -- the hero's actual (correct) action
  category    text not null default 'other',   -- answer | hand | video | unclear | other
  comment     text not null,
  ua          text,          -- trimmed user-agent (triage only)
  app_ver     text,
  client_ts   timestamptz    -- timestamp from the client clock
);

-- keep comments sane
alter table public.feedback drop constraint if exists feedback_comment_len;
alter table public.feedback add  constraint feedback_comment_len check (char_length(comment) <= 2000);

-- triage index
create index if not exists feedback_pack_created_idx on public.feedback (pack, created_at desc);

-- ---- row-level security -------------------------------------------------
--  Anonymous visitors (the public site uses the anon key) may INSERT a report,
--  but may NOT read/update/delete. You read feedback from the dashboard
--  (Table Editor / SQL) or with the service_role key — never the anon key.
alter table public.feedback enable row level security;

grant usage on schema public to anon;
grant insert on public.feedback to anon;

drop policy if exists "anon can insert feedback" on public.feedback;
create policy "anon can insert feedback"
  on public.feedback for insert
  to anon
  with check (true);

-- (intentionally no SELECT/UPDATE/DELETE policy for anon)

-- ---- done ---------------------------------------------------------------
-- Read your feedback later with:
--   select created_at, pack, hand, category, pick_label, hero_label, comment
--   from public.feedback order by created_at desc;
