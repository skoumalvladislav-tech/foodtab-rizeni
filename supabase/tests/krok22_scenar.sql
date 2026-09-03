-- Scénář pro krok 22 — modul Komunikace, základ.
--
-- Pokrývá migraci 20260903100000_komunikace_zaklad a zadání
-- docs/komunikace-zadani.md, oddíl 6, body 4, 5, 6, 10 a 11.
--
-- Navazuje na etapa0_scenar.sql až krok21_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Záporné kontroly jsou tu důležitější než kladné. Je to po mzdách
-- nejcitlivější tabulka v aplikaci: jsou v ní stížnosti, zdraví a řeči
-- o penězích. Tichá díra v RLS tady znamená, že si lidé čtou navzájem
-- stížnosti — a nikdo se to nedozví.
--
-- Všechno se ptá POD ROLÍ `authenticated`, ne jako správce. Přesně na
-- tomhle dnes spadla barva u člověka: kontrola četla nový sloupec jako
-- superuživatel, kterému granty nic neříkají, a hlásila zeleno nad
-- aplikací, která padala.

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
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset
select user_id as cisnik  from public.profiles where email = 'cisnik@foodtab.cz'  \gset
select user_id as cizi    from public.profiles where email = 'cizi@jinafirma.cz' \gset

/*
  Zaměstnanecké řádky. Účet a zaměstnanec jsou dvě různé věci — vedoucí
  má v seedu profil i členství, ale zaměstnance ne, a bez něj by se
  nedal přidat do konverzace. Zakládá se jen ten, který chybí.
*/
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'vedouci', 'Vedoucí Zkušební', 'hpp'
where not exists (
  select 1 from public.employees where tenant_id = :'tenant' and user_id = :'vedouci'
);

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'majitel', 'Majitel Zkušební', 'hpp'
where not exists (
  select 1 from public.employees where tenant_id = :'tenant' and user_id = :'majitel'
);

select id as e_majitel from public.employees
  where tenant_id = :'tenant' and user_id = :'majitel' \gset
select id as e_vedouci from public.employees
  where tenant_id = :'tenant' and user_id = :'vedouci' \gset
select id as e_cisnik  from public.employees
  where tenant_id = :'tenant' and user_id = :'cisnik'  \gset

select set_config('test.tenant', :'tenant', false);

-- Osobní rozhovor číšníka s majitelem. Vedoucí v něm NENÍ.
-- (`test.konverzace` se nastaví hned pod ním — do-bloky psql proměnné
-- nevidí a berou hodnoty přes current_setting.)
insert into public.konverzace (tenant_id, druh, nazev, zalozil)
values (:'tenant', 'osobni', 'Výměna směny', :'e_cisnik')
returning id as k_osobni \gset

insert into public.konverzace_ucastnici (konverzace_id, employee_id)
values (:'k_osobni', :'e_cisnik'), (:'k_osobni', :'e_majitel');

insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text)
values (:'k_osobni', :'tenant', :'e_cisnik', 'Můžu si prohodit čtvrtek?')
returning id as z_osobni \gset

select set_config('test.konverzace', :'k_osobni', false);


\echo ''
\echo '== 1. Účastník čte, ostatní ne =========================='

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

select pg_temp.check('účastník svou konverzaci vidí',
  (select count(*) from public.konverzace where id = :'k_osobni') = 1);
