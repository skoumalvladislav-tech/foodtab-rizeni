-- Scénář marketing 16 — profil značky z webu: nové sloupce.
--
-- Pokrývá 20260929140000_marketing_profil_sloupce.sql.
--
-- Zadání Šéfíka 1. 10. 2026: nástroj „Najít na webu" v Marketing →
-- Značka potřebuje čtyři nová pole (popis_firmy, web_url,
-- instagram_url, facebook_url) na `marketing_nastaveni`. Migrace sama
-- tvrdí, že RLS a granty se tím nemění, protože grant je na tabulku
-- celou a politiky se ptají jen na `tenant_id`/`branch_id` — tenhle
-- scénář to DOKAZUJE spuštěním, nebere tvrzení z komentáře migrace.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
--   1. Výchozí hodnota všech čtyř nových sloupců je '' (prázdný
--      řetězec), NE null — na rozdíl od `barva_hlavni` o pár řádků výš
--      ve stejné tabulce, kde chybějící barva je legitimní „nezadáno".
--   2. `marketing.manage` smí UPDATE nových sloupců PŘES STÁVAJÍCÍ
--      politiku `marketing_nastaveni_write` — žádná nová politika se
--      nepsala a tahle kontrola dokazuje, že stávající stačí.
--   3. `marketing.read` (bez `manage`) zápis do nových sloupců
--      NEPROVEDE — stejná politika ho musí odmítnout stejně jako
--      u starých sloupců.
--   4. Cizí firma novou dvojici řádků/sloupců nevidí ani nezmění.
--
-- ---------------------------------------------------------------------
-- CO SE TU NAD PGLITE NEOVĚŘÍ
--
-- PGlite běží jako superuživatel a sloupcové granty se tam vůbec
-- neprojeví (skill `foodtab-db-security`, „Sloupcové granty"). Grant
-- u týhle tabulky je ale CELOTABULKOVÝ (ne po sloupcích jako
-- u `employees`), takže zrovna tahle mezera se scénáře netýká — nový
-- sloupec grant dědí automaticky, ať PGlite kouká, nebo ne.
--
-- Body 3 a 4 stojí na RLS nad obyčejnou tabulkou (žádná
-- `security definer` funkce, která by si chybu vynutila sama jako
-- u `marketing_okamzik` v marketing6) — podle `foodtab-e2e`/`scenar`
-- by se to nad PGlite nemuselo spolehlivě projevit. OVĚŘENO SCHVÁLNÝM
-- ROZBITÍM (`marketing_nastaveni_write` přepnuta na `marketing.read`):
-- PGlite ji přesto kousne — RLS se tu podle všeho vyhodnocuje správně,
-- i v PGlite. Přesto bod 4 (cizí firma) schválně rozbitý nebyl — jen
-- bod 3 — a nasazení pořád patří workflow Databáze proti opravdovému
-- PostgreSQL (`foodtab-e2e`), ne tomuhle běhu. Kontroly jsou navíc
-- napsané tak, aby nad rozbitou politikou SPADLY (čtou skutečnou
-- hodnotu po pokusu o zápis, nepředpokládají výsledek), ne aby mlčky
-- prošly.
--
-- Vlastní číselná řada (marketingN_scenar.sql), oddělená od provozní
-- krokN — CLAUDE.md, „Dvě relace v jednom repozitáři".

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

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as danuse  from public.profiles where email = 'danuse@foodtab.cz'  \gset
select id as e_danuse from public.employees
 where user_id = :'danuse' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

/*
  Danuše dostane jen `marketing.read`, ne `manage` — stejná osoba a
  stejný vzor jako v marketing11/12/13/15. Pobočku (Černá Perla) má
  z `krok25_scenar.sql` natrvalo, takže `app.can_read_scoped` pro ni
  u scope `perla` neselže na chybějícím členství.
*/
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_danuse', 'marketing.read', true)
on conflict (employee_id, permission_key) do update set granted = excluded.granted;


\echo ''
\echo '== 1. Výchozí hodnoty nových sloupců ========================='

insert into public.marketing_nastaveni (tenant_id, branch_id)
values (:'tenant', :'perla')
returning id as nastaveni \gset

select pg_temp.check('popis_firmy je prázdný řetězec, ne null',
  (select popis_firmy from public.marketing_nastaveni where id = :'nastaveni') = '');
select pg_temp.check('web_url je prázdný řetězec, ne null',
  (select web_url from public.marketing_nastaveni where id = :'nastaveni') = '');
select pg_temp.check('instagram_url je prázdný řetězec, ne null',
  (select instagram_url from public.marketing_nastaveni where id = :'nastaveni') = '');
select pg_temp.check('facebook_url je prázdný řetězec, ne null',
  (select facebook_url from public.marketing_nastaveni where id = :'nastaveni') = '');

-- Barva vedle nich v téže tabulce je naopak nullable — ověřuje se tu,
-- že se migrace nespletla a neudělala default i tam, kde žádný být nemá.
select pg_temp.check('barva_hlavni zůstává null (nedotčené pole, kontrola nad kontrolou)',
  (select barva_hlavni from public.marketing_nastaveni where id = :'nastaveni') is null);


\echo ''
\echo '== 2. marketing.read vidí nové sloupce stejně jako staré ====='

set role authenticated;
select set_config('test.user_id', :'danuse', false);

select pg_temp.check('marketing.read přečte prázdné hodnoty nových sloupců',
  (select count(*) from public.marketing_nastaveni
    where id = :'nastaveni' and popis_firmy = '' and web_url = '') = 1);


\echo ''
\echo '== 3. marketing.manage smí UPDATE nových sloupců ============='

select set_config('test.user_id', :'majitel', false);

update public.marketing_nastaveni
   set popis_firmy   = 'Rodinná restaurace s grilovanou kuchyní',
       web_url        = 'https://www.cerna-perla.cz',
       instagram_url  = 'https://www.instagram.com/cerna_perla_tabor',
       facebook_url   = 'https://www.facebook.com/cernaperla'
 where id = :'nastaveni';

reset role;
select pg_temp.check('marketing.manage update persistuje ve všech čtyřech nových sloupcích',
  (select popis_firmy from public.marketing_nastaveni where id = :'nastaveni')
    = 'Rodinná restaurace s grilovanou kuchyní'
  and (select web_url from public.marketing_nastaveni where id = :'nastaveni')
    = 'https://www.cerna-perla.cz'
  and (select instagram_url from public.marketing_nastaveni where id = :'nastaveni')
    = 'https://www.instagram.com/cerna_perla_tabor'
  and (select facebook_url from public.marketing_nastaveni where id = :'nastaveni')
    = 'https://www.facebook.com/cernaperla');


\echo ''
\echo '== 4. marketing.read BEZ manage zápis do nových sloupců NEPROVEDE'

/*
  Kontrola čte SKUTEČNOU hodnotu po pokusu o zápis, nepředpokládá
  výsledek (scenar, bod 2) — ať UPDATE skončí tiše na nule řádků (USING
  klauzule řádek vůbec neuvidí), nebo by politika omylem propustila
  zápis, tahle kontrola to pozná ve všech případech stejně: podle toho,
  jestli se podezřelá hodnota opravdu objevila v databázi.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

update public.marketing_nastaveni
   set popis_firmy = 'POKUS O ZÁPIS BEZ MANAGE NEPROPUSTNE3317'
 where id = :'nastaveni';

reset role;
select pg_temp.check('zápis bez marketing.manage se do databáze nedostal',
  (select popis_firmy from public.marketing_nastaveni where id = :'nastaveni')
    <> 'POKUS O ZÁPIS BEZ MANAGE NEPROPUSTNE3317');


\echo ''
\echo '== 5. Cizí firma nevidí ani nezmění =========================='

reset role;
select app.create_tenant('Cizí profil s.r.o.', '26262626') as cizi_tenant \gset

insert into public.marketing_nastaveni (tenant_id, branch_id, popis_firmy, web_url)
values (:'cizi_tenant', null, 'Cizí popis NEPROPUSTNE8822', 'https://cizi-firma.example')
returning id as cizi_nastaveni \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('cizí firmu v přehledu nevidí vůbec',
  (select count(*) from public.marketing_nastaveni where tenant_id = :'cizi_tenant') = 0);

-- A OSTŘEJI: i když zná přesné `id` cizího řádku, UPDATE na něj nic
-- nezmění — stejná úvaha jako u `marketing_audit`/cizí firmy v marketing15.
update public.marketing_nastaveni
   set popis_firmy = 'PŘEPSÁNO CIZÍM NEPROPUSTNE8822'
 where id = :'cizi_nastaveni';

reset role;
select pg_temp.check('cizí řádek zůstal nedotčený i při zásahu podle id',
  (select popis_firmy from public.marketing_nastaveni where id = :'cizi_nastaveni')
    = 'Cizí popis NEPROPUSTNE8822');


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.tenants where id = :'cizi_tenant';
delete from public.marketing_nastaveni where id = :'nastaveni';
delete from public.employee_permissions
 where employee_id = :'e_danuse' and permission_key = 'marketing.read';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  not exists (select 1 from public.tenants where id = :'cizi_tenant')
  and not exists (select 1 from public.marketing_nastaveni where id = :'nastaveni')
  and not exists (select 1 from public.employee_permissions
                   where employee_id = :'e_danuse' and permission_key = 'marketing.read')
  and not exists (select 1 from public.tenant_modules
                   where tenant_id = :'tenant' and module_key = 'marketing'));


\echo ''
\echo '=========================================================='
\echo ' MARKETING 16 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
