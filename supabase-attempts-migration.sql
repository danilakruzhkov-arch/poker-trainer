-- ============================================================================
--  poker-trainer · attempts schema  (Stage 3b — per-question progress)
--  Run AFTER supabase-auth-migration.sql, in the same project.
--  Supabase dashboard → SQL Editor → New query → paste all → Run.
--  Safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ---- one row per answered question --------------------------------------
create table if not exists public.attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  pack        text,          -- pack id
  pack_title  text,          -- pack title as shown
  hand        text,          -- hand title
  street      text,          -- preflop / flop / turn / river
  q_index     int,           -- question number within the hand (1-based)
  q_total     int,           -- total questions in the hand
  pick_label  text,          -- what the player chose
  grade       text,          -- best | ok | mistake
  hero_label  text,          -- the hero's actual (correct) action
  app_ver     text,
  client_ts   timestamptz    -- client clock
);

-- ---- row-level security: a user touches ONLY their own rows --------------
alter table public.attempts enable row level security;

grant insert, select on public.attempts to authenticated;

drop policy if exists "own attempts insert" on public.attempts;
create policy "own attempts insert" on public.attempts
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "own attempts read" on public.attempts;
create policy "own attempts read" on public.attempts
  for select to authenticated using (auth.uid() = user_id);

-- (no update/delete policy — attempts are an append-only log)

-- ---- indexes for the stats screen (Stage 3c) ----------------------------
create index if not exists attempts_user_created_idx on public.attempts (user_id, created_at desc);
create index if not exists attempts_user_pack_idx    on public.attempts (user_id, pack);

-- ---- done ---------------------------------------------------------------
-- Your own progress later:
--   select pack, grade, count(*) from public.attempts group by pack, grade;
