-- Scénář pro krok 105 — Rezervace: napojení na Choice (Open API).
--
-- Pokrývá migraci 20261031100000_rezervace_choice.sql (úloha
-- `rezervace-choice`, fronta dotazů `rezervace_choice_zabrat_dotaz`)
-- a zápis rezervací z Choice STÁVAJÍCÍ cestou
-- (`rezervace_importovat_zdroj`, 20261027100000) — přesně v tom tvaru,
-- v jakém je posílá lib/rezervace-choice.ts (`radekZChoice`).
--
-- Navazuje na etapa0_scenar.sql až krok104_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. úloha je v plánovači s plánem z GitHub workflow a jde zabrat;
--   2. fronta dotazů drží rozestup 5,5 s mezi po sobě jdoucími dotazy,
--      dotaz, který se nevejde, NIC nezabere, nesmysl se odmítne;
--      firma má nejvýš jeden zabraný dotaz, který ještě neodešel —
--      souběžné kliky jedné firmy nezaberou frontu ostatním; chybějící
--      řádek fronty je chyba, ne tiché NULL;
--   3. frontu volá jen service_role (přihlášený ani anonym ne) a funguje
--      i s vlastníkem, který NENÍ superuživatel (na Supabase jím migrace
--      nejsou) — vyzkoušené přeneseným vlastnictvím, ne úvahou. Text
--      grantů hlídá navíc scripts/provoz-granty.test.mjs;
--   4. z Choice se zapisuje jen přes OVĚŘENÉ připojení („připojeno" jen
--      s úspěšným testem); _id = číslo ze zdroje, totéž podruhé nic
--      nezdvojí, zrušení = stav, rezervace zůstává; Foodtabu patří
--      záloha, poznámky a stůl (stůl jen doplní prázdný);
--   5. čas bez pásma odmítne i databáze (druhá linie za adaptérem).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, externi_ucet)
values (:'tenant', :'perla', 'rezervace', 'choice', 'zakaznicky', 'Choice — krok105.choiceqr.com',
        '{"domena":"krok105.choiceqr.com","var_symbol":"10501"}')
returning id as choice \gset

-- Tvar řádků přesně podle radekZChoice: okamžik v UTC, konec a „změněno"
-- prázdné (Choice je neposílá), číslo = Mongo _id.
select '[{"externi_id":"65f0a1b2c3d4e5f600000105","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2026-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Choice Krok105","pocet_osob":"4","telefon":"+420 777 105 105","email":"krok105@example.cz","poznamka":"u okna","prostor":"Terasa"},{"externi_id":"65f0a1b2c3d4e5f600000106","stav":"ceka","stav_zdroje":"CREATED","zacatek":"2026-11-28T17:30:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Choice2 Krok105","pocet_osob":"","telefon":"","email":"","poznamka":"","prostor":"Salonek"}]' as davka \gset
select '[{"externi_id":"65f0a1b2c3d4e5f600000105","stav":"zrusena","stav_zdroje":"CANCELLED","zacatek":"2026-11-27T18:00:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Choice Krok105","pocet_osob":"4","telefon":"+420 777 105 105","email":"krok105@example.cz","poznamka":"u okna","prostor":"Bar"},{"externi_id":"65f0a1b2c3d4e5f600000106","stav":"ceka","stav_zdroje":"CREATED","zacatek":"2026-11-28T17:30:00.000Z","konec":"","zmeneno_kdy":"","jmeno_hosta":"Choice2 Krok105","pocet_osob":"","telefon":"","email":"","poznamka":"","prostor":"Salonek"}]' as zruseni \gset
select '[{"externi_id":"65f0a1b2c3d4e5f600000199","stav":"potvrzeno","stav_zdroje":"CONFIRMED","zacatek":"2026-11-27T19:00:00","konec":"","zmeneno_kdy":"","jmeno_hosta":"Bez pásma Krok105","pocet_osob":"2","telefon":"","email":"","poznamka":"","prostor":""}]' as bez_pasma \gset


\echo ''
\echo '== 1. Úloha v plánovači ================================='

select pg_temp.check('úloha rezervace-choice je v plánovači: každých 15 minut, limit 90 s',
  exists (select 1 from app.planovac_ulohy
           where uloha = 'rezervace-choice' and plan_utc = '11,26,41,56 * * * *' and limit_sekund = 90));

update app.planovac_ulohy set zamceno_do = null where uloha = 'rezervace-choice';
set role service_role;
select public.uloha_zabrat('rezervace-choice') as zabrano1 \gset
select public.uloha_zabrat('rezervace-choice') as zabrano2 \gset
reset role;
select pg_temp.check('úlohu jde zabrat a podruhé (druhý plánovač) už ne',
  :'zabrano1'::boolean and not :'zabrano2'::boolean);
