-- Scénář marketing 8 — úložiště fotek.
--
-- Pokrývá 20260913120000_marketing_ulozne.sql.
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 4.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Že se k fotkám jedné restaurace nedostane druhá. Je to jediné místo
-- v modulu, kde únik neznamená „viděl cizí text", ale „viděl cizí lidi
-- v cizím podniku" — na fotkách z provozovny bývají hosté a personál.
--
-- Politiky se nezeptají samy od sebe, kdo je odkud: musí to vyčíst
-- Z CESTY. Proto má scénář zvláštní oddíl na čtení cesty. Když se
-- rozbije čtení cesty, politiky pořád „platí" a přitom nechrání nic.
--
-- ---------------------------------------------------------------------
-- CO TENHLE BĚH V PGLITE NEDOKÁŽE
--
-- `storage` je tu napodobenina z `00_harness.sql`, ne Supabase Storage.
-- Ověřuje se tedy PRAVIDLO, ne služba: že politika pustí a nepustí
-- toho, koho má. Že Storage ta pravidla opravdu uplatní na nahrávání
-- přes HTTP, tenhle scénář neříká — to řekne až běh proti PostgreSQL
-- a pak zkouška v ostrém projektu.
--
-- Píšu to sem schválně. Zelený běh odsud není důkaz, že fotky nikam
-- neunikají.
--
-- ---------------------------------------------------------------------
-- POUČENÍ Z ROZBÍJENÍ
--
-- Devět záměrných sabotáží migrace. Osm spadlo na pojmenované
-- kontrole; devátá („úprava bez `with check`") ne, a proč, je
-- vysvětlené dole u té kontroly — drží ji dvě politiky najednou.
--
-- Tři věci, které se přitom ukázaly a stály za to:
--
--   1. TŘI KONTROLY NEUMĚLY SPADNOUT VŮBEC. Zápis, mazání a úprava
--      procházely, i když se v politice vyměnil `marketing.manage` za
--      `marketing.read`. Nebylo totiž kým to změřit: číšník nemá
--      marketing vůbec a majitel má všechno. Doplnil se proto herec,
--      který smí jen číst.
--   2. HERCE JSEM NEJDŘÍV VYROBIL ŠPATNĚ. Dal jsem mu id, které už
--      patřilo „Druhé majitelce" z kroku 9, a `on conflict do nothing`
--      to tiše spolklo — z člověka, co smí jen číst, byl spolumajitel.
--      Proto tu žádné `on conflict` není a jeho práva se rovnou
--      ověřují.
--   3. SABOTÁŽ NAD NEÚPLNOU SADOU SCÉNÁŘŮ NEDOKAZUJE NIC. Dvakrát mi
--      všech devět sabotáží vyrobilo devětkrát tutéž cizí chybu
--      (chybějící herec z dřívějšího scénáře) a vypadalo to jako
--      důkaz. Ověřovat se to musí sadou, která projde i jako celek.

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

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

-- Cizí firma. Nemusí existovat: `app.has_access` na neznámou firmu
-- vrátí nepravdu stejně jako na cizí, a o to tu jde.
select '00000000-0000-0000-0000-0000000000ff'::uuid as cizi \gset


-- ---------------------------------------------------------------------
-- HEREC, KTERÝ SMÍ JEN KOUKAT
--
-- Bez něj se v tomhle scénáři NEDÁ ODLIŠIT čtení od zápisu. Číšník
-- nemá marketing vůbec, majitel má všechno — takže obě sady kontrol
-- procházejí, ať politika zápisu žádá `marketing.read` nebo
-- `marketing.manage`. Ověřeno rozbíjením: záměna práva v politice
-- zápisu neshodila nic, dokud tenhle člověk neexistoval.
--
-- V provozu je to úplně běžná role: kdo připravuje podklady a smí
-- vidět, co se chystá, ale nemá co sahat na knihovnu fotek.
--
-- ---------------------------------------------------------------------
-- BEZ `on conflict`, A PROČ
--
-- Napsal jsem ho nejdřív s id `cccccccc-…` a s `on conflict do
-- nothing`. Jenže to id už patří „Druhé majitelce" z kroku 9 — vložení
-- tedy TIŠE NEUDĚLALO NIC a z „člověka, který smí jen číst" byl
-- spolumajitel se všemi právy. Samostatný běh scénáře to neodhalil
-- (krok 9 v něm nebyl), v celé sadě to spadlo.
--
-- Je to táž past jako `create table if not exists` z CLAUDE.md,
-- „Dvě relace v jednom repozitáři": srážka jmen se nemá obcházet, má
-- spadnout. Proto tu žádné `on conflict` není a hned pod tím se
-- ověřuje, že ten člověk má opravdu jen to, co má mít.
-- ---------------------------------------------------------------------

select set_config('test.user_id', '', false);

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska_marketing_ctenar', 'Zkouška — marketing jen čtení', 'vedeni', true)
returning id as z_ctenar \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_ctenar', 'marketing.read');

insert into auth.users (id, email, raw_user_meta_data) values
  ('8a000008-0000-0000-0000-000000000008', 'marketing-ctenar@foodtab.cz',
   '{"full_name":"Čtenář Marketingu"}');

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', '8a000008-0000-0000-0000-000000000008', null, 'active', 'tenant');

insert into public.employees (tenant_id, user_id, position_id, full_name, employment_type)
values (:'tenant', '8a000008-0000-0000-0000-000000000008', :'z_ctenar',
        'Čtenář Marketingu', 'hpp');

select '8a000008-0000-0000-0000-000000000008'::uuid as ctenar \gset
select set_config('test.ctenar', :'ctenar', false);

/*
  A TEĎ SE OVĚŘÍ, ŽE JE TEN ČLOVĚK OPRAVDU TAKOVÝ, JAK SE TVÁŘÍ.

  Bez tohohle by celý oddíl „Čtení není zápis" měřil něco jiného, než
  si myslí — a poznalo by se to až tím, že by kontrola prošla i nad
  rozbitou politikou. Přesně to se stalo.
*/
set role authenticated;
select set_config('test.user_id', :'ctenar', false);

select pg_temp.check('herec pro čtení marketing.read má',
  app.has_access(:'tenant', 'marketing.read', :'perla'));
select pg_temp.check('a marketing.manage NEmá',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));
select pg_temp.check('a není to omylem majitel',
  not exists (select 1 from public.employees
               where user_id = :'ctenar' and tenant_id = :'tenant' and je_majitel));
