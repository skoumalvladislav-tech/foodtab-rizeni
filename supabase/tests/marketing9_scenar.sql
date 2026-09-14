-- Scénář marketing 9 — menu a jeho import.
--
-- Pokrývá 20260914060000_marketing_menu.sql.
-- Zadání: master prompt, oddíl 10.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Dvě věci, a ta druhá je důležitější:
--
--   1. Že menu jedné restaurace nevidí druhá. Běžná tenantní hygiena.
--   2. **Že se nepotvrzené menu nedá potvrdit.** Import čte z fotky
--      a z PDF, takže se plete — a zadání proto žádá, aby to, co si
--      není jisté, nesl příznak „vyžaduje kontrolu" a člověk to prošel.
--      Kdyby šlo potvrdit menu s nezkontrolovanými položkami, byl by
--      ten příznak jen ozdoba.
--
-- Nejtišší chyba, která tu hrozí, není únik. Je to CENA: nerozpoznaná
-- cena je NULL, ne nula. Kdyby se někdo pokusil „opravit" sloupec na
-- `not null default 0`, vyšel by příspěvek se svíčkovou za nula korun
-- a vypadal by jako nabídka, ne jako chyba čtení. Kontrola na to je
-- dole.
--
-- ---------------------------------------------------------------------
-- ROZSAH SE BERE Z RODIČE
--
-- Dny ani položky nemají vlastní `branch_id` — ptají se menu. Kontrola
-- „cizí menu si nikdo nepodstrčí" proto míří na to, že se nedá založit
-- položka k menu cizí firmy, i když se uhodne jeho id.

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

/*
  MODUL SE NEJDŘÍV ODEBERE.

  Scénáře si firmu vybírají `limit 1` bez řazení, takže si dva z nich
  můžou sáhnout na jinou — a ten dřívější pak modul neuklidí po tom,
  komu ho tenhle zapíná. Bez tohohle řádku scénář spadl na duplicitním
  klíči, tedy na něčem, co vypadá jako chyba v migraci a není.

  Není to `on conflict do nothing`: to by srážku SCHOVALO a scénář by
  běžel nad stavem, který si nezaložil (CLAUDE.md, „Dvě relace").
  Tady se stav vyrábí znovu, takže se ví, jaký je.
*/
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

select '00000000-0000-0000-0000-0000000000ff'::uuid as cizi \gset

-- Do bloků `do $$` se proměnné psql nedostanou — předávají se přes
-- `set_config`. Kdyby se to zapomnělo, spadne to na „unrecognized
-- configuration parameter", tedy na něčem, co nevypadá jako chybějící
-- řádek.
select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);


\echo ''
\echo '== Sloupce, na kterých záleží =============================='

/*
  CENA SMÍ BÝT PRÁZDNÁ. Viz hlavička — je to rozdíl mezi „nevíme"
  a „zdarma". Kdyby někdo sloupec utáhl na `not null`, import by musel
  něco vymyslet, a to zadání zakazuje.
*/
select pg_temp.check('cena položky smí být prázdná (nerozpoznáno ≠ zdarma)',
  (select not a.attnotnull from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'marketing_menu_polozky'
      and a.attname = 'cena_haleru'));

select pg_temp.check('a je to celé číslo, ne desetinné',
  (select format_type(a.atttypid, null) = 'integer' from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'marketing_menu_polozky'
      and a.attname = 'cena_haleru'));

select pg_temp.check('záporná cena neprojde',
  exists (select 1 from pg_constraint
           where conrelid = 'public.marketing_menu_polozky'::regclass
             and contype = 'c' and pg_get_constraintdef(oid) like '%cena_haleru%>= 0%'));

-- Všechny tři tabulky mají zapnutou RLS (pravidlo 3).
select pg_temp.check('všechny tři tabulky menu mají RLS',
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('marketing_menu', 'marketing_menu_dny', 'marketing_menu_polozky')) = 3);

/*
  ANON NEMÁ V MODULU CO POHLEDÁVAT (CLAUDE.md, Konvence).

  POZOR NA TO, CO TAHLE KONTROLA DOKAZUJE — a co ne.

  Odebrání `revoke all … from anon` z migrace ji NESHODÍ. Tady žádný
  grant pro `anon` nevzniká: Supabase má v projektu výchozí práva,
  která ho každé nové tabulce přidají, ale čistá databáze z `run.sh`
  je nemá. Ověřeno rozbíjením — `revoke` jsem z migrace vyndal a
  scénář prošel.

  Spadne až tehdy, když někdo grant VÝSLOVNĚ přidá. To taky ověřeno:
  `grant select … to anon` v migraci ji shodí.

  Tenhle rozdíl je zapsaný v CLAUDE.md („Nová tabulka dostane granty
  pro anon a authenticated, i když jí je nikdo nedá") a přišlo se na
  něj 13. 9. při nasazení. Píšu to sem nahlas, aby se ta kontrola
  nebrala jako důkaz, že `revoke` v migraci je — to řekne až ostrá
  databáze.
*/
select pg_temp.check('a anon na ně nemá grant',
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
      and table_name in ('marketing_menu', 'marketing_menu_dny', 'marketing_menu_polozky')) = 0);


\echo ''
\echo '== Založení menu a položek ================================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.marketing_menu (tenant_id, branch_id, druh, nazev, plati_od, zdroj)
values (:'tenant', :'perla', 'denni', 'Denní menu na zkoušku', current_date, 'text')
returning id as menu \gset

