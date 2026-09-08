-- Scénář pro krok 24 — doručení zpráv až po píchnutí na směnu.
--
-- Pokrývá migraci 20260906010000_doruceni_po_pichnuti a zadání
-- docs/nocni-prace-komunikace-2026-09-05.md, krok A a oddíl 5.
--
-- Navazuje na etapa0_scenar.sql až krok23_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Nejdůležitější je oddíl 5: CIZÍ ROZHOVOR NEPŘEČTE NIKDO, ani majitel
-- firmy, ani přímým dotazem na tabulku. Je to po mzdách nejcitlivější
-- místo v aplikaci — jsou tam stížnosti, zdraví a řeči o penězích.
-- Kladná kontrola („účastník si to přečte") tady nedokazuje nic:
-- projde i nad databází, kde čte úplně každý. Teprve ta záporná říká,
-- že tam něco hlídá.
--
-- Proto se v tomhle souboru čte **pod rolí `authenticated`**, ne jako
-- superuživatel. Superuživateli granty ani politiky nic neříkají
-- a kontrola by hlásila zeleno nad rozbitou aplikací — přesně to se
-- 3. 9. stalo u `employees.color`.
--
-- Druhá věc, která se tu hlídá: pravidlo o doručení nesmí obsah
-- SCHOVAT. Kdo si sám otevře aplikaci mimo směnu, zprávy si přečte;
-- čeká jen oznámení. Kdyby se schoval obsah, napíše si člověk kolegovi
-- na WhatsApp a modul se obejde celý. Oddíl 2 zkouší obojí naráz.

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
--
-- Vlastní lidé, ne ti ze seedu: bude se jim schválně nechávat otevřený
-- příchod a ostatní scénáře s nimi počítají jinak. Účty se zakládají
-- přes auth.users, protože profil z nich vyrábí spoušť
-- app.handle_new_user — ručně vložený profil by se s ní rozešel.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

/*
  Účty se načítají TEĎ, pod superuživatelem.

  Číst je až pod rolí „authenticated" nejde: politika na „profiles"
  vrátí cizí řádek prázdný, do „test.user_id" se uloží NULL a scénář
  pak tiše zkouší nepřihlášeného člověka — kontrola spadne na něčem
  úplně jiném, než co měří.
*/
select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaa0000-0000-0000-0000-00000000000a', 'anna@foodtab.cz',    '{"full_name":"Anna Nováková"}'),
  ('bbbb0000-0000-0000-0000-00000000000b', 'borek@foodtab.cz',   '{"full_name":"Bořek Dvořák"}'),
  ('cccc0000-0000-0000-0000-00000000000c', 'cecilie@foodtab.cz', '{"full_name":"Cecílie Provozní"}');

select id as z_kuchyne  from public.positions where tenant_id = :'tenant' and key = 'kuchyne' \gset
select id as z_provozni from public.positions where tenant_id = :'tenant' and key = 'provozni' \gset

-- Práva visí od přepnutí na zaměstnanci, ne na roli u členství.
-- Příprava scény proto běží bez přihlášeného, jako migrace.
select set_config('test.user_id', '', false);

-- Anna vaří na Perle. Bořek je za barem v Bernardu. Cecílie je provozní
-- přes celou firmu — má people.manage, a právě proto na ní stojí
-- kontrola v oddíle 6.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type) values
  (:'tenant', :'perla', 'aaaa0000-0000-0000-0000-00000000000a', :'z_kuchyne',  'Anna Nováková', 'hpp'),
  (:'tenant', :'bar',   'bbbb0000-0000-0000-0000-00000000000b', :'z_kuchyne',  'Bořek Dvořák', 'hpp'),
  (:'tenant', :'perla', 'cccc0000-0000-0000-0000-00000000000c', :'z_provozni', 'Cecílie Provozní', 'hpp');

select id as anna    from public.employees where user_id = 'aaaa0000-0000-0000-0000-00000000000a' \gset
select id as borek   from public.employees where user_id = 'bbbb0000-0000-0000-0000-00000000000b' \gset
select id as cecilie from public.employees where user_id = 'cccc0000-0000-0000-0000-00000000000c' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', 'aaaa0000-0000-0000-0000-00000000000a', null, 'branch', 'active'),
  (:'tenant', 'bbbb0000-0000-0000-0000-00000000000b', null, 'branch', 'active'),
  (:'tenant', 'cccc0000-0000-0000-0000-00000000000c', null, 'tenant', 'active');