select pg_temp.check('a její zprávy taky',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_osobni') = 1);

reset role;
set role authenticated;
select set_config('test.user_id', :'vedouci', false);

/*
  Vedoucí má people.manage a vidí na obě pobočky. Na cizí rozhovor to
  nestačí a stačit nesmí — účastnictví, ne oprávnění.
*/
select pg_temp.check('kdo není účastník, konverzaci nevidí',
  (select count(*) from public.konverzace where id = :'k_osobni') = 0);
select pg_temp.check('ani její zprávy',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_osobni') = 0);
select pg_temp.check('ani seznam účastníků',
  (select count(*) from public.konverzace_ucastnici where konverzace_id = :'k_osobni') = 0);

reset role;


\echo ''
\echo '== 2. Ani majitel do cizího rozhovoru nevidí ============'

-- Rozhovor dvou lidí, ve kterém majitel není. `app.has_access` mu dává
-- všechna práva aktivních modulů — kdyby čtení viselo na právu, četl by
-- každou stížnost, která na něj byla napsaná.

insert into public.konverzace (tenant_id, druh, nazev, zalozil)
values (:'tenant', 'osobni', 'Bez majitele', :'e_cisnik')
returning id as k_bez \gset

insert into public.konverzace_ucastnici (konverzace_id, employee_id)
values (:'k_bez', :'e_cisnik'), (:'k_bez', :'e_vedouci');

insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text)
values (:'k_bez', :'tenant', :'e_cisnik', 'Tohle majitel číst nemá.');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel cizí konverzaci nevidí',
  (select count(*) from public.konverzace where id = :'k_bez') = 0);
select pg_temp.check('a její zprávy nepřečte ani přímým dotazem',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_bez') = 0);

-- Ani průzorem: `precetl_si` se nejdřív zeptá, jestli je tazatel uvnitř.
select pg_temp.check('a průzor mu na cizí konverzaci neodpoví',
  public.precetl_si(:'k_bez', :'e_cisnik') is null);

reset role;


\echo ''
\echo '== 3. Vzkaz vedení adresovaný majiteli ==================='

-- Stížnost na vedoucího, která přistane vedoucímu, je horší než žádná
-- cesta: člověk si myslí, že si postěžoval, a jediné, čeho dosáhl, je
-- že si na sebe řekl.

insert into public.konverzace (tenant_id, druh, nazev, adresat, zalozil)
values (:'tenant', 'vedeni', 'Vzkaz vedení', 'majitel', :'e_cisnik')
returning id as k_vedeni \gset

insert into public.konverzace_ucastnici (konverzace_id, employee_id)
values (:'k_vedeni', :'e_cisnik'), (:'k_vedeni', :'e_majitel');

insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text)
values (:'k_vedeni', :'tenant', :'e_cisnik', 'Stížnost na vedoucího.');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel vzkaz adresovaný jemu vidí',
  (select count(*) from public.konverzace where id = :'k_vedeni') = 1);
reset role;

set role authenticated;
select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('vedoucí ho nevidí, i když má people.manage',
  (select count(*) from public.konverzace where id = :'k_vedeni') = 0);
select pg_temp.check('a nepřečte ani text stížnosti',
  (select count(*) from public.konverzace_zpravy
    where konverzace_id = :'k_vedeni') = 0);
reset role;


\echo ''
\echo '== 4. Mezi pobočkami ===================================='

-- Jediné místo, kde se hranice poboček schválně překračuje. Účastnictví
-- platí i tady — pobočka o ničem nerozhoduje.

insert into public.konverzace (tenant_id, druh, nazev, zalozil)
values (:'tenant', 'mezi_pobockami', 'Výpomoc na baru', :'e_majitel')
returning id as k_mezi \gset

insert into public.konverzace_ucastnici (konverzace_id, employee_id)
values (:'k_mezi', :'e_majitel'), (:'k_mezi', :'e_cisnik');

insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text)
values (:'k_mezi', :'tenant', :'e_majitel', 'Kdo vypomůže v sobotu na baru?');

set role authenticated;
select set_config('test.user_id', :'cisnik', false);
select pg_temp.check('účastník z druhé pobočky čte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_mezi') = 1);
reset role;

