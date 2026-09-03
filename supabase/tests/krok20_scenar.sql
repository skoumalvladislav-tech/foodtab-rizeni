-- Scénář pro krok 20 — šablony směn (D, N, R) s časy podle pozice.
--
-- Pokrývá migraci 20260903060000_sablony_smen a zadání
-- docs/sablony-smen-zadani.md, oddíl 7.
--
-- Navazuje na etapa0_scenar.sql až krok19_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Šablona je PŘEDVYPLNĚNÍ, ne vazba. Nejdůležitější kontrola v tomhle
-- souboru je ta čtvrtá: změna šablony nesmí pohnout už zadanou směnou.
-- Kdyby ano, stačilo by opravit D z 9:00 na 9:30 a lidem by se tiše
-- posunul rozpis, podle kterého si zařizují život.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

insert into public.positions (tenant_id, key, label, department)
values (:'tenant', 'zk_kuchar', 'Zkouška — kuchař', 'kuchyne')
on conflict (tenant_id, key) do update set label = excluded.label
returning id as poz_kuchar \gset

insert into public.positions (tenant_id, key, label, department)
values (:'tenant', 'zk_cisnik', 'Zkouška — číšník', 'servis')
on conflict (tenant_id, key) do update set label = excluded.label
returning id as poz_cisnik \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Šablonový Kuchař', 'hpp')
returning id as e_kuchar \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla',  :'perla',  false);


\echo ''
\echo '== 1. Kuchař a číšník mají oba D, a jiné časy ============'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Firemní pravidlo pro kuchaře a pro číšníka. Táž zkratka, jiné časy.
select public.ulozit_sablonu(:'tenant', null, null, :'poz_kuchar',
  'D', 'Denní', time '07:30', time '22:00') as s_kuchar \gset
select public.ulozit_sablonu(:'tenant', null, null, :'poz_cisnik',
  'D', 'Denní', time '09:00', time '22:00') as s_cisnik \gset

select starts_at as od_kuchar from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar') \gset
select starts_at as od_cisnik from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_cisnik') \gset

select pg_temp.check('kuchař má D od 7:30', :'od_kuchar' = '07:30:00');
select pg_temp.check('číšník má D od 9:00',  :'od_cisnik' = '09:00:00');
select pg_temp.check('a nejsou to tytéž časy', :'od_kuchar' <> :'od_cisnik');


\echo ''
\echo '== 2. Bez pozice se použije obecné pravidlo =============='

/*
  Dnes má pozici jediný člověk z dvanácti, takže tohle je ta nejčastější
  cesta. Nesmí se stát nic záhadného.
*/
select pg_temp.check('bez obecného pravidla se nenabídne nic',
  (select count(*) from public.sablony_pro_smenu(:'tenant', :'perla', null)) = 0);

select public.ulozit_sablonu(:'tenant', null, null, null,
  'D', 'Denní', time '10:00', time '18:00') as s_obecna \gset

select starts_at as od_bez from public.sablony_pro_smenu(:'tenant', :'perla', null) \gset
select pg_temp.check('teď se nabídne obecné D od 10:00', :'od_bez' = '10:00:00');

select pg_temp.check('ale kuchař má pořád svoje 7:30',
  (select starts_at from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar'))
  = time '07:30');


\echo ''
\echo '== 3. Pobočkové pravidlo přebije firemní ================='

select public.ulozit_sablonu(:'tenant', null, :'perla', :'poz_kuchar',
  'D', 'Denní na Perle', time '06:00', time '14:00') as s_perla \gset

select pg_temp.check('na Perle platí pobočkové 6:00',
  (select starts_at from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar'))
  = time '06:00');

select pg_temp.check('na Bernard Baru pořád firemní 7:30',
  (select starts_at from public.sablony_pro_smenu(:'tenant', :'bar', :'poz_kuchar'))
  = time '07:30');

select pg_temp.check('a z jednoho klíče se nabídne jen jedna',
  (select count(*) from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar')
   where klic = 'D') = 1);


\echo ''
\echo '== 4. Změna šablony NEZMĚNÍ už zadané směny =============='

/*
  Tohle je ta kontrola, kvůli které je `sablona_key` text a ne odkaz.
*/
select smena as sm from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_kuchar', :'poz_kuchar',
  date '2026-11-10', time '06:00', time '14:00', 'podle šablony', 'D') \gset

reset role;

select pg_temp.check('směna si opsala časy',
  (select starts_at::text || '-' || ends_at::text from public.shifts where id = :'sm')
  = '06:00:00-14:00:00');
select pg_temp.check('a opsala si i zkratku, ať je v kalendáři vidět D',
  (select sablona_key from public.shifts where id = :'sm') = 'D');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Šéfík opraví šablonu.
select public.ulozit_sablonu(:'tenant', :'s_perla', :'perla', :'poz_kuchar',
  'D', 'Denní na Perle', time '06:30', time '14:30');

reset role;

select pg_temp.check('už zadaná směna se NEPOHNULA',
  (select starts_at::text || '-' || ends_at::text from public.shifts where id = :'sm')
  = '06:00:00-14:00:00');

select pg_temp.check('a nová by se předvyplnila už novým časem',
  (select starts_at from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar'))
  = time '06:30');

/*
  A pojistka do budoucna: v `shifts` nesmí být cizí klíč na šablonu.
  Kdyby ho tam někdo přidal, celá tahle úvaha padá.
*/
select pg_temp.check('shifts nemá cizí klíč na šablony',
  not exists (
    select 1 from information_schema.referential_constraints rc
    join information_schema.key_column_usage k
      on k.constraint_name = rc.constraint_name
    where k.table_name = 'shifts'
      and rc.unique_constraint_name in (
        select constraint_name from information_schema.table_constraints
        where table_name = 'sablony_smen' and constraint_type = 'PRIMARY KEY')));


\echo ''
\echo '== 5. Šablona přes půlnoc ==============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.ulozit_sablonu(:'tenant', null, null, null,
  'N', 'Noční', time '22:00', time '06:00') as s_nocni \gset

select minut as minut_n from public.sablony_pro_smenu(:'tenant', :'perla', null)
  where klic = 'N' \gset

select pg_temp.check('noční má osm hodin, ne mínus šestnáct', :'minut_n'::integer = 480);

select smena as sm_noc, varovani as v_noc from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_kuchar', null,
  date '2026-11-12', time '22:00', time '06:00', 'noční', 'N') \gset

