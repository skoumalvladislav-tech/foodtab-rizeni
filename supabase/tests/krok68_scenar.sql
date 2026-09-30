-- Scénář pro krok 66 — nezávislé ověření úklidu otázek 25, 31 a 33
-- (docs/hlaseni/otazky.md), migrace 20260929110000_dochazka_uklid_otazek.sql.
--
-- Navazuje na etapa0_scenar.sql až krok67_scenar.sql. Krok67 stejné tři
-- otázky už pokrývá — tenhle scénář je NEZÁVISLÁ druhá kontrola, se
-- svými vlastními lidmi a daty (žádné sdílení s krok67), a přidává tři
-- věci, které krok67 nemá:
--
--   * u otázky 25 se navíc porovnává PŘESNÉ znění hlášky (ne jen
--     errcode) a shoda stylu se sesterskými funkcemi přes katalog
--     (pg_get_functiondef), ne jen chování;
--   * u otázky 31 se přímý insert zkouší JAK vedoucímu, TAK majiteli,
--     a `pg_temp.spadne_pravem` (vzor z krok63) ověřuje, že chyba je
--     „permission denied" (GRANT), ne RLS věta — obě mají stejný
--     errcode 42501, jen tenhle rozliší proč;
--   * u otázky 33 se „novější otevřený" mezi app.otevreny_prichod
--     a app.useky_dochazky porovnává PŘÍMO (jeden dotaz vůči druhému),
--     ne vůči předem vymyšlenému id (skill `scenar`, bod 2 — kontrola
--     musí sáhnout na výstup, ne na vlastní očekávání vedle).
--
-- ---------------------------------------------------------------------
-- CO TENHLE SCÉNÁŘ HLÍDÁ
--
--   1. otázka 25 — vedoucí (attendance.manage, NE majitel) zapíše
--      přes zapsat_rucni_dochazku VLASTNÍ ruční docházku → odmítnuto,
--      hláška je slovo od slova stejná jako u upravit_usek_dochazky
--      (jen „upravit" → „zapsat").
--   2. otázka 25 — vedoucí zapíše docházku KOLEGY → projde
--      (nezměněné chování).
--   3. otázka 25 — majitel zapíše VLASTNÍ ruční docházku → projde
--      (majitel je výjimka ze stejného pravidla).
--   4. otázka 31 — přímý INSERT do attendance_events jako
--      authenticated (mimo RPC) je odmítnutý GRANTEM, ne jen RLS —
--      ani vedoucímu, ani majiteli.
--   5. otázka 33 — příchod i odchod ve STEJNOU chvíli (ruční zápis):
--      app.otevreny_prichod a app.useky_dochazky se SHODNOU, že úsek
--      není otevřený (přesně incident z ostré DB 27. 9. 2026).
--   6. otázka 33 — dva otevřené příchody bez odchodu týž den: oba
--      zdroje pravdy ukážou TENTÝŽ záznam jako „otevřený" (první,
--      ne novější podle času).
--   7. otázka 33 — app.otevreny_prichod nepřeskočí do cizí firmy:
--      cizí zaměstnanec s doopravdy otevřeným příchodem, zavolaný
--      s NAŠÍM tenantem, nevrátí nic (nezávislé ověření zvenčí, ne
--      jen čtení zdrojového textu funkce).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Vzor z krok63: insufficient_privilege sám o sobě nestačí, RLS hlásí
-- týž errcode 42501 jinou větou. Grantová chyba začíná „permission
-- denied", RLS „new row violates row-level security policy".
create or replace function pg_temp.spadne_pravem(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return sqlerrm like 'permission denied%';
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA — vlastní lidé, ne ze seedu a ne z krok67.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as majitel_emp from public.employees
  where tenant_id = :'tenant' and user_id = :'majitel' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('68680000-0000-0000-0000-000000000001', 'vedouci66@foodtab.cz', '{"full_name":"Vedoucí Šestašedesát"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '68680000-0000-0000-0000-000000000001', 'Vedoucí Šestašedesát', 'hpp')
returning id as vedouci66 \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Kolega Šestašedesát', 'hpp')
returning id as kolega66 \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '68680000-0000-0000-0000-000000000001', null, 'branch', 'active')
returning id as clen_vedouci66 \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'clen_vedouci66', :'perla');

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'vedouci66', 'attendance.read',   true),
  (:'tenant', :'vedouci66', 'attendance.manage', true);

