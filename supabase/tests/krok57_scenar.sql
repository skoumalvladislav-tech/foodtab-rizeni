-- Scénář pro krok 57 — záloha se vyplácí na pobočce výdeje.
--
-- Pokrývá migraci 20260924120000_zalohy_vyplaceni_na_pobocce.sql.
--
-- Navazuje na etapa0_scenar.sql až krok54_scenar.sql (seed firmy, poboček
-- Černá Perla / Bernard Bar a majitele). Krok 55 a 56 patří jiným větvím.
--
-- ---------------------------------------------------------------------
-- HLÁŠENÍ (24. 9. 2026)
--
-- „U zaměstnanců, kteří na to mají práva, mi nejdou vyplácet zálohy."
-- V ostré databázi: zařazení Číšník/servírka s právem advances.manage,
-- BEZ attendance.manage, členství jen na Černé Perle. Nabídka „Komu"
-- byla prázdná (průzor pro docházku) a výplata brala domovskou pobočku.
-- Juli57 níž je přesně tenhle člověk.
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ (písmena odpovídají zadání)
--
--   a) jen advances.manage na Perle stačí: nabídka i výplata na Perle;
--      průzor pro docházku (lide_pro_pobocku) se nemění;
--   b) člověk bez domovské pobočky je v nabídce a výplata se zaúčtuje
--      na pobočku výdeje;
--   c) zaskakující z Baru se směnou na Perle — záloha na PERLE, ne na
--      Baru (i provozní den, audit, upozornění a kiosek Perly). Provozní
--      den se zkouší s Perlou a Barem v RŮZNÝCH časových pásmech, jinak
--      by den podle domovského Baru nešel poznat. A okno směn: kdo má na
--      Perle směnu až za pět dní (Hugo), je v nabídce i výplata mu projde
--      — okno výplaty je stejné jako okno obrazovky;
--   d) kdo na Perle nepracuje (bez směny, jen zrušená, směna mimo okno,
--      smazaný), v nabídce není a výplata spadne;
--   e) majitel bez pobočky a bez směny v nabídce není;
--   f) cizí firma (pobočka, zaměstnanec, člověk bez pobočky) a člověk
--      bez práva. Právo se ptá PRVNÍ: kdo ho nemá, dostane „oprávnění"
--      i u cizí pobočky a i u člověka, který tu nepracuje;
--   g) stará volání se čtyřmi parametry fungují jako dřív;
--   h) pozastavení záloh platí dál.
--
-- Každá výjimka se kontroluje i s HLÁŠKOU, ne jen s kódem: několik
-- podmínek ve výplatě je jištěných ještě jednou v app.patri_k_zaloze
-- a vyndání té první by jinak prošlo nepoznané (spadlo by to jen jinou
-- větou). Viz hlavička migrace.
--
-- POZOR NA PGLITE: běží jako superuživatel, RLS ani sloupcové granty se
-- tam neuplatní. Tady nevadí — všechno, co se měří, je uvnitř definer
-- funkcí (tam RLS není ani na Supabase) a granty se čtou katalogem.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

-- Projde příkaz BEZ výjimky? Pro výplatu, která projít MUSÍ: když
-- neprojde, ať to spadne pojmenovanou kontrolou, ne holou výjimkou
-- uprostřed scénáře. Důvod pádu se vypíše, aby se nemusel hledat.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
-- Předchozí scénář nechává test.user_id nastavené — bez tohohle by
-- insert majitele spadl na „Majitele jmenuje jenom majitel.".
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('57570000-0000-0000-0000-000000000001', 'juli57@foodtab.cz',  '{"full_name":"Juli Padesátsedm"}'),
  ('57570000-0000-0000-0000-000000000002', 'hana57@foodtab.cz',  '{"full_name":"Hana Padesátsedm"}'),
  ('57570000-0000-0000-0000-000000000003', 'ivan57@foodtab.cz',  '{"full_name":"Ivan Padesátsedm"}'),
  ('57570000-0000-0000-0000-000000000004', 'cyril57@foodtab.cz', '{"full_name":"Cyril Padesátsedm"}');

