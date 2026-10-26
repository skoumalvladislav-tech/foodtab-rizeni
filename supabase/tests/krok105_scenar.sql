-- Scénář pro krok 105 — Rezervace: napojení na Choice (Open API).
--
-- Pokrývá migraci 20261031100000_rezervace_choice.sql (úloha
-- `rezervace-choice`, fronta dotazů `rezervace_choice_zabrat_dotaz`)
-- ve znění 20261102100000_rezervace_choice_fronta_tlacitka.sql (vstup
-- úlohy `rezervace_choice_zabrat_dotaz_ulohy`, „zkusit znovu za")
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
--      dotaz, který se nevejde, NIC nezabere a vrátí ZÁPORNĚ, za kolik
--      ms to zkusit znovu (až odejde zabraný dotaz firmy / až se fronta
--      posune; obojí naráz = to pozdější), nesmysl se odmítne;
--      firma má nejvýš jeden zabraný dotaz tlačítka, který ještě
--      neodešel — souběžné kliky jedné firmy nezaberou frontu ostatním;
--      šest firem s tlačítkem (čekat nejvýš dva rozestupy) posune frontu
--      nejvýš o tři rozestupy; ÚLOHA jde vlastním vstupem: pravidlo
--      firmy ji nezastaví a ona firmě nic nezabere (nález po sloučení
--      #162); chybějící řádek fronty je chyba, ne tiché NULL;
--   2b. souběh DVOU SPOJENÍ (dblink, jen PostgreSQL): druhé volání téže
--      firmy stojí na zámku řádku firmy a dotaz nedostane — a kopie
--      funkce bez toho zámku ho v témž souběhu dostane (kontrola umí
--      spadnout, ukázané při každém běhu);
--   2c. odstup „Ověřit znovu" na připojení: nejvýš jednou za minutu
--      (délka proti skutečné funkci: 30 s a 59 s ještě ne, 61 s ano),
--      klik V ODSTUPU odstup neprodlouží (nezávislé ověření po #162),
--      odstup a dotaz ve frontě naráz — v odstupu se fronty nedotkne,
--      a když se dotaz do fronty nevejde, odstup se nespotřebuje;
--   2d. souběh dvou „Ověřit znovu" na TÉMŽ připojení dvěma spojeními
--      (dblink, jen PostgreSQL): druhé stojí na zámku řádku odstupu
--      a po prvním dostane -1 — a kopie funkce bez toho zámku v témž
--      souběhu dostane druhý dotaz (dva testy do minuty), kontrola umí
--      spadnout;
--   3. frontu (obě funkce) i odstup volá jen service_role (přihlášený
--      ani anonym ne) a funguje i s vlastníkem, který NENÍ
--      superuživatel (na Supabase jím migrace nejsou) — vyzkoušené
--      přeneseným vlastnictvím, ne úvahou. Text grantů hlídá navíc
--      scripts/provoz-granty.test.mjs;
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

-- Výsledek funkce fronty jako text (`coalesce(…::text, 'nic')`) zpátky na
-- číslo; 'nic' a cokoli jiného = NULL (porovnání pak neprojde).
create or replace function pg_temp.cislo(p text) returns integer
language sql immutable as $$ select case when p ~ '^-?[0-9]+$' then p::integer end $$;

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
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat1 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat2 \gset
-- Cizí firma by musela čekat ~11 s; povolená doba je 1 s → nevejde se.
select coalesce(public.rezervace_choice_zabrat_dotaz(:'cizi', 5500, 1000)::text, 'nic') as cekat3 \gset
-- Šest souběžných „Ověřit znovu“ téže firmy (prověrka 25. 10.: dřív si
-- zabraly frontu na 30 s dopředu). Funkce je volatile, v poddotazu se
-- zavolá pro každý řádek zvlášť.
select count(*) filter (where c < 0) as firma_nic,
       count(*) as firma_vse,
       coalesce(min(c), 0) as firma_znovu_min,
       coalesce(max(c), 0) as firma_znovu_max
  from (select public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 30000) as c
          from generate_series(1, 6)) volani \gset
-- Naplánovaná úloha cizí firmy hned potom — vlastním vstupem (bez firmy).
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 37000)::text, 'nic') as cekat_cizi \gset
reset role;

select pg_temp.check(format('první dotaz smí hned (%s ms)', :'cekat1'),
  coalesce(pg_temp.cislo(:'cekat1') between 0 and 100, false));
select pg_temp.check(format('druhý hned po něm čeká 5,5 s (Choice: 1 dotaz za 5 s; %s ms)', :'cekat2'),
  coalesce(pg_temp.cislo(:'cekat2') between 4500 and 5500, false));
select pg_temp.check(format('dotaz, který se do povolené doby (1 s) nevejde, nic nezabere a vrátí, že znovu za ~10 s, až se fronta posune (%s)', :'cekat3'),
  coalesce(pg_temp.cislo(:'cekat3') between -10000 and -9500, false));
select pg_temp.check(format('firma, jejíž zabraný dotaz ještě neodešel, další nedostane: 6× „znovu za ~5,5 s, až odejde“ (%s až %s), nic nezabráno', :'firma_znovu_min', :'firma_znovu_max'),
  :firma_vse = 6 and :firma_nic = 6 and :firma_znovu_min >= -5500 and :firma_znovu_max <= -4500);
select pg_temp.check(format('úloha cizí firmy tak dostane dotaz hned za tím zabraným (≤ 11 s), ne až za 30 s (%s ms)', :'cekat_cizi'),
  coalesce(pg_temp.cislo(:'cekat_cizi') between 9500 and 11000, false));
select pg_temp.check('fronta drží další volný čas za posledním zabraným (nevejde-li se, nic se nezabralo)',
  (select dalsi_volny > clock_timestamp() + interval '14 seconds'
          and dalsi_volny < clock_timestamp() + interval '17 seconds'
     from app.rezervace_choice_fronta));