select id as clen_anna  from public.memberships where user_id = 'aaaa0000-0000-0000-0000-00000000000a' \gset
select id as clen_borek from public.memberships where user_id = 'bbbb0000-0000-0000-0000-00000000000b' \gset

-- Anna dělá na OBOU pobočkách — na tom stojí oddíl 8.
insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_anna',  :'perla'),
  (:'clen_anna',  :'bar'),
  (:'clen_borek', :'bar');

select set_config('test.tenant', :'tenant', false);
select set_config('test.anna', :'anna', false);
select set_config('test.perla', :'perla', false);
select set_config('test.bar', :'bar', false);


\echo ''
\echo '== 1. Pravidlo samo o sobě — bez tabulek ================='

/*
  `app.doruci_se` je immutable a rozhoduje jen ze svých argumentů.
  Dá se proto vyzkoušet přímo, bez zakládání docházky — a hlavně jde
  vyzkoušet ZÁPORNÁ větev, která je na celém pravidle to podstatné.
*/

select pg_temp.check('mimo směnu se nedoručí nic',
  app.doruci_se(null, null, false) = false);
select pg_temp.check('mimo směnu se naléhavá doručí',
  app.doruci_se(null, null, true) = true);
select pg_temp.check('na směně se nepobočková doručí',
  app.doruci_se(:'perla', null, false) = true);
select pg_temp.check('na směně se doručí zpráva té pobočky, kde píchl',
  app.doruci_se(:'perla', :'perla', false) = true);
select pg_temp.check('zpráva DRUHÉ pobočky se nedoručí',
  app.doruci_se(:'perla', :'bar', false) = false);


\echo ''
\echo '== 2. Mimo směnu se nedoručí, po píchnutí ano ============'

-- Rozhovor Anny s Bořkem. Zakládá ho Bořek, píše do něj Bořek — Anna je
-- příjemce a je to ona, komu se má (ne)doručovat.
select set_config('test.user_id', 'bbbb0000-0000-0000-0000-00000000000b', false);
set role authenticated;

select public.zalozit_rozhovor(
  :'tenant', 'osobni', null, 'Anna a Bořek', null, array[:'anna']::uuid[]) as osobni \gset
select public.poslat_zpravu(:'osobni', 'Zítra přines nože.') as zprava1 \gset

reset role;
select set_config('test.osobni', :'osobni', false);

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('mimo směnu zpráva ČEKÁ, nedoručuje se',
  (select ceka from public.ceka_na_me(:'tenant')) = 1);
select pg_temp.check('mimo směnu se nedoručilo nic',
  (select doruceno from public.ceka_na_me(:'tenant')) = 0);

/*
  A TEĎ TO PODSTATNÉ: pravidlo chrání před vyrušením, ne před informací.
  Obsah si Anna přečíst musí i mimo směnu, když si aplikaci sama otevře.
  Kdyby tahle kontrola spadla, znamenalo by to, že jsme místo pravidla
  o doručení postavili zámek — a ten se obejde WhatsAppem.
*/
select pg_temp.check('obsah si mimo směnu přečíst MŮŽE',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'osobni') = 1);

reset role;

-- Anna píchne příchod na Perle. Až tady jí to má chodit.
select udalost from app.pichnout(:'tenant', :'perla', :'anna', 'in') \gset

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('po píchnutí se doručí',
  (select doruceno from public.ceka_na_me(:'tenant')) = 1);
select pg_temp.check('po píchnutí už nic nečeká',
  (select ceka from public.ceka_na_me(:'tenant')) = 0);

-- Přečtení se posune a nepřečtené zmizí.
select public.oznacit_precteno(:'osobni') as precteno \gset
select pg_temp.check('po označení není nepřečtené nic',
  (select neprectenych from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'osobni') = 0);

reset role;


\echo ''
\echo '== 3. Naléhavá se doručí hned a je v auditu =============='

-- Šéf má communication.urgent (majitel má všechno z aktivních modulů).
select set_config('test.user_id', :'sef', false);
set role authenticated;

select public.zalozit_rozhovor(
  :'tenant', 'osobni', null, 'Zavřeno', null, array[:'anna']::uuid[]) as nalehavy \gset
select public.poslat_zpravu(:'nalehavy', 'Zítra máme zavřeno, nechoďte.', true) as zprava2 \gset

