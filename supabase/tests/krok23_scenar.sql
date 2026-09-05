-- Scénář pro krok 23 — příchod, když je jeden ještě otevřený.
--
-- Pokrývá migraci 20260905010000_dvojity_prichod a rozhodnutí
-- docs/rozhodnuti-dvojity-prichod.md, oddíl Testy.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Rozdíl mezi body 1 a 2 je JEDNA HODINA a plete se snadno: dnešní
-- provozní den odmítne, starší uzavře. Proto se obojí zkouší i přes
-- půlnoc — příchod ve 22:00 a pokus ve 2:15 je týž provozní den, ne
-- nový.
--
-- A pak jedna kontrola, která hlídá tu nejtišší možnou chybu: uzavřený
-- záznam nesmí zmizet z dosahu hlídače zapomenutých odchodů. Kdyby
-- zmizel, aplikace by překážku odklidila a nikdo by se nedozvěděl,
-- že tam byla.

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
-- Vlastní zaměstnanec, ne někdo ze seedu: bude se mu schválně nechávat
-- otevřený příchod a ostatní scénáře s ním počítají jinak.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Dvojitý Příchod', 'hpp')
returning id as e \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.e', :'e', false);

-- Provozní den se počítá z `day_starts_at` (05:00), ne z půlnoci.
select app.business_date(:'perla', now()) as dnes \gset


\echo ''
\echo '== 1. Otevřený z TÉHOŽ provozního dne → neprojde ========='

select udalost as prvni from app.pichnout(:'tenant', :'perla', :'e', 'in') \gset

select pg_temp.check('první příchod projde',
  (select count(*) from public.attendance_events where id = :'prvni') = 1);

/*
  Odsunout ho za dvouminutové okno.

  Do dvou minut se totéž píchnutí bere jako dvojí načtení kódu a vrací
  se PŮVODNÍ záznam, ne chyba — kdo ťukne dvakrát za sebou, za to
  nemůže. Bez tohohle by nové pravidlo nešlo vyzkoušet vůbec a první
  podoba téhle kontroly na tom spadla.

  `business_date` se dosazuje výslovně, ať kontrola nezávisí na tom,
  kolik je zrovna hodin: rozhoduje shoda provozních dnů, ne odstup.
*/
update public.attendance_events
   set occurred_at = now() - interval '5 minutes',
       business_date = :'dnes'
 where id = :'prvni';

do $$
declare v_ok boolean := false; v_text text;
begin
  begin
    perform app.pichnout(
      current_setting('test.tenant')::uuid,
      (select id from public.branches where slug = 'cerna-perla'),
      current_setting('test.e')::uuid, 'in');
  exception when check_violation then
    v_ok := true;
    get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then raise exception 'SELHALO: druhý příchod téhož dne prošel'; end if;
  -- Hláška je pro člověka a má v ní být čas toho prvního.
  if v_text not like 'Už máte píchnutý příchod od __:__%' then
    raise exception 'SELHALO: hláška neříká, od kdy: %', v_text;
  end if;
  raise notice '  OK    druhý příchod téhož dne neprojde (%)', v_text;
end $$;

/*
  Dvojí načtení do dvou minut je něco jiného než druhý příchod — vrací
  se původní záznam. Ověřuje se, že to nová podmínka nepřebila: kdo
  ťukne dvakrát za sebou, nemá dostat chybu.

  Odlišit to jde jen tím, že se ten původní odsune do minulosti.
*/
update public.attendance_events set occurred_at = now() - interval '3 hours'
 where id = :'prvni';


\echo ''
\echo '== 2. Přes půlnoc rozhoduje provozní den ================='