-- Úloha, která se do svého dílu nevejde, dostane NULL a nic nezabere
-- (opakování by jí nepomohlo: díl se zkracuje stejně rychle, jak se
-- fronta blíží — hlavička migrace 20261102100000).
select dalsi_volny::text as fronta_pred_ulohou from app.rezervace_choice_fronta \gset
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 1000)::text, 'nic') as uloha_nevejde \gset
reset role;
select pg_temp.check(format('úloha, která se do svého dílu (1 s) nevejde: NULL, ne „zkusit znovu" (%s), a nic se nezabralo', :'uloha_nevejde'),
  :'uloha_nevejde' = 'nic'
  and (select dalsi_volny = :'fronta_pred_ulohou'::timestamptz from app.rezervace_choice_fronta));

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
select pg_temp.check('vstup úlohy odmítne totéž: rozestup pod 5 s, zápornou i dlouhou dobu čekání',
  pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz_ulohy(4999, 60000)', '22023', '5 až 60 sekund')
  and pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz_ulohy(5500, -1)', '22023', 'nejvýš 120 sekund')
  and pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz_ulohy(5500, 120001)', '22023', 'nejvýš 120 sekund'));
reset role;

-- Chybějící řádek fronty není „nevejde se“ — tiché NULL by u napojení
-- vypadalo jako „pokračuje se příště“ a nenačítalo by se nic.
delete from app.rezervace_choice_fronta;
set role service_role;
select pg_temp.check('chybí-li řádek fronty, funkce spadne (P0002), ne tiché NULL',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', :'cizi'), 'P0002', 'nemá svůj řádek'));
select pg_temp.check('… vstup úlohy taky (P0002)',
  pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz_ulohy(5500, 60000)', 'P0002', 'nemá svůj řádek'));
reset role;
insert into app.rezervace_choice_fronta (jediny) values (true);

-- Nezávislé ověření po sloučení #162 (nález 1): pravidlo firmy platilo
-- i pro úlohu. Běh si další dotaz zabírá hned po odpovědi, takže firma
-- měla zabraný dotaz skoro pořád — tlačítko téže firmy (jiná pobočka)
-- neprošlo, a když prošlo, úloze vzalo další dotaz a úloha skončila.
-- Úloha teď jde vlastním vstupem: pravidlo firmy ji nezastaví a firmě
-- nic nezabere. Fronta je přitom společná (rozestup platí dál).
update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval '3 seconds';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
insert into app.rezervace_choice_fronta_firmy (tenant_id, zabrano_do) values (:'tenant', clock_timestamp() + interval '2 seconds');
select zabrano_do::text as zabrano_pred from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant' \gset
set role service_role;
-- Tlačítko firmy má zabraný dotaz (odejde za 2 s) — úloha (fronta volná
-- za 3 s, smí čekat 37 s) dotaz dostane.
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 37000)::text, 'nic') as uloha_vedle_tlacitka \gset
reset role;
select pg_temp.check(format('úloha dostane dotaz, i když tlačítko její firmy má zabraný dotaz (pravidlo firmy se jí netýká; %s ms)', :'uloha_vedle_tlacitka'),
  coalesce(pg_temp.cislo(:'uloha_vedle_tlacitka') between 2500 and 3000, false));
select pg_temp.check('… a firmě nic nezapsala (zabraný dotaz tlačítka beze změny)',
  (select zabrano_do = :'zabrano_pred'::timestamptz from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant'));

-- Opačně: úloha má zabraný dotaz (odejde za 3 s) — tlačítko TÉŽE firmy
-- se postaví za něj, pravidlo firmy ho nezastaví. Dřív úloha zapsala
-- firmě zabraný dotaz a tlačítko dostalo „nic" (a teď by dostalo jen
-- „zkuste za 3 s").
update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval '3 seconds';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 37000)::text, 'nic') as uloha_sama \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 11000)::text, 'nic') as tlacitko_vedle_ulohy \gset
reset role;
select pg_temp.check(format('tlačítko téže firmy vedle úlohy (úloha čeká %s ms) dotaz dostane hned za ní, nic nezkouší znovu (%s ms)', :'uloha_sama', :'tlacitko_vedle_ulohy'),
  coalesce(pg_temp.cislo(:'uloha_sama') between 2500 and 3000, false)
  and coalesce(pg_temp.cislo(:'tlacitko_vedle_ulohy') between 8000 and 8500, false));

-- Kdy to zkusit znovu (záporně, ms): až odejde zabraný dotaz firmy, až
-- se fronta posune tak, aby se dotaz vešel do povolené doby — a platí-li
-- obojí, to pozdější. Nic se přitom nezabere.
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
update app.rezervace_choice_fronta_firmy set zabrano_do = clock_timestamp() + interval '4 seconds' where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 11000)::text, 'nic') as znovu_firma \gset
reset role;
update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval '20 seconds';
update app.rezervace_choice_fronta_firmy set zabrano_do = '-infinity' where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 11000)::text, 'nic') as znovu_fronta \gset
reset role;
update app.rezervace_choice_fronta_firmy set zabrano_do = clock_timestamp() + interval '12 seconds' where tenant_id = :'tenant';
select dalsi_volny::text as fronta_pred, (select zabrano_do::text from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant') as firma_pred
  from app.rezervace_choice_fronta \gset
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 11000)::text, 'nic') as znovu_obe \gset
reset role;
select pg_temp.check(format('firma má zabraný dotaz (odejde za 4 s), fronta volná → znovu za ~4 s (%s)', :'znovu_firma'),
  coalesce(pg_temp.cislo(:'znovu_firma') between -4000 and -3500, false));
select pg_temp.check(format('fronta volná až za 20 s, čekat smí 11 s → znovu za ~9 s (%s)', :'znovu_fronta'),
  coalesce(pg_temp.cislo(:'znovu_fronta') between -9000 and -8500, false));
select pg_temp.check(format('obojí (firma 12 s, fronta 9 s) → to pozdější, ~12 s (%s)', :'znovu_obe'),
  coalesce(pg_temp.cislo(:'znovu_obe') between -12000 and -11500, false));
select pg_temp.check('… a nic se nezabralo (fronta ani firma beze změny)',
  (select dalsi_volny = :'fronta_pred'::timestamptz from app.rezervace_choice_fronta)
  and (select zabrano_do = :'firma_pred'::timestamptz from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant'));
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');

-- Prověrka 26. 10.: firmu si může založit kdokoli přihlášený
-- (app.create_tenant), takže pravidlo „firma nejvýš jeden zabraný
-- dotaz" samo nestačí — šest firem by si „Ověřit znovu" (čekat až 30 s)
-- zabralo frontu ~33 s dopředu. Tlačítkům proto server dává
-- p_nejdele_cekat_ms = dva rozestupy (lib/rezervace-choice-sync.ts,
-- NEJDELE_CEKA_TLACITKO_MS; že to server opravdu posílá, hlídá
-- scripts/rezervace-choice.test.mjs — i to, proč ne jeden). Tady:
-- s tímhle stropem šest firem naráz posune frontu nejvýš o tři rozestupy.
insert into public.tenants (name, legal_name, currency, timezone)
select 'Krok105 Tlačítko ' || i || ' s.r.o.', 'Krok105 Tlačítko ' || i || ' s.r.o.', 'CZK', 'Europe/Prague'
  from generate_series(1, 6) i;
select array_agg(id)::text as tlacitka from public.tenants where name like 'Krok105 Tlačítko %' \gset
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');

set role service_role;
select count(*) filter (where c >= 0) as tlacitka_zabrala,
       count(*) as tlacitka_vse
  from (select public.rezervace_choice_zabrat_dotaz(f, 5500, 11000) as c
          from unnest(:'tlacitka'::uuid[]) f) volani \gset
-- Naplánovaná úloha cizí firmy hned potom (smí čekat celý svůj díl).
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 37000)::text, 'nic') as uloha_po_tlacitkach \gset
reset role;