select set_config('test.tenant',      :'tenant',      false);
select set_config('test.perla',       :'perla',       false);
select set_config('test.majitel',     :'majitel',     false);
select set_config('test.majitel_emp', :'majitel_emp', false);
select set_config('test.vedouci66',   :'vedouci66',   false);
select set_config('test.kolega66',    :'kolega66',    false);


\echo ''
\echo '== 1. Otázka 25 — vedoucí si vlastní ruční docházku nezapíše ='

set role authenticated;
select set_config('test.user_id', '68680000-0000-0000-0000-000000000001', false);

do $$
declare
  v_ok  boolean := false;
  v_msg text    := null;
begin
  begin
    perform public.zapsat_rucni_dochazku(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
      current_setting('test.vedouci66')::uuid, 'in', timestamp '2026-09-19 08:00', 'sám sobě, nemělo by projít');
  exception when insufficient_privilege then
    v_ok := true; v_msg := sqlerrm;
  end;
  perform pg_temp.check('vedoucí si vlastní ruční docházku nezapíše (otázka 25)', v_ok);
  perform pg_temp.check(
    'hláška slovo od slova stejná jako upravit_usek_dochazky (jen "upravit"→"zapsat")',
    v_msg = 'Vlastní docházku si zapsat nemůžete — udělá to majitel nebo jiný vedoucí.');
end $$;

-- Katalogová kontrola vedle chování: stejný styl hlášky sedí i ve
-- zdrojovém textu všech tří funkcí, ne jen v tom, co se náhodou
-- vyzkoušelo výš.
select pg_temp.check(
  'zapsat_rucni_dochazku, upravit_usek_dochazky a stornovat_usek_dochazky mají stejný styl hlášky "vlastní docházku"',
  pg_get_functiondef('public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text)'::regprocedure)
    like '%Vlastní docházku si zapsat nemůžete — udělá to majitel nebo jiný vedoucí.%'
  and pg_get_functiondef(
        'public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text)'::regprocedure)
    like '%Vlastní docházku si upravit nemůžete — udělá to majitel nebo jiný vedoucí.%'
  and pg_get_functiondef('public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text)'::regprocedure)
    like '%Vlastní docházku si stornovat nemůžete — udělá to majitel nebo jiný vedoucí.%');


\echo ''
\echo '== 2. Otázka 25 — vedoucí kolegovi ruční docházku zapíše ====='

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'kolega66', 'in', timestamp '2026-09-19 09:00', 'zapsal vedoucí kolegovi')
  as zr_kolega \gset
select pg_temp.check('vedoucí ale KOLEGOVI ruční záznam zapíše (nezměněné chování)',
  :'zr_kolega' is not null);

select public.stornovat_usek_dochazky(:'tenant', :'kolega66', :'zr_kolega', null, 'úklid krok68');
reset role;


\echo ''
\echo '== 3. Otázka 25 — majitel VLASTNÍ ruční docházku zapíše ======'

select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'majitel_emp', 'in', timestamp '2026-09-19 10:00', 'majitel sám sobě')
  as zr_majitel \gset
select pg_temp.check('majitel zapíše VLASTNÍ ruční docházku — výjimka z otázky 25',
  :'zr_majitel' is not null);

select public.stornovat_usek_dochazky(:'tenant', :'majitel_emp', :'zr_majitel', null, 'úklid krok68');
reset role;