reset role;
select set_config('test.nalehavy', :'nalehavy', false);

select pg_temp.check('naléhavá je označená v datech, ne jen v textu',
  (select nalehava from public.konverzace_zpravy where id = :'zprava2') = true);

/*
  Jméno se bere z databáze, ne napevno.

  Napoprvé tu stálo 'Vladislav Skoumal' a kontrola spadla — majitel se
  v testovacích datech jmenuje „12345678". Není to chyba téhle
  kontroly: `etapa0_scenar.sql` ř. 31 volá
  `app.create_tenant('Foodtab s.r.o.', '12345678')`, jenže druhý
  parametr se 1. 9. změnil z `p_ico` na `p_full_name`
  (20260901160000_jmeno_ne_z_emailu.sql). Volání se neupravilo, takže
  se od té doby zakládá majitel se jménem IČO a firma bez IČO —
  a nikomu to nespadlo, protože `p_ico` má výchozí hodnotu.
  Do scénáře nesahám (není můj), je to nález do hlášení.
*/
select full_name as sefjmeno from public.employees
 where user_id = :'sef' and tenant_id = :'tenant' \gset

select pg_temp.check('naléhavá je v auditu se jménem odesílatele',
  exists (select 1 from public.audit_log
          where action = 'komunikace.nalehava_zprava'
            and after ->> 'odesilatel' = :'sefjmeno'));

/*
  A TEĎ TA DŮLEŽITĚJŠÍ POLOVINA: TEXT ZPRÁVY V AUDITU BÝT NESMÍ.

  Hledá se v CELÉM auditu, ne jen v mém řádku. Napoprvé tu bylo
  `where action = 'komunikace.nalehava_zprava'` — a prošlo to, zatímco
  o řádek vedle ležel tentýž text kompletní, protože ho tam zapsala
  obecná spoušť `app.audit_zmenu`. Kontrola, která se dívá jen na to,
  co jsem napsal sám, je k ničemu: díra bývá vedle.

  Proč na tom záleží: audit se čte se `settings.manage`, konverzace
  se čte účastnictvím. Majitel má settings.manage vždycky — takže
  dokud text v auditu ležel, byla celá záporná kontrola z oddílu 5
  jen představení. Opraveno v 20260906010000 vlastní spouští
  app.audit_zpravy.

  Schválně rozbito: po vrácení `app.audit_zmenu('konverzace_zprava')`
  tahle kontrola spadne. Ověřeno.
*/
select pg_temp.check('text zprávy se do auditu nedostane VŮBEC',
  not exists (select 1 from public.audit_log where after::text like '%nechoďte%'));
select pg_temp.check('ani přes obecnou spoušť u obyčejné zprávy',
  not exists (select 1 from public.audit_log where after::text like '%přines nože%'));
select pg_temp.check('že zpráva vznikla, ale v auditu zůstává',
  exists (select 1 from public.audit_log
          where entity_type = 'konverzace_zprava'
            and action = 'konverzace_zprava.insert'
            and after ->> 'nalehava' = 'true'));

-- Anna má odpíchnuto (v oddílu 2 zůstala na směně), takže naléhavou
-- zkoušíme na Bořkovi, který na směně NENÍ.
select set_config('test.user_id', 'bbbb0000-0000-0000-0000-00000000000b', false);
set role authenticated;

select pg_temp.check('Bořek na směně není',
  (select count(*) from public.attendance_events
   where employee_id = :'borek' and kind = 'in') = 0);

reset role;
set role authenticated;
select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
select pg_temp.check('naléhavá se doručí i tomu, kdo píchnutý není',
  app.doruci_se(null, null,
    (select nalehava from public.konverzace_zpravy where id = :'zprava2')) = true);
reset role;


\echo ''
\echo '== 4. Naléhavou nepošle, kdo na to nemá právo ============'

/*
  Anna má roli „kuchyne", ve které communication.urgent není. Kdyby
  tahle kontrola chyběla, stane se naléhavé výchozím — a když je
  naléhavé všechno, není naléhavé nic. Zkoušel jsem to i obráceně:
  když se podmínka na právo z funkce vyndá, tenhle blok spadne.
*/

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

