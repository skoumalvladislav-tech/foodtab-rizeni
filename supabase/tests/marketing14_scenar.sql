-- Scénář marketing 14 — měřitelné odkazy a metriky.
--
-- Pokrývá 20260914180000_marketing_metriky.sql.
-- Zadání: master prompt, oddíl 18.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- 1. Že proklik připočítá TÁŽ funkce, která vrací cíl — a že se
--    započítá právě jednou za volání.
--
-- 2. Že vypnutý i neexistující klíč dopadnou STEJNĚ: prázdno, ne
--    vysvětlení. Rozdíl by dovolil zkoušením klíčů zjistit, co která
--    restaurace chystala a co zrušila.
--
-- 3. Že metriky nedopíše přihlášený uživatel. Výkon příspěvku, do
--    kterého může kdokoli psát, není doklad o ničem.
--
-- 4. Že prázdná hodnota metriky JDE uložit. Je to celý smysl: NULL
--    znamená „síť to nedala", ne „bylo to nula".
--
-- ---------------------------------------------------------------------
-- FUNKCE JE `security definer` A VOLÁ JI NEPŘIHLÁŠENÝ
--
-- `/k/<klic>` otevírá host z Instagramu — účet u nás nemá a mít
-- nebude. Uvnitř se proto RLS neuplatní (skill `migrace`, oddíl 5)
-- a funkce si musí ohlídat sama, co vrací. Ověřuje se to pod rolí
-- `anon`, ne jako superuživatel.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select id as e_provozni from public.employees where user_id = :'provozni' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

insert into public.marketing_odkazy
  (tenant_id, branch_id, klic, cil, popis, utm_source, utm_medium, utm_campaign, vytvoril)
values (:'tenant', :'perla', 'zabijac2', 'https://cernaperla.cz/rezervace',
        'Rezervace na zabijačku', 'instagram', 'social', 'zabijacka', :'e_provozni')
returning id as odkaz \gset

insert into public.marketing_odkazy
  (tenant_id, branch_id, klic, cil, popis, aktivni, vytvoril)
values (:'tenant', :'perla', 'vypnuty2', 'https://cernaperla.cz/stare',
        'Loňská akce', false, :'e_provozni')
returning id as odkaz_vypnuty \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Proklik se počítá při přesměrování ===================='

select pg_temp.check('nový odkaz má nula prokliků',
  (select prokliku from public.marketing_odkazy where id = :'odkaz') = 0);

/*
  Volá se pod rolí `anon`, tedy jako host z Instagramu. Kdyby se to
  zkoušelo jako superuživatel, neověřilo by se, že na to nepřihlášený
  vůbec dosáhne — a přesně o to tu jde.
*/
set role anon;
select public.marketing_prejit('zabijac2') as cil1 \gset
reset role;

select pg_temp.check('nepřihlášený dostal cíl',
  :'cil1' like 'https://cernaperla.cz/rezervace%');

select pg_temp.check('a proklik se připočetl',
  (select prokliku from public.marketing_odkazy where id = :'odkaz') = 1);

select pg_temp.check('a zapsal se čas posledního kliknutí',
  (select posledni_klik from public.marketing_odkazy where id = :'odkaz') is not null);

set role anon;
select public.marketing_prejit('zabijac2') as cil2 \gset
select public.marketing_prejit('zabijac2') as cil3 \gset
reset role;

/*
  TŘI VOLÁNÍ = TŘI PROKLIKY. Kdyby se počítalo jinde než v té funkci,
  rozešlo by se to pokaždé, když jedno z toho selže.
*/
select pg_temp.check('tři volání dala tři prokliky',
  (select prokliku from public.marketing_odkazy where id = :'odkaz') = 3);


\echo ''
\echo '== 2. UTM se přidávají až při přesměrování =================='

/*
  V odkazu je uložený holý cíl. UTM se přilepí až tady, takže se dají
  opravit, aniž se mění to, co je vytištěné na plakátu.
*/
select pg_temp.check('v uloženém cíli žádné UTM nejsou',
  (select cil from public.marketing_odkazy where id = :'odkaz') not like '%utm_%');

select pg_temp.check('ale ve vráceném ano', :'cil1' like '%utm_source=instagram%');
select pg_temp.check('včetně media', :'cil1' like '%utm_medium=social%');
select pg_temp.check('a kampaně', :'cil1' like '%utm_campaign=zabijacka%');