reset role;


\echo ''
\echo '== Kbelík je SOUKROMÝ ======================================='

/*
  Kdyby byl veřejný, všechno ostatní v téhle migraci je k ničemu:
  politiky hlídají přístup přes databázi, ale veřejný kbelík vydá
  soubor komukoli, kdo zná adresu, úplně mimo ně.
*/
select pg_temp.check('kbelík marketing existuje',
  exists (select 1 from storage.buckets where id = 'marketing'));

select pg_temp.check('a NENÍ veřejný',
  (select not public from storage.buckets where id = 'marketing'));

select pg_temp.check('má strop na velikost souboru',
  (select file_size_limit from storage.buckets where id = 'marketing') > 0);

-- Bílá listina, ne černá. Seznam zakázaných typů je vždycky neúplný.
select pg_temp.check('a pouští jen obrázky',
  (select allowed_mime_types from storage.buckets where id = 'marketing')
    @> array['image/jpeg', 'image/png', 'image/webp']);

select pg_temp.check('nic jiného než obrázky v seznamu není',
  (select array_length(allowed_mime_types, 1) from storage.buckets where id = 'marketing') = 3);


\echo ''
\echo '== Čtení cesty ============================================='

/*
  Tohle je pod politikami. Kdyby čtení cesty vracelo prázdno vždycky,
  politiky by nepustily nikoho a vypadalo by to bezpečně; kdyby
  vracelo cokoli, pustily by kohokoli. Obojí se pozná jen tady.
*/

select pg_temp.check('z cesty se přečte firma i pobočka',
  exists (select 1 from app.marketing_cesta_rozsah(:'tenant' || '/' || :'perla' || '/a.jpg') r
           where r.tenant_id = :'tenant' and r.branch_id = :'perla'));

select pg_temp.check('slovo firma znamená bez pobočky',
  exists (select 1 from app.marketing_cesta_rozsah(:'tenant' || '/firma/logo.png') r
           where r.tenant_id = :'tenant' and r.branch_id is null));

/*
  Nesmyslná cesta musí vyjít PRÁZDNÁ, ne spadnout. Přímý `::uuid`
  v politice by u takové cesty vyhodil výjimku — a chyba z politiky se
  navenek tváří jako chyba serveru, ne jako odepřený přístup. Uživatel
  by viděl „něco se pokazilo" tam, kde měl vidět „sem nemáte".
*/
select pg_temp.check('nesmyslná firma vrátí prázdno, ne výjimku',
  not exists (select 1 from app.marketing_cesta_rozsah('tohle-neni-uuid/x/a.jpg')));

