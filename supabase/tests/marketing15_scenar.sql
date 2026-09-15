-- Scénář marketing 15 — auditní přehled.
--
-- Pokrývá 20260914200000_marketing_audit.sql.
-- Zadání: master prompt, obrazovka 16 z oddílu 22 a oddíl 23.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE
--
-- Funkce `public.marketing_audit` je `security definer`, takže se
-- uvnitř ní RLS NEUPLATNÍ (skill `migrace`, oddíl 5) a všechno si musí
-- odfiltrovat sama. Filtry jsou tři a každý má vlastní kontrolu:
--
--   1. `tenant_id = p_tenant`          — cizí firma se nesmí objevit
--   2. `entity_type like 'marketing%'` — okno je ÚZKÉ, ne celý audit
--   3. `app.has_access(…, branch)`     — rozsah podle pobočky
--
-- Ten druhý je tu ten nejdůležitější. Kdyby chyběl, byla by tahle
-- funkce cestou, jak se přes marketing dostat ke mzdám a docházce —
-- přesně k tomu, co politika `audit_select` schválně nepouští.
--
-- ---------------------------------------------------------------------
-- A JEŠTĚ JEDNA VĚC, KTERÁ SE DOKAZUJE HŮŘ
--
-- Že se ven nedostanou HODNOTY, jen názvy změněných sloupců. Zkouší se
-- to tak, že se do příspěvku napíše řetězec, který nikde jinde být
-- nemůže, a pak se hledá v celém výstupu funkce.

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
select id as e_provozni from public.employees
 where user_id = :'provozni' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

/*
  ČTENÁŘ, KTERÝ NA AUDIT NESMÍ.

  Danuše dostane `marketing.read`, ne `manage` — a pobočku MÁ
  (na rozdíl od číšníka, jehož členství nemá v `membership_branches`
  ani jednu; na tom už jednou kontrola v marketing13 procházela
  z jiného důvodu, než říkal její název).

  Bez pobočky by prošla i tehdy, kdyby se právo nekontrolovalo vůbec.
*/
select user_id as danuse from public.profiles where email = 'danuse@foodtab.cz' \gset
select id as e_danuse from public.employees
 where user_id = :'danuse' and tenant_id = :'tenant' and deleted_at is null \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_danuse', 'marketing.read', true)
on conflict (employee_id, permission_key) do update set granted = excluded.granted;

/* --- Něco, co se do auditu zapíše ---------------------------------- */

insert into public.marketing_prispevky
  (tenant_id, branch_id, nazev, stav, kanaly, vytvoril)
values (:'tenant', :'perla', 'Zabijačka u Perly', 'koncept', array['instagram'], :'e_provozni')
returning id as prispevek \gset

/*
  TAJNÝ ŘETĚZEC. Musí být takový, aby se v auditu nemohl objevit
  odjinud — proto ne „test" ani „zabijačka".
*/
update public.marketing_prispevky
   set nazev = 'Zabijačka NEPROPUSTNE7419'
 where id = :'prispevek';

\echo ''
\echo '== 1. Kdo smí spravovat marketing, přehled vidí ============='

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select count(*) as videl from public.marketing_audit(:'tenant') \gset
select pg_temp.check('provozní vidí auditní záznamy', :videl > 0);

select count(*) as zalozeni from public.marketing_audit(:'tenant')
 where entita = 'marketing_prispevek' and akce like '%insert' \gset
select pg_temp.check('a je mezi nimi založení příspěvku', :zalozeni > 0);

select coalesce((select array_to_string(zmeneno, ',') from public.marketing_audit(:'tenant')
                  where entita = 'marketing_prispevek' and akce like '%update'
                  order by id desc limit 1), '') as zmeny \gset
select pg_temp.check('u změny je vidět, KTERÝ sloupec se změnil',
  :'zmeny' like '%nazev%');

\echo ''
\echo '== 2. Hodnoty se ven nedostanou, jen názvy sloupců =========='

/*
  Tohle je celý smysl toho, že funkce nevrací syrové `before`/`after`.
  Hledá se tajný řetězec v CELÉM výstupu, ve všech sloupcích najednou.
*/
select count(*) as unik from (
  select to_jsonb(a) as radek from public.marketing_audit(:'tenant') a
) t where radek::text like '%NEPROPUSTNE7419%' \gset

select pg_temp.check('název příspěvku se ve výstupu NEOBJEVÍ', :unik = 0);

reset role;
select pg_temp.check('a přitom v auditu uložený je',
  exists (select 1 from public.audit_log
           where tenant_id = :'tenant'
             and after::text like '%NEPROPUSTNE7419%'));

\echo ''
\echo '== 3. Okno je úzké — jen marketing ==========================='

/*
  Bez filtru `entity_type like 'marketing%'` by tahle funkce byla
  cesta ke mzdám a docházce — přesně k tomu, co politika `audit_select`
  schválně nepouští.

  Nic se sem NEVKLÁDÁ. Do auditu existující firmy nejde nic smazat
  (pravidlo `audit_log_no_delete` mazání tiše zahodí), takže falešný
  řádek by tam zůstal a „úklid“ by lhal. Cizí záznamy tu po `krok`
  scénářích už jsou — a že jsou, se nejdřív ověří, jinak by kontrola
  níž nemohla spadnout.
*/
reset role;
select count(*) as mimo_v_auditu from public.audit_log
 where tenant_id = :'tenant' and entity_type not like 'marketing%' \gset