select pg_temp.check('šest firem naráz jako tlačítko (čekat nejvýš dva rozestupy): dotaz zaberou jen tři, ostatní nic',
  :tlacitka_vse = 6 and :tlacitka_zabrala = 3);
select pg_temp.check(format('úloha cizí firmy pak čeká nejvýš tři rozestupy (≤ 16,5 s), ať je firem kolik chce (%s ms)', :'uloha_po_tlacitkach'),
  coalesce(pg_temp.cislo(:'uloha_po_tlacitkach') between 15000 and 16500, false));

delete from public.tenants where name like 'Krok105 Tlačítko %';
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');


\echo ''
\echo '== 2b. Souběh dvou spojení (jen PostgreSQL) ============='

-- Zámek řádku firmy (`for update` ve čtení `zabrano_do`) má zařídit, že
-- ze dvou SOUBĚŽNÝCH volání téže firmy dostane dotaz jen jedno. V jednom
-- sezení to vyzkoušet nejde — volání jdou po sobě. Tady jsou dvě další
-- spojení (dblink): A vezme zámky jako funkce na začátku (firma, pak
-- fronta) a zastaví se; B zavolá funkci za tutéž firmu a musí stát na
-- zámku, který drží A; pak A dokončí, zabere dotaz a zapíše.
--
-- Že kontrola umí spadnout, se ukazuje při každém běhu: tentýž souběh
-- nad kopií funkce, které chybí JEN `for update` u řádku firmy, musí dát
-- dotaz i B (přečte `zabrano_do` dřív, než A zapíše). Kdyby nedal, souběh
-- se nevyrobil a kontrola nic neměří.
--
-- PGlite (scripts/scenare-pglite.mjs) má jediné spojení a dblink nemá —
-- tam se oddíl přeskočí a řekne to. Proti PostgreSQL se přeskočit nesmí:
-- dblink je v obrazu postgres:16 a jeho chybění tu spadne; workflow
-- Databáze navíc hledá hlášky obou kontrol souběhu.
--
-- CO TU OVĚŘENÉ NENÍ: jen tohle jedno proložení (B čte, když A drží
-- zámky a ještě nezapsal). B úplně před A, nebo až po zápisu A, jsou
-- obyčejná po sobě jdoucí volání z oddílu 2.

select set_config('test.tenant105', :'tenant', false);
select set_config('test.choice105', :'choice', false);

create or replace function pg_temp.je_pglite() returns boolean
language sql as $$ select version() like '%PGlite%' $$;

do $$
declare
  v_def   text;
  v_kopie text;
begin
  if pg_temp.je_pglite() then
    raise notice '  (PGlite: souběh dvou spojení se přeskakuje — ověřuje ho běh proti PostgreSQL)';
    return;
  end if;
  create schema test105;
  create extension dblink schema test105;

  -- Kopie funkce fronty, které chybí jen zámek řádku firmy.
  v_def := pg_get_functiondef('public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)'::regprocedure);
  v_kopie := regexp_replace(v_def, '(where f\.tenant_id = p_tenant)\s+for update;', '\1;');
  v_kopie := replace(v_kopie, 'FUNCTION public.rezervace_choice_zabrat_dotaz', 'FUNCTION test105.zabrat_bez_zamku');
  perform pg_temp.check('kopie funkce fronty se liší jen chybějícím zámkem řádku firmy (zámek fronty zůstal)',
    v_kopie like '%FUNCTION test105.zabrat_bez_zamku%'
    and (length(v_def) - length(replace(v_def, 'for update', ''))) / length('for update') = 2
    and (length(v_kopie) - length(replace(v_kopie, 'for update', ''))) / length('for update') = 1
    and v_kopie like '%from app.rezervace_choice_fronta q%where q.jediny%for update%');
  execute v_kopie;
  grant usage on schema test105 to service_role;
  grant execute on function test105.zabrat_bez_zamku(uuid, integer, integer) to service_role;

  -- Kopie funkce odstupu „Ověřit znovu", které chybí jen zámek řádku
  -- odstupu (oddíl 2d). Dotaz ve frontě zabírá dál SKUTEČNÁ funkce fronty.
  v_def := pg_get_functiondef('public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)'::regprocedure);
  v_kopie := regexp_replace(v_def, '(where o\.pripojeni_id = p_pripojeni)\s+for update;', '\1;');
  v_kopie := replace(v_kopie, 'FUNCTION public.rezervace_choice_zabrat_overeni', 'FUNCTION test105.overit_bez_zamku');
  perform pg_temp.check('kopie funkce odstupu se liší jen chybějícím zámkem řádku odstupu (frontu zabírá skutečná funkce)',
    v_kopie like '%FUNCTION test105.overit_bez_zamku%'
    and (length(v_def) - length(replace(v_def, 'for update', ''))) / length('for update') = 1
    and v_kopie not like '%for update%'
    and v_kopie like '%public.rezervace_choice_zabrat_dotaz(p_tenant, p_rozestup_ms, p_nejdele_cekat_ms)%');
  execute v_kopie;
  grant execute on function test105.overit_bez_zamku(uuid, uuid, integer, integer, integer) to service_role;

  -- Kopie vstupu úlohy, které chybí jen zámek řádku fronty (souběh
  -- úlohy s tlačítkem níž). Úloha firmu nebere, ten zámek je jediný.
  v_def := pg_get_functiondef('public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)'::regprocedure);
  v_kopie := regexp_replace(v_def, '(where q\.jediny)\s+for update;', '\1;');
  v_kopie := replace(v_kopie, 'FUNCTION public.rezervace_choice_zabrat_dotaz_ulohy', 'FUNCTION test105.ulohy_bez_zamku');
  perform pg_temp.check('kopie vstupu úlohy se liší jen chybějícím zámkem řádku fronty',
    v_kopie like '%FUNCTION test105.ulohy_bez_zamku%'
    and (length(v_def) - length(replace(v_def, 'for update', ''))) / length('for update') = 1
    and v_kopie not like '%for update%'
    and v_kopie like '%from app.rezervace_choice_fronta q%where q.jediny;%');
  execute v_kopie;
  grant execute on function test105.ulohy_bez_zamku(integer, integer) to service_role;
end $$;

-- Souběh nad funkcí `p_funkce`: vrátí, jestli B stál na zámku A, kolik
-- ms čeká dotaz A a co dostalo B ('nic' = NULL).
create or replace function pg_temp.soubeh(p_funkce text) returns jsonb
language plpgsql as $$
declare
  v_firma   text := current_setting('test.tenant105');
  v_spojeni text := format('dbname=%s user=%s port=%s', current_database(), current_user,
                           (select setting from pg_settings where name = 'port'));
  v_pid_a   integer;
  v_pid_b   integer;
  v_a       integer;
  v_b       text;
  v_ceka    boolean := false;
