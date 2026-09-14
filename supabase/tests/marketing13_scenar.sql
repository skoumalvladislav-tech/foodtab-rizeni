-- Scénář marketing 13 — upozornění.
--
-- Pokrývá 20260914160000_marketing_upozorneni.sql.
-- Zadání: master prompt, oddíl 14.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- 1. Že žádost o schválení dojde těm, kdo smějí rozhodnout — a NIKOMU
--    jinému. Zvlášť ne tomu, kdo o ni požádal.
--
-- 2. Že rozhodnutí dojde tomu, kdo o schválení požádal, a že se pozná
--    schválení od vrácení.
--
-- 3. Že se u publikace hlásí až VZDÁNÍ, ne každý neúspěšný pokus.
--    Fronta má pět pokusů; zpráva u každého by znamenala pět zpráv
--    o jednom příspěvku, který nakonec vyjde.
--
-- 4. Že upozornění vidí jen ten, komu patří. Cizí upozornění by
--    prozradilo, kdo co v marketingu dělá.
--
-- ---------------------------------------------------------------------
-- MĚŘÍ SE POČTY, NE „NESPADLO TO"
--
-- Spouště nic nevracejí a chyba v nich se pozná jedině tím, že zpráva
-- nepřijde — nebo přijde komu nemá. Každá kontrola proto počítá řádky
-- v `notifications`, ne jestli `insert` prošel.

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

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz'  \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select id as e_majitel  from public.employees where user_id = :'majitel'  and tenant_id = :'tenant' and deleted_at is null \gset
select id as e_provozni from public.employees where user_id = :'provozni' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

/*
  ČTENÁŘ MARKETINGU, KTERÝ NESMÍ PUBLIKOVAT.

  Napsal jsem tu kontrolu nejdřív s číšníkem — a procházela z jiného
  důvodu, než říkal její název: číšníkovo členství nemá v
  `membership_branches` ani jednu pobočku, takže by zprávu nedostal
  ani tehdy, kdyby se rozesílala všem. Sabotáž (`marketing.publish`
  vyměněné za `marketing.read`) to nechala projít.

  Danuše pobočku má. Dostane `marketing.read`, ne `publish` — takže
  když se okruh spočítá špatně, zpráva jí přijde a kontrola spadne.
*/
select user_id as danuse from public.profiles where email = 'danuse@foodtab.cz' \gset
select id as e_danuse from public.employees
 where user_id = :'danuse' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_danuse', 'marketing.read', true)
on conflict (employee_id, permission_key) do update set granted = excluded.granted;

-- Čistý stůl: scénář počítá přírůstky, ne absolutní čísla.
delete from public.notifications where tenant_id = :'tenant' and druh like 'marketing.%';

insert into public.marketing_prispevky (tenant_id, branch_id, nazev, vytvoril)
values (:'tenant', :'perla', 'Pozvánka na zabijačku', :'e_provozni')
returning id as prispevek \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek', 1, 'otisk-U', :'e_provozni')
returning id as verze \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Žádost dojde těm, kdo smějí rozhodnout ================'

insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze', 'otisk-U', :'e_provozni')
returning id as zadost \gset

select pg_temp.check('žádost vyrobila upozornění',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost') > 0);

/*
  ŽADATEL SÁM SOBĚ NE. Zní to samozřejmě, ale je to nejčastější chyba
  v upozorněních vůbec — a lidé si pak odvyknou je číst.
*/
select pg_temp.check('ale NE tomu, kdo o ni požádal',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost'
      and user_id = :'provozni') = 0);

select pg_temp.check('a došla majiteli, který smí publikovat',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost'
      and user_id = :'majitel') = 1);

/*
  KOMU BY DOJÍT NEMĚLA. Danuše marketing VIDÍ, ale publikovat nesmí —
  kdyby jí zpráva přišla, znamenalo by to, že se okruh nebere
  z `app.kdo_ma_pravo_na_pobocce` s právem `marketing.publish`.
*/
select pg_temp.check('a NEdošla tomu, kdo marketing vidí, ale publikovat nesmí',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost'
      and user_id = :'danuse') = 0);

select pg_temp.check('(a ta Danuše marketing OPRAVDU vidí — jinak by kontrola výš neznamenala nic)',
  (select count(*) from public.employee_permissions
    where employee_id = :'e_danuse' and permission_key = 'marketing.read' and granted) = 1);

select pg_temp.check('v těle je název příspěvku',
  (select telo ->> 'nazev' from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost'
    order by created_at desc limit 1) = 'Pozvánka na zabijačku');

select pg_temp.check('a odkaz na příspěvek, ať se dá otevřít',
  (select telo ->> 'prispevek' from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.zadost'
    order by created_at desc limit 1) = :'prispevek');