do $$
declare v_ok boolean := false; v_text text;
begin
  begin
    perform public.poslat_zpravu(
      current_setting('test.osobni')::uuid, 'Vstávej!', true);
  exception when insufficient_privilege then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then raise exception 'SELHALO: naléhavou poslal, kdo na to nemá právo'; end if;
  raise notice '  OK    naléhavou bez práva neposlal (%)', v_text;
end $$;

select pg_temp.check('obyčejnou zprávu poslat smí',
  public.poslat_zpravu(:'osobni', 'Nesu je zítra.') is not null);

reset role;


\echo ''
\echo '== 5. Cizí rozhovor nepřečte nikdo — ani majitel ========='

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V CELÉM SOUBORU.

  Ne „nezobrazí se mu to" — nesmí se k tomu dostat ani přímým dotazem
  na tabulku, ani průzorem, ani majitel firmy. Účastnictví je
  autorizace: kdo je uvnitř, čte; kdo není, nečte, i kdyby měl všechna
  práva světa.

  SCHVÁLNĚ ROZBITO, A OBOJÍ SPADLO:
    * politika `konverzace_zpravy_select` přepsaná na `using (true)`
      → spadne první kontrola („majitel cizí zprávy nevidí přímým
        dotazem“),
    * `app.je_ucastnik` vyndaný z `poslat_zpravu`
      → spadne „majitel dopsal do cizí konverzace“,
    * `app.je_ucastnik` vyndaný z `oznacit_precteno`
      → spadne „majitel si označil cizí konverzaci za přečtenou“.
*/

-- Rozhovor Anny s Bořkem, do kterého majitel NEPATŘÍ.
select set_config('test.user_id', :'sef', false);
set role authenticated;

select pg_temp.check('majitel cizí zprávy nevidí přímým dotazem',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'osobni') = 0);
select pg_temp.check('majitel cizí konverzaci nevidí ani v seznamu',
  (select count(*) from public.konverzace where id = :'osobni') = 0);
select pg_temp.check('majitel cizí konverzaci nemá ani ve svých rozhovorech',
  (select count(*) from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'osobni') = 0);
select pg_temp.check('majitel není účastník',
  app.je_ucastnik(:'osobni') = false);
select pg_temp.check('majitel nezjistí ani čas přečtení',
  public.precetl_si(:'osobni', :'anna') is null);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.poslat_zpravu(current_setting('test.osobni')::uuid, 'Co si to píšete?');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: majitel dopsal do cizí konverzace'; end if;
  raise notice '  OK    majitel do cizí konverzace nedopíše';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.oznacit_precteno(current_setting('test.osobni')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: majitel si označil cizí konverzaci za přečtenou'; end if;
  raise notice '  OK    majitel cizí konverzaci za přečtenou neoznačí';
end $$;

reset role;


\echo ''
\echo '== 6. Vzkaz majiteli nevidí provozní s people.manage ====='

/*
  Stížnost na vedoucího, která přistane vedoucímu, je horší než žádná
  cesta: člověk si myslí, že si postěžoval, a jediné, čeho dosáhl, je
  že si na sebe řekl. Cecílie má people.manage a přesto to nesmí vidět.
*/

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'vedeni', null, 'Mám problém', 'majitel') as vedeni \gset
select public.poslat_zpravu(:'vedeni', 'Nesedí mi výplata.') as zprava3 \gset
reset role;

select set_config('test.vedeni', :'vedeni', false);

select pg_temp.check('majitel je mezi adresáty (odvozeno, ne předáno)',
  exists (select 1 from public.konverzace_ucastnici u
          join public.employees e on e.id = u.employee_id
          where u.konverzace_id = :'vedeni' and e.user_id = :'sef'));
select pg_temp.check('provozní mezi adresáty NENÍ',
  not exists (select 1 from public.konverzace_ucastnici
              where konverzace_id = :'vedeni' and employee_id = :'cecilie'));

select set_config('test.user_id', 'cccc0000-0000-0000-0000-00000000000c', false);
set role authenticated;

select pg_temp.check('provozní má people.manage',
  app.has_access(:'tenant', 'people.manage'));
select pg_temp.check('a přesto vzkaz pro majitele nevidí',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'vedeni') = 0);
select pg_temp.check('nevidí ani samotnou konverzaci',
  (select count(*) from public.konverzace where id = :'vedeni') = 0);

reset role;

select set_config('test.user_id', :'sef', false);
set role authenticated;
select pg_temp.check('majitel svůj vzkaz naopak vidí',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'vedeni') = 1);
reset role;