begin
  perform test105.dblink_connect('a105', v_spojeni);
  perform test105.dblink_connect('b105', v_spojeni);
  begin
    select x into v_pid_a from test105.dblink('a105', 'select pg_backend_pid()') as t(x integer);
    select x into v_pid_b from test105.dblink('b105', 'select pg_backend_pid()') as t(x integer);
    -- Nic nesmí viset: zaseknutý zámek by zastavil celý běh scénářů.
    perform test105.dblink_exec('a105', 'set lock_timeout = ''20s''');
    perform test105.dblink_exec('b105', 'set lock_timeout = ''20s''');

    -- Výchozí stav, zapsaný (A je zatím mimo transakci): fronta volná až
    -- za 30 s, firma nemá nic zabraného.
    perform test105.dblink_exec('a105', 'update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval ''30 seconds''');
    perform test105.dblink_exec('a105', format(
      'insert into app.rezervace_choice_fronta_firmy (tenant_id) values (%L) '
      'on conflict (tenant_id) do update set zabrano_do = ''-infinity''', v_firma));

    -- A: zámky jako funkce na začátku (firma, pak fronta), nic nezapsáno.
    perform test105.dblink_exec('a105', 'begin');
    perform x from test105.dblink('a105', format(
      'select 1 from app.rezervace_choice_fronta_firmy where tenant_id = %L for update', v_firma)) as t(x integer);
    perform x from test105.dblink('a105', 'select 1 from app.rezervace_choice_fronta where jediny for update') as t(x integer);

    -- B: totéž volání za tutéž firmu jako service_role, asynchronně.
    perform test105.dblink_exec('b105', 'set role service_role');
    perform test105.dblink_send_query('b105', format(
      'select coalesce(%s(%L, 5500, 60000)::text, ''nic'')', p_funkce, v_firma));

    -- Počkat (nejvýš 10 s), až B stojí na zámku, který drží A.
    for i in 1..200 loop
      if v_pid_a = any(pg_blocking_pids(v_pid_b)) then
        v_ceka := true;
        exit;
      end if;
      perform pg_sleep(0.05);
    end loop;

    -- A dokončí: zabere dotaz (fronta volná za 30 s) a zapíše.
    select x into v_a from test105.dblink('a105', format(
      'select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', v_firma)) as t(x integer);
    perform test105.dblink_exec('a105', 'commit');

    select x into v_b from test105.dblink_get_result('b105') as t(x text);
    perform x from test105.dblink_get_result('b105') as t(x text);
  exception when others then
    perform test105.dblink_disconnect('a105');
    perform test105.dblink_disconnect('b105');
    raise;
  end;
  perform test105.dblink_disconnect('a105');
  perform test105.dblink_disconnect('b105');
  return jsonb_build_object('ceka', v_ceka, 'a', v_a, 'b', v_b);
end $$;

set statement_timeout = '120s';

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    return;
  end if;
  r := pg_temp.soubeh('public.rezervace_choice_zabrat_dotaz');
  perform pg_temp.check('souběh dvou spojení: druhé volání téže firmy stálo na zámku, který drží první',
    (r->>'ceka')::boolean);
  perform pg_temp.check(format('… první zabralo dotaz, fronta volná za ~30 s (%s ms)', r->>'a'),
    (r->>'a')::integer between 20000 and 30000);
  -- Záporné = nic se nezabralo, jen „zkusit znovu, až dotaz prvního
  -- odejde" (~30 s; migrace 20261102100000).
  perform pg_temp.check(format('souběh dvou spojení: druhé volání téže firmy po zámku NEDOSTANE dotaz (%s, znovu až odejde dotaz prvního) — jeden zabraný dotaz na firmu platí i v souběhu', r->>'b'),
    coalesce(pg_temp.cislo(r->>'b') between -30000 and -20000, false));
end $$;

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    return;
  end if;
  r := pg_temp.soubeh('test105.zabrat_bez_zamku');
  perform pg_temp.check(format('kontrola souběhu umí spadnout: kopie funkce BEZ zámku řádku firmy dá v témž souběhu dotaz i druhému volání (%s ms)', r->>'b'),
    (r->>'ceka')::boolean
    and case when r->>'b' ~ '^[0-9]+$' then (r->>'b')::integer between 20000 and 36000 else false end);
end $$;

-- Nezávislé ověření PR #163 (nález 3): vstup úlohy
-- (`rezervace_choice_zabrat_dotaz_ulohy`) nebere zámek firmy, takže
-- `for update` u řádku fronty je JEDINÉ, co ji řadí za souběžné
-- tlačítko. Bez něj úloha přečte `dalsi_volny` dřív, než tlačítko
-- zapíše, její UPDATE na zámku počká a pak zapíše čas spočtený ze
-- starého stavu — úloha i tlačítko dostanou TENTÝŽ čas a na Choice
-- odejdou dva dotazy naráz (limit 1 za 5 s, hrozí 429). Souběhy výš
-- volají jen funkce tlačítek, tohle by nechytily.
--
-- A = tlačítko: zámky jako `rezervace_choice_zabrat_dotaz` na začátku
-- (firma, pak fronta), zastaví se. B = vstup úlohy, asynchronně, musí
-- stát na zámku A. Pak A zabere dotaz skutečnou funkcí a potvrdí.
-- Měří se, o kolik se posunul další volný čas fronty: dva dotazy za
-- sebou = o dva rozestupy (11 s), tentýž čas dvakrát = o jeden (5,5 s).
-- Výchozí `dalsi_volny` (teď + 30 s) je čas, který dostane A.
create or replace function pg_temp.soubeh_ulohy(p_funkce text) returns jsonb
language plpgsql as $$
declare
  v_firma   text := current_setting('test.tenant105');
  v_spojeni text := format('dbname=%s user=%s port=%s', current_database(), current_user,
                           (select setting from pg_settings where name = 'port'));
  v_pid_a   integer;
  v_pid_b   integer;
  v_a       integer;
  v_b       text;
  v_ceka    boolean := false;
  v_pred    timestamptz;
  v_po      timestamptz;