-- Zařazení jako „Číšník/servírka" v ostré databázi: vyplácet zálohy
-- smí, docházku spravovat NE. Právo dává zařazení, ne role.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska57_obsluha', 'Zkouška 57 — obsluha', 'servis', true)
returning id as z_obsluha \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_obsluha', 'advances.manage');

-- Juli: zálohy smí, jen na Perle.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '57570000-0000-0000-0000-000000000001', :'z_obsluha', 'Juli Padesátsedm', 'hpp')
returning id as juli \gset

-- Hana: člověk z Perly bez práva na zálohy.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '57570000-0000-0000-0000-000000000002', 'Hana Padesátsedm', 'hpp')
returning id as hana \gset

-- Ivan: zálohy smí v CELÉ firmě (výjimka u člověka, rozsah 'tenant').
-- Na něm se zkouší cizí pobočka: jemu has_access u cizí pobočky
-- neřekne ne, takže ji musí zastavit kontrola firmy pobočky.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '57570000-0000-0000-0000-000000000003', 'Ivan Padesátsedm', 'hpp')
returning id as ivan \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'ivan', 'advances.manage', true);

-- Komu se vyplácí.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Adam Padesátsedm', 'hpp')
returning id as adam \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', null, 'Bára Padesátsedm', 'dpp')
returning id as bara \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'bar', '57570000-0000-0000-0000-000000000004', 'Cyril Padesátsedm', 'dpp')
returning id as cyril \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Dana Padesátsedm', 'hpp')
returning id as dana \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Emil Padesátsedm', 'hpp')
returning id as emil \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Filip Padesátsedm', 'hpp')
returning id as filip \gset

-- Hugo: z Baru, na Perle zaskočí až za pět dní (okraj okna, oddíl 3b).
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'bar', 'Hugo Padesátsedm', 'hpp')
returning id as hugo \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type, deleted_at)
values (:'tenant', :'perla', 'Gustav Padesátsedm', 'hpp', now())
returning id as gustav \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type, je_majitel)
values (:'tenant', null, 'Majitel Padesátsedm', 'ico', true)
returning id as majitel57 \gset

-- Směny na Perle. Cyril zaskakuje dnes; Emil měl, ale je zrušená;
-- Filip ji má až za měsíc (mimo okno ±7 dní); Hugo za pět dní (v okně
-- ±7, ale mimo užší — oddíl 3b).
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'cyril', current_date, '08:00', '16:00');

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'hugo', current_date + 5, '08:00', '16:00');

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, status)
values (:'tenant', :'perla', :'emil', current_date, '08:00', '16:00', 'cancelled');

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'filip', current_date + 30, '08:00', '16:00');

-- Členství: Juli a Hana jen Perla, Ivan celá firma.
insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '57570000-0000-0000-0000-000000000001', null, 'branch', 'active'),
  (:'tenant', '57570000-0000-0000-0000-000000000002', null, 'branch', 'active'),
  (:'tenant', '57570000-0000-0000-0000-000000000003', null, 'tenant', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id in ('57570000-0000-0000-0000-000000000001',
                     '57570000-0000-0000-0000-000000000002');

-- Cyril má účet a ČLENSTVÍ (na svém Baru). Od 25. 9. 2026 jde upozornění
-- na zálohu přes app.notifikovat (20260925100000) a ta píše jen lidem
-- s aktivním členstvím — kdo ho nemá, do aplikace firmy stejně nevidí.
-- Bez členství by kontrola „upozornění zaskakujícímu je z Perly" níž
-- neměla co měřit. Scénář ho dřív neměl, protože přímý insert se na
-- členství neptal.
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '57570000-0000-0000-0000-000000000004', null, 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'bar'::uuid
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id = '57570000-0000-0000-0000-000000000004';

-- Cizí firma: pobočka a člověk BEZ pobočky (ne majitel). Právě ten by
-- bez filtru firmy prošel pravidlem „bez pobočky" do nabídky Perly.
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok57 Cizí s.r.o.', 'Krok57 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset

insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 57', 'krok57-cizi')
returning id as cizi_pobocka \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'cizi_firma', null, 'Cizinec Padesátsedm', 'dpp')
returning id as cizinec \gset


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