/*
  Otazník proti ampersandu. Kdyby se lepilo vždycky otazníkem, vznikla
  by u cíle s parametrem adresa se dvěma otazníky — a ta nefunguje.
*/
reset role;
insert into public.marketing_odkazy (tenant_id, branch_id, klic, cil, vytvoril)
values (:'tenant', :'perla', 'sparam2', 'https://cernaperla.cz/menu?den=pa', :'e_provozni')
returning id as odkaz_param \gset

set role anon;
select public.marketing_prejit('sparam2') as cil_param \gset
reset role;

select pg_temp.check('cíl s parametrem dostane ampersand, ne druhý otazník',
  :'cil_param' like 'https://cernaperla.cz/menu?den=pa&utm_source=%'
  and (length(:'cil_param') - length(replace(:'cil_param', '?', ''))) = 1);


\echo ''
\echo '== 3. Vypnutý a neznámý klíč dopadnou STEJNĚ ================'

set role anon;
select coalesce(public.marketing_prejit('vypnuty2'), '') as vypnuty \gset
select coalesce(public.marketing_prejit('neexist2'), '') as neznamy \gset
reset role;

/*
  `coalesce` schválně: `\gset` nad NULL proměnnou NEZALOŽÍ (CLAUDE.md)
  a další řádek by spadl na „syntax error at or near :" — tedy na
  něčem, co se vůbec netváří jako chyba v datech.
*/
select pg_temp.check('vypnutý klíč nevrací nic', :'vypnuty' = '');
select pg_temp.check('neznámý klíč taky ne', :'neznamy' = '');
select pg_temp.check('a je to úplně TOTÉŽ — nedá se je od sebe poznat',
  :'vypnuty' = :'neznamy');

select pg_temp.check('vypnutému odkazu se proklik nepřipočetl',
  (select prokliku from public.marketing_odkazy where id = :'odkaz_vypnuty') = 0);


\echo ''
\echo '== 4. Cizí firma odkazy nevidí ============================='

/*
  Klíč je jedinečný globálně, takže adresa firmu nenese. Přes funkci
  se cíl dozví kdokoli — to je záměr, je to veřejný odkaz. Ale SEZNAM
  odkazů je firemní věc: z něj by se dalo vyčíst, co restaurace chystá.
*/
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

set role authenticated;
select set_config('test.user_id', :'cizi', false);

select pg_temp.check('cizí firma seznam odkazů nevidí',
  (select count(*) from public.marketing_odkazy where tenant_id = :'tenant') = 0);

reset role;


\echo ''
\echo '== 5. Metriky: prázdno jde uložit, uživatel je nedopíše ====='

/*
  Dva samostatné inserty, ne jeden vnořený. Zkusil jsem
  `insert … select … from (insert … returning) p` a psql na tom spadl
  na „syntax error at or near into": data-modifying statement se
  ve `from` použít nedá, jen v `with`. Dva řádky jsou čitelnější než
  CTE, které by tu bylo jen kvůli úspoře.
*/
insert into public.marketing_prispevky (tenant_id, branch_id, nazev, vytvoril)
values (:'tenant', :'perla', 'Měřený příspěvek', :'e_provozni')
returning id as prispevek \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek', 1, 'otisk-M', :'e_provozni')
returning id as verze \gset

insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze', 'otisk-M', :'e_provozni')
returning id as zadost \gset

/*
  SCHVÁLENÍ SE MUSÍ ODKLEPNOUT, JINAK ÚLOHA NEVZNIKNE.

  Narazil jsem na to při psaní: `app.marketing_strez_publikaci` odmítla
  úlohu větou „Schválení není platné (stav ceka)". Není to chyba
  scénáře ani modulu — je to ta pojistka, kvůli které celý modul stojí.
  Schvaluje majitel, ne žadatel: o vlastní žádosti se nerozhoduje.
*/
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost';
reset role;

insert into public.marketing_publikace_ulohy
  (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
   kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic, vytvoril)
values (:'tenant', :'prispevek', :'verze', 'otisk-M', :'zadost',
        'instagram', 'prispevek', 'mock', 'demo', now(), 'metriky-1', :'e_provozni')
returning id as uloha \gset

insert into public.marketing_publikace
  (tenant_id, branch_id, prispevek_id, verze_id, uloha_id, kanal, format, je_nanecisto)