begin
  perform test105.dblink_connect('a105u', v_spojeni);
  perform test105.dblink_connect('b105u', v_spojeni);
  begin
    select x into v_pid_a from test105.dblink('a105u', 'select pg_backend_pid()') as t(x integer);
    select x into v_pid_b from test105.dblink('b105u', 'select pg_backend_pid()') as t(x integer);
    perform test105.dblink_exec('a105u', 'set lock_timeout = ''20s''');
    perform test105.dblink_exec('b105u', 'set lock_timeout = ''20s''');

    -- Výchozí stav, zapsaný (A je zatím mimo transakci): fronta volná až
    -- za 30 s, firma tlačítka nemá nic zabraného.
    perform test105.dblink_exec('a105u', 'update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval ''30 seconds''');
    perform test105.dblink_exec('a105u', format(
      'insert into app.rezervace_choice_fronta_firmy (tenant_id) values (%L) '
      'on conflict (tenant_id) do update set zabrano_do = ''-infinity''', v_firma));
    select x into v_pred from test105.dblink('a105u', 'select dalsi_volny from app.rezervace_choice_fronta') as t(x timestamptz);

    -- A: zámky jako tlačítko na začátku (firma, pak fronta), nic nezapsáno.
    perform test105.dblink_exec('a105u', 'begin');
    perform x from test105.dblink('a105u', format(
      'select 1 from app.rezervace_choice_fronta_firmy where tenant_id = %L for update', v_firma)) as t(x integer);
    perform x from test105.dblink('a105u', 'select 1 from app.rezervace_choice_fronta where jediny for update') as t(x integer);

    -- B: vstup úlohy jako service_role (jako server), asynchronně.
    perform test105.dblink_exec('b105u', 'set role service_role');
    perform test105.dblink_send_query('b105u', format(
      'select coalesce(%s(5500, 60000)::text, ''nic'')', p_funkce));

    for i in 1..200 loop
      if v_pid_a = any(pg_blocking_pids(v_pid_b)) then
        v_ceka := true;
        exit;
      end if;
      perform pg_sleep(0.05);
    end loop;

    -- A dokončí skutečnou funkcí tlačítka: dotaz za 30 s, zapíše.
    select x into v_a from test105.dblink('a105u', format(
      'select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', v_firma)) as t(x integer);
    perform test105.dblink_exec('a105u', 'commit');

    select x into v_b from test105.dblink_get_result('b105u') as t(x text);
    perform x from test105.dblink_get_result('b105u') as t(x text);
    select x into v_po from test105.dblink('a105u', 'select dalsi_volny from app.rezervace_choice_fronta') as t(x timestamptz);
  exception when others then
    perform test105.dblink_disconnect('a105u');
    perform test105.dblink_disconnect('b105u');
    raise;
  end;
  perform test105.dblink_disconnect('a105u');
  perform test105.dblink_disconnect('b105u');
  return jsonb_build_object('ceka', v_ceka, 'a', v_a, 'b', v_b,
                            'posun', round(extract(epoch from (v_po - v_pred)) * 1000));
end $$;

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    raise notice '  (PGlite: souběh úlohy s tlačítkem se přeskakuje — ověřuje ho běh proti PostgreSQL)';
    return;
  end if;
  r := pg_temp.soubeh_ulohy('public.rezervace_choice_zabrat_dotaz_ulohy');
  perform pg_temp.check(format('… tlačítko zabralo dotaz za ~30 s (%s ms) a vstup úlohy stál na jeho zámku', r->>'a'),
    (r->>'ceka')::boolean and (r->>'a')::integer between 20000 and 30000);
  perform pg_temp.check(format('souběh úlohy s tlačítkem: vstup úlohy stál na zámku fronty a dostal dotaz o rozestup dál (úloha %s ms, tlačítko %s ms; fronta posunutá o %s ms = dva dotazy)', r->>'b', r->>'a', r->>'posun'),
    (r->>'ceka')::boolean
    and coalesce(pg_temp.cislo(r->>'b') - (r->>'a')::integer between 4000 and 5600, false)
    and (r->>'posun')::numeric = 11000);
end $$;

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    return;
  end if;
  r := pg_temp.soubeh_ulohy('test105.ulohy_bez_zamku');
  perform pg_temp.check(format('kontrola souběhu úlohy umí spadnout: kopie vstupu úlohy BEZ zámku fronty dostane v témž souběhu TENTÝŽ čas jako tlačítko (úloha %s ms, tlačítko %s ms; fronta posunutá jen o %s ms)', r->>'b', r->>'a', r->>'posun'),
    (r->>'ceka')::boolean
    and coalesce(pg_temp.cislo(r->>'b') - (r->>'a')::integer between -100 and 2000, false)
    and (r->>'posun')::numeric = 5500);
end $$;

update app.rezervace_choice_fronta set dalsi_volny = '-infinity';

reset statement_timeout;

-- Schéma test105 (dblink a kopie bez zámků) se uklízí až po oddílu 2d.
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';


\echo ''
\echo '== 2c. Odstup „Ověřit znovu" na připojení =============='

-- Každé „Ověřit znovu" je dotaz ve společné frontě — na připojení nejvýš
-- jednou za minutu. Čas drží databáze; `posledni_test_kdy` v registru
-- si správce napojení přepíše. Odstup a dotaz ve frontě rozhoduje funkce
-- NARÁZ (nezávislé ověření 26. 10.): v odstupu se fronty nedotkne, a když
-- se dotaz do fronty nevejde, odstup nespotřebuje.

-- Jedno „Ověřit znovu" přesně jako server (lib/rezervace-choice-sync.ts:
-- odstup minuta, rozestup 5,5 s, tlačítko čeká nejvýš 11 s). Výsledek
-- jako text: počet ms, '-1' = ověřovalo se před chvílí, '-n' (n ≥ 2) =
-- do fronty se nevešel, znovu za n ms; 'nic' = NULL (nemá nastat).
create or replace function pg_temp.overit(p_pripojeni uuid, p_tenant uuid) returns text
language sql volatile as $$
  select coalesce(public.rezervace_choice_zabrat_overeni(p_pripojeni, p_tenant, 60000, 5500, 11000)::text, 'nic')
$$;

delete from app.rezervace_choice_overeni where pripojeni_id = :'choice';
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as overeni1 \gset
select pg_temp.overit(:'choice', :'tenant') as overeni2 \gset
reset role;
select pg_temp.check(format('první „Ověřit znovu" u připojení smí: dotaz ve frontě hned (%s ms)', :'overeni1'),
  coalesce(pg_temp.cislo(:'overeni1') between 0 and 100, false));
select pg_temp.check('… zabral se za firmu připojení (pravidlo „firma nejvýš jeden zabraný dotaz" platí i tady)',
  exists (select 1 from app.rezervace_choice_fronta_firmy
           where tenant_id = :'tenant' and zabrano_do > clock_timestamp() - interval '5 seconds'));
select pg_temp.check(format('druhé hned po něm: -1, ověřovalo se před chvílí (%s)', :'overeni2'),
  :'overeni2' = '-1');
select pg_temp.check('… a fronty se nedotklo (další volný čas jen za tím prvním dotazem)',
  (select dalsi_volny between clock_timestamp() + interval '4 seconds' and clock_timestamp() + interval '5.5 seconds'
     from app.rezervace_choice_fronta));