\echo ''
\echo '== 4. Otázka 31 — přímý INSERT je zavřený GRANTEM, ne jen RLS ='

select pg_temp.check('katalog: authenticated nemá na attendance_events INSERT na úrovni tabulky',
  not has_table_privilege('authenticated', 'public.attendance_events', 'INSERT'));
select pg_temp.check('katalog: authenticated nemá INSERT na žádném sloupci attendance_events',
  not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.attendance_events'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')));

select set_config('test.user_id', '68680000-0000-0000-0000-000000000001', false);
set role authenticated;
select pg_temp.check('vedoucí: přímý insert (mimo RPC) spadne na GRANTU, ne na RLS (otázka 31)',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source) '
    'values (%L, %L, %L, ''in'', now(), ''app'')',
    current_setting('test.tenant'), current_setting('test.perla'), current_setting('test.kolega66'))));
reset role;

select set_config('test.user_id', :'majitel', false);
set role authenticated;
select pg_temp.check('majitel: přímý insert (mimo RPC) taky spadne na GRANTU, ne na RLS (otázka 31)',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source) '
    'values (%L, %L, %L, ''in'', now(), ''app'')',
    current_setting('test.tenant'), current_setting('test.perla'), current_setting('test.majitel_emp'))));
reset role;


\echo ''
\echo '== 5. Otázka 33 — příchod i odchod ve STEJNOU chvíli ========='

/*
  Přesně incident z ostré DB 27. 9. 2026 (docs/hlaseni/otazky.md,
  otázka 33): ruční příchod a odchod na stejný okamžik. Dřív
  app.otevreny_prichod chtěl odchod OSTŘE později, takže tvrdil
  „v práci"; app.useky_dochazky ho spároval jako úsek 0 min. Teď musí
  oba zdroje pravdy říct totéž.
*/
select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'kolega66', 'in',  timestamp '2026-09-20 09:00', 'stejná chvíle — příchod') as sm_in  \gset
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'kolega66', 'out', timestamp '2026-09-20 09:00', 'stejná chvíle — odchod')  as sm_out \gset

reset role;

select pg_temp.check('app.useky_dochazky: úsek 0 min, NE otevřený',
  (select u.druh          from app.useky_dochazky(:'kolega66', '2026-09-20', '2026-09-20') u) = 'usek'
  and (select u.cistych_sekund from app.useky_dochazky(:'kolega66', '2026-09-20', '2026-09-20') u) = 0);

select pg_temp.check('app.otevreny_prichod SE SHODUJE: taky NENÍ otevřeno (otázka 33)',
  not exists (select 1 from app.otevreny_prichod(:'tenant', :'kolega66')));

-- Storno je zároveň důkaz: dřív by ho databáze odmítla, protože zámek
-- řádku hledá otevřený úsek, který automat podle staré definice
-- app.otevreny_prichod neviděl.
select set_config('test.user_id', :'majitel', false);
set role authenticated;
select stornovano as sm_pocet
  from public.stornovat_usek_dochazky(:'tenant', :'kolega66', :'sm_in', :'sm_out', 'úklid krok68') \gset
reset role;
select pg_temp.check('storno úseku 0 min projde (dřív by spadlo na „Mezitím to někdo změnil")',
  :sm_pocet = 2);


\echo ''
\echo '== 6. Otázka 33 — dva otevřené příchody, oba zdroje se shodnou'

/*
  Jen ruční zápis tohle umí (app.pichnout druhý příchod týž provozní
  den vždy odmítne). Porovnání je PŘÍMO mezi app.otevreny_prichod
  a app.useky_dochazky — ne vůči id vymyšlenému předem.
*/
select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'kolega66', 'in', timestamp '2026-09-21 08:00', 'první příchod') as dv_prvni \gset
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'kolega66', 'in', timestamp '2026-09-21 08:30', 'druhý příchod, omylem') as dv_druhy \gset

reset role;