/*
  Noční směna: příchod ve 22:00, pokus ve 2:15. KALENDÁŘNÍ den se
  liší, PROVOZNÍ ne — a rozhodovat má ten provozní. Druhé píchnutí je
  omyl, ne nový nástup.

  Zkouší se to tak, že otevřený příchod má okamžik o dvacet hodin
  zpátky (tedy jiný kalendářní den), ale provozní den dnešní. Kdyby
  kód porovnával `occurred_at::date` místo `business_date`, pustil by
  ho dál — a z jedné noční směny by se staly dvě.
*/
update public.attendance_events
   set occurred_at = now() - interval '20 hours',
       business_date = :'dnes'
 where id = :'prvni';

select pg_temp.check('okamžik je z jiného kalendářního dne',
  (select occurred_at::date <> :'dnes'::date
   from public.attendance_events where id = :'prvni'));

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.pichnout(
      current_setting('test.tenant')::uuid,
      (select id from public.branches where slug = 'cerna-perla'),
      current_setting('test.e')::uuid, 'in');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception 'SELHALO: přes půlnoc prošel druhý příchod — rozhoduje kalendářní den?';
  end if;
  raise notice '  OK    přes půlnoc rozhoduje provozní den, ne kalendářní';
end $$;


\echo ''
\echo '== 3. Otevřený ze STARŠÍHO dne → uzavře se =============='

-- Posuneme ho o tři dny zpět: jiný provozní den.
update public.attendance_events
   set occurred_at = now() - interval '3 days',
       business_date = :'dnes'::date - 3
 where id = :'prvni';

select udalost as druhy, uzavren_stary, stary_den
from app.pichnout(:'tenant', :'perla', :'e', 'in') \gset

select pg_temp.check('nový příchod projde',
  (select count(*) from public.attendance_events where id = :'druhy') = 1);
select pg_temp.check('a funkce ohlásí, že uzavřela starý',
  :'uzavren_stary' = 't');
select pg_temp.check('se dnem, ze kterého byl (' || :'stary_den' || ')',
  :'stary_den'::date = :'dnes'::date - 3);

select pg_temp.check('starý je označený jako uzavřený systémem',
  (select uzavreno_systemem is not null from public.attendance_events where id = :'prvni'));


\echo ''
\echo '== 4. Uzavřít NENÍ domyslet odchod ======================='

-- `out` zůstává prázdné. To pravidlo v tomhle modulu platí všude
-- a neláme se ani tady.
select pg_temp.check('žádný odchod se nedomyslel',
  (select count(*) from public.attendance_events a
    where a.employee_id = :'e' and a.kind = 'out'
      and a.business_date = :'dnes'::date - 3) = 0);

select pg_temp.check('do odpracovaných minut se nezapočítal',
  (select odpracovano_minut from app.earnings(:'e', :'dnes'::date - 3)) = 0);

-- A pořád je v seznamu nedokončených — vedoucí ho má co doplnit.
set role authenticated;
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);
select pg_temp.check('zůstává v seznamu nedokončených',
  (select count(*) from public.nedokoncena_dochazka(
      :'tenant', :'dnes'::date - 4, :'dnes'::date, :'perla') n
    where n.employee_id = :'e' and n.business_date = :'dnes'::date - 3) = 1);
reset role;

/*
  A NEZMIZEL Z DOSAHU HLÍDAČE zapomenutých odchodů.

  Hlídač má v podmínce i denní dobu, takže volat ho tady by udělalo
  kontrolu závislou na hodině — přesně ta past, na které dnes ráno
  spadl krok5. Ověřuje se proto jeho ROZPOZNÁVACÍ podmínka: příchod
  bez storna, po kterém nepřišel odchod. `uzavreno_systemem` v ní není
  a být nesmí.
*/
select pg_temp.check('hlídač zapomenutých odchodů na něj pořád dosáhne',
  exists (
    select 1 from public.attendance_events a
    where a.id = :'prvni'
      and a.kind = 'in'
      and a.stornovano_kdy is null
      and not exists (
        select 1 from public.attendance_events o
        where o.employee_id = a.employee_id
          and o.business_date = a.business_date
          and o.kind = 'out'
          and o.occurred_at > a.occurred_at
          and o.stornovano_kdy is null
      )
  ));