-- Délka odstupu proti SKUTEČNÉ funkci (nezávislé ověření 26. 10.:
-- jednotka „1 millisecond" → „1 microsecond" dřív prošla, odstup by byl
-- 60 ms). Fronta volná a firma bez zabraného dotazu: rozhoduje jen odstup.
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
update app.rezervace_choice_overeni set naposledy = clock_timestamp() - interval '30 seconds' where pripojeni_id = :'choice';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as odstup30 \gset
reset role;
update app.rezervace_choice_overeni set naposledy = clock_timestamp() - interval '59 seconds' where pripojeni_id = :'choice';
select naposledy::text as naposledy59 from app.rezervace_choice_overeni where pripojeni_id = :'choice' \gset
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as odstup59 \gset
reset role;
-- Nezávislé ověření po sloučení #162 (nález 4): délka odstupu byla
-- hlídaná, ale ne to, že klik V ODSTUPU odstup neprodlouží. S „klouzavým
-- oknem" (při -1 zapsat naposledy = teď) by opakované klikání drželo
-- „Ověřit znovu" zamčené donekonečna — a JS svět v testu má vlastní
-- model funkce, takže by to nechytil. Tady proti SKUTEČNÉ funkci: čas
-- posledního ověření se klikem v odstupu nezměnil, a o 2 s později
-- (posunem toho času o 2 s do minulosti, jako by uplynuly) už ověření
-- projde.
select pg_temp.check('klik v odstupu (-1) odstup neprodlouží: čas posledního ověření je pořád ten před 59 s',
  (select naposledy = :'naposledy59'::timestamptz from app.rezervace_choice_overeni where pripojeni_id = :'choice'));
update app.rezervace_choice_overeni set naposledy = naposledy - interval '2 seconds' where pripojeni_id = :'choice';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as odstup59_po2s \gset
reset role;
select pg_temp.check(format('… a o 2 s později (minuta od posledního ověření uplynula) projde (%s ms)', :'odstup59_po2s'),
  coalesce(pg_temp.cislo(:'odstup59_po2s') between 0 and 100, false));
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
update app.rezervace_choice_overeni set naposledy = clock_timestamp() - interval '61 seconds' where pripojeni_id = :'choice';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as odstup61 \gset
reset role;
select pg_temp.check(format('odstup trvá minutu: ověřovalo se před 30 s → pořád ne (%s)', :'odstup30'), :'odstup30' = '-1');
select pg_temp.check(format('… před 59 s → pořád ne (%s)', :'odstup59'), :'odstup59' = '-1');
select pg_temp.check(format('… před 61 s → už ano (%s ms)', :'odstup61'), coalesce(pg_temp.cislo(:'odstup61') between 0 and 100, false));

-- Fronta plná (víc běhů naráz, volná až za 20 s; tlačítko čeká nejvýš
-- 11 s): dotaz se nevejde → „znovu za ~9 s" (záporně), nic se nezabere
-- a odstup se NESPOTŘEBUJE. Dřív tu minuta propadla bez jediného dotazu.
update app.rezervace_choice_fronta set dalsi_volny = clock_timestamp() + interval '20 seconds';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
update app.rezervace_choice_overeni set naposledy = clock_timestamp() - interval '61 seconds' where pripojeni_id = :'choice';
select naposledy::text as naposledy_pred from app.rezervace_choice_overeni where pripojeni_id = :'choice' \gset
select dalsi_volny::text as fronta_pred from app.rezervace_choice_fronta \gset
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as plna \gset
reset role;
select pg_temp.check(format('fronta plná: znovu za ~9 s, dotaz se nezabral (%s)', :'plna'),
  coalesce(pg_temp.cislo(:'plna') between -9000 and -8500, false)
  and (select dalsi_volny = :'fronta_pred'::timestamptz from app.rezervace_choice_fronta)
  and (select zabrano_do = '-infinity' from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant'));
select pg_temp.check('… a odstup se NESPOTŘEBOVAL (čas posledního ověření beze změny)',
  (select naposledy = :'naposledy_pred'::timestamptz from app.rezervace_choice_overeni where pripojeni_id = :'choice'));
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as po_uvolneni \gset
reset role;
select pg_temp.check(format('fronta se uvolnila → ověření projde hned, bez čekání na minutu (%s ms)', :'po_uvolneni'),
  coalesce(pg_temp.cislo(:'po_uvolneni') between 0 and 100, false));

update app.rezervace_choice_overeni set naposledy = clock_timestamp() - interval '61 seconds' where pripojeni_id = :'choice';
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
-- Funkce je volatile, v agregaci se zavolá pro každý řádek zvlášť.
select count(*) filter (where pg_temp.cislo(pg_temp.overit(:'choice', :'tenant')) >= 0) as overeni_smi,
       count(*) as overeni_vse
  from generate_series(1, 5) \gset
reset role;
select pg_temp.check('po minutě zase smí — a z pěti volání po sobě jen první',
  :overeni_vse = 5 and :overeni_smi = 1);
select pg_temp.check('čas ověření zapsala funkce (teď)',
  (select naposledy > clock_timestamp() - interval '5 seconds'
     from app.rezervace_choice_overeni where pripojeni_id = :'choice'));

set role service_role;
select pg_temp.check('ověření bez připojení se odmítne',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(null, %L, 60000, 5500, 11000)', :'tenant'), '22023', 'musí patřit připojení'));
select pg_temp.check('… bez firmy taky (dotaz ve frontě patří firmě)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, null, 60000, 5500, 11000)', :'choice'), '22023', 'musí patřit firmě'));
select pg_temp.check('odstup pod 30 s nebo nad hodinu se odmítne',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, %L, 29999, 5500, 11000)', :'choice', :'tenant'), '22023', '30 sekund až 1 hodina')
  and pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, %L, 3600001, 5500, 11000)', :'choice', :'tenant'), '22023', '30 sekund až 1 hodina'));
select pg_temp.check('neexistující připojení se odmítne (cizí klíč)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, %L, 60000, 5500, 11000)', gen_random_uuid(), :'tenant'), '23503', 'rezervace_choice_overeni'));
reset role;
-- Rozestup a čekání ověřuje fronta — dojde se k ní, jen když odstup pustí.
update app.rezervace_choice_overeni set naposledy = '-infinity' where pripojeni_id = :'choice';
set role service_role;
select pg_temp.check('rozestup pod 5 s se odmítne i tady (ověří ho fronta)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, %L, 60000, 4999, 11000)', :'choice', :'tenant'), '22023', '5 až 60 sekund'));
reset role;
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';


\echo ''
\echo '== 2d. Souběh dvou „Ověřit znovu" (jen PostgreSQL) ======'

-- Nezávislé ověření po sloučení #162 (nález 5): zámek řádku odstupu
-- (`select … for update` v rezervace_choice_zabrat_overeni) je JEDINÁ
-- ochrana proti dvěma souběžným „Ověřit znovu" na tomtéž připojení
-- a nic ho nehlídalo. Bez něj druhé volání přečte starý čas posledního
-- ověření, na zámku firmy počká, až první skončí, a pravidlo firmy ho
-- nezastaví (zabraný dotaz prvního je při volné frontě už minulost) —
-- dostane slot +5,5 s a na Choice jdou do minuty dva testy.
--
-- Stejný postup jako 2b: A vezme zámky jako funkce na začátku (odstup,
-- firma, fronta) a zastaví se; B zavolá funkci za totéž připojení a musí
-- stát na zámku, který drží A; pak A dokončí (zabere dotaz, zapíše čas
-- ověření) a potvrdí. SKUTEČNÁ funkce: B stojí na zámku odstupu a po A
-- dostane -1. Kopie BEZ zámku odstupu (test105.overit_bez_zamku, oddíl
-- 2b): B projde odstupem se starým časem, stojí až na zámku firmy a po
-- A dostane dotaz (~5,5 s) — kontrola umí spadnout, ukázané při každém
-- běhu. PGlite (jediné spojení, bez dblink) oddíl přeskočí.
--
-- CO TU OVĚŘENÉ NENÍ: jen tohle jedno proložení (B čte, když A drží
-- zámky a ještě nezapsal).