-- Bez tohohle by kontroly níž mohly mlčky zkoušet jiného člověka, než
-- jakého popisuje hlášení.
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('příprava: Juli smí vyplácet zálohy na Perle',
  app.has_access(:'tenant', 'advances.manage', :'perla'));

select pg_temp.check('příprava: Juli NEsmí spravovat docházku na Perle (jako v ostré DB)',
  not app.has_access(:'tenant', 'attendance.manage', :'perla'));

select pg_temp.check('příprava: Juli nemá právo na Baru',
  not app.has_access(:'tenant', 'advances.manage', :'bar'));

select set_config('test.user_id', '57570000-0000-0000-0000-000000000003', false);

select pg_temp.check('příprava: celofiremnímu Ivanovi has_access u CIZÍ pobočky ne neřekne',
  app.has_access(:'tenant', 'advances.manage', :'cizi_pobocka'));

select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. (a) Jen advances.manage na Perle stačí ============='

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('Juli má v nabídce domácího člověka z Perly',
  exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                          current_date - 7, current_date + 7) l
          where l.employee_id = :'adam' and l.domovska and not l.bez_pobocky));

-- Průzor pro ruční zápis docházky se NEMĚNÍ: bez attendance.manage je
-- u něj prázdno dál. (Že tam lidé jsou, dokazuje majitel o kus níž.)
select pg_temp.check('lide_pro_pobocku jí dál nevrátí nikoho (beze změny)',
  (select count(*) from public.lide_pro_pobocku(:'tenant', :'perla',
                          current_date - 7, current_date + 7)) = 0);

select zaloha as zal_a from public.vyplatit_zalohu(
  :'tenant', :'adam', 10000, 'krok57 a', :'perla') \gset

reset role;

select pg_temp.check('výplata domácímu z Perly prošla a je na Perle',
  (select branch_id from public.advances where id = :'zal_a') = :'perla'::uuid);

select set_config('test.user_id', :'majitel', false);
select pg_temp.check('důkaz: majitel (má attendance.manage) v lide_pro_pobocku Adama vidí',
  exists (select 1 from public.lide_pro_pobocku(:'tenant', :'perla',
                          current_date - 7, current_date + 7) l
          where l.employee_id = :'adam'));
select set_config('test.user_id', '', false);


\echo ''
\echo '== 2. (b) Bez domovské pobočky ==========================='

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('člověk bez pobočky je v nabídce Perly jako bez_pobocky',
  exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                          current_date - 7, current_date + 7) l
          where l.employee_id = :'bara' and l.bez_pobocky and not l.domovska));

select zaloha as zal_b from public.vyplatit_zalohu(
  :'tenant', :'bara', 20000, 'krok57 b', :'perla') \gset

reset role;

select pg_temp.check('výplata člověku bez pobočky prošla a je na Perle',
  (select branch_id from public.advances where id = :'zal_b') = :'perla'::uuid);

select pg_temp.check('provozní den je den Perly',
  (select business_date from public.advances where id = :'zal_b')
  = app.business_date(:'perla', now()));


\echo ''
\echo '== 3. (c) Zaskakující z Baru se směnou na Perle =========='

/*
  Provozní den zálohy se musí brát z pobočky VÝDEJE, ne z domovské.
  Dokud mají Perla a Bar stejné časové pásmo i začátek dne, je to jedno
  a kontrola by to nepoznala. Proto se jim na tenhle oddíl dají pásma
  co nejdál od sebe: Kiritimati je UTC+14, Pago Pago UTC−11 — 25 hodin.
  Se začátkem dne o půlnoci se jejich provozní dny neshodnou nikdy, ať
  scénář běží v kteroukoli hodinu.

  Původní hodnoty se uloží a na konci oddílu vrátí (kontrola níž).
*/
reset role;
select set_config('test.user_id', '', false);