set role authenticated;
select set_config('test.user_id', :'vedouci', false);
select pg_temp.check('kdo v ní není, nečte ani mezi pobočkami',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_mezi') = 0);
reset role;


\echo ''
\echo '== 5. Čas přečtení nepřečte nikdo ======================='

/*
  Tohle je to přitvrzení: `precteno_do` nemá grant ani pro vlastníka
  řádku. Kdyby ho odesílatel viděl, vrátí se tlak zadními vrátky —
  „psal jsem ti to v jedenáct večer, tys to četl“. Technicky se nic
  nedoručilo, sociálně se doručilo všechno.

  Jedna kontrola hlídá dnešní obrazovku; grant hlídá i tu, kterou někdo
  přidá za rok.
*/

update public.konverzace_ucastnici
   set precteno_do = now()
 where konverzace_id = :'k_osobni' and employee_id = :'e_cisnik';

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

do $$
begin
  begin
    perform precteno_do from public.konverzace_ucastnici limit 1;
    raise exception 'SELHALO: čas přečtení šel přečíst přímo z tabulky';
  exception when insufficient_privilege then
    raise notice '  OK    čas přečtení se z tabulky přečíst nedá ani vlastníkovi';
  end;
end $$;

-- Ostatní sloupce ano — jinak by nešel vypsat seznam účastníků.
select pg_temp.check('ostatní sloupce účastníků číst jde',
  (select count(*) from public.konverzace_ucastnici
    where konverzace_id = :'k_osobni') = 2);

-- Svůj vlastní čas průzorem ano.
select pg_temp.check('svůj čas přečtení si člověk zjistí průzorem',
  public.moje_precteno_do(:'k_osobni') is not null);

reset role;
set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Cizí čas ne — jen ano/ne.
select pg_temp.check('druhý účastník se dozví jen ANO/NE',
  public.precetl_si(:'k_osobni', :'e_cisnik') = true);
select pg_temp.check('a u toho, kdo nečetl, NE',
  public.precetl_si(:'k_osobni', :'e_majitel') = false);
select pg_temp.check('svůj cizí čas průzorem nedostane',
  public.moje_precteno_do(:'k_osobni') is null);

reset role;


\echo ''
\echo '== 6. Cizí firma ========================================'
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

set role authenticated;
select set_config('test.user_id', :'cizi', false);

select pg_temp.check('cizí firma nevidí žádnou konverzaci',
  (select count(*) from public.konverzace where tenant_id = :'tenant') = 0);
select pg_temp.check('ani žádnou zprávu',
  (select count(*) from public.konverzace_zpravy where tenant_id = :'tenant') = 0);
select pg_temp.check('a průzor jí neodpoví',
  public.precetl_si(:'k_osobni', :'e_cisnik') is null);

reset role;


\echo ''
\echo '== 7. Vypnutý modul odmítne i přímé volání =============='

/*
  Pravidlo 5. Schovat obrazovku nestačí — dotaz musí odmítnout databáze.

  ROVNOU POZNÁMKA, CO TAHLE KONTROLA NEUMÍ. Konverzace visí na modulu
  `provoz` a ten se firmě vypnout NEDÁ: drží ho spoušť („Základní modul
  provoz musí zůstat aktivní“) a hlídá i prošlou platnost. Zkusil jsem
  obojí a obojí spadlo. Pro tenhle modul je tedy pravidlo 5 splněné
  tím, že vypnutý stav nemůže nastat — ne tím, že bych ho odzkoušel.

  Ověřuje se proto dvojice, která dohromady dává totéž: že
  `app.modul_zapnuty` opravdu rozliší vypnutý modul, a že se o ni
  politika opírá. Až konverzace někdy dostanou vlastní modul, dá se
  tohle nahradit přímou zkouškou.
*/

set role authenticated;
select set_config('test.user_id', :'cisnik', false);

select pg_temp.check('zapnutý modul funkce potvrdí',
  app.modul_zapnuty(:'tenant', 'provoz'));

-- Marketing tahle firma zapnutý nemá.
select pg_temp.check('nezapnutý modul funkce odmítne',
  not app.modul_zapnuty(:'tenant', 'marketing'));

-- A cizímu člověku neodpoví ani u zapnutého — není člen.
reset role;
set role authenticated;
select set_config('test.user_id', :'cizi', false);
select pg_temp.check('a nečlenovi firmy neodpoví vůbec',
  not app.modul_zapnuty(:'tenant', 'provoz'));
reset role;

select pg_temp.check('politika konverzací se o modul opírá',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'konverzace'
      and qual like '%modul_zapnuty%') = 1);

