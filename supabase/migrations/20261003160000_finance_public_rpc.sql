-- =====================================================================
-- Foodtab — Finance: průzor z `app` do `public` pro PostgREST
--
-- PostgREST (`supabase/config.toml`, `[api] schemas`) vidí jen `public`
-- a `graphql_public`. Funkce z migrací 1 a 6 (integrace_* a
-- cashflow_prehled*) žijí v `app`, takže appka na ně `supabase.rpc(...)`
-- nedosáhne, dokud nemají tenhle úzký, výhradně přeposílající obal —
-- stejný vzor jako `public.has_access` (20260825080000_api_authz.sql).
--
-- Žádná z těchhle funkcí nic nepřidává ani neubírá: SECURITY INVOKER,
-- jen přeposílá. Oprávnění a izolaci firmy řeší pořád jen funkce v `app`
-- (SECURITY DEFINER, sama si dohledá tenanta a ověří finance.manage/
-- finance.read) — tady by se podmínka navíc neměla psát.
-- =====================================================================


create or replace function public.integrace_uloz_tajemstvi(
  p_pripojeni uuid,
  p_sifra     text,
  p_otisk     text
)
returns void
language sql security invoker set search_path = ''
as $$
  select app.integrace_uloz_tajemstvi(p_pripojeni, p_sifra, p_otisk);
$$;

revoke all on function public.integrace_uloz_tajemstvi(uuid, text, text) from public, anon;
grant execute on function public.integrace_uloz_tajemstvi(uuid, text, text) to authenticated;


create or replace function public.integrace_precti_tajemstvi(p_pripojeni uuid)
returns text
language sql security invoker set search_path = ''
as $$
  select app.integrace_precti_tajemstvi(p_pripojeni);
$$;

revoke all on function public.integrace_precti_tajemstvi(uuid) from public, anon;
grant execute on function public.integrace_precti_tajemstvi(uuid) to authenticated;


create or replace function public.integrace_smaz_tajemstvi(p_pripojeni uuid)
returns void
language sql security invoker set search_path = ''
as $$
  select app.integrace_smaz_tajemstvi(p_pripojeni);
$$;

revoke all on function public.integrace_smaz_tajemstvi(uuid) from public, anon;
grant execute on function public.integrace_smaz_tajemstvi(uuid) to authenticated;


create or replace function public.cashflow_prehled(p_tenant uuid, p_od date, p_do date)
returns table (
  branch_id      uuid,
  pobocka        text,
  prijmy_haleru  integer,
  vydaje_haleru  integer
)
language sql stable security invoker set search_path = ''
as $$
  select * from app.cashflow_prehled(p_tenant, p_od, p_do);
$$;

revoke all on function public.cashflow_prehled(uuid, date, date) from public, anon;
grant execute on function public.cashflow_prehled(uuid, date, date) to authenticated;


create or replace function public.cashflow_prehled_firma(p_tenant uuid, p_od date, p_do date)
returns table (
  prijmy_haleru integer,
  vydaje_haleru integer
)
language sql stable security invoker set search_path = ''
as $$
  select * from app.cashflow_prehled_firma(p_tenant, p_od, p_do);
$$;

revoke all on function public.cashflow_prehled_firma(uuid, date, date) from public, anon;
grant execute on function public.cashflow_prehled_firma(uuid, date, date) to authenticated;