values (:'tenant', :'perla', :'prispevek', :'verze', :'uloha', 'instagram', 'prispevek', true)
returning id as publikace \gset
select set_config('test.publikace', :'publikace', false);

/*
  PRÁZDNÁ HODNOTA JDE ULOŽIT, A JE TO CELÝ SMYSL.

  NULL = síť ten ukazatel nedala. Kdyby byl sloupec `not null`, musela
  by se neznámá čísla ukládat jako nula — a příspěvek, u kterého se
  nepodařilo nic stáhnout, by vypadal jako propadák.
*/
insert into public.marketing_metriky (tenant_id, publikace_id, den, ukazatel, hodnota, zdroj)
values (:'tenant', :'publikace', current_date, 'dosah', null, 'sit');

select pg_temp.check('prázdná hodnota se uložila jako prázdná',
  (select hodnota from public.marketing_metriky
    where publikace_id = :'publikace' and ukazatel = 'dosah') is null);

insert into public.marketing_metriky (tenant_id, publikace_id, den, ukazatel, hodnota, zdroj)
values (:'tenant', :'publikace', current_date, 'zobrazeni', 1240, 'sit');

select pg_temp.check('a skutečné číslo jako číslo',
  (select hodnota from public.marketing_metriky
    where publikace_id = :'publikace' and ukazatel = 'zobrazeni') = 1240);

/*
  JEDEN ŘÁDEK NA UKAZATEL A DEN. Stahování běží opakovaně a bez toho
  by se čísla načítala pokaždé znovu vedle sebe.
*/
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_metriky (tenant_id, publikace_id, den, ukazatel, hodnota, zdroj)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.publikace')::uuid, current_date, 'zobrazeni', 9999, 'sit');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: týž ukazatel se uložil za týž den dvakrát'; end if;
  raise notice '  OK    týž ukazatel za týž den podruhé neprojde';
end $$;

/*
  A ŽE JE ODHAD ODLIŠITELNÝ OD ZMĚŘENÉHO. Zadání: „Pokud není možné
  prokázat přímou atribuci, označ výsledek jako odhad a nepředstírej
  přesnost."
*/
insert into public.marketing_metriky (tenant_id, publikace_id, den, ukazatel, hodnota, zdroj)
values (:'tenant', :'publikace', current_date - 1, 'zobrazeni', 800, 'odhad');

select pg_temp.check('odhad je v datech odlišený od změřeného',
  (select count(distinct zdroj) from public.marketing_metriky
    where publikace_id = :'publikace' and ukazatel = 'zobrazeni') = 2);

/*
  UŽIVATEL METRIKY NEDOPÍŠE. Pro `authenticated` není `insert` grant
  vůbec — dostane 42501 dřív, než se dojde na politiku.
*/
set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_metriky (tenant_id, publikace_id, den, ukazatel, hodnota, zdroj)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.publikace')::uuid, current_date, 'reakce', 500, 'sit');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: uživatel dopsal metriku'; end if;
  raise notice '  OK    ani ten, kdo smí publikovat, metriku nedopíše';
end $$;

select pg_temp.check('ale číst je smí',
  (select count(*) from public.marketing_metriky where publikace_id = :'publikace') = 3);

reset role;

/*
  A TEĎ ZVLÁŠŤ OBĚ LINIE, PROTOŽE KONTROLA VÝŠ PLATÍ Z DVOU DŮVODŮ.

  Zjistil jsem to sabotáží: přidal jsem `authenticated` grant na
  `insert` a kontrola pořád procházela — zápis zastavila RLS, která
  pro `insert` žádnou politiku nemá. Obojí je správně (pravidlo 3,
  dvě obranné linie), ale kontrola, která nepozná, KTERÁ z nich drží,
  nechá tu druhou tiše zmizet.

  Měří se proto každá zvlášť.
*/
select pg_temp.check('PRVNÍ LINIE: uživatel na metriky nemá grant na zápis',
  not exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'marketing_metriky'
       and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE', 'DELETE')));

select pg_temp.check('DRUHÁ LINIE: a RLS pro zápis nemá politiku',
  not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'marketing_metriky'
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_metriky where tenant_id = :'tenant';
delete from public.marketing_publikace where tenant_id = :'tenant';
delete from public.marketing_publikace_ulohy where tenant_id = :'tenant';
delete from public.marketing_schvaleni where tenant_id = :'tenant';
delete from public.marketing_odkazy where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_odkazy where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_metriky where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 14 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
