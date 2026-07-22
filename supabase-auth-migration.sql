-- ============================================================================
--  poker-trainer · auth / profiles schema  (Stage 3a — logins)
--  Run in the SAME Supabase project as feedback (mydnywznytluikbwbhsk).
--  Supabase dashboard → SQL Editor → New query → paste all → Run.
--  Safe to re-run (guards with "if not exists" / "drop ... if exists").
-- ============================================================================

-- ---- profiles: one row per authenticated user ---------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- a signed-in user may read + update ONLY their own profile
drop policy if exists "own profile read"   on public.profiles;
create policy "own profile read"   on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- ---- auto-create a profile row on signup --------------------------------
-- Runs as SECURITY DEFINER so the signup trigger can insert past RLS.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- done ---------------------------------------------------------------
-- Stage 3b will add public.attempts (per-question progress) on top of this.
-- Check your profiles later with:
--   select id, email, display_name, created_at from public.profiles order by created_at desc;
