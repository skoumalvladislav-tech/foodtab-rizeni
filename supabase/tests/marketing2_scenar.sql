-- Scénář marketing 2 — podklady modulu Marketing.
--
-- Pokrývá 20260909180000_marketing_podklady.sql:
-- marketing_nastaveni, marketing_media, marketing_sablony
-- a funkci public.marketing_znacka.
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 2.
--
-- ---------------------------------------------------------------------
-- CO TENHLE SCÉNÁŘ NAD PGLITE NEOVĚŘÍ
--
-- PGlite běží jako superuživatel, takže se RLS z velké části neuplatní
-- a sloupcové granty vůbec (scripts/scenare-pglite.mjs, hlavička).
-- Kontroly typu „cizí pobočka to nevidí" tu můžou projít i nad
-- rozbitou politikou — rozhoduje workflow Databáze proti PostgreSQL.
--
-- Proto tu váhu nesou kontroly, které **spadnou i v PGlite**:
-- omezení sloupců, jedinečnost, pořadí v `marketing_znacka`, audit
-- a `app.has_access`. Ty, které bez opravdového PostgreSQL nekousnou,
-- jsou dole a je to u nich napsané — ať se z jejich zeleně nedělá
-- závěr.
--
-- Vlastní číselná řada (marketingN_scenar.sql) — CLAUDE.md,
-- „Dvě relace v jednom repozitáři".

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
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cisnik  from public.profiles where email = 'cisnik@foodtab.cz'  \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);
select set_config('test.bar', :'bar', false);


\echo ''
\echo '== Vypnutý modul odmítne i přímé volání — pravidlo 5 ========='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel bez zapnutého modulu nemá marketing.manage',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));

reset role;
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('po zapnutí modulu majitel marketing.manage má',
  app.has_access(:'tenant', 'marketing.manage', :'perla'));


\echo ''
\echo '== Značka: pobočka přebíjí firmu ============================'

insert into public.marketing_nastaveni (tenant_id, branch_id, podpis, ton_hlasu)
values (:'tenant', null, 'Firemní podpis', 'neformalni');

select pg_temp.check('bez pobočkového řádku vrátí značka ten firemní',
  (select podpis from public.marketing_znacka(:'tenant', :'perla')) = 'Firemní podpis');

insert into public.marketing_nastaveni (tenant_id, branch_id, podpis, ton_hlasu)
values (:'tenant', :'perla', 'Černá Perla', 'hrave');

select pg_temp.check('pobočkový řádek firemní přebije',
  (select podpis from public.marketing_znacka(:'tenant', :'perla')) = 'Černá Perla');
select pg_temp.check('a druhé pobočce se to nepodstrčí — ta má dál firemní',
  (select podpis from public.marketing_znacka(:'tenant', :'bar')) = 'Firemní podpis');

-- Kdyby značka neexistovala vůbec, musí vyjít prázdno, ne vymyšlená
-- výchozí hodnota. Agent si značku nedomýšlí.
select pg_temp.check('cizí firma dostane prázdno, ne výchozí značku',
  (select count(*) from public.marketing_znacka(
     '00000000-0000-0000-0000-000000000000'::uuid, :'perla')) = 0);


\echo ''
\echo '== Jeden řádek na rozsah ===================================='

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_nastaveni (tenant_id, branch_id, podpis)
    values (current_setting('test.tenant')::uuid, null, 'Druhý firemní');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: druhý firemní řádek značky prošel'; end if;
  raise notice '  OK    druhý firemní řádek značky databáze odmítne (nulls not distinct)';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_nastaveni (tenant_id, branch_id, video_sekundy)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.bar')::uuid, 300);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: video na 300 sekund prošlo'; end if;
  raise notice '  OK    nesmyslná délka videa neprojde';
end $$;


\echo ''
\echo '== Média: stejný soubor dvakrát ne, v jiné pobočce ano ======'