create or replace function pg_temp.soubeh_overeni(p_funkce text) returns jsonb
language plpgsql as $$
declare
  v_firma     text := current_setting('test.tenant105');
  v_pripojeni text := current_setting('test.choice105');
  v_spojeni   text := format('dbname=%s user=%s port=%s', current_database(), current_user,
                             (select setting from pg_settings where name = 'port'));
  v_pid_a     integer;
  v_pid_b     integer;
  v_a         integer;
  v_b         text;
  v_ceka      boolean := false;
begin
  perform test105.dblink_connect('a105o', v_spojeni);
  perform test105.dblink_connect('b105o', v_spojeni);
  begin
    select x into v_pid_a from test105.dblink('a105o', 'select pg_backend_pid()') as t(x integer);
    select x into v_pid_b from test105.dblink('b105o', 'select pg_backend_pid()') as t(x integer);
    perform test105.dblink_exec('a105o', 'set lock_timeout = ''20s''');
    perform test105.dblink_exec('b105o', 'set lock_timeout = ''20s''');

    -- Výchozí stav, zapsaný (A je zatím mimo transakci): fronta volná,
    -- firma nemá nic zabraného, připojení se ověřovalo před 61 s.
    perform test105.dblink_exec('a105o', 'update app.rezervace_choice_fronta set dalsi_volny = ''-infinity''');
    perform test105.dblink_exec('a105o', format(
      'insert into app.rezervace_choice_fronta_firmy (tenant_id) values (%L) '
      'on conflict (tenant_id) do update set zabrano_do = ''-infinity''', v_firma));
    perform test105.dblink_exec('a105o', format(
      'insert into app.rezervace_choice_overeni (pripojeni_id, naposledy) values (%L, clock_timestamp() - interval ''61 seconds'') '
      'on conflict (pripojeni_id) do update set naposledy = clock_timestamp() - interval ''61 seconds''', v_pripojeni));

    -- A: zámky jako funkce na začátku (odstup, firma, fronta), nic nezapsáno.
    perform test105.dblink_exec('a105o', 'begin');
    perform x from test105.dblink('a105o', format(
      'select 1 from app.rezervace_choice_overeni where pripojeni_id = %L for update', v_pripojeni)) as t(x integer);
    perform x from test105.dblink('a105o', format(
      'select 1 from app.rezervace_choice_fronta_firmy where tenant_id = %L for update', v_firma)) as t(x integer);
    perform x from test105.dblink('a105o', 'select 1 from app.rezervace_choice_fronta where jediny for update') as t(x integer);

    -- B: „Ověřit znovu" téhož připojení jako service_role (jako server), asynchronně.
    perform test105.dblink_exec('b105o', 'set role service_role');
    perform test105.dblink_send_query('b105o', format(
      'select coalesce(%s(%L, %L, 60000, 5500, 11000)::text, ''nic'')', p_funkce, v_pripojeni, v_firma));

    for i in 1..200 loop
      if v_pid_a = any(pg_blocking_pids(v_pid_b)) then
        v_ceka := true;
        exit;
      end if;
      perform pg_sleep(0.05);
    end loop;

    -- A dokončí skutečnou funkcí: odstup prošel (61 s), dotaz hned, zapíše čas.
    select x into v_a from test105.dblink('a105o', format(
      'select public.rezervace_choice_zabrat_overeni(%L, %L, 60000, 5500, 11000)', v_pripojeni, v_firma)) as t(x integer);
    perform test105.dblink_exec('a105o', 'commit');

    select x into v_b from test105.dblink_get_result('b105o') as t(x text);
    perform x from test105.dblink_get_result('b105o') as t(x text);
  exception when others then
    perform test105.dblink_disconnect('a105o');
    perform test105.dblink_disconnect('b105o');
    raise;
  end;
  perform test105.dblink_disconnect('a105o');
  perform test105.dblink_disconnect('b105o');
  return jsonb_build_object('ceka', v_ceka, 'a', v_a, 'b', v_b);
end $$;

set statement_timeout = '120s';

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    raise notice '  (PGlite: souběh dvou „Ověřit znovu" se přeskakuje — ověřuje ho běh proti PostgreSQL)';
    return;
  end if;
  r := pg_temp.soubeh_overeni('public.rezervace_choice_zabrat_overeni');
  perform pg_temp.check('souběh dvou ověření téhož připojení: druhé stálo na zámku, který drží první',
    (r->>'ceka')::boolean);
  perform pg_temp.check(format('… první ověření prošlo odstupem a zabralo dotaz hned (%s ms)', r->>'a'),
    (r->>'a')::integer between 0 and 100);
  perform pg_temp.check(format('souběh dvou ověření téhož připojení: druhé po zámku odstupu dostane -1, NE druhý dotaz (%s)', r->>'b'),
    r->>'b' = '-1');
end $$;

do $$
declare
  r jsonb;
begin
  if pg_temp.je_pglite() then
    return;
  end if;
  r := pg_temp.soubeh_overeni('test105.overit_bez_zamku');
  perform pg_temp.check(format('kontrola souběhu ověření umí spadnout: kopie BEZ zámku odstupu dá v témž souběhu druhý dotaz (%s ms) — dva testy do minuty', r->>'b'),
    (r->>'ceka')::boolean
    and coalesce(pg_temp.cislo(r->>'b') between 4500 and 5600, false));
end $$;

reset statement_timeout;

do $$
begin
  if pg_temp.je_pglite() then
    return;
  end if;
  drop function test105.zabrat_bez_zamku(uuid, integer, integer);
  drop function test105.overit_bez_zamku(uuid, uuid, integer, integer, integer);
  drop extension dblink;
  drop schema test105;
end $$;
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
delete from app.rezervace_choice_overeni where pripojeni_id = :'choice';


\echo ''
\echo '== 3. Práva a vlastník, který není superuživatel ========'

-- Granty hlídá i TEXT migrace (scripts/provoz-granty.test.mjs): v čisté
-- databázi tady chybí výchozí práva Supabase, takže revoke bez
-- `authenticated` by tahle kontrola nepoznala.
select pg_temp.check('frontu volá jen service_role, přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)', 'execute'));