/*
  A tohle je ta druhá polovina, bez které je kontrola výš jen opis.

  Předchozí kontrola ověřuje PODMÍNKU, ne hlídače — kdyby si někdo do
  `ohlasit_zapomenute_odchody` dopsal `uzavreno_systemem is null`,
  prošla by dál a uzavřené záznamy by z hlášení tiše vypadly. Ověřeno:
  rozbil jsem to a nespadlo nic.

  Volat hlídače přímo tady nejde — má v podmínce denní dobu a kontrola
  by závisela na hodině (na tom dnes ráno spadl krok5). Ptáme se proto
  jeho definice.
*/
select pg_temp.check('a hlídač o uzavřených systémem vůbec neví',
  (select pg_get_functiondef(p.oid) not like '%uzavreno_systemem%'
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ohlasit_zapomenute_odchody'));


\echo ''
\echo '== 5. Uzavření je v auditu =============================='

select pg_temp.check('uzavření systémem je zapsané v auditu',
  (select count(*) from public.audit_log a
    where a.entity_id = :'prvni' and a.action = 'dochazka.uzavreno_systemem') = 1);

select pg_temp.check('a je u něj, ze kterého dne to bylo',
  (select (a."after" ->> 'business_date')::date from public.audit_log a
    where a.entity_id = :'prvni' and a.action = 'dochazka.uzavreno_systemem')
  = :'dnes'::date - 3);


\echo ''
\echo '== 6. Otevřený na druhé pobočce brání stejně ============='

/*
  Člověk může být fyzicky jen na jednom místě.

  Otevřený příchod musí být na DRUHÉ pobočce, než kde se zkouší píchat
  — jinak kontrola nic neověří. První podoba měla otevřený příchod
  v Perle i pokus v Bernardu, ale ten otevřený patřil Perle stejně
  jako předtím: zúžil jsem hledání na jednu pobočku a nespadlo nic.
*/
update public.attendance_events
   set branch_id = :'bar'
 where id = :'druhy';

do $$
declare v_ok boolean := false;
begin
  begin
    perform app.pichnout(
      current_setting('test.tenant')::uuid,
      (select id from public.branches where slug = 'cerna-perla'),
      current_setting('test.e')::uuid, 'in');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: příchod na druhé pobočce prošel'; end if;
  raise notice '  OK    otevřený příchod v Bernardu brání i příchodu v Perle';
end $$;

-- A zpátky, ať další oddíly pracují s tím, co čekají.
update public.attendance_events set branch_id = :'perla' where id = :'druhy';


\echo ''
\echo '== 7. Ruční doplnění odchodu ============================'

-- Doplnění překlopí uzavřený záznam na řádnou dvojici a hodiny se
-- dopočítají. Kontroluje se na minutu — na tomhle jsme se už spálili.
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, occurred_at, business_date, source, note)
values (:'tenant', :'perla', :'e', 'out',
        (select occurred_at from public.attendance_events where id = :'prvni')
          + interval '7 hours 30 minutes',
        :'dnes'::date - 3, 'manual', 'dopsáno vedoucím');

select pg_temp.check('po doplnění se hodiny dopočítaly na minutu',
  (select odpracovano_minut from app.earnings(:'e', :'dnes'::date - 3)) = 450);

set role authenticated;
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);
select pg_temp.check('a ze seznamu nedokončených zmizel',
  (select count(*) from public.nedokoncena_dochazka(
      :'tenant', :'dnes'::date - 4, :'dnes'::date, :'perla') n
    where n.employee_id = :'e' and n.business_date = :'dnes'::date - 3) = 0);
reset role;


\echo ''
\echo '== 8. Cizí firma ========================================'

set role authenticated;
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'cizi@jinafirma.cz'), false);

select pg_temp.check('cizí firma ty záznamy nevidí',
  (select count(*) from public.attendance_events where employee_id = :'e') = 0);

reset role;


\echo ''
\echo '== KROK 23 HOTOV ========================================='