update app.planovac_ulohy set zamceno_do = null, posledni_zacatek = null where uloha = 'rezervace-choice';


\echo ''
\echo '== 2. Fronta dotazů na Choice ==========================='

-- Druhá firma: fronta je společná všem firmám a právě mezi nimi se tu
-- hlídá, že jedna nezabere čas ostatním.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok105 Cizí s.r.o.', 'Krok105 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi \gset

update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');

set role service_role;
-- coalesce: \gset nad NULL proměnnou nezaloží a další řádek by spadl na
-- „syntax error“ místo srozumitelné kontroly (CLAUDE.md).
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000), -1) as cekat1 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000), -1) as cekat2 \gset
-- Cizí firma by musela čekat ~11 s; povolená doba je 1 s → nevejde se.
select coalesce(public.rezervace_choice_zabrat_dotaz(:'cizi', 5500, 1000)::text, 'nic') as cekat3 \gset
-- Šest souběžných „Ověřit znovu“ téže firmy (prověrka 25. 10.: dřív si
-- zabraly frontu na 30 s dopředu). Funkce je volatile, v agregaci se
-- zavolá pro každý řádek zvlášť.
select count(*) filter (where public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 30000) is null) as firma_nic,
       count(*) as firma_vse
  from generate_series(1, 6) \gset
-- Naplánovaná úloha cizí firmy hned potom.
select coalesce(public.rezervace_choice_zabrat_dotaz(:'cizi', 5500, 37000), -1) as cekat_cizi \gset
reset role;

select pg_temp.check('první dotaz smí hned',
  :cekat1 between 0 and 100);
select pg_temp.check('druhý hned po něm čeká 5,5 s (Choice: 1 dotaz za 5 s)',
  :cekat2 between 4500 and 5500);
select pg_temp.check('dotaz, který se do povolené doby nevejde, dostane NULL',
  :'cekat3' = 'nic');
select pg_temp.check('firma, jejíž zabraný dotaz ještě neodešel, další nedostane (6× NULL, nic nezabráno)',
  :firma_vse = 6 and :firma_nic = 6);
select pg_temp.check('cizí firma tak dostane dotaz hned za tím zabraným (≤ 11 s), ne až za 30 s',
  :cekat_cizi between 9500 and 11000);
select pg_temp.check('fronta drží další volný čas za posledním zabraným (nevejde-li se, nic se nezabralo)',
  (select dalsi_volny > clock_timestamp() + interval '14 seconds'
          and dalsi_volny < clock_timestamp() + interval '17 seconds'
     from app.rezervace_choice_fronta));

-- Zabraný dotaz firmy odešel (čas uplynul) → další dostane, za frontou.
update app.rezervace_choice_fronta_firmy set zabrano_do = clock_timestamp() - interval '1 second' where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000), -1) as cekat_po \gset
reset role;
select pg_temp.check('po odchodu zabraného dotazu firma další dostane (běh jde dotaz po dotazu, pravidlo ho nebrzdí)',
  :cekat_po between 15000 and 17000);

set role service_role;
select pg_temp.check('dotaz bez firmy se odmítne',
  pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz(null, 5500, 60000)', '22023', 'musí patřit firmě'));
select pg_temp.check('rozestup pod 5 s se odmítne',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 4999, 60000)', :'tenant'), '22023', '5 až 60 sekund'));
select pg_temp.check('záporná nebo dlouhá doba čekání se odmítne',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, -1)', :'tenant'), '22023', 'nejvýš 120 sekund')
  and pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, 120001)', :'tenant'), '22023', 'nejvýš 120 sekund'));
reset role;

-- Chybějící řádek fronty není „nevejde se“ — tiché NULL by u napojení
-- vypadalo jako „pokračuje se příště“ a nenačítalo by se nic.
delete from app.rezervace_choice_fronta;
set role service_role;
select pg_temp.check('chybí-li řádek fronty, funkce spadne (P0002), ne tiché NULL',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', :'cizi'), 'P0002', 'nemá svůj řádek'));
reset role;
insert into app.rezervace_choice_fronta (jediny) values (true);


\echo ''
\echo '== 3. Práva a vlastník, který není superuživatel ========'

-- Granty hlídá i TEXT migrace (scripts/provoz-granty.test.mjs): v čisté
-- databázi tady chybí výchozí práva Supabase, takže revoke bez
-- `authenticated` by tahle kontrola nepoznala.
select pg_temp.check('frontu volá jen service_role, přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute'));

set role authenticated;
select pg_temp.check('přihlášený frontu nezavolá (42501)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', :'tenant'), '42501', 'permission denied'));
reset role;