\echo ''
\echo '== 2. Schválení dojde žadateli =============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost';
reset role;

select pg_temp.check('žadatel dostal zprávu o rozhodnutí',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto'
      and user_id = :'provozni') = 1);

select pg_temp.check('a je v ní, že je schváleno',
  (select (telo ->> 'schvaleno')::boolean from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto'
      and user_id = :'provozni') = true);

/*
  A TEN, KDO ROZHODL, ŽÁDNOU ZPRÁVU NEDOSTANE. Zpráva „schválil jste
  příspěvek" nikomu nic neřekne — ví to, právě to udělal.
*/
select pg_temp.check('rozhodující zprávu nedostal',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto'
      and user_id = :'majitel') = 0);

/*
  A TEĎ TEN PŘÍPAD, KVŮLI KTERÉMU TA POJISTKA VŮBEC JE.

  Kontrola výš procházela i bez ní — majitel a provozní jsou dva různí
  lidé, takže zpráva mířila jinam tak jako tak. Sabotáž (vyndaná
  podmínka `new.rozhodl = new.zadal`) ji nechala projít.

  Pojistka platí na jediný případ: když ve firmě nikdo druhý s právem
  publikovat není, `app.marketing_strez_rozhodnuti` dovolí rozhodnout
  o VLASTNÍ žádosti. Tehdy by přišla zpráva „schválil jste si vlastní
  příspěvek", což nikomu nic neřekne.

  ---------------------------------------------------------------------
  A PROČ SE KVŮLI TOMU VYPÍNÁ SPOUŠŤ ČTYŘ OČÍ

  Ten stav se normálním `update` vyrobit NEDÁ, a to je dobře: dokud je
  ve firmě druhý schvalovatel, `app.marketing_strez_rozhodnuti` vlastní
  žádost odmítne. Napsal jsem to nejdřív tak, že jsem `rozhodl` dosadil
  ručně pod `reset role` — a nezabralo to: ta spoušť si `rozhodl`
  přepisuje sama podle `auth.uid()`, které harness čte z
  `test.user_id`. Dosazená hodnota se tiše zahodila a kontrola spadla
  na tom, že zpráva PŘIŠLA.

  Vypíná se proto na jeden příkaz, a JEN ta jedna spoušť. Ověřuje se
  tím chování spouště od upozornění, ne to, že by pravidlo čtyř očí
  šlo obejít — o tom je marketing3. Hned za tím se zapíná zpátky
  a kontrola níž ověřuje, že je zase činná.
*/
insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze', 'otisk-U', :'e_provozni')
returning id as zadost_sam \gset

select count(*) as pred_sam from public.notifications
 where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto' \gset

reset role;
alter table public.marketing_schvaleni disable trigger trg_marketing_strez_rozhodnuti;

update public.marketing_schvaleni
   set stav = 'schvaleno', rozhodl = :'e_provozni', rozhodnuto_kdy = now()
 where id = :'zadost_sam';

alter table public.marketing_schvaleni enable trigger trg_marketing_strez_rozhodnuti;