select pg_temp.check('a politika zpráv taky',
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'konverzace_zpravy'
      and qual like '%modul_zapnuty%') = 1);


\echo ''
\echo '== 8. Právo na naléhavou zprávu ========================='

select pg_temp.check('communication.urgent je v katalogu',
  (select count(*) from public.permissions where key = 'communication.urgent') = 1);

select pg_temp.check('a je označené jako citlivé',
  (select sensitive from public.permissions where key = 'communication.urgent'));

-- Samostatné, ne communication.manage: spravovat nástěnku a rozsvítit
-- ve dvě ráno telefon dvanácti lidem jsou dvě různé pravomoci.
select pg_temp.check('provozní ho v roli má',
  exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.key = 'provozni' and not r.is_owner
      and rp.permission_key = 'communication.urgent'
  ));

select pg_temp.check('kuchyně ne',
  not exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.key = 'kuchyne' and rp.permission_key = 'communication.urgent'
  ));


\echo ''
\echo '== 9. Tvar dat =========================================='

-- Pobočková konverzace bez pobočky nedává smysl a osobní s pobočkou
-- taky ne.
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.konverzace (tenant_id, druh, nazev)
    values (current_setting('test.tenant')::uuid, 'pobocka', 'Bez pobočky');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: pobočková konverzace prošla bez pobočky'; end if;
  raise notice '  OK    pobočková konverzace bez pobočky neprojde';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.konverzace (tenant_id, druh, nazev, adresat)
    values (current_setting('test.tenant')::uuid, 'osobni', 'S adresátem', 'majitel');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: adresát prošel i mimo vzkaz vedení'; end if;
  raise notice '  OK    adresát jinde než u vzkazu vedení neprojde';
end $$;

-- Prázdná zpráva není zpráva.
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.konverzace_zpravy (konverzace_id, tenant_id, text)
    values (current_setting('test.konverzace')::uuid,
            current_setting('test.tenant')::uuid, '   ');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prošla prázdná zpráva'; end if;
  raise notice '  OK    prázdná zpráva neprojde';
end $$;


\echo ''
\echo '== 10. Kdo z konverzace odešel, zpětně do ní nevidí ======'

/*
  `odesel_kdy` není jen popiska. Když někoho z rozhovoru vyřadím,
  nesmí ho číst dál — jinak by „odebrání z konverzace“ bylo jen
  schování tlačítka.

  Chyběla tu kontrola: rozbil jsem podmínku v `app.je_ucastnik`
  a scénář prošel. Tohle je ta chybějící.
*/

insert into public.konverzace (tenant_id, druh, nazev, zalozil)
values (:'tenant', 'osobni', 'Odejde z ní', :'e_majitel')
returning id as k_odchod \gset

insert into public.konverzace_ucastnici (konverzace_id, employee_id)
values (:'k_odchod', :'e_majitel'), (:'k_odchod', :'e_cisnik');

insert into public.konverzace_zpravy (konverzace_id, tenant_id, autor, text)
values (:'k_odchod', :'tenant', :'e_majitel', 'Ještě než odešel.');

set role authenticated;
select set_config('test.user_id', :'cisnik', false);
select pg_temp.check('dokud je uvnitř, čte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_odchod') = 1);
reset role;

update public.konverzace_ucastnici
   set odesel_kdy = now()
 where konverzace_id = :'k_odchod' and employee_id = :'e_cisnik';

set role authenticated;
select set_config('test.user_id', :'cisnik', false);
select pg_temp.check('po odchodu už konverzaci nevidí',
  (select count(*) from public.konverzace where id = :'k_odchod') = 0);
select pg_temp.check('ani zprávy, které v ní zůstaly',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_odchod') = 0);
select pg_temp.check('a průzor mu na ni neodpoví',
  public.precetl_si(:'k_odchod', :'e_majitel') is null);
reset role;

-- Ten, kdo zůstal, čte dál. Odchod jednoho není konec rozhovoru.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('kdo zůstal, čte dál',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'k_odchod') = 1);
reset role;


\echo ''
\echo '== KROK 22 HOTOV ========================================='