select pg_temp.check('nesmyslná pobočka vrátí prázdno',
  not exists (select 1 from app.marketing_cesta_rozsah(:'tenant' || '/taky-ne/a.jpg')));

-- Mělká cesta by se jinak přečetla jako „firma bez pobočky" a soubor
-- položený do kořene kbelíku by patřil komukoli.
select pg_temp.check('soubor v kořeni kbelíku nepatří nikomu',
  not exists (select 1 from app.marketing_cesta_rozsah('a.jpg')));

select pg_temp.check('a příliš hluboká cesta taky ne',
  not exists (select 1 from app.marketing_cesta_rozsah(:'tenant' || '/' || :'perla' || '/dal/a.jpg')));


\echo ''
\echo '== Kdo smí nahrávat ========================================'

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into storage.objects (bucket_id, name)
values ('marketing', :'tenant' || '/' || :'perla' || '/vlastni.jpg');

select pg_temp.check('majitel nahraje fotku své pobočky',
  exists (select 1 from storage.objects
           where name = :'tenant' || '/' || :'perla' || '/vlastni.jpg'));

insert into storage.objects (bucket_id, name)
values ('marketing', :'tenant' || '/firma/logo.png');

select pg_temp.check('a firemní logo taky',
  exists (select 1 from storage.objects where name = :'tenant' || '/firma/logo.png'));

select set_config('test.cizi', :'cizi', false);
select set_config('test.perla', :'perla', false);
select set_config('test.tenant', :'tenant', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('marketing', current_setting('test.cizi') || '/' || current_setting('test.perla') || '/podvrh.jpg');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: majitel nahrál fotku do cizí firmy'; end if;
  raise notice '  OK    do cizí firmy se nahrát nedá';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('marketing', 'tohle-neni-uuid/x/podvrh.jpg');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prošla cesta, ke které nikdo nepatří'; end if;
  raise notice '  OK    cesta, ke které nikdo nepatří, neprojde';
end $$;


\echo ''
\echo '== Kdo nesmí ==============================================='

-- Číšník marketing nemá. Nesmí nahrát ani vidět — a to druhé je
-- důležitější: nahrání by si někdo všiml, tiché čtení ne.

select set_config('test.user_id', :'cisnik', false);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('marketing', current_setting('test.tenant') || '/' || current_setting('test.perla') || '/cisnik.jpg');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník bez marketing.manage nahrál fotku'; end if;
  raise notice '  OK    kdo nemá marketing.manage, nenahraje';
end $$;

select pg_temp.check('a fotky ani nevidí',
  (select count(*) from storage.objects where bucket_id = 'marketing') = 0);


\echo ''
\echo '== ČTENÍ NENÍ ZÁPIS ========================================'

/*
  Tohle je jediné místo, kde se pozná, jestli politika zápisu žádá
  `marketing.manage`, nebo jestli jí stačí `marketing.read`.

  Číšník a cizí firma na to nestačí: ti neprojdou ani jedním právem,
  takže by kontroly procházely, i kdyby politika zápisu žádala jen
  čtení. Ověřeno rozbíjením — záměna práva v politice zápisu
  neshodila nic, dokud tenhle oddíl neexistoval.
*/

select set_config('test.user_id', :'ctenar', false);

select pg_temp.check('čtenář fotky vidí',
  (select count(*) from storage.objects where bucket_id = 'marketing') = 2);

do $$
declare v_ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name)
    values ('marketing', current_setting('test.tenant') || '/' || current_setting('test.perla') || '/ctenar.jpg');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: kdo smí jen číst, nahrál fotku'; end if;
  raise notice '  OK    kdo smí jen číst, nenahraje';
end $$;

/*
  A hlavně: nesmaže. Mazání pod RLS nekřičí, jen nic nesmaže — proto
  se počítají řádky před a po. Tichý průchod by jinak vypadal jako
  úspěch (past ze skillu `scenar`).
*/
delete from storage.objects where bucket_id = 'marketing';

reset role;
select pg_temp.check('a nesmaže ani to, na co vidí',
  (select count(*) from storage.objects where bucket_id = 'marketing') = 2);

set role authenticated;