\echo ''
\echo '== 6b. Vzkaz vedení: pobočku vybírá odesílatel =========='

/*
  Rozhodnutí Šéfíka 6. 9. (odpověď 2). Do té doby se „vedoucí pobočky"
  odvozoval z DOMOVSKÉ pobočky odesílatele — a člověk, který dělá na
  dvou pobočkách, si stěžuje na to, co zažil TAM, KDE ZROVNA BYL.
  Vzkaz by přistál u vedoucího té druhé provozovny a odesílatel by se
  to nedozvěděl. To je horší než žádná cesta.

  Anna dosáhne na Perlu i na Bernard (oddíl PŘÍPRAVA), takže se jí
  aplikace musí zeptat.
*/

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('Anna dosáhne na dvě pobočky',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 2);

do $$
declare v_ok boolean := false; v_text text;
begin
  begin
    perform public.zalozit_rozhovor(
      current_setting('test.tenant')::uuid, 'vedeni', null, 'Bez pobočky', 'vedouci');
  exception when check_violation then
    v_ok := true; get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then
    raise exception 'SELHALO: vzkaz vedoucímu prošel bez výběru pobočky';
  end if;
  if v_text not like '%Vyberte pobočku%' then
    raise exception 'SELHALO: hláška neříká, co má člověk udělat: %', v_text;
  end if;
  raise notice '  OK    bez výběru pobočky to aplikace odmítne větou (%)', v_text;
end $$;

-- S vybranou pobočkou to projde a adresáti sedí na TU pobočku.
select public.zalozit_rozhovor(:'tenant', 'vedeni', :'bar', 'Na Bernardu', 'vedouci')
  as vzkaz_bar \gset

select pg_temp.check('s vybranou pobočkou vzkaz vznikne', :'vzkaz_bar' is not null);

/*
  A OBRAZOVKA SE PTÁ TÉŽE FUNKCE, jakou se vybírají účastníci. Kdyby
  měla vlastní dotaz, slíbila by jeden okruh a konverzace by vznikla
  s jiným — a u vzkazu vedení je to ten nejcitlivější rozdíl, jaký
  může nastat.
*/
select pg_temp.check('kdo_uvidi_vzkaz vrací totéž, co je v účastnících',
  (select array_agg(employee_id order by employee_id)
   from public.kdo_uvidi_vzkaz(:'tenant', 'vedouci', :'bar'))
  = (select array_agg(employee_id order by employee_id)
     from public.konverzace_ucastnici
     where konverzace_id = :'vzkaz_bar' and employee_id <> :'anna'));

select pg_temp.check('a vrací JMÉNA, ne jen id',
  (select count(*) from public.kdo_uvidi_vzkaz(:'tenant', 'vedouci', :'bar')
   where btrim(coalesce(jmeno, '')) <> '') > 0);

/*
  MAJITEL SE MEZI „VEDOUCÍ POBOČKY" NEPLETE. Kdo si vybral vedoucího,
  vybral si vedoucího — kdyby to zároveň četl majitel, je volba
  adresáta k ničemu a stížnost na vedoucího nemá kam jít.

  POZOR, JAK SE TAHLE KONTROLA MĚŘÍ. Napoprvé tu stálo jen to spodní
  `not exists` a schválné rozbití (vyndání `and not r.is_owner`
  z `app.adresati_vzkazu`) ji NESHODILO. Prošla totiž z jiného důvodu,
  než na který mířila: majitelská role nemá `people.manage` jako řádek
  v `role_permissions` — majitel dostává práva zkratkou `r.is_owner`
  v `app.has_access`. Podmínka, kterou jsem chtěl ověřit, se tedy nikdy
  nedostala ke slovu.

  Role jsou ale DATA firmy a jdou upravovat. Až někdo majitelské roli
  to právo připíše, začne na tom záležet. Proto se tady to právo
  schválně připíše, změří se s ním a zase se odebere.
*/
select pg_temp.check('u volby „vedoucí" mezi adresáty majitel není',
  not exists (
    select 1 from public.kdo_uvidi_vzkaz(:'tenant', 'vedouci', :'bar') k
    join public.employees e on e.id = k.employee_id
    where e.user_id = :'sef'));