select pg_temp.check('app.otevreny_prichod ukazuje TENTÝŽ záznam jako řádek "otevreny" z app.useky_dochazky',
  (select id from app.otevreny_prichod(:'tenant', :'kolega66'))
  is not distinct from
  (select u.prichod_id from app.useky_dochazky(:'kolega66', '-infinity'::date, 'infinity'::date) u
    where u.druh = 'otevreny'
    order by u.prichod desc limit 1));

select pg_temp.check('a je to ten PRVNÍ příchod (pořadí rozhoduje, ne novější čas)',
  (select id from app.otevreny_prichod(:'tenant', :'kolega66')) = :'dv_prvni');

select pg_temp.check('druhý příchod je navic_prichod, ne druhé "otevřeno"',
  (select u.druh from app.useky_dochazky(:'kolega66', '2026-09-21', '2026-09-21') u
    where u.prichod_id = :'dv_druhy') = 'navic_prichod');

-- Úklid. Pořadí záleží (navic_prichod dřív, stejná past jako krok67):
-- storno prvního (otevřeného) by jinak tiše překlopilo druhý příchod
-- z navic_prichod na otevreny.
select set_config('test.user_id', :'majitel', false);
set role authenticated;
select public.stornovat_usek_dochazky(:'tenant', :'kolega66', :'dv_druhy', null, 'úklid krok68');
select public.stornovat_usek_dochazky(:'tenant', :'kolega66', :'dv_prvni', null, 'úklid krok68');
reset role;

select pg_temp.check('po úklidu: kolega už nemá žádný otevřený příchod',
  not exists (select 1 from app.otevreny_prichod(:'tenant', :'kolega66')));


\echo ''
\echo '== 7. Otázka 33 — app.otevreny_prichod nepřeskočí do cizí firmy'

/*
  app.otevreny_prichod dostává p_tenant jako parametr, ne z auth.uid() —
  jediná hranice mezi firmami je `e.tenant_id = p_tenant` (migrace
  20260929110000, sekce 3). app.useky_dochazky sama tenant nehlídá
  (pravidlo 7b — definer funkce si tenant musí ohlídat sama, volá ji
  jen tahle funkce, která to dělá). Nezávislé ověření ZVENKU, ne jen
  čtení zdrojového textu: cizí zaměstnanec s doopravdy otevřeným
  příchodem, zavolaný s NAŠÍM tenantem, nesmí nic vrátit; se svým
  vlastním tenantem musí vrátit přesně ten řádek — jinak by byla
  kontrola sama nesmyslná (memory projektu, „definer funkce nemá
  druhou linii").
*/

insert into public.tenants (name, currency, timezone)
values ('Konkurence Šestašedesát s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_tenant \gset

insert into public.branches (tenant_id, name, slug, timezone, day_starts_at)
values (:'cizi_tenant', 'Konkurence — pobočka', 'konkurence-66', 'Europe/Prague', '05:00')
returning id as cizi_branch \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'cizi_tenant', :'cizi_branch', 'Cizák Šestašedesát', 'hpp')
returning id as cizi_zamestnanec \gset

insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source, note)
values (:'cizi_tenant', :'cizi_branch', :'cizi_zamestnanec', 'in', now(), 'manual', 'cizí firma, otevřený příchod')
returning id as cizi_prichod \gset

select pg_temp.check('příprava není nesmyslná: cizí firma se svým tenantem otevřený příchod vidí',
  (select id from app.otevreny_prichod(:'cizi_tenant', :'cizi_zamestnanec')) = :'cizi_prichod');

select pg_temp.check('app.otevreny_prichod s NAŠÍM tenantem a CIZÍM employee_id nevrátí nic (otázka 33 / pravidlo 7b)',
  not exists (select 1 from app.otevreny_prichod(:'tenant', :'cizi_zamestnanec')));


\echo ''
\echo '== KROK 68 HOTOV ==========================================='
