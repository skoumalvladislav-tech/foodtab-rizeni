-- =====================================================================
-- NÁVRH — úklid po sloučení Faktur (NENÍ migrace, NEPOUŠTĚT)
--
-- Tohle schválně NENÍ v supabase/migrations: `db push` by ho pustil
-- spolu s 20261018100000 ještě před převodem dat a cizí klíče by spadly.
-- Až skončí zkušební doba (otázka 58, bod 5) a Šéfík řekne „uklidit",
-- vznikne z něj samostatná PR: tenhle obsah jako nová migrace
-- (RRRRMMDDHHMMSS_faktury_uklid.sql) + změny kódu níž, scénář, CI.
--
-- PODMÍNKY (všechny, jinak se úklid nedělá):
--   1. faktury_prevod.stav = 'dokonceno' u firmy ze staré databáze
--      a zkušební doba uplynula bez návratu.
--   2. Krok „nanecisto" hlásí zmeneno_ve_stare_od_prevodu = 0 (nikdo
--      do staré databáze nepíše).
--   3. Krok „prilohy" hlásí 0 zbývajících; nepovedené přílohy Šéfík
--      viděl a rozhodl o nich (zůstanou jen ve staré databázi!).
--   4. Párování bez faktury (dotaz níž) jsou vyřešená.
--   5. KÓD se změní DŘÍV než databáze (samostatný commit téže PR, nebo
--      PR předem): nic už nečte ani nepíše platby_faktury.faktura_id:
--        * app/[rozsah]/finance/platby/page.tsx (select faktura_id),
--        * lib/finance-automaticke-parovani.ts (select faktura_id),
--        * app/api/ucetni/export/route.ts (select faktura_id),
--      a zmizí: lib/supabase/faktury.ts, lib/faktury-prevod-sync.ts,
--      app/api/prevod-faktur, .github/workflows/faktury-prevod.yml,
--      lib/faktury-vlastnik.ts (+ jejich testy), proměnné
--      FAKTURY_SUPABASE_URL, FAKTURY_SUPABASE_ANON_KEY,
--      FAKTURY_DB_TENANT_ID ve Vercelu (= druhé spojení vypnuté).
--      Brána (lib/faktury-brana.ts) podle otázky 60 případně otevře
--      Faktury i ostatním firmám.
-- =====================================================================


-- 0. Pojistky: když cokoli nesedí, migrace spadne nahlas a nic nezmění.
do $$
declare
  v_bez integer;
begin
  select count(*) into v_bez from public.platby_faktury where faktura is null;
  if v_bez > 0 then
    raise exception 'Úklid: % párování nemá uuid faktury (faktura ve staré databázi zmizela). Nejdřív je vyřešit (otázka 58, bod 4).', v_bez;
  end if;
  if exists (select 1 from public.faktury_prevod where stav <> 'dokonceno') then
    raise exception 'Úklid: převod faktur není u všech firem dokončený.';
  end if;
end $$;


-- 1. Párování: uuid povinné, textové faktura_id pryč.
alter table public.platby_faktury alter column faktura set not null;
drop trigger trg_platby_faktury_odkaz on public.platby_faktury;
drop index public.platby_faktury_faktura;
alter table public.platby_faktury drop column faktura_id;

-- Brána párování: stará cesta už neexistuje (funkce níž pryč), zůstává
-- jen zákaz změn během převodu — vlastní jednodušší funkce v migraci.


-- 2. Staré funkce párování (do teď jen kvůli návratu na předchozí verzi appky).
drop function public.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric);
drop function app.potvrdit_alokaci_platby(uuid, uuid, text, integer, integer, numeric);
drop function public.zrusit_alokaci_platby(uuid, uuid, text);
drop function app.zrusit_alokaci_platby(uuid, uuid, text);
drop function public.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer);
drop function app.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer);
drop function public.zrusit_automaticke_parovani(uuid, uuid, text);
drop function app.zrusit_automaticke_parovani(uuid, uuid, text);


-- 3. Evidence příjmu: textové faktura_id ZŮSTÁVÁ (záznam evidence — podle
--    něj příjem pozná, že doklad už zpracoval, i když fakturu někdo
--    smazal). Spoušť trg_faktury_prijem_odkaz zůstává.


-- 4. Převod: funkce pryč. Kopie staré databáze (faktury_prevod_zdroj)
--    ZŮSTÁVÁ jako záloha, dokud Šéfík nerozhodne jinak (otázka 63);
--    faktury_prevod zůstává (brána podle ní rozhoduje).
drop function public.faktury_prevod_zahajit(uuid, text, jsonb);
drop function app.faktury_prevod_zahajit(uuid, text, jsonb);
drop function public.faktury_prevod_dokoncit(uuid, integer, integer);
drop function app.faktury_prevod_dokoncit(uuid, integer, integer);
drop function public.faktury_prevod_vratit(uuid);
drop function app.faktury_prevod_vratit(uuid);
drop function public.faktury_prevod_zamek(uuid, boolean);
drop function app.faktury_prevod_zamek(uuid, boolean);
-- faktury_prevod_porovnat / _mereni nechat — slouží k měření zálohy.