select pg_temp.check('kdo rozhodl o SVÉ VLASTNÍ žádosti, zprávu nedostane',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto') = :'pred_sam');

/*
  A ŽE JE PRAVIDLO ČTYŘ OČÍ ZASE ČINNÉ. Vypnutá spoušť, kterou by někdo
  zapomněl zapnout, by z tohohle scénáře udělala díru v modulu — a to
  je horší než chybějící kontrola.
*/
select pg_temp.check('pravidlo čtyř očí je zpátky zapnuté',
  (select tgenabled from pg_trigger
    where tgname = 'trg_marketing_strez_rozhodnuti'
      and tgrelid = 'public.marketing_schvaleni'::regclass) = 'O');


\echo ''
\echo '== 3. U publikace se hlásí až vzdání ======================='

insert into public.marketing_publikace_ulohy
  (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
   kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic, vytvoril)
values (:'tenant', :'prispevek', :'verze', 'otisk-U', :'zadost',
        'instagram', 'prispevek', 'mock', 'demo', now(), 'upozorneni-1', :'e_provozni')
returning id as uloha \gset

/*
  PRVNÍ NEÚSPĚCH JEŠTĚ NIC NEHLÁSÍ. `selhalo` znamená „zkusí se to
  znovu" — fronta má pět pokusů. Zpráva u každého by znamenala pět
  zpráv o jednom příspěvku, který nakonec vyjde.
*/
update public.marketing_publikace_ulohy
   set stav = 'selhalo', pokusy = 1, posledni_chyba = 'Dočasná chyba sítě.'
 where id = :'uloha';

select pg_temp.check('po prvním neúspěchu se nehlásí nic',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala') = 0);

update public.marketing_publikace_ulohy
   set stav = 'selhalo', pokusy = 4, posledni_chyba = 'Pořád to nejde.'
 where id = :'uloha';

select pg_temp.check('ani po čtvrtém',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala') = 0);

update public.marketing_publikace_ulohy
   set stav = 'vzdano', pokusy = 5, posledni_chyba = 'The access token has expired.'
 where id = :'uloha';

select pg_temp.check('teprve vzdání pošle zprávu',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala'
      and user_id = :'provozni') = 1);

select pg_temp.check('a nese původní hlášku od poskytovatele',
  (select telo ->> 'duvod' from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala'
    order by created_at desc limit 1) = 'The access token has expired.');

select pg_temp.check('i síť, na kterou to nešlo',
  (select telo ->> 'kanal' from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala'
    order by created_at desc limit 1) = 'instagram');

/*
  A ŽE SE NEHLÁSÍ DVAKRÁT. `update` nad už vzdanou úlohou (třeba
  doplnění odpovědi) nesmí poslat zprávu znovu.
*/
update public.marketing_publikace_ulohy
   set posledni_chyba = 'The access token has expired. (detail)'
 where id = :'uloha';

select pg_temp.check('a opakovaný zápis zprávu nepošle podruhé',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.publikace_selhala') = 1);


\echo ''
-- POŘADÍ NENÍ NÁHODNÉ: VRÁCENÍ JE AŽ ZA PUBLIKACÍ.
--
-- Zamítnutí shodí `schvalena_verze_id` na příspěvku (spoušť
-- `app.marketing_zapis_rozhodnuti`) a publikační úloha pak nevznikne —
-- `app.marketing_strez_publikaci` ji odmítne větou „Příspěvek už na
-- tuhle verzi jako na schválenou neukazuje."
--
-- Napsal jsem to nejdřív obráceně a scénář na to spadl. NEBYLA TO
-- chyba modulu, ale důkaz, že pojistka funguje: po vrácení opravdu
-- nejde nic naplánovat. Pořadí se proto prohodilo a tenhle komentář
-- je tu, aby to někdo „neopravil" zpátky.

\echo '== 4. Vrácení nese připomínku =============================='

insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze', 'otisk-U', :'e_provozni')
returning id as zadost2 \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni
   set stav = 'zamitnuto', pripominka = 'Chybí cena u svíčkové.'
 where id = :'zadost2';
reset role;

select pg_temp.check('vrácení má schvaleno = false',
  (select (telo ->> 'schvaleno')::boolean from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto'
      and user_id = :'provozni'
    order by created_at desc limit 1) = false);

/*
  PŘIPOMÍNKA JE V TĚLE, NE JEN V TABULCE SCHVÁLENÍ. Bez ní je zpráva
  k ničemu: člověk ví, že to neprošlo, a netuší proč — a musel by to
  jít hledat do příspěvku.
*/
select pg_temp.check('a nese připomínku',
  (select telo ->> 'pripominka' from public.notifications
    where tenant_id = :'tenant' and druh = 'marketing.rozhodnuto'
      and user_id = :'provozni'
    order by created_at desc limit 1) = 'Chybí cena u svíčkové.');


\echo ''
\echo '== 5. Cizí upozornění nikdo nevidí ========================='

/*
  Politika `notifications_select` pouští jen vlastní. Ověřuje se to
  ZDE a ne jen u rozpisu, protože marketingová upozornění nesou
  název příspěvku a jméno toho, kdo o schválení požádal — z cizích
  by se dalo vyčíst, kdo co v marketingu dělá.
*/
/*
  Bere se Danuše, ne někdo úplně cizí: ona marketing VIDÍ
  (`marketing.read` výš). Kdyby se to zkoušelo s někým, kdo do
  marketingu nedosáhne, procházelo by to z jiného důvodu — a přesně
  na tom tenhle scénář dneska už jednou stál.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

select pg_temp.check('ani ten, kdo marketing vidí, nevidí cizí upozornění',
  (select count(*) from public.notifications where druh like 'marketing.%') = 0);

reset role;

select pg_temp.check('a superuživatel je přitom vidí — takže tam opravdu jsou',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh like 'marketing.%') > 0);


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.notifications where tenant_id = :'tenant' and druh like 'marketing.%';
delete from public.marketing_publikace_ulohy where tenant_id = :'tenant';
delete from public.marketing_schvaleni where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';
delete from public.employee_permissions
 where employee_id = :'e_danuse' and permission_key = 'marketing.read';
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.notifications
    where tenant_id = :'tenant' and druh like 'marketing.%') = 0
  and (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 13 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