select pg_temp.check('v auditu firmy JSOU záznamy mimo marketing (jinak by kontrola níž nemohla spadnout)',
  :mimo_v_auditu > 0);

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select count(*) as mimo from public.marketing_audit(:'tenant')
 where entita not like 'marketing%' \gset
select pg_temp.check('přes funkci neprojde nic, co není marketing', :mimo = 0);

/*
  A OSTŘEJI: funkce si o cizí entitu řekne JMÉNEM. Kdyby filtr chyběl,
  tohle vrátí řádky bez ohledu na limit 200 — první kontrola by se dala
  zamaskovat tím, že marketingových záznamů je víc než dvě stě.
*/
select count(*) as vyzadane from public.marketing_audit(:'tenant', null, 'employee') \gset
select pg_temp.check('ani když si o ně řekne jménem', :vyzadane = 0);

\echo ''
\echo '== 4. Kdo smí jen číst, na audit nemá ======================='

select set_config('test.user_id', :'danuse', false);

select count(*) as danuse_vidi from public.marketing_audit(:'tenant') \gset
select pg_temp.check('čtenář marketingu auditní přehled nevidí', :danuse_vidi = 0);

select count(*) as danuse_druhy from public.marketing_audit_druhy(:'tenant') \gset
select pg_temp.check('ani číselník druhů', :danuse_druhy = 0);

\echo ''
\echo '== 5. Cizí firma ============================================'

/*
  Zakládá se přes `app.create_tenant` jako v krok21 — přímý insert do
  `tenants` neprojde, tabulka nemá `slug`. Maže se na konci kaskádou:
  pravidlo na auditu ji pouští, protože firma v tu chvíli už neexistuje.
*/
reset role;
select app.create_tenant('Cizí audit s.r.o.', '15151515') as cizi_tenant \gset

insert into public.audit_log (tenant_id, actor_type, actor_label, action, entity_type, entity_id, after)
values (:'cizi_tenant', 'user', 'Cizí člověk', 'marketing_prispevek.insert',
        'marketing_prispevek', 'cizi-1', jsonb_build_object('nazev', 'Cizí příspěvek'));

set role authenticated;
select set_config('test.user_id', :'provozni', false);

select count(*) as cizi_firma from public.marketing_audit(:'cizi_tenant') \gset
select pg_temp.check('do cizí firmy provozní nevidí', :cizi_firma = 0);

/*
  A OBRÁCENĚ: cizí záznam se nesmí připlést ani do VLASTNÍHO výpisu.
  Kdyby filtr `tenant_id = p_tenant` chyběl, prošel by právě tudy.
*/
select count(*) as pripleteny from public.marketing_audit(:'tenant')
 where entita_id = 'cizi-1' \gset
select pg_temp.check('a nepřiplete se ani do vlastního výpisu', :pripleteny = 0);

\echo ''
\echo '== 6. Stránkování a strop ==================================='

select count(*) as strop from public.marketing_audit(:'tenant', null, null, null, 1) \gset
select pg_temp.check('limit se dodrží', :strop <= 1);

select count(*) as prilis from public.marketing_audit(:'tenant', null, null, null, 99999) \gset
select pg_temp.check('a nesmyslně velký limit se osekne', :prilis <= 200);

/*
  NEJSTARŠÍ SE BERE Z `audit_log`, NE Z FUNKCE. První podoba téhle
  kontroly brala `min(id)` z výchozího okna funkce — a to je 50
  nejnovějších, ne všechno. „Nejstarší z padesáti nejnovějších“ má pod
  sebou další řádky, takže kontrola spadla na mé chybě, ne na funkci.
*/
reset role;
select coalesce(min(id), 0) as nejstarsi from public.audit_log
 where tenant_id = :'tenant' and entity_type like 'marketing%' \gset
set role authenticated;
select set_config('test.user_id', :'provozni', false);

select count(*) as starsi from public.marketing_audit(:'tenant', null, null, :nejstarsi) \gset
select pg_temp.check('„starší než nejstarší“ nevrátí nic', :starsi = 0);

/* A že stránkování opravdu POSOUVÁ, ne jen ořezává. */
select id as prvni from public.marketing_audit(:'tenant', null, null, null, 1) \gset
select coalesce(max(id), 0) as druhy from public.marketing_audit(:'tenant', null, null, :prvni, 1) \gset
select pg_temp.check('další stránka navazuje — má menší id než předchozí',
  :druhy > 0 and :druhy < :prvni);

\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.tenants where id = :'cizi_tenant';
delete from public.marketing_prispevky where id = :'prispevek';
delete from public.employee_permissions
 where employee_id = :'e_danuse' and permission_key = 'marketing.read';

/*
  Druhá podmínka hlídá, že kaskáda audit cizí firmy OPRAVDU odnesla.
  Kdyby pravidlo `audit_log_no_delete` kaskádu blokovalo, zůstaly by
  tu sirotčí řádky bez firmy — a nikdo by si nevšiml.
*/
select pg_temp.check('scénář po sobě uklidil',
  not exists (select 1 from public.tenants where id = :'cizi_tenant')
  and not exists (select 1 from public.audit_log where tenant_id = :'cizi_tenant'));

\echo ''
\echo '=========================================================='
\echo ' MARKETING 15 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