reset role;

select pg_temp.check('směna z noční šablony říká, že končí druhý den',
  exists (select 1 from unnest(:'v_noc'::text[]) v where v like '%druhý den%'));

/*
  Směna nemá sloupec provozního dne — ten má docházka. Rozpis má
  shift_date, a noční směna zůstává na dni, kdy začala; to je i den,
  pod kterým ji kiosek ukáže v „dnes na směně“.
*/
select pg_temp.check('noční zůstává na dni, kdy začala',
  (select shift_date from public.shifts where id = :'sm_noc') = date '2026-11-12');

select pg_temp.check('a den se od zadaného neposunul',
  (select count(*) from public.shifts
   where id = :'sm_noc' and shift_date = date '2026-11-13') = 0);


\echo ''
\echo '== 6. Doplněné časy jde přepsat =========================='

/*
  Záskok od devíti do dvou je normální den v provozu, ne odchylka.
*/
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as sm_zaskok from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_kuchar', :'poz_kuchar',
  date '2026-11-13', time '09:00', time '14:00', 'záskok', 'D') \gset

reset role;

select pg_temp.check('uložilo se to, co člověk přepsal, ne co dala šablona',
  (select starts_at::text || '-' || ends_at::text from public.shifts where id = :'sm_zaskok')
  = '09:00:00-14:00:00');


\echo ''
\echo '== 7. Dvě šablony s týmž klíčem nejdou ==================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_sablonu(
      current_setting('test.tenant')::uuid, null,
      current_setting('test.perla')::uuid,
      (select id from public.positions where tenant_id = current_setting('test.tenant')::uuid
         and key = 'zk_kuchar'),
      'D', 'Druhá denní', time '08:00', time '16:00');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: dvě D pro tutéž pobočku a pozici prošly'; end if;
  raise notice '  OK    dvě šablony s týmž klíčem pro tutéž pobočku a pozici neprojdou';
end $$;

-- A malé „d“ je totéž co „D“ — kvůli budoucímu nahrávání z Excelu.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_sablonu(
      current_setting('test.tenant')::uuid, null, null, null,
      ' d ', 'Denní jinak', time '08:00', time '16:00');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: „ d “ prošlo vedle „D“'; end if;
  raise notice '  OK    „ d “ je totéž co „D“';
end $$;

reset role;


\echo ''
\echo '== 8. Cizí firma svoje šablony nevidí ===================='

select id as tenant2 from public.tenants where name = 'Jiná firma s.r.o.' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

set role authenticated;
select set_config('test.user_id', :'cizi', false);