\echo ''
\echo '== PŘEJMENOVÁNÍ DO CIZÍ FIRMY =============================='

/*
  Nejtišší cesta ven.

  Cesta je jen sloupec `name` a přesun souboru je obyčejný `update`.
  Kdyby politika hlídala jen `using` (na co smím sáhnout) a ne
  `with check` (jak to smí vypadat potom), vzal by si kdokoli vlastní
  soubor a přesunul ho do cizí firmy — nebo, což je horší, přetáhl
  by si cizí soubor k sobě tím, že by ho přejmenoval.

  DRŽÍ TO DVOJITÁ POJISTKA A JE TŘEBA TO ŘÍCT NAHLAS. Vyndání
  `with check` z politiky úpravy tuhle kontrolu NESHODÍ, protože
  přejmenování zastaví i politika čtení: PostgreSQL u `update` žádá,
  aby výsledný řádek zůstal viditelný, a do cizí firmy přesunutý
  soubor viditelný není. Ověřeno rozbíjením — teprve když se uvolní
  OBĚ politiky najednou, přejmenování projde.

  Rozdělit se to nedá: aby `with check` padlo samo, musel by existovat
  člověk, který na CÍLOVOU cestu vidí, ale nesmí na ni psát. Čtení
  i zápis se ale škálují stejným rozsahem členství, takže takový
  člověk v tomhle modelu nevznikne. Není to mezera v testu, je to
  vlastnost modelu oprávnění.

  Nechávám obě. Kontrola tedy měří „nejde to", ne „drží to tahle
  jedna politika" — a je to tady napsané, aby si to nikdo nemyslel.
*/

select set_config('test.user_id', :'majitel', false);

/*
  ODMÍTNUTÍ SEM CHODÍ VÝJIMKOU, NE TICHEM.

  Je to rozdíl, na kterém jsem se sekl a scénář kvůli tomu spadl na
  kódu, na kterém nic nebylo. `using` řádek jen SCHOVÁ — update pak
  nic nezmění a nikdo nekřičí. `with check` se ale ptá na výsledný
  řádek a při nesouhlasu VYHODÍ CHYBU. Napsal jsem to nejdřív jako
  tichý průchod.

  Kontroluje se proto obojí: že to křiklo, i že soubor zůstal, kde
  byl. Samotná výjimka nestačí — mohla by přijít odjinud.
*/
do $$
declare v_ok boolean := false;
begin
  begin
    update storage.objects
       set name = current_setting('test.cizi') || '/' || current_setting('test.perla') || '/ukradeno.jpg'
     where name = current_setting('test.tenant') || '/' || current_setting('test.perla') || '/vlastni.jpg';
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přejmenování do cizí firmy prošlo bez námitek'; end if;
  raise notice '  OK    přejmenování do cizí firmy skončí odmítnutím';
end $$;

select pg_temp.check('a soubor zůstal, kde byl',
  exists (select 1 from storage.objects
           where name = :'tenant' || '/' || :'perla' || '/vlastni.jpg'));

select pg_temp.check('a v cizí firmě nic nevzniklo',
  not exists (select 1 from storage.objects where name like :'cizi' || '/%'));


\echo ''
\echo '== Mazání =================================================='

reset role;
insert into storage.objects (bucket_id, name)
values ('marketing', :'cizi' || '/' || :'perla' || '/cizi-fotka.jpg');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

delete from storage.objects where name = :'cizi' || '/' || :'perla' || '/cizi-fotka.jpg';

/*
  Mazání pod RLS nekřičí, jen nic nesmaže. Proto se kontroluje, že
  řádek pořád je — tichý průchod by jinak vypadal jako úspěch.

  I tuhle drží dvě pojistky: cizí soubor `delete` nenajde už proto, že
  ho nepustí politika čtení. Že se ptá i politika mazání, se pozná
  o oddíl výš, u čtenáře — ten cizí soubory vidí, a přesto je nesmaže.
*/
reset role;
select pg_temp.check('cizí fotku nikdo nesmaže',
  exists (select 1 from storage.objects where name = :'cizi' || '/' || :'perla' || '/cizi-fotka.jpg'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);
delete from storage.objects where name = :'tenant' || '/firma/logo.png';

reset role;
select pg_temp.check('vlastní fotku ale smaže',
  not exists (select 1 from storage.objects where name = :'tenant' || '/firma/logo.png'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from storage.objects where bucket_id = 'marketing';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from storage.objects where bucket_id = 'marketing') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 8 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