insert into public.marketing_media
  (tenant_id, branch_id, druh, sbirka, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
values
  (:'tenant', :'perla', 'foto', 'jidla', 'svickova.jpg',
   'marketing/perla/svickova.jpg', 'image/jpeg', 128000, 'otisk-svickova');

select pg_temp.check('fotka se nahrála do Černé Perly',
  (select count(*) from public.marketing_media
    where tenant_id = :'tenant' and branch_id = :'perla') = 1);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_media
      (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'foto', 'svickova-kopie.jpg', 'marketing/perla/svickova-kopie.jpg',
            'image/jpeg', 128000, 'otisk-svickova');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: stejný soubor prošel podruhé'; end if;
  raise notice '  OK    stejný soubor podruhé v téže pobočce neprojde';
end $$;

-- Táž fotka v druhé pobočce je jiná věc: jiný interiér, jiné použití.
insert into public.marketing_media
  (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
values (:'tenant', :'bar', 'foto', 'svickova.jpg',
        'marketing/bar/svickova.jpg', 'image/jpeg', 128000, 'otisk-svickova');
select pg_temp.check('táž fotka v druhé pobočce projde',
  (select count(*) from public.marketing_media
    where tenant_id = :'tenant' and otisk = 'otisk-svickova') = 2);

-- Firemně sdílené médium má branch_id NULL. Bez `nulls not distinct`
-- by šlo nahrát logo donekonečna.
insert into public.marketing_media
  (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
values (:'tenant', null, 'foto', 'logo.png',
        'marketing/firma/logo.png', 'image/png', 9000, 'otisk-logo');

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_media
      (tenant_id, branch_id, druh, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
    values (current_setting('test.tenant')::uuid, null, 'foto', 'logo2.png',
            'marketing/firma/logo2.png', 'image/png', 9000, 'otisk-logo');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: firemní logo prošlo podruhé'; end if;
  raise notice '  OK    ani firemně sdílené médium nejde nahrát dvakrát';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_media
      (tenant_id, branch_id, druh, sbirka, nazev_souboru, cesta, mime, velikost_bajtu, otisk)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'foto', 'vymyslena-sbirka', 'x.jpg', 'marketing/perla/x.jpg',
            'image/jpeg', 1000, 'otisk-x');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neznámá sbírka prošla'; end if;
  raise notice '  OK    neznámá sbírka neprojde (číselník je v omezení sloupce)';
end $$;


\echo ''
\echo '== Šablony: klíč je ve firmě jedinečný ======================'

insert into public.marketing_sablony (tenant_id, klic, nazev, ucel)
values (:'tenant', 'denni_menu', 'Denní menu', 'denni_menu');

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_sablony (tenant_id, klic, nazev, ucel)
    values (current_setting('test.tenant')::uuid, 'denni_menu', 'Denní menu podruhé', 'denni_menu');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: dvě šablony se stejným klíčem'; end if;
  raise notice '  OK    dvě šablony se stejným klíčem neprojdou';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_sablony (tenant_id, klic, nazev, ucel)
    values (current_setting('test.tenant')::uuid, 'prazdna', '   ', 'atmosfera');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šablona bez názvu prošla'; end if;
  raise notice '  OK    šablona bez názvu neprojde';
end $$;


\echo ''
\echo '== Audit zapisuje, a s firmou =============================='

-- Bez `tenant_id` na tabulce by `app.audit_zmenu` TIŠE mlčela — vrátí
-- null a nic nezapíše. Kontrola proto míří i na to, že u záznamu firma
-- opravdu je.
select pg_temp.check('založení značky je v auditu i s firmou',
  exists (select 1 from public.audit_log
           where entity_type = 'marketing_nastaveni' and tenant_id = :'tenant'));
select pg_temp.check('založení média je v auditu',
  exists (select 1 from public.audit_log
           where entity_type = 'marketing_medium' and tenant_id = :'tenant'));
select pg_temp.check('založení šablony je v auditu',
  exists (select 1 from public.audit_log
           where entity_type = 'marketing_sablona' and tenant_id = :'tenant'));


\echo ''
\echo '== Rozhoduje až PostgreSQL: RLS a granty ===================='

-- Tyhle dvě kontroly v PGlite NEKOUSNOU (superuživatel, RLS se
-- neuplatní). Jsou tu proto, že proti PostgreSQL kousnou — a proto, aby
-- bylo v jednom souboru vidět, co se od politik čeká.

select set_config('test.user_id', :'cisnik', false);
select pg_temp.check('číšník marketing.manage nemá (has_access — kousne i tady)',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));
select pg_temp.check('číšník do médií nevidí (RLS — kousne až proti PostgreSQL)',
  (select count(*) from public.marketing_media) = 0);


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_sablony where tenant_id = :'tenant';
delete from public.marketing_nastaveni where tenant_id = :'tenant';
delete from public.marketing_media where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_nastaveni where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_media where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_sablony where tenant_id = :'tenant') = 0
  and not exists (select 1 from public.tenant_modules
                   where tenant_id = :'tenant' and module_key = 'marketing'));


\echo ''
\echo '=========================================================='
\echo ' MARKETING 2 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