select pg_temp.check('do tabulek fronty nesahá nikdo kromě funkce (ani service_role)',
  not has_table_privilege('service_role', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta', 'update')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('anon', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta_firmy', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta_firmy', 'update')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_fronta_firmy', 'select')
  and not has_table_privilege('anon', 'app.rezervace_choice_fronta_firmy', 'select'));

-- Na Supabase vlastní migrace (tabulky i funkci) role `postgres`, která
-- NENÍ superuživatel. Tady se vlastnictví všeho přenese na obyčejnou
-- roli a zavolá se pod service_role — funkce musí projít. (Vlastník
-- tabulky RLS bez politiky obchází. Role, která tabulku nevlastní, by
-- řádek fronty neviděla — dřív by funkce tiše vracela NULL, dnes spadne
-- na P0002, viz výš.)
create role vlastnik105 nologin;
grant usage on schema app to vlastnik105;
alter table app.rezervace_choice_fronta owner to vlastnik105;
alter table app.rezervace_choice_fronta_firmy owner to vlastnik105;
alter function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) owner to vlastnik105;
select pg_temp.check('zkušební vlastník není superuživatel',
  not (select rolsuper from pg_roles where rolname = 'vlastnik105'));

update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000), -1) as cekat_v1 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000), -1) as cekat_v2 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat_v3 \gset
reset role;
select pg_temp.check('s vlastníkem bez superuživatele fronta funguje stejně (i pravidlo jednoho zabraného dotazu)',
  :cekat_v1 between 0 and 100 and :cekat_v2 between 4500 and 5500 and :'cekat_v3' = 'nic');

alter function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) owner to current_user;
alter table app.rezervace_choice_fronta owner to current_user;
alter table app.rezervace_choice_fronta_firmy owner to current_user;
select pg_temp.check('vlastník funkce i tabulek je zase ten, kdo pouští migrace',
  (select pg_get_userbyid(proowner) = current_user from pg_proc
    where oid = 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)'::regprocedure)
  and (select bool_and(pg_get_userbyid(relowner) = current_user) from pg_class
        where oid in ('app.rezervace_choice_fronta'::regclass, 'app.rezervace_choice_fronta_firmy'::regclass)));
revoke usage on schema app from vlastnik105;
drop role vlastnik105;
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'cizi', 5500, 60000), -1) as cekat_cizi2 \gset
reset role;
select pg_temp.check('cizí firma má ve frontě svůj řádek',
  :cekat_cizi2 >= 0 and exists (select 1 from app.rezervace_choice_fronta_firmy where tenant_id = :'cizi'));
delete from public.tenants where id = :'cizi';
select pg_temp.check('… a ten zmizí s firmou (on delete cascade)',
  not exists (select 1 from app.rezervace_choice_fronta_firmy where tenant_id = :'cizi'));
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';


\echo ''
\echo '== 4. Zápis z Choice jen přes ověřené připojení ========='

set role service_role;
select pg_temp.check('neověřené připojení Choice (čeká na připojení) nic nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'choice', :'davka'),
    '23514', 'ještě není ověřené'));
reset role;

select pg_temp.check('„připojeno" bez úspěšného živého testu databáze nedovolí',
  pg_temp.spadne_hlaskou(format($q$update public.integrace_pripojeni set stav = 'pripojeno' where id = %L$q$, :'choice'),
    '23514', 'integrace_pripojeni_rezervace_overeno'));

update public.integrace_pripojeni
   set stav = 'pripojeno', posledni_test_ok = true, posledni_test_kdy = now()
 where id = :'choice';

set role service_role;
select public.rezervace_importovat_zdroj(:'choice', :'davka'::jsonb)::text as vysledek1 \gset
select public.rezervace_importovat_zdroj(:'choice', :'davka'::jsonb)::text as vysledek2 \gset
reset role;

select pg_temp.check('první načtení: dvě nové rezervace',
  (:'vysledek1'::jsonb ->> 'nove')::int = 2);
select pg_temp.check('totéž načtení podruhé (stejná _id) nic nezdvojí',
  (:'vysledek2'::jsonb ->> 'nove')::int = 0 and (:'vysledek2'::jsonb ->> 'beze_zmeny')::int = 2
  and (select count(*) from public.rezervace where jmeno_hosta like 'Choice%Krok105') = 2);
select pg_temp.check('rezervace mají systém choice, zdroj externí, _id jako číslo a odkaz na připojení',
  (select bool_and(poskytovatel = 'choice' and zdroj = 'externi' and pripojeni_id = :'choice'::uuid
                   and externi_id like '65f0a1b2c3d4e5f6%')
     from public.rezervace where jmeno_hosta like 'Choice%Krok105'));