create temp table puvodni57 as
  select b.id, b.timezone, b.day_starts_at
    from public.branches b
   where b.id in (:'perla', :'bar');

update public.branches set timezone = 'Pacific/Kiritimati', day_starts_at = '00:00'
 where id = :'perla';
update public.branches set timezone = 'Pacific/Pago_Pago', day_starts_at = '00:00'
 where id = :'bar';

select pg_temp.check('předpoklad: Perla a Bar mají teď RŮZNÝ provozní den',
  app.business_date(:'perla', now()) <> app.business_date(:'bar', now()));

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('zaskakující je v nabídce Perly, ne jako domácí',
  exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                          current_date - 7, current_date + 7) l
          where l.employee_id = :'cyril' and not l.domovska and not l.bez_pobocky));

select zaloha as zal_c from public.vyplatit_zalohu(
  :'tenant', :'cyril', 30000, 'krok57 c', :'perla') \gset

reset role;

select pg_temp.check('záloha zaskakujícího je na PERLE, ne na jeho domovském Baru',
  (select branch_id from public.advances where id = :'zal_c') = :'perla'::uuid);

select pg_temp.check('i provozní den zálohy je den PERLY, ne Baru',
  (select business_date from public.advances where id = :'zal_c')
  = app.business_date(:'perla', now()));

select pg_temp.check('i audit výplaty je na Perle',
  (select branch_id from public.audit_log
    where action = 'advance.vyplaceno' and entity_id = :'zal_c') = :'perla'::uuid);

select pg_temp.check('i upozornění zaskakujícímu je z Perly',
  (select n.branch_id from public.notifications n
    where n.druh = 'zaloha.vyplacena'
      and n.user_id = '57570000-0000-0000-0000-000000000004'
      and n.telo ->> 'zaloha' = :'zal_c') = :'perla'::uuid);

-- To, na co se v provozu narazilo: kiosek pobočky, kde peníze přešly
-- z ruky do ruky, musí zálohu ukázat k potvrzení. Kiosek bere jen
-- zálohy s provozním dnem SVÉ pobočky — proto se to zkouší ještě
-- s pásmy nastavenými výš.
select set_config('test.user_id', :'majitel', false);
select kod as kod57 from public.vytvorit_registracni_kod(
  :'tenant', :'perla', 'tablet krok57') \gset
select klic as klic57 from public.registrovat_zarizeni(:'kod57') \gset
select set_config('test.user_id', '', false);

set role anon;
select pg_temp.check('kiosek Perly zálohu zaskakujícího ukáže k potvrzení (Bar má jiný den)',
  exists (select 1 from jsonb_array_elements(public.kiosk_zalohy(:'klic57')) z
          where z ->> 'id' = :'zal_c'));
reset role;

-- Pásma zpátky. Počet řádků se kontroluje, protože prázdná záloha
-- hodnot by „všechno sedí" řekla vždycky.
update public.branches b
   set timezone = p.timezone, day_starts_at = p.day_starts_at
  from puvodni57 p
 where b.id = p.id;

select pg_temp.check('Perla a Bar mají zpátky původní pásmo a začátek dne',
  (select count(*) from puvodni57) = 2
  and not exists (select 1 from public.branches b join puvodni57 p on p.id = b.id
                   where b.timezone is distinct from p.timezone
                      or b.day_starts_at is distinct from p.day_starts_at));

drop table puvodni57;


\echo ''
\echo '== 3b. (c) Směna na okraji okna =========================='

/*
  Okno výplaty (±7 dní kolem provozního dne pobočky výdeje) musí být
  stejné jako okno, se kterým obrazovka volá nabídku — výchozí
  `okno = 7` v lib/lide-pobocky.ts (lideProZalohy). Hugo z Baru má na
  Perle směnu až za pět dní: nabídka obrazovky ho ukáže, a výplata ho
  proto pustit MUSÍ. Kdyby si ji někdo zúžil, obrazovka by nabídla
  člověka, kterému pak výplata řekne „nepracuje".

  Nabídka se volá přesně jako z obrazovky: provozní den pobočky ±7.
*/
select app.business_date(:'perla', now()) as den_perla \gset

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('Hugo (směna na Perle za pět dní) je v nabídce s oknem obrazovky ±7',
  exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                          :'den_perla'::date - 7, :'den_perla'::date + 7) l
          where l.employee_id = :'hugo' and not l.domovska and not l.bez_pobocky));