select pg_temp.check('majitel menu založí', :'menu' is not null);
select set_config('test.menu', :'menu', false);

insert into public.marketing_menu_polozky
  (tenant_id, menu_id, kategorie, nazev, cena_haleru, poradi)
values (:'tenant', :'menu', 'polevka', 'Hovězí vývar', 5900, 0)
returning id as polozka_ok \gset

/*
  Položka bez rozpoznané ceny. Přesně tak vypadá výstup čtení z fotky,
  když je cena rozmazaná — a musí jít uložit, jinak by import musel
  cenu domyslet.
*/
insert into public.marketing_menu_polozky
  (tenant_id, menu_id, kategorie, nazev, cena_haleru, vyzaduje_kontrolu, duvod_kontroly, poradi)
values (:'tenant', :'menu', 'hlavni', 'Svíčková', null, true, 'Nerozpoznaná cena', 1)
returning id as polozka_sporna \gset

select pg_temp.check('položka bez ceny se uloží a je označená ke kontrole',
  (select vyzaduje_kontrolu and cena_haleru is null
     from public.marketing_menu_polozky where id = :'polozka_sporna'));


\echo ''
\echo '== Nepotvrzené menu se nedá potvrdit ======================='

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V CELÉM SCÉNÁŘI.

  Dokud zbývá položka ke kontrole, potvrzení musí SPADNOUT. Kdyby
  prošlo, byl by příznak „vyžaduje kontrolu" jen ozdoba a do příspěvku
  by se dostala cena, kterou nikdo neviděl.
*/
do $$
declare v_ok boolean := false; v_hlaska text;
begin
  begin
    perform public.marketing_menu_potvrdit(current_setting('test.menu')::uuid);
  exception when check_violation then
    v_ok := true; v_hlaska := sqlerrm;
  end;
  if not v_ok then
    raise exception 'SELHALO: menu se dalo potvrdit i s nezkontrolovanou položkou';
  end if;
  raise notice '  OK    menu s nezkontrolovanou položkou potvrdit nejde';
  if position('Svíčková' in v_hlaska) > 0 then
    raise exception 'SELHALO: hláška prozrazuje obsah, stačí počet';
  end if;
  raise notice '  OK    a hláška řekne kolik, ne co';
end $$;

select pg_temp.check('a menu zůstalo v konceptu',
  (select stav = 'koncept' from public.marketing_menu where id = :'menu'));

-- Člověk položku prošel a cenu doplnil.
update public.marketing_menu_polozky
   set cena_haleru = 18900, vyzaduje_kontrolu = false, duvod_kontroly = null
 where id = :'polozka_sporna';

select public.marketing_menu_potvrdit(:'menu');

select pg_temp.check('po kontrole se menu potvrdí',
  (select stav = 'potvrzeno' from public.marketing_menu where id = :'menu'));

select pg_temp.check('a zapíše se kdo a kdy',
  (select potvrzeno_kdy is not null and potvrdil is not null
     from public.marketing_menu where id = :'menu'));


\echo ''
\echo '== Cizí firma ============================================='

select pg_temp.check('cizí firma menu nevidí',
  (select count(*) from public.marketing_menu where tenant_id = :'cizi') = 0);

/*
  Číšník marketing nemá vůbec. Nesmí tedy vidět ani menu — je v něm
  cena, kterou podnik teprve chystá.
*/
reset role;
set role authenticated;
select set_config('test.user_id', :'cisnik', false);

select pg_temp.check('kdo nemá marketing, menu nevidí',
  (select count(*) from public.marketing_menu where id = :'menu') = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_menu (tenant_id, branch_id, druh, nazev)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.perla')::uuid, 'denni', 'Číšníkovo menu');
    -- Politika zápis zahodí tiše jako porušení `with check`.
  exception when insufficient_privilege or check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'SELHALO: číšník založil menu';
  end if;
  raise notice '  OK    a nezaloží ho';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.marketing_menu_potvrdit(current_setting('test.menu')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'SELHALO: číšník potvrdil cizí menu';
  end if;
  raise notice '  OK    ani nepotvrdí cizí';
end $$;


\echo ''
\echo '== Položka k cizímu menu ==================================='

/*
  Rozsah se bere z rodiče, takže se nedá podstrčit položka k menu,
  na které nemám právo — ani když se jeho id uhodne.
*/
reset role;
set role authenticated;
select set_config('test.user_id', :'cisnik', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_menu_polozky (tenant_id, menu_id, nazev)
    values (current_setting('test.tenant')::uuid,
            current_setting('test.menu')::uuid, 'Podstrčená položka');
  exception when insufficient_privilege or check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'SELHALO: do cizího menu šla přidat položka';
  end if;
  raise notice '  OK    do cizího menu položka nepřibude';
end $$;


\echo ''
\echo '== Audit =================================================='

reset role;

select pg_temp.check('založení menu je v auditu',
  exists (select 1 from public.audit_log
           where tenant_id = :'tenant' and entity_type = 'marketing_menu'));

select pg_temp.check('a položky taky',
  exists (select 1 from public.audit_log
           where tenant_id = :'tenant' and entity_type = 'marketing_menu_polozka'));


\echo ''
\echo '== Úklid po sobě ============================================'

delete from public.marketing_menu where tenant_id = :'tenant';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_menu where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_menu_polozky where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 9 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
