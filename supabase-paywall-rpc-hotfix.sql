-- ============================================================================
--  poker-trainer · HOTFIX for supabase-paywall-rpc.sql — run this now
--
--  Postgres grants EXECUTE on every new function to PUBLIC. `revoke ... from
--  anon` does NOT undo that, because anon inherits PUBLIC. So grant_pack(),
--  which deliberately has no is_admin() check (the dashboard calls it as
--  postgres), was reachable anonymously over /rest/v1/rpc/grant_pack — any
--  visitor could grant themselves a paid pack.
--
--  Verified before the fix:
--    POST /rest/v1/rpc/grant_pack {"p_email":"…","p_slug":"__nope__"}
--    -> 400 {"message":"grant_pack: no such pack: __nope__"}   (i.e. it ran)
--
--  The right revoke target is PUBLIC. Safe to re-run.
-- ============================================================================

-- ---- admin-only plumbing: nobody but postgres/service_role may call --------
revoke execute on function public.grant_pack(text, text)         from public, anon, authenticated;
revoke execute on function public.claim_pending_for(uuid, text)   from public, anon, authenticated;

-- ---- called from the app, but only by signed-in users ---------------------
-- Each still enforces its own rule inside (is_admin / auth.uid + price = 0);
-- dropping PUBLIC just stops anonymous callers from reaching the body at all.
revoke execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) from public, anon;
grant  execute on function public.pack_apply_split(text, jsonb, int, boolean, int, boolean) to authenticated;

revoke execute on function public.claim_free_pack(text) from public, anon;
grant  execute on function public.claim_free_pack(text) to authenticated;

-- ---- trigger functions are never called directly -------------------------
-- Also clears the four "Public Can Execute SECURITY DEFINER Function" advisor
-- warnings that predate this work.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.pack_log()        from public, anon, authenticated;
revoke execute on function public.pack_snapshot()   from public, anon, authenticated;
revoke execute on function public.pack_bump()       from public, anon, authenticated;

-- is_admin() stays callable: RLS policies reference it, so the querying role
-- needs EXECUTE. It only reports whether the CALLER is an admin — no leverage.

-- ---- confirm nothing was granted while the hole was open ------------------
select 'entitlement' as tbl, e.pack_slug, u.email, e.source, e.granted_at
from public.entitlement e join auth.users u on u.id = e.user_id
union all
select 'pending', p.pack_slug, p.email, p.source, p.created_at
from public.entitlement_pending p
order by 5;

-- ---- confirm the ACLs are closed -----------------------------------------
-- expected: grant_pack / claim_pending_for -> postgres + service_role only
select p.proname, coalesce(array_to_string(p.proacl::text[], ' '), '(default: PUBLIC can execute)') as acl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('grant_pack','claim_pending_for','pack_apply_split','claim_free_pack','handle_new_user','pack_log','pack_snapshot','pack_bump','is_admin')
order by p.proname;