select pg_temp.check('a výplata mu na Perle projde',
  pg_temp.projde(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'hugo', 'krok57 okno', :'perla')));

reset role;

select pg_temp.check('Hugova záloha je na Perle',
  (select branch_id from public.advances
    where employee_id = :'hugo' and poznamka = 'krok57 okno') = :'perla'::uuid);


\echo ''
\echo '== 4. (d) Kdo na Perle nepracuje ========================='

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('člověk z Baru bez směny na Perle v nabídce NENÍ',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'dana'));

select pg_temp.check('se ZRUŠENOU směnou na Perle taky ne',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'emil'));

select pg_temp.check('se směnou až za měsíc (mimo okno) taky ne',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'filip'));

select pg_temp.check('smazaný člověk z Perly taky ne',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'gustav'));

select pg_temp.check('výplata člověku z Baru bez směny na Perle spadne na „nepracuje"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'dana', 'krok57 d', :'perla'),
    '23514', 'na téhle pobočce nepracuje'));

select pg_temp.check('a se zrušenou směnou taky',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'emil', 'krok57 d', :'perla'),
    '23514', 'na téhle pobočce nepracuje'));

select pg_temp.check('a se směnou mimo okno taky',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'filip', 'krok57 d', :'perla'),
    '23514', 'na téhle pobočce nepracuje'));

-- Smazaného zastaví už dohledání zaměstnance ve výplatě (deleted_at),
-- ne až „patří" — proto hláška o firmě, ne „nepracuje".
select pg_temp.check('smazanému výplata spadne na „nepatří téhle firmě"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'gustav', 'krok57 d', :'perla'),
    'P0002', 'nepatří téhle firmě'));

reset role;

select pg_temp.check('nikomu z nich se nic nezapsalo',
  not exists (select 1 from public.advances
               where employee_id in (:'dana', :'emil', :'filip', :'gustav')));


\echo ''
\echo '== 5. (e) Majitel bez pobočky a bez směny ================'

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('majitel bez pobočky v nabídce Perly NENÍ',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'majitel57'));

select pg_temp.check('a výplata mu na Perle spadne na „nepracuje"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'majitel57', 'krok57 e', :'perla'),
    '23514', 'na téhle pobočce nepracuje'));

reset role;


\echo ''
\echo '== 6. (f) Cizí firma a chybějící právo ==================='

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000003', false);

-- Ivan dosáhne všude, i na cizí pobočku (příprava, oddíl 0). Zastavit
-- ho musí kontrola firmy pobočky. Bára nemá pobočku, takže pravidlo
-- „patří" by ji pustilo kamkoli — proto se to zkouší na ní.
select pg_temp.check('výplata na pobočku CIZÍ firmy spadne na „Taková pobočka tu není"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'bara', 'krok57 f', :'cizi_pobocka'),
    'P0002', 'Taková pobočka tu není'));

select pg_temp.check('důkaz: Ivanovi nabídka Perly Báru ukazuje',
  exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                          current_date - 7, current_date + 7) l
          where l.employee_id = :'bara'));

select pg_temp.check('nabídka pro pobočku CIZÍ firmy je prázdná',
  (select count(*) from public.lide_pro_zalohy(:'tenant', :'cizi_pobocka',
                          current_date - 7, current_date + 7)) = 0);

reset role;

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select pg_temp.check('zaměstnanec CIZÍ firmy: „Zaměstnanec nepatří téhle firmě"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'cizinec', 'krok57 f', :'perla'),
    'P0002', 'nepatří téhle firmě'));

