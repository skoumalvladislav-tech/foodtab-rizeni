-- =====================================================================
-- Foodtab — Finance: hromadný idempotentní zápis importovaných transakcí
--
-- Zadání (docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 13, scénář 5):
-- „opakovaný import téhož bankovního souboru znovu nezdvojí cashflow."
-- `transakce_externi_id` (20261003120000) je unikátní index na
-- (ucet_id, externi_id) — PostgREST/supabase-js `.upsert()` navíc neumí
-- cílit na PARTIAL index (`where externi_id is not null`) vůbec, a i
-- syrové `ON CONFLICT` samo o sobě nejde použít (viz nález níž), takže
-- dedup dělá anti-join PŘED insertem, ne ON CONFLICT.
--
-- SECURITY INVOKER, žádné obcházení RLS — vkládá se jako `authenticated`,
-- politiky `transakce_insert`/druhá linie (`app.hlida_firmu_transakce`)
-- platí úplně stejně jako při jednotlivém INSERTu z klienta. Žádný
-- parametr se nevěří navíc: řádek, který neprojde WITH CHECK, spadne
-- celý příkaz (atomicky), ne jen ten jeden řádek.
--
-- NÁLEZ PŘI PSANÍ (krok76_scenar.sql): `INSERT ... ON CONFLICT` na
-- `transakce` spadne vždy, bez ohledu na WHERE podmínku — PostgreSQL
-- odmítá ON CONFLICT na JAKÉKOLI tabulce, která má JAKÉKOLI pravidlo
-- (`transakce_no_update`, 20261003120000), i když se pravidlo týká
-- jiného příkazu (UPDATE, ne INSERT). „cannot be used with table that
-- has INSERT or UPDATE rules" — skutečné omezení PostgreSQL, ne PGlite.
-- Deduplikace je proto ANTI-JOIN (řádek se vloží, jen když jeho
-- externi_id v tabulce ještě není), ne ON CONFLICT. Duplicitní
-- externi_id UVNITŘ JEDNOHO volání (chyba ve vstupním souboru, ne
-- opakovaný upload) spadne na unikátní index celým příkazem — to je
-- žádoucí, ne tichá ztráta jednoho z nich.
-- =====================================================================

create or replace function public.importovat_transakce(
  p_tenant uuid,
  p_ucet   uuid,
  p_davka  uuid,
  p_zdroj  text,
  p_radky  jsonb
)
returns integer
language sql security invoker set search_path = ''
as $$
  with radky as (
    select * from jsonb_to_recordset(p_radky) as r(
      datum text, smer text, castka_haleru integer,
      protistrana text, vs text, poznamka text, externi_id text
    )
  ),
  nove as (
    select r.* from radky r
    where r.externi_id is null or not exists (
      select 1 from public.transakce t
      where t.ucet_id = p_ucet and t.externi_id = r.externi_id
    )
  ),
  vlozene as (
    insert into public.transakce (
      tenant_id, ucet_id, smer, castka_haleru, datum,
      protistrana, vs, poznamka, zdroj, externi_id, import_davka_id
    )
    select
      p_tenant, p_ucet, n.smer, n.castka_haleru, n.datum::date,
      coalesce(n.protistrana, ''), coalesce(n.vs, ''), coalesce(n.poznamka, ''),
      p_zdroj, n.externi_id, p_davka
    from nove n
    returning 1
  )
  select count(*)::integer from vlozene;
$$;

comment on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) is
  'Hromadný zápis CSV importu s dedupem na (ucet_id, externi_id) přes '
  'anti-join, ne ON CONFLICT (transakce má pravidlo na UPDATE a '
  'PostgreSQL proto ON CONFLICT na ní odmítá úplně). Vrací počet '
  'skutečně vložených řádků (bez duplicit, pro hlášení uživateli).';

revoke all on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) to authenticated;