select pg_temp.check('čas z Choice je okamžik (18:00 UTC = 19:00 v Praze v listopadu), stav a počet sedí',
  (select zacatek = timestamptz '2026-11-27 19:00:00+01' and stav = 'potvrzeno' and stav_zdroje = 'CONFIRMED'
          and pocet_osob = 4 and konec is null and externi_zmeneno_kdy is null
     from public.rezervace where externi_id = '65f0a1b2c3d4e5f600000105'));
select pg_temp.check('kontakt hosta je v rezervace_kontakty (ne v rezervaci)',
  (select telefon = '+420 777 105 105' and email = 'krok105@example.cz'
     from public.rezervace_kontakty k join public.rezervace r on r.id = k.rezervace_id
    where r.externi_id = '65f0a1b2c3d4e5f600000105'));

-- Foodtab si k rezervaci zapíše svoje: zálohu, poznámku a jiný stůl.
update public.rezervace set zaloha_hosta_haleru = 50000, zaloha_hosta_stav = 'zaplacena', prostor = 'Salonek u okna'
 where externi_id = '65f0a1b2c3d4e5f600000105' and poskytovatel = 'choice';
insert into public.rezervace_poznamky (tenant_id, branch_id, rezervace_id, nadpis, obsah)
select tenant_id, branch_id, id, 'Krok105', 'Dort ve 20:00 — Krok105'
  from public.rezervace where externi_id = '65f0a1b2c3d4e5f600000105' and poskytovatel = 'choice';
update public.rezervace set prostor = ''
 where externi_id = '65f0a1b2c3d4e5f600000106' and poskytovatel = 'choice';

set role service_role;
select public.rezervace_importovat_zdroj(:'choice', :'zruseni'::jsonb)::text as vysledek3 \gset
reset role;

select pg_temp.check('zrušení v Choice = stav „zrušená“, rezervace zůstává',
  (select stav = 'zrusena' and stav_zdroje = 'CANCELLED'
     from public.rezervace where externi_id = '65f0a1b2c3d4e5f600000105' and poskytovatel = 'choice'));
select pg_temp.check('Foodtabu zůstala záloha od hosta i jeho stůl (Choice poslal jiný)',
  (select zaloha_hosta_haleru = 50000 and zaloha_hosta_stav = 'zaplacena' and prostor = 'Salonek u okna'
     from public.rezervace where externi_id = '65f0a1b2c3d4e5f600000105' and poskytovatel = 'choice'));
select pg_temp.check('… i poznámka obsluhy',
  exists (select 1 from public.rezervace_poznamky where obsah = 'Dort ve 20:00 — Krok105'));
select pg_temp.check('prázdný stůl Choice doplnil',
  (select prostor = 'Salonek' from public.rezervace where externi_id = '65f0a1b2c3d4e5f600000106' and poskytovatel = 'choice'));


\echo ''
\echo '== 5. Čas bez pásma odmítne i databáze =================='

set role service_role;
select pg_temp.check('rezervace s časem bez pásma se nezapíše (druhá linie za adaptérem)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'choice', :'bez_pasma'),
    '23514', 'nemá časové pásmo'));
reset role;
select pg_temp.check('… a nezapsalo se nic',
  not exists (select 1 from public.rezervace where jmeno_hosta = 'Bez pásma Krok105'));

update public.integrace_pripojeni set odpojeno_kdy = now(), stav = 'odpojeno' where id = :'choice';
set role service_role;
select pg_temp.check('odpojené připojení Choice už nic nezapíše',
  pg_temp.spadne_hlaskou(format('select public.rezervace_importovat_zdroj(%L, %L::jsonb)', :'choice', :'davka'),
    'P0002', 'neexistuje nebo je odpojené'));
reset role;
select pg_temp.check('… a už zapsané rezervace po odpojení zůstaly',
  (select count(*) from public.rezervace where jmeno_hosta like 'Choice%Krok105') = 2);


\echo ''
\echo '== Úklid ================================================='

delete from public.rezervace_poznamky where obsah = 'Dort ve 20:00 — Krok105';
delete from public.rezervace_kontakty
 where rezervace_id in (select id from public.rezervace where jmeno_hosta like '%Krok105');
delete from public.rezervace where jmeno_hosta like '%Krok105';
delete from public.integrace_pripojeni where id = :'choice';
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';

select pg_temp.check('úklid: po scénáři nezůstalo nic z kroku 105',
  not exists (select 1 from public.rezervace where jmeno_hosta like '%Krok105')
  and not exists (select 1 from public.integrace_pripojeni where nazev like '%krok105%')
  and not exists (select 1 from public.tenants where name = 'Krok105 Cizí s.r.o.')
  and not exists (select 1 from app.rezervace_choice_fronta_firmy)
  and not exists (select 1 from pg_roles where rolname = 'vlastnik105'));

\echo ''
\echo '== KROK 105 HOTOV ========================================'