select pg_temp.check('člověk bez pobočky z CIZÍ firmy v nabídce Perly není',
  not exists (select 1 from public.lide_pro_zalohy(:'tenant', :'perla',
                              current_date - 7, current_date + 7) l
              where l.employee_id = :'cizinec'));

select pg_temp.check('Juli na Baru (tam právo nemá) nevyplatí',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'dana', 'krok57 f', :'bar'),
    '42501', 'kdo na to má oprávnění'));

reset role;

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000002', false);

select pg_temp.check('bez advances.manage výplata spadne',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'adam', 'krok57 f', :'perla'),
    '42501', 'kdo na to má oprávnění'));

-- Právo PŘED „patří": Dana z Baru na Perle nepracuje (oddíl 4), ale
-- Hana bez práva se to z hlášky dozvědět nesmí — dostane totéž co
-- u Adama, ne „nepracuje".
select pg_temp.check('bez práva ani u člověka, který tu nepracuje, nepadá „nepracuje", jen „oprávnění"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'dana', 'krok57 f', :'perla'),
    '42501', 'kdo na to má oprávnění'));

-- Že v nabídce Perly lidi jsou, dokázala Juli v oddílu 1.
select pg_temp.check('a nabídka je bez práva prázdná',
  (select count(*) from public.lide_pro_zalohy(:'tenant', :'perla',
                          current_date - 7, current_date + 7)) = 0);

reset role;

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

-- Právo se ptá PRVNÍ, i před firmou pobočky. Juli má právo jen na
-- Perle, takže u cizí pobočky dostane „oprávnění" — a ne „Taková
-- pobočka tu není", ze kterého by poznala, že ta pobočka není její
-- firmy. Že kontrola firmy pobočky pořád drží, dokazuje výš Ivan,
-- kterého právo nezastaví.
--
-- Stojí až za Haninými kontrolami schválně: prohození práva s „patří"
-- (Hana) a prohození práva s firmou pobočky (tady) tak shodí každé
-- svou vlastní kontrolu, ne tutéž.
select pg_temp.check('bez práva na cizí pobočce: „oprávnění", ne „Taková pobočka tu není"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'bara', 'krok57 f', :'cizi_pobocka'),
    '42501', 'kdo na to má oprávnění'));

reset role;

select pg_temp.check('na cizí pobočku se nic nezapsalo (Ivan ani Juli)',
  not exists (select 1 from public.advances where branch_id = :'cizi_pobocka'));


\echo ''
\echo '== 7. (g) Stará volání se čtyřmi parametry ==============='

select pg_temp.check('výplata existuje JEDNOU — PostgREST nemá dva kandidáty',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'vyplatit_zalohu') = 1);

select pg_temp.check('výplatu smí volat přihlášený, anonym ne',
  has_function_privilege('authenticated',
    'public.vyplatit_zalohu(uuid, uuid, integer, text, uuid)', 'execute')
  and not has_function_privilege('anon',
    'public.vyplatit_zalohu(uuid, uuid, integer, text, uuid)', 'execute'));

select pg_temp.check('nabídku smí volat přihlášený, anonym ne',
  has_function_privilege('authenticated',
    'public.lide_pro_zalohy(uuid, uuid, date, date)', 'execute')
  and not has_function_privilege('anon',
    'public.lide_pro_zalohy(uuid, uuid, date, date)', 'execute'));

select pg_temp.check('pomocnou funkci nevolá zvenku nikdo',
  not has_function_privilege('authenticated',
    'app.patri_k_zaloze(uuid, uuid, date, date)', 'execute')
  and not has_function_privilege('anon',
    'app.patri_k_zaloze(uuid, uuid, date, date)', 'execute'));

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);

select zaloha as zal_g from public.vyplatit_zalohu(
  p_tenant => :'tenant', p_employee => :'adam',
  p_castka => 5000, p_poznamka => 'krok57 g') \gset

select pg_temp.check('bez pobočky výdeje a bez domovské: „Vyberte pobočku"',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(p_tenant => %L, p_employee => %L, p_castka => 10000, p_poznamka => %L)',
    :'tenant', :'bara', 'krok57 g'),
    '23514', 'Vyberte pobočku'));