select pg_temp.check('cizí účet naše šablony nedostane',
  (select count(*) from public.sablony_pro_smenu(:'tenant', :'perla', null)) = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ulozit_sablonu(
      current_setting('test.tenant')::uuid, null, null, null,
      'X', 'Cizí', time '08:00', time '16:00');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí účet založil šablonu'; end if;
  raise notice '  OK    cizí účet šablonu nezaloží';
end $$;

reset role;


\echo ''
\echo '== 9. Vyřazení z nabídky je přepínač, ne jednosměrka ====='

-- Vyřadit šablonu je běžný překlep. Obrazovka Pozice to má obousměrné
-- a šablony se mají chovat stejně; kdyby to šlo jen jedním směrem,
-- musela by se zakládat nová zkratka a stará by překážela v nabídce.

select user_id as marek from public.profiles where email = 'cisnik@foodtab.cz' \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select id as sab_perla from public.sablony_smen
  where tenant_id = :'tenant' and branch_id = :'perla'
  order by created_at limit 1 \gset
select set_config('test.sablona', :'sab_perla', false);

select pg_temp.check('než se vyřadí, v nabídce je',
  (select count(*) from public.sablony_smen
    where id = :'sab_perla' and active) = 1);

select public.prepnout_sablonu(:'tenant', :'sab_perla', false);

select pg_temp.check('vyřazená se přestane nabízet',
  (select count(*) from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar') t
    where t.id = :'sab_perla') = 0);

select pg_temp.check('ale z tabulky nezmizela',
  (select count(*) from public.sablony_smen where id = :'sab_perla') = 1);

select public.prepnout_sablonu(:'tenant', :'sab_perla', true);

select pg_temp.check('a vrátit do nabídky jde zase',
  (select count(*) from public.sablony_pro_smenu(:'tenant', :'perla', :'poz_kuchar') t
    where t.id = :'sab_perla') = 1);

reset role;

-- Kdo nespravuje nastavení, nepřepne ani jedním směrem.
set role authenticated;
select set_config('test.user_id', :'marek', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.prepnout_sablonu(
      current_setting('test.tenant')::uuid,
      current_setting('test.sablona')::uuid,
      false);
  exception
    when insufficient_privilege then v_ok := true;
    -- Když na ten řádek nedohlédne ani přes RLS, je to taky správně.
    when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník vyřadil šablonu z nabídky'; end if;
  raise notice '  OK    kdo nespravuje nastavení, šablonu nevyřadí';
end $$;

reset role;

-- A po tom všem musí zůstat zapnutá — kdyby ji číšník přece jen
-- přepnul, další kontroly by běžely nad jinými daty, než si myslí.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('a po pokusu je pořád v nabídce',
  (select active from public.sablony_smen where id = :'sab_perla'));
reset role;


\echo ''
\echo '== 10. Nabídka stojí v nastaveném pořadí ================='

-- Pořadí v nabídce řídí sloupec `poradi`, ne abeceda. Kdyby se řadilo
-- podle zkratky, přejmenování by přeházelo nabídku, na kterou jsou lidé
-- zvyklí — a v seznamu, kde se kliká rychle, se to pozná pozdě.
--
-- `with ordinality` je tu podstatné: bere pořadí, ve kterém řádky
-- doopravdy přišly. Kdyby se v `string_agg` seřadilo znovu podle
-- `poradi`, vyšla by kontrola vždycky — ověřila by vlastní ORDER BY,
-- ne to, co funkce vrátila.

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select public.ulozit_sablonu(
  :'tenant', null, null, null, 'A', 'Až úplně dole',
  time '10:00', time '18:00', 900);

select string_agg(t.klic, ',' order by t.n) as poradi_nabidky
from public.sablony_pro_smenu(:'tenant', :'perla', null)
  with ordinality as t(id, klic, label, starts_at, ends_at, minut, poradi, n) \gset

select pg_temp.check(
  'šablona s vysokým pořadím stojí až za ostatními (' || :'poradi_nabidky' || ')',
  :'poradi_nabidky' like '%A');

select pg_temp.check(
  'a není první, i když je v abecedě nejdřív',
  :'poradi_nabidky' not like 'A%');

reset role;

\echo ''
\echo '== 11. Do tabulky se píše jen přes funkce ================'

-- Tabulka má grant na ČTENÍ, ne na zápis. Správa potřebuje vidět
-- i vyřazené šablony, které nabídková funkce nevrací, ale zapisovat
-- se má výhradně přes `ulozit_sablonu` a `prepnout_sablonu` — tam
-- sedí kontroly práva, prázdných údajů, cizí pobočky i audit.
--
-- Kdyby se zápis dal obejít, dal by se obejít i audit: nikdo by
-- nepoznal, kdo přepsal D z 8–16 na 9–17.

set role authenticated;
select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.sablony_smen (tenant_id, key, label, starts_at, ends_at)
    values (current_setting('test.tenant')::uuid, 'Z', 'Zadem',
            time '01:00', time '02:00');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šablona se založila zadem, mimo ulozit_sablonu'; end if;
  raise notice '  OK    ani majitel nezaloží šablonu přímo do tabulky';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    update public.sablony_smen set starts_at = time '03:00'
     where tenant_id = current_setting('test.tenant')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: časy šablony se přepsaly zadem'; end if;
  raise notice '  OK    ani časy se přímo přepsat nedají';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    delete from public.sablony_smen
     where tenant_id = current_setting('test.tenant')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šablony se daly smazat'; end if;
  raise notice '  OK    a smazat se nedají vůbec';
end $$;

-- Čtení naopak fungovat MUSÍ — obrazovka Nastavení → Šablony sahá na
-- tabulku přímo, protože potřebuje i ty vyřazené.
select pg_temp.check('ale číst je správa smí',
  (select count(*) from public.sablony_smen
    where tenant_id = :'tenant') > 0);

reset role;

\echo ''
\echo '== KROK 20 HOTOV ========================================='