reset role;
select set_config('test.user_id', '', false);
update public.employees set position_id = :'z_provozni'
 where tenant_id = :'tenant' and user_id = :'sef';

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;
select pg_temp.check('ani když majitel to právo dostane ze zařazení',
  not exists (
    select 1 from public.kdo_uvidi_vzkaz(:'tenant', 'vedouci', :'bar') k
    join public.employees e on e.id = k.employee_id
    where e.user_id = :'sef'));
reset role;

select set_config('test.user_id', '', false);
update public.employees set position_id = null
 where tenant_id = :'tenant' and user_id = :'sef';

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

/*
  Pobočka, na kterou člověk nedosáhne, neprojde ani tady (pravidlo 4).

  Ta zkušební pobočka se na konci zase MAŽE. Napoprvé jsem ji tu nechal
  a spadl na tom krok25, který počítá, na kolik poboček majitel dosáhne
  — z dvou byly tři. Data, která scénář založí a neuklidí, nejsou jeho
  vlastní věc: běží nad touž databází jako všechno za ním.
*/
reset role;
insert into public.branches (tenant_id, name, slug)
values (:'tenant', 'Cizí provozovna', 'cizi-provozovna')
returning id as cizi_pob \gset
select set_config('test.cizi_pob', :'cizi_pob', false);

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zalozit_rozhovor(
      current_setting('test.tenant')::uuid, 'vedeni',
      current_setting('test.cizi_pob')::uuid, 'Podvrh', 'vedouci');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: prošla pobočka, na kterou nedosáhne'; end if;
  raise notice '  OK    pobočka, na kterou nedosáhne, neprojde';
end $$;

/*
  Uklízí se OZNAČENÍM, ne výmazem.

  `delete from public.branches` tady spadlo na cizím klíči z
  `audit_log.branch_id` — a je to tak správně: audit se mazat nemá.
  `deleted_at` je navíc to, co s pobočkou dělá i aplikace, takže se
  scénář chová jako provoz. `app.visible_branch_ids` smazané pobočky
  nevrací, takže krok25 zase napočítá dvě.
*/
reset role;
update public.branches set deleted_at = now(), active = false
 where id = :'cizi_pob';

select set_config('test.user_id', :'sef', false);
set role authenticated;
select pg_temp.check('zkušební pobočka po sobě uklidila',
  (select count(*) from app.visible_branch_ids(:'tenant')) = 2);
reset role;


\echo ''
\echo '== 7. Mezi pobočkami: účastník čte, kdo v ní není, ne ===='

/*
  Jediné místo, kde se hranice poboček schválně překračuje — a proto
  jediné, kde je hranicí opravdu jen účastnictví. Cecílie tady zastupuje
  „kdo v konverzaci není": je provozní přes celou firmu, takže na obě
  pobočky vidí, a přesto nesmí číst.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.zalozit_rozhovor(
  :'tenant', 'mezi_pobockami', null, 'Výměna sifonů', null,
  array[:'anna', :'borek']::uuid[]) as mezi \gset
select public.poslat_zpravu(:'mezi', 'Půjčíme vám sifon.') as zprava4 \gset
reset role;

select set_config('test.mezi', :'mezi', false);

select set_config('test.user_id', 'bbbb0000-0000-0000-0000-00000000000b', false);
set role authenticated;
select pg_temp.check('účastník z druhé pobočky čte',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'mezi') = 1);
reset role;

select set_config('test.user_id', 'cccc0000-0000-0000-0000-00000000000c', false);
set role authenticated;
select pg_temp.check('kdo v ní není, nečte — ani s dosahem na obě pobočky',
  (select count(*) from public.konverzace_zpravy where konverzace_id = :'mezi') = 0);
reset role;

/*
  Účastník z JINÉ FIRMY konverzaci nezaloží.

  Napoprvé tu bylo `gen_random_uuid()` — a to nic nedokazovalo: takové
  id zastaví cizí klíč na `konverzace_ucastnici`, ne moje kontrola.
  Poznalo se to při schválném rozbití: po vyndání kontroly z
  `zalozit_rozhovor` blok pořád padal, jen na cizím klíči.

  Bere se proto SKUTEČNÝ zaměstnanec jiné firmy (zakládá ho
  krok11_scenar.sql). Ten cizímu klíči vyhoví — zastavit ho může jen
  pravidlo 4, tedy ověření rozsahu proti členství. Po vyndání té
  kontroly se teď cizí člověk do konverzace opravdu dostane a blok
  spadne správně.
*/
select id as cizi_emp from public.employees
 where tenant_id <> :'tenant' order by created_at limit 1 \gset