select pg_temp.check('vstup úlohy do fronty volá jen service_role, přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)', 'execute'));

select pg_temp.check('odstup ověření volá jen service_role, přihlášený ani anonym ne',
  has_function_privilege('service_role', 'public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)', 'execute'));

-- Nezávislé ověření PR #163 (nález 4): funkce fronty jsou ve schématu
-- public a krok31 hlídá search_path jen ve schématu app — jejich ztrátu
-- by jinak nepoznalo nic. Všechny tři běží s právy vlastníka (do tabulek
-- fronty nesmí nikdo jiný), takže prázdná search_path je povinná.
select pg_temp.check('všechny tři funkce fronty běží s právy vlastníka a s prázdnou search_path',
  (select count(*) = 3 and bool_and(p.prosecdef and p.proconfig = array['search_path=""'])
     from pg_proc p
    where p.oid in ('public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)'::regprocedure,
                    'public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)'::regprocedure,
                    'public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)'::regprocedure)));

set role authenticated;
select pg_temp.check('přihlášený frontu nezavolá (42501)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_dotaz(%L, 5500, 60000)', :'tenant'), '42501', 'permission denied'));
select pg_temp.check('… ani vstup úlohy (42501) — jinak by si zabíral frontu bez pravidla firmy',
  pg_temp.spadne_hlaskou('select public.rezervace_choice_zabrat_dotaz_ulohy(5500, 60000)', '42501', 'permission denied'));
select pg_temp.check('… ani odstup ověření (42501) — jinak by si ho mohl sám vynulovat',
  pg_temp.spadne_hlaskou(format('select public.rezervace_choice_zabrat_overeni(%L, %L, 60000, 5500, 11000)', :'choice', :'tenant'), '42501', 'permission denied'));
reset role;

select pg_temp.check('do tabulek fronty nesahá nikdo kromě funkce (ani service_role)',
  not has_table_privilege('service_role', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta', 'update')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('anon', 'app.rezervace_choice_fronta', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta_firmy', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_fronta_firmy', 'update')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_fronta_firmy', 'select')
  and not has_table_privilege('anon', 'app.rezervace_choice_fronta_firmy', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_overeni', 'select')
  and not has_table_privilege('service_role', 'app.rezervace_choice_overeni', 'update')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_overeni', 'select')
  and not has_table_privilege('authenticated', 'app.rezervace_choice_overeni', 'update')
  and not has_table_privilege('anon', 'app.rezervace_choice_overeni', 'select'));

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
alter table app.rezervace_choice_overeni owner to vlastnik105;
alter function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) owner to vlastnik105;
alter function public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer) owner to vlastnik105;
alter function public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer) owner to vlastnik105;
select pg_temp.check('zkušební vlastník není superuživatel',
  not (select rolsuper from pg_roles where rolname = 'vlastnik105'));

update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id in (:'tenant', :'cizi');
delete from app.rezervace_choice_overeni where pripojeni_id = :'choice';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat_v1 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat_v2 \gset
select coalesce(public.rezervace_choice_zabrat_dotaz(:'tenant', 5500, 60000)::text, 'nic') as cekat_v3 \gset
-- Úloha vlastním vstupem hned za nimi (fronta volná za ~11 s).
select coalesce(public.rezervace_choice_zabrat_dotaz_ulohy(5500, 60000)::text, 'nic') as uloha_v \gset
reset role;
-- „Ověřit znovu" zabírá dotaz frontou (vlastník je tentýž) — fronta volná.
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
select pg_temp.overit(:'choice', :'tenant') as overeni_v1 \gset
select pg_temp.overit(:'choice', :'tenant') as overeni_v2 \gset
reset role;
select pg_temp.check(format('s vlastníkem bez superuživatele fronta funguje stejně, i pravidlo jednoho zabraného dotazu (%s, %s, %s ms)', :'cekat_v1', :'cekat_v2', :'cekat_v3'),
  coalesce(pg_temp.cislo(:'cekat_v1') between 0 and 100, false)
  and coalesce(pg_temp.cislo(:'cekat_v2') between 4500 and 5500, false)
  and coalesce(pg_temp.cislo(:'cekat_v3') between -5500 and -4500, false));
select pg_temp.check(format('… i vstup úlohy (čeká za nimi ~11 s: %s ms)', :'uloha_v'),
  coalesce(pg_temp.cislo(:'uloha_v') between 10000 and 11000, false));
select pg_temp.check(format('… i odstup ověření s frontou (první dotaz zabere: %s ms, druhé hned -1: %s)', :'overeni_v1', :'overeni_v2'),
  coalesce(pg_temp.cislo(:'overeni_v1') between 0 and 100, false) and :'overeni_v2' = '-1');

alter function public.rezervace_choice_zabrat_dotaz(uuid, integer, integer) owner to current_user;
alter function public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer) owner to current_user;
alter function public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer) owner to current_user;
alter table app.rezervace_choice_fronta owner to current_user;
alter table app.rezervace_choice_fronta_firmy owner to current_user;
alter table app.rezervace_choice_overeni owner to current_user;
select pg_temp.check('vlastník funkcí i tabulek je zase ten, kdo pouští migrace',
  (select bool_and(pg_get_userbyid(proowner) = current_user) from pg_proc
    where oid in ('public.rezervace_choice_zabrat_dotaz(uuid, integer, integer)'::regprocedure,
                  'public.rezervace_choice_zabrat_dotaz_ulohy(integer, integer)'::regprocedure,
                  'public.rezervace_choice_zabrat_overeni(uuid, uuid, integer, integer, integer)'::regprocedure))
  and (select bool_and(pg_get_userbyid(relowner) = current_user) from pg_class
        where oid in ('app.rezervace_choice_fronta'::regclass, 'app.rezervace_choice_fronta_firmy'::regclass,
                      'app.rezervace_choice_overeni'::regclass)));
revoke usage on schema app from vlastnik105;
drop role vlastnik105;
update app.rezervace_choice_fronta set dalsi_volny = '-infinity';
delete from app.rezervace_choice_fronta_firmy where tenant_id = :'tenant';
set role service_role;
select coalesce(public.rezervace_choice_zabrat_dotaz(:'cizi', 5500, 60000)::text, 'nic') as cekat_cizi2 \gset
reset role;
select pg_temp.check('cizí firma má ve frontě svůj řádek',
  coalesce(pg_temp.cislo(:'cekat_cizi2') >= 0, false) and exists (select 1 from app.rezervace_choice_fronta_firmy where tenant_id = :'cizi'));
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
  and not exists (select 1 from public.tenants where name like 'Krok105 %')
  and not exists (select 1 from app.rezervace_choice_fronta_firmy)
  and not exists (select 1 from app.rezervace_choice_overeni)
  and not exists (select 1 from pg_namespace where nspname = 'test105')
  and not exists (select 1 from pg_roles where rolname = 'vlastnik105'));

\echo ''
\echo '== KROK 105 HOTOV ========================================'