-- Bez pobočky výdeje se právo ptá jako dřív na domovské — u Cyrila na
-- Baru, kde Juli právo nemá. Přesně to se hlásilo.
select pg_temp.check('zaskakujícímu starým voláním nevyplatí (jako dřív)',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(p_tenant => %L, p_employee => %L, p_castka => 10000, p_poznamka => %L)',
    :'tenant', :'cyril', 'krok57 g'),
    '42501', 'kdo na to má oprávnění'));

reset role;

select pg_temp.check('staré volání: záloha na domovské pobočce jako dřív',
  (select branch_id from public.advances where id = :'zal_g') = :'perla'::uuid);


\echo ''
\echo '== 8. (h) Pozastavení platí dál =========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.pozastavit_zalohy(:'tenant', :'adam', true);
reset role;

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);
select pg_temp.check('pozastavenému člověku výplata na pobočce výdeje neprojde',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'adam', 'krok57 h', :'perla'),
    '42501', 'pozastavené'));
reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.pozastavit_zalohy(:'tenant', :'adam', false);
select public.pozastavit_zalohy(:'tenant', null, true);
reset role;

set role authenticated;
select set_config('test.user_id', '57570000-0000-0000-0000-000000000001', false);
select pg_temp.check('pozastavené za firmu neprojde ani člověku bez pobočky',
  pg_temp.spadne_hlaskou(format(
    'select public.vyplatit_zalohu(%L, %L, 10000, %L, %L)',
    :'tenant', :'bara', 'krok57 h', :'perla'),
    '42501', 'pozastavené'));
reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.pozastavit_zalohy(:'tenant', null, false);
reset role;

select pg_temp.check('pozastavené výplaty se nezapsaly',
  not exists (select 1 from public.advances where poznamka = 'krok57 h'));


\echo ''
\echo '== Úklid ================================================='

/*
  Po sobě se uklízí lidé, směny, zálohy a zařazení: člověk bez pobočky
  by jinak zůstal v nabídce Záloh každé pobočky i dalším scénářům.

  CIZÍ FIRMA ZŮSTÁVÁ (stejně jako po kroku 54). Smazat ji nejde, protože
  má pobočku: `audit_log.branch_id` je `on delete set null` a audit_log
  má pravidlo `audit_log_no_update … do instead nothing`. Pravidlo
  přepíše i nulovací dotaz kaskády a PostgreSQL to odmítne jako
  „referential integrity query … gave unexpected result" — u jakékoli
  pobočky, i bez jediného řádku auditu. Maže se aspoň její člověk bez
  pobočky. Tablet zůstává, stejně jako po kroku 8.
*/
select set_config('test.user_id', '', false);

delete from public.advances
 where employee_id in (:'adam', :'bara', :'cyril', :'dana', :'emil', :'filip', :'hugo');
delete from public.shifts
 where employee_id in (:'cyril', :'emil', :'filip', :'hugo');
delete from public.memberships
 where tenant_id = :'tenant'
   and user_id in ('57570000-0000-0000-0000-000000000001', '57570000-0000-0000-0000-000000000002',
                   '57570000-0000-0000-0000-000000000003', '57570000-0000-0000-0000-000000000004');
delete from public.employee_permissions where employee_id = :'ivan';
delete from public.employees
 where id in (:'juli', :'hana', :'ivan', :'adam', :'bara', :'cyril', :'dana',
              :'emil', :'filip', :'hugo', :'gustav', :'majitel57');
delete from public.position_permissions where position_id = :'z_obsluha';
delete from public.positions where id = :'z_obsluha';
delete from public.employees where id = :'cizinec';

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 57',
  not exists (select 1 from public.employees where full_name like '%Padesátsedm')
  and not exists (select 1 from public.shifts
                   where employee_id in (:'cyril', :'emil', :'filip', :'hugo'))
  and not exists (select 1 from public.positions where id = :'z_obsluha'));

\echo ''
\echo '== KROK 57 HOTOV ========================================'