select set_config('test.cizi_emp', :'cizi_emp', false);

select set_config('test.user_id', :'sef', false);
set role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zalozit_rozhovor(
      current_setting('test.tenant')::uuid, 'mezi_pobockami', null, 'Podvrh', null,
      array[current_setting('test.cizi_emp')::uuid]);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: člověk z jiné firmy se dostal do konverzace'; end if;
  raise notice '  OK    člověk z jiné firmy se do konverzace nedostane';
end $$;
reset role;


\echo ''
\echo '== 8. Kdo má víc poboček, dostane zprávy té, kde píchl ==='

/*
  Anna má dosah na Perlu i na Bernard a v oddílu 2 píchla na PERLE.
  Zpráva do bernardského kanálu jí proto čekat MUSÍ — jinak by pravidlo
  „dostane zprávy té pobočky, kde píchl" neznamenalo nic.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'pobocka', :'bar', 'Bernard', null,
  array[:'anna']::uuid[]) as kanal_bar \gset
select public.poslat_zpravu(:'kanal_bar', 'V Bernardu došla plzeň.') as zprava5 \gset

select public.zalozit_rozhovor(:'tenant', 'pobocka', :'perla', 'Perla', null,
  array[:'anna']::uuid[]) as kanal_perla \gset
select public.poslat_zpravu(:'kanal_perla', 'Na Perle přijede kontrola.') as zprava6 \gset
reset role;

/*
  `app.otevreny_prichod` ani `app.smena_ted` nemá `authenticated`
  udělené schválně — jsou to vnitřní funkce a volají se zevnitř
  security definer průzorů. Proto se sem kouká jako superuživatel,
  ne pod rolí; napoprvé to tady spadlo na `permission denied for
  function otevreny_prichod`, což je správné chování, ne chyba.
*/
select pg_temp.check('Anna má otevřený příchod na Perle',
  (select branch_id from app.otevreny_prichod(:'tenant', :'anna')) = :'perla');

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('vnitřní funkci o směně zvenčí nikdo nezavolá',
  not has_function_privilege('authenticated', 'app.smena_ted(uuid, uuid)', 'execute'));
