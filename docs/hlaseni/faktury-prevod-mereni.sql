-- =====================================================================
-- Faktury v hlavní databázi — měřicí dotazy PŘED a PO převodu
--
-- Spouští Šéfík (jen čtení): SQL editor projektu foodtab-test
-- (spekntcsuroqhehmjssv), nebo
--   npx.cmd supabase db query --linked -f docs/hlaseni/faktury-prevod-mereni.sql
-- (ten vrací jen výsledek POSLEDNÍHO příkazu — proto je tu všechno
-- v jednom dotazu jako jeden JSON).
--
-- Před spuštěním nahraďte <FIRMA> id firmy z proměnné FAKTURY_DB_TENANT_ID
-- (Vercel → Settings → Environment Variables), na dvou místech níž.
--
-- KDY:
--   1. PŘED db push migrace 20261018100000 → oddíl „pred" (párování
--      a evidence; faktury ještě v hlavní databázi nejsou, oddíl „po"
--      spadne na neexistující tabulku — pak pusťte jen dotaz 1 níž).
--   2. PO dokončení převodu → celý dotaz 2. Čísla „pred" se NESMÍ
--      změnit (převod párování ani evidenci nekopíruje, jen doplní
--      uuid faktury) — to je důkaz, že se nic nezapočítalo dvakrát.
--
-- Úloha převodu vypisuje do logu jen POČTY ze strany staré databáze
-- (krok nanecisto: stara_faktur, stara_archivovanych, stara_duplicit,
-- stara_s_odkazem_pdf, stara_men, stara_vzoru) — součty peněz do
-- veřejného logu nepatří. Součty po měnách spočítala úloha přímo ze staré
-- databáze při zahájení a uložila je (níž „zdroj_pri_zahajeni"). Musí se
-- rovnat „po.hlavni.castky_haleru" i „po.stara.castky_haleru".
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PŘED db push (jen tabulky, které už existují)
-- ---------------------------------------------------------------------
-- select jsonb_build_object(
--   'parovani', (select jsonb_build_object(
--       'pocet', count(*),
--       'potvrzenych', count(*) filter (where stav = 'potvrzeno'),
--       'navrzenych', count(*) filter (where stav = 'navrzeno'),
--       'zrusenych', count(*) filter (where stav = 'zamitnuto'),
--       'potvrzeno_haleru', coalesce(sum(castka_haleru) filter (where stav = 'potvrzeno'), 0),
--       'faktura_id_neni_uuid', count(*) filter (where faktura_id !~* '^\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\s*$'))
--     from public.platby_faktury where tenant_id = '<FIRMA>'),
--   'evidence_prijmu', (select jsonb_build_object(
--       'pocet', count(*),
--       's_fakturou', count(*) filter (where faktura_id is not null),
--       'podle_stavu', (select jsonb_object_agg(stav, n) from (select stav, count(*) n from public.faktury_prijem
--                         where tenant_id = '<FIRMA>' group by stav) x))
--     from public.faktury_prijem where tenant_id = '<FIRMA>')
-- );


-- ---------------------------------------------------------------------
-- 2. PO převodu (a kdykoli během zkušební doby)
-- ---------------------------------------------------------------------
with firma as (select '<FIRMA>'::uuid as id)
select jsonb_build_object(
  'stav_prevodu', (select jsonb_build_object('stav', stav, 'zahajeno', zahajeno_kdy, 'dokonceno', dokonceno_kdy,
                                             'nepovedene_prilohy', (select count(*) from jsonb_object_keys(coalesce(prilohy -> 'chyby', '{}'::jsonb))))
                     from public.faktury_prevod where tenant_id = (select id from firma)),

  -- Stejné počty a součty nad kopií staré databáze i nad hlavní —
  -- „stara" a „hlavni" se musí shodovat (počítá to databáze sama).
  'po', app.faktury_prevod_mereni((select id from firma)),

  -- Nezávislé měření zdroje: součty po měnách, které úloha spočítala
  -- PŘÍMO ze staré databáze v okamžiku zahájení (ne z kopie).
  'zdroj_pri_zahajeni', (select pr.mereni_zahajeni -> 'castky_haleru' from public.faktury_prevod pr
                          where pr.tenant_id = (select id from firma)),

  -- Pole po poli: kopie staré databáze proti převedeným fakturám.
  -- Po dokončení: chybi = navic = lisi = 0 (později, během zkušební doby,
  -- se „lisi" zvětšuje o faktury změněné v appce — to je v pořádku).
  'porovnani', app.faktury_prevod_porovnat((select id from firma)),

  -- Párování a evidence — tatáž čísla jako v dotazu 1 (PŘED). Převod je
  -- nesmí změnit; jen „bez_uuid" klesne k nule (kromě párování na
  -- faktury, které ve staré databázi zmizely).
  'pred_porovnat', jsonb_build_object(
    'parovani_pocet', (select count(*) from public.platby_faktury where tenant_id = (select id from firma)),
    'parovani_potvrzeno_haleru', (select coalesce(sum(castka_haleru), 0) from public.platby_faktury
                                    where tenant_id = (select id from firma) and stav = 'potvrzeno'),
    'parovani_bez_uuid', (select count(*) from public.platby_faktury where tenant_id = (select id from firma) and faktura is null),
    'evidence_s_fakturou', (select count(*) from public.faktury_prijem where tenant_id = (select id from firma) and faktura_id is not null),
    'evidence_s_uuid', (select count(*) from public.faktury_prijem where tenant_id = (select id from firma) and faktura is not null)),

  -- Bez dvojího započítání: žádné id faktury dvakrát (primární klíč to
  -- hlídá, tady pro jistotu nahlas) a žádná faktura v cizí firmě se
  -- stejným id jako ve staré databázi.
  'dvakrat', jsonb_build_object(
    'stejne_cislo_a_dodavatel_vic_nez_jednou', (select count(*) from (
        select dodavatel, cislo_faktury from public.faktury
         where tenant_id = (select id from firma) and coalesce(cislo_faktury, '') <> '' and not duplicita
         group by 1, 2 having count(*) > 1) x),
    'id_z_kopie_u_jine_firmy', (select count(*) from public.faktury f
        join public.faktury_prevod_zdroj z on z.klic = f.id::text and z.tabulka = 'invoices'
       where z.tenant_id = (select id from firma) and f.tenant_id <> (select id from firma)))
);


-- ---------------------------------------------------------------------
-- 3. Rychlost POD PŘIHLÁŠENÝM (memory „měřit pod přihlášeným": jako
--    postgres se RLS obejde a číslo lže). Do <UZIVATEL> dejte user_id
--    majitele (auth.users). V transakci s rollback — nic se nezmění.
-- ---------------------------------------------------------------------
-- begin;
-- select set_config('request.jwt.claims', json_build_object('sub', '<UZIVATEL>', 'role', 'authenticated')::text, true);
-- select set_config('request.jwt.claim.sub', '<UZIVATEL>', true);
-- set local role authenticated;
-- explain analyze select id, dodavatel, castka_haleru from public.faktury
--   where tenant_id = '<FIRMA>' and archivovano = false order by prijato_kdy desc;
-- explain analyze select count(*) from public.faktury
--   where tenant_id = '<FIRMA>' and archivovano = false and (ke_kontrole or stav like 'Nutná ruční kontrola%');
-- rollback;