select pg_temp.check('zpráva z Perly se doručila',
  (select ceka from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal_perla') = 0);
select pg_temp.check('zpráva z Bernardu ČEKÁ, i když tam Anna dělá taky',
  (select ceka from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal_bar') = 1);

reset role;


\echo ''
\echo '== 8b. Zapomenutý odchod směnu neprodlouží =============='

/*
  Rozhodnutí Šéfíka 6. 9. (odpověď 1). Zprávy chodí jen dokud trvá
  provozní den, ve kterém se píchl příchod.

  Bez toho by zapomenutý odchod obcházel celé pravidlo: kdo v úterý
  zapomněl odejít, měl by otevřený příchod dál a aplikace by mu zvonila
  ve středu ve tři ráno — zrovna tomu člověku, který si toho nevšiml,
  takže by o tom ani nevěděl.

  Anniny záznamy se posunou o dva provozní dny zpátky. Příchod tím
  ZŮSTÁVÁ OTEVŘENÝ (`uzavreno_systemem` se nesahá), jen už není
  z dnešního dne — což je přesně stav „zapomněl jsem odejít".
*/

reset role;

update public.attendance_events
   set occurred_at   = occurred_at - interval '2 days',
       business_date = business_date - 2
 where employee_id = :'anna' and kind = 'in' and stornovano_kdy is null;

select pg_temp.check('příchod zůstal otevřený, jen je ze staršího dne',
  (select business_date from app.otevreny_prichod(:'tenant', :'anna'))
    < app.business_date(:'perla', now()));

select pg_temp.check('a přesto už se nebere jako směna',
  app.smena_ted(:'tenant', :'anna') is null);

select set_config('test.user_id', 'aaaa0000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('zpráva z Perly proto zase ČEKÁ',
  (select ceka from public.moje_rozhovory(:'tenant')
   where konverzace_id = :'kanal_perla') > 0);

reset role;

/*
  A DRUHÁ POLOVINA, na kterou se dá snadno zapomenout: nedokončený
  záznam se tím NEUKLIDIL. Kdyby ho aplikace odklidila, vedoucí by se
  nedozvěděl, že tam byl — a to je nejtišší možná chyba.
*/
select pg_temp.check('nedokončený záznam zůstává v panelu nedokončených',
  exists (select 1 from public.nedokoncena_dochazka(
            :'tenant', current_date - 5, current_date, null)
          where employee_id = :'anna'));

-- Vrátit zpátky, ať oddíly níž počítají s tím, s čím počítaly.
update public.attendance_events
   set occurred_at   = occurred_at + interval '2 days',
       business_date = business_date + 2
 where employee_id = :'anna' and kind = 'in' and stornovano_kdy is null;

select pg_temp.check('po vrácení do dnešního dne je zase na směně',
  app.smena_ted(:'tenant', :'anna') = :'perla');


\echo ''
\echo '== 9. Vypnutý modul odmítne i přímé volání ==============='

/*
  Pravidlo 5. Schovaná položka v nabídce není zámek; odmítnout musí
  databáze.

  CO TAHLE KONTROLA NEUMÍ — stejná mez jako v krok22_scenar.sql, oddíl 7.
  Konverzace visí na modulu `provoz` a ten se vypnout NEDÁ: spoušť
  z 20260824190000 hlídá `status` i `valid_until` („Základní modul
  provoz musí zůstat aktivní“). Zkusil jsem obojí; obojí spadlo na té
  spoušti, ne na mé funkci. Vypnutý stav pro tenhle modul nemůže
  nastat, takže se pravidlo 5 nedá odzkoušet přímo.

  Zkouší se proto druhá polovina téže podmínky, která nastat MŮŽE:
  `app.modul_zapnuty` je zároveň kontrola členství, a nečlen jí
  neprojde.

  A POCTIVĚ: schválné vyndání `modul_zapnuty` z `moje_rozhovory`
  shodilo jen tu strukturální kontrolu dole, ne ty dvě nad ní. Nečlen
  totiž nemá ani zaměstnanecký záznam, takže ho zastaví
  `app.muj_employee` dřív, než se na modul vůbec dojde. Ty dvě
  kontroly tedy měří obranu, ale ne tuhle — proto ta strukturální
  zůstává, i když je slabší. Je to jediná z nich, která na vyndání
  podmínky spadne.
*/

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('nečlen modul zapnutý nemá',
  not app.modul_zapnuty(:'tenant', 'provoz'));
select pg_temp.check('a proto mu seznam rozhovorů nevrátí nic',
  (select count(*) from public.moje_rozhovory(:'tenant')) = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zalozit_rozhovor(
      current_setting('test.tenant')::uuid, 'osobni', null, 'Obchvat', null, '{}'::uuid[]);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nečlen založil konverzaci v cizí firmě'; end if;
  raise notice '  OK    nečlen konverzaci v cizí firmě nezaloží';
end $$;

reset role;

-- A že se o tu podmínku obě nové funkce opravdu opírají. Je to slabší
-- kontrola než zkouška chování, ale umí spadnout — a pokrývá to, co
-- se vypnutím modulu vyzkoušet nedá.
select pg_temp.check('moje_rozhovory se ptá na zapnutý modul',
  pg_get_functiondef('public.moje_rozhovory(uuid)'::regprocedure) like '%modul_zapnuty%');
select pg_temp.check('zalozit_rozhovor se ptá na zapnutý modul',
  pg_get_functiondef('public.zalozit_rozhovor(uuid,text,uuid,text,text,uuid[])'::regprocedure)
    like '%modul_zapnuty%');
select pg_temp.check('poslat_zpravu se ptá na zapnutý modul',
  pg_get_functiondef('public.poslat_zpravu(uuid,text,boolean)'::regprocedure)
    like '%modul_zapnuty%');


\echo ''
\echo '== 10. Cizí firma ======================================='

-- Pod rolí, ne jako superuživatel: granty ani politiky superuživateli
-- nic neříkají a kontrola by hlásila zeleno nad rozbitou aplikací.
select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma nevidí žádnou konverzaci',
  (select count(*) from public.konverzace) = 0);
select pg_temp.check('cizí firma nevidí žádnou zprávu',
  (select count(*) from public.konverzace_zpravy) = 0);
select pg_temp.check('cizí firmě nevrátí seznam nic',
  (select count(*) from public.moje_rozhovory(:'tenant')) = 0);

reset role;


\echo ''
\echo '== KROK 24 HOTOV ========================================'
