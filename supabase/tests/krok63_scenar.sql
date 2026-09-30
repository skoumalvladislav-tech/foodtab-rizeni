-- Scénář pro krok 63 — docházka jednoho člověka po dnech: úseky,
-- úprava a storno.
--
-- Pokrývá 20260927110000_dochazka_smeny_cloveka.sql: app.useky_dochazky,
-- public.useky_cloveka, public.vydelek_cloveka_po_dnech,
-- public.upravit_usek_dochazky, public.stornovat_usek_dochazky, spoušť
-- app.hlida_firmu_dochazky, opravenou spoušť app.rucni_dochazka_kdo
-- a odebraný UPDATE/DELETE na attendance_events.
--
-- Stojí na VLASTNÍCH dvou firmách (naše a cizí) a na datech předchozích
-- scénářů nezávisí — kromě GLOBÁLNÍ kontroly shody, která schválně
-- projde všechno, co v databázi je. Dá se pustit i samotný:
--   node scripts/scenare-pglite.mjs krok63_scenar
--
-- Měsíce jsou pevné a minulé (březen, červen, červenec 2026), takže
-- výsledek nezáleží na dni běhu. Jediné, co stojí na „teď": píchnutí
-- omylem a jeho storno (oddíl 5, to je smysl zadání) a odmítnutí zápisu
-- do budoucna (hodina před a po teď — platí v kteroukoli hodinu dne).
--
-- ---------------------------------------------------------------------
-- ODDÍLY
--
--  1. KONTROLA SHODY: úseky = app.worked_minutes po dni (páry, dvojí
--     příchod, osamělý odchod, přestávka, paušál na prahu / pod / před
--     platností, přebití pobočkou, přes půlnoc, dvě pobočky, dva úseky,
--     sekundy) a globálně pro všechny lidi a měsíce v databázi; měsíc
--     = earnings = vydelky_prehled = Σ vydelek_cloveka_po_dnech.
--  2. Čtení přes public RPC s právy: majitel (bez pobočky, celá
--     firma), vedoucí jen své pobočky (a protějšek), číšník jen sebe,
--     účetní bez docházky, cizí firma, člen dvou firem, pozastavené
--     členství, smazaný člověk, peníze jen s payroll.read; stornované
--     řádky po pobočce jako platné, příznak celého měsíce, hlavička
--     člověka bez pobočky.
--  3. Úprava: odchod, příchod, doplnění odchodu (příchod beze storna),
--     doplnění příchodu, nový úsek, přes půlnoc, sekundy.
--  4. Odmítnutí: pořadí, 24 h, budoucnost, jiný provozní den, překryv
--     (i na jiné pobočce, obejmutí, s otevřeným), přestávka mimo, nic
--     se nezměnilo, zastaralé id, nespárovaná dvojice, druh řádku
--     (druhý příchod, konec přestávky), bez práva na pobočce starého
--     i NOVÉHO konce, vedoucí sám sobě (majitel smí), cizí firma, cizí
--     i zrušená pobočka, přepárování. Počet řádků beze změny. Pořadí
--     řádků dne podle času.
-- 4b. Navazující úseky: nezměněný konec se smí dotýkat souseda, nový
--     čas ve stejné chvíli jako jiný záznam ne.
--  5. Storno: píchnutí omylem dnes (otevreny_prichod, muj_den, znovu
--     píchnout), úsek s přestávkami (mzda, Můj účet, zálohy beze
--     změny), dvojí příchod, osamělý odchod, přestávka mimo, právo na
--     pobočce každého stornovaného záznamu.
--  6. Pravidlo 11: pobočka v jiném pásmu, noc přes změnu času —
--     uložení a zobrazení zvlášť.
--  7. Kdo zapsal ruční záznam, zůstane i po stornu (nález a).
--  8. Granty (nález b: INSERT jen na sedmi sloupcích), stará
--     stornovat_dochazku bez EXECUTE (nález d), sloupec pod
--     authenticated, funkce.
--  9. Spoušť firmy (nález c).
--
-- POZOR NA PGLITE: funkce jsou SECURITY DEFINER a práva si ověřují
-- samy přes auth.uid() → test.user_id, takže kontroly práv tady měří
-- i v PGlite. Granty drží katalog (has_table_privilege…) a pokus
-- o přímý zápis pod `set role authenticated` (PGlite 0.5.8 granty pod
-- rolí vynucuje, viz krok56). SOUBĚH (zámek řádku zaměstnance) jedno
-- sezení neověří; hlídá se jen, že zámek ve funkci je, a cesta, kterou
-- souběh končí (zastaralé id → „Mezitím to někdo změnil").

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Příkaz musí spadnout a hláška musí obsahovat danou větu. Jiná chyba
-- (třeba překlep ve jménu sloupce) se za odmítnutí nepočítá.
create or replace function pg_temp.odmitne(p_sql text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  raise notice '    (NEODMÍTLO: %)', left(p_sql, 240);
  return false;
exception when others then
  if sqlerrm not like '%' || p_hlaska || '%' then
    raise notice '    (jiná hláška: %)', sqlerrm;
    return false;
  end if;
  return true;
end $$;

-- Příkaz musí projít. Když neprojde, vypíše proč (a kontrola spadne).
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '    (NEPROŠLO: %)', sqlerrm;
  return false;
end $$;

-- Jen chyba grantu, ne RLS (ta hlásí tentýž 42501 jinou větou).
create or replace function pg_temp.spadne_pravem(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when insufficient_privilege then
  return sqlerrm like 'permission denied%';
end $$;

-- Volání úpravy a storna jako text pro pg_temp.odmitne.
create or replace function pg_temp.uprava(
  p_tenant uuid, p_emp uuid, p_in uuid, p_out uuid,
  p_in_kdy text, p_in_pob uuid, p_out_kdy text, p_out_pob uuid, p_duvod text)
returns text language sql as $$
  select format(
    'select * from public.upravit_usek_dochazky(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L::timestamp, %L::uuid, %L::timestamp, %L::uuid, %L)',
    p_tenant, p_emp, p_in, p_out, p_in_kdy, p_in_pob, p_out_kdy, p_out_pob, p_duvod);
$$;

create or replace function pg_temp.storno(
  p_tenant uuid, p_emp uuid, p_in uuid, p_out uuid, p_duvod text)
returns text language sql as $$
  select format(
    'select * from public.stornovat_usek_dochazky(%L::uuid, %L::uuid, %L::uuid, %L::uuid, %L)',
    p_tenant, p_emp, p_in, p_out, p_duvod);
$$;

-- PGlite pouští všechny scénáře v jednom sezení a `reset role`
-- nevyprázdní test.user_id.
reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Majitel (…01) zakládá naši firmu — z app.create_tenant má
-- zaměstnanecký záznam BEZ pobočky a členství „celá firma". Cizí
-- majitel (…09) cizí firmu.
--
--   A  Praha, den od 5:00          vedoucí (…02): docházka čtení+správa
--   B  Praha, paušál 15 min od 4 h  béčková (…03): docházka + payroll.read
--   Z  America/New_York            nikdo (jen majitel)
--   C  cizí firma
--
-- Číšník (…04) nemá práva, je i členem cizí firmy. Účetní (…05) má jen
-- payroll.read za celou firmu. Karel (…06) si píchne omylem, Petr (…07)
-- je ten, komu se upravuje. Jana a Smazaný účet nemají.
-- Paušál firmy: 30 min od 6 h hrubé délky, platí od 10. 6. 2026.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('63630000-0000-0000-0000-000000000001', 'majitel63@foodtab.cz',  '{"full_name":"Majitel Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000002', 'vedouci63@foodtab.cz',  '{"full_name":"Vedoucí Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000003', 'beckova63@foodtab.cz',  '{"full_name":"Béčková Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000004', 'cisnik63@foodtab.cz',   '{"full_name":"Číšník Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000005', 'ucetni63@foodtab.cz',   '{"full_name":"Účetní Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000006', 'karel63@foodtab.cz',    '{"full_name":"Karel Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000007', 'petr63@foodtab.cz',     '{"full_name":"Petr Šedesáttři"}'),
  ('63630000-0000-0000-0000-000000000009', 'cizi63@jinafirma.cz',   '{"full_name":"Cizí Šedesáttři"}');

-- Bez uvozovek: psql je z příkazu set odstraní, pomocná vrstva PGlite ne.
\set u_majitel 63630000-0000-0000-0000-000000000001
\set u_vedouci 63630000-0000-0000-0000-000000000002
\set u_beckova 63630000-0000-0000-0000-000000000003
\set u_cisnik 63630000-0000-0000-0000-000000000004
\set u_ucetni 63630000-0000-0000-0000-000000000005
\set u_karel 63630000-0000-0000-0000-000000000006
\set u_petr 63630000-0000-0000-0000-000000000007
\set u_cizi 63630000-0000-0000-0000-000000000009

set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select app.create_tenant('Krok63 Docházka s.r.o.', 'Majitel Šedesáttři') as firma \gset
select set_config('test.user_id', :'u_cizi', false);
select app.create_tenant('Krok63 Cizí s.r.o.', 'Cizí Šedesáttři') as cizi_firma \gset
reset role;
select set_config('test.user_id', '', false);

insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok63 A', 'krok63-a') returning id as pob_a \gset
insert into public.branches (tenant_id, name, slug, prestavka_minut, prestavka_od_minut)
values (:'firma', 'Krok63 B', 'krok63-b', 15, 240) returning id as pob_b \gset
insert into public.branches (tenant_id, name, slug, timezone)
values (:'firma', 'Krok63 Z', 'krok63-z', 'America/New_York') returning id as pob_z \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Krok63 Cizí', 'krok63-cizi') returning id as pob_c \gset
-- Zrušená pobočka naší firmy (oddíl 4: nový úsek na ni neprojde).
insert into public.branches (tenant_id, name, slug, deleted_at)
values (:'firma', 'Krok63 Zrušená', 'krok63-zrusena', now()) returning id as pob_d \gset

insert into public.tenant_settings (tenant_id, prestavka_minut, prestavka_od_minut, prestavka_platna_od)
values (:'firma', 30, 360, '2026-06-10')
on conflict (tenant_id) do update
  set prestavka_minut     = excluded.prestavka_minut,
      prestavka_od_minut  = excluded.prestavka_od_minut,
      prestavka_platna_od = excluded.prestavka_platna_od;

select id as majitel      from public.employees where tenant_id = :'firma'      and je_majitel \gset
select id as cizi_majitel from public.employees where tenant_id = :'cizi_firma' and je_majitel \gset
select id as role_f from public.roles where tenant_id = :'firma'      and not is_owner order by key limit 1 \gset
select id as role_c from public.roles where tenant_id = :'cizi_firma' and not is_owner order by key limit 1 \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name) values
  (:'firma', :'pob_a', :'u_vedouci', 'Vedoucí Šedesáttři'),
  (:'firma', :'pob_b', :'u_beckova', 'Béčková Šedesáttři'),
  (:'firma', :'pob_a', :'u_cisnik',  'Číšník Šedesáttři'),
  (:'firma', :'pob_b', :'u_ucetni',  'Účetní Šedesáttři'),
  (:'firma', :'pob_a', :'u_karel',   'Karel Šedesáttři'),
  (:'firma', :'pob_a', :'u_petr',    'Petr Šedesáttři'),
  (:'firma', :'pob_a', null,         'Jana Šedesáttři'),
  (:'firma', :'pob_a', null,         'Smazaný Šedesáttři'),
  -- Nový: domovská pobočka A, zatím žádný záznam (dochazka_clovek).
  (:'firma', :'pob_a', null,         'Nový Šedesáttři'),
  -- Firemní: BEZ pobočky (jako majitel) a bez záznamu (dochazka_clovek).
  (:'firma', null,     null,         'Firemní Šedesáttři'),
  (:'cizi_firma', :'pob_c', null,    'Cizinec Šedesáttři');

select max(id::text) filter (where full_name = 'Vedoucí Šedesáttři')  as vedouci,
       max(id::text) filter (where full_name = 'Béčková Šedesáttři')  as beckova,
       max(id::text) filter (where full_name = 'Číšník Šedesáttři')   as cisnik,
       max(id::text) filter (where full_name = 'Účetní Šedesáttři')   as ucetni,
       max(id::text) filter (where full_name = 'Karel Šedesáttři')    as karel,
       max(id::text) filter (where full_name = 'Petr Šedesáttři')     as petr,
       max(id::text) filter (where full_name = 'Jana Šedesáttři')     as jana,
       max(id::text) filter (where full_name = 'Smazaný Šedesáttři')  as smazany,
       max(id::text) filter (where full_name = 'Nový Šedesáttři')     as novy,
       max(id::text) filter (where full_name = 'Firemní Šedesáttři')  as firemni,
       max(id::text) filter (where full_name = 'Cizinec Šedesáttři')  as cizinec
from public.employees where tenant_id in (:'firma', :'cizi_firma') \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma', :'u_vedouci', :'role_f', 'branch', 'active'),
  (:'firma', :'u_beckova', :'role_f', 'branch', 'active'),
  (:'firma', :'u_cisnik',  :'role_f', 'branch', 'active'),
  (:'firma', :'u_ucetni',  :'role_f', 'tenant', 'active'),
  (:'firma', :'u_karel',   :'role_f', 'branch', 'active'),
  (:'firma', :'u_petr',    :'role_f', 'branch', 'active'),
  -- Číšník je i v cizí firmě (oddíl 2: člen dvou firem).
  (:'cizi_firma', :'u_cisnik', :'role_c', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'u_beckova'::uuid then :'pob_b'::uuid else :'pob_a'::uuid end
  from public.memberships m
 where m.tenant_id = :'firma' and m.scope = 'branch';
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pob_c'::uuid
  from public.memberships m
 where m.tenant_id = :'cizi_firma' and m.user_id = :'u_cisnik'::uuid;

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'firma', :'vedouci', 'attendance.read',   true),
  (:'firma', :'vedouci', 'attendance.manage', true),
  (:'firma', :'beckova', 'attendance.read',   true),
  (:'firma', :'beckova', 'attendance.manage', true),
  (:'firma', :'beckova', 'payroll.read',      true),
  (:'firma', :'ucetni',  'payroll.read',      true);

insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from) values
  (:'firma', :'jana',    20000, '2026-01-01'),
  (:'firma', :'petr',    15000, '2026-01-01'),
  (:'firma', :'majitel', 30000, '2026-01-01');

/*
  JANA, ČERVEN 2026 — jeden den na jeden případ automatu. Provozní den
  dopočítá spoušť (Praha, od 5:00), odchod zdědí den příchodu.

    2. 6.  8–16                      480  před platností paušálu
   10. 6.  8–14 (přesně 6 h)         330  den platnosti, práh >=
   11. 6.  8–13:59:30                359  pod prahem (sekundy)
   12. 6.  8:00, 8:00 dvakrát, 16    450  druhý příchod se nepočítá
   13. 6.  odchod 7:00; 9–10          60  odchod bez příchodu
   14. 6.  8–17, přestávka 12–12:20  520  přestávka má přednost
   15. 6.  B 8–13                    285  pobočka přebíjí (15 od 4 h)
   16. 6.  20:00–2:30 (17. 6.)       360  přes půlnoc, den příchodu
   18. 6.  A 8 → B 12; B 13–18       525  dvě pobočky, paušál z příchodu
   19. 6.  jen příchod 8:00            0  otevřený
   20. 6.  8–12, konec přestávky 10  240  přestávka mimo
   21. 6.  9:00:00–9:00:20             0  20 s (den v mzdě s nulou)
   22. 6.  8:00:30–10:00:59          120  sekundy
   23. 6.  8–12, 13–17               480  paušál po úsecích, ne za den
                                   -----
                                    4209
*/
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-02 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-02 16:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-10 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-10 14:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-11 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-11 13:59:30+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-12 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-12 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-12 16:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-13 07:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-13 09:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-13 10:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-14 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'break_start', '2026-06-14 12:00+02'),
  (:'firma', :'pob_a', :'jana', 'break_end',   '2026-06-14 12:20+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-14 17:00+02'),
  (:'firma', :'pob_b', :'jana', 'in',          '2026-06-15 08:00+02'),
  (:'firma', :'pob_b', :'jana', 'out',         '2026-06-15 13:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-16 20:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-17 02:30+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-18 08:00+02'),
  (:'firma', :'pob_b', :'jana', 'out',         '2026-06-18 12:00+02'),
  (:'firma', :'pob_b', :'jana', 'in',          '2026-06-18 13:00+02'),
  (:'firma', :'pob_b', :'jana', 'out',         '2026-06-18 18:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-19 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-20 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'break_end',   '2026-06-20 10:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-20 12:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-21 09:00:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-21 09:00:20+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-22 08:00:30+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-22 10:00:59+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-23 08:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-23 12:00+02'),
  (:'firma', :'pob_a', :'jana', 'in',          '2026-06-23 13:00+02'),
  (:'firma', :'pob_a', :'jana', 'out',         '2026-06-23 17:00+02'),
  -- Majitel, číšník a smazaný: po jednom úseku (oddíl 2).
  (:'firma', :'pob_a', :'majitel', 'in',       '2026-06-05 08:00+02'),
  (:'firma', :'pob_a', :'majitel', 'out',      '2026-06-05 12:00+02'),
  (:'firma', :'pob_a', :'cisnik',  'in',       '2026-06-05 10:00+02'),
  (:'firma', :'pob_a', :'cisnik',  'out',      '2026-06-05 14:00+02'),
  (:'firma', :'pob_a', :'smazany', 'in',       '2026-06-05 08:00+02'),
  (:'firma', :'pob_a', :'smazany', 'out',      '2026-06-05 12:00+02'),
  (:'firma', :'pob_a', :'smazany', 'in',       '2026-06-06 08:00+02');

-- Smazanému se jeden záznam stornuje (ať je čím prozradit, že filtr
-- smazaných drží i na stornovaných řádcích), pak se smaže.
update public.attendance_events
   set stornovano_kdy = now(), duvod_storna = 'zkouška'
 where employee_id = :'smazany' and occurred_at = '2026-06-06 08:00+02';

-- Janin stornovaný záznam na pobočce B (24. 6.) — stornované řádky mají
-- stejnou viditelnost po pobočce jako platné (oddíl 2).
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, occurred_at, stornovano_kdy, duvod_storna)
values (:'firma', :'pob_b', :'jana', 'in', '2026-06-24 08:00+02', now(), 'tajné na B');


-- =====================================================================
\echo '== 1. KONTROLA SHODY: úseky = worked_minutes =================='
-- =====================================================================

select count(distinct den) as jana_dny, count(*) as jana_useku
  from app.useky_dochazky(:'jana', '2026-06-01', '2026-06-30') \gset

select pg_temp.check('Jana má v červnu 14 dnů s úseky (kontrola níž není naprázdno)', :jana_dny = 14);
select pg_temp.check('a 19 řádků automatu (úseky, otevřený, nezapočítané)', :jana_useku = 19);

select pg_temp.check('KONTROLA SHODY po dnech: floor(Σ čistých sekund / 60) = worked_minutes (Jana, červen)',
  not exists (
    select 1
    from app.worked_minutes(:'jana', '2026-06-01', '2026-06-30') w
    full join (select u.den,
                      floor(sum(u.cistych_sekund) / 60)::integer as minut,
                      sum(u.cistych_sekund) as s
                 from app.useky_dochazky(:'jana', '2026-06-01', '2026-06-30') u
                group by u.den) u on u.den = w.den
    where w.minut is distinct from u.minut
      and not (w.den is null and u.s = 0)));

select pg_temp.check('Jana za červen 4209 minut podle worked_minutes',
  (select sum(minut) from app.worked_minutes(:'jana', '2026-06-01', '2026-06-30')) = 4209);
select pg_temp.check('a 4209 i ze součtu úseků po dnech',
  (select sum(m) from (select floor(sum(cistych_sekund) / 60) as m
                         from app.useky_dochazky(:'jana', '2026-06-01', '2026-06-30')
                        group by den) x) = 4209);

-- Jednotlivé případy automatu, ať shoda nestojí jen na tom, že se obě
-- strany spletou stejně.
select pg_temp.check('2. 6. před platností: 8 h bez paušálu',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-02', '2026-06-02') u
           where u.druh = 'usek' and u.pausal_minut = 0 and u.cistych_sekund = 28800));
select pg_temp.check('10. 6. přesně na prahu 6 h: paušál 30 min (práh >=)',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-10', '2026-06-10') u
           where u.druh = 'usek' and u.pausal_minut = 30 and u.hrubych_sekund = 21600
             and u.cistych_sekund = 19800));
select pg_temp.check('11. 6. o půl minuty pod prahem: bez paušálu',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-11', '2026-06-11') u
           where u.druh = 'usek' and u.pausal_minut = 0 and u.cistych_sekund = 21570));
select pg_temp.check('12. 6. dvojí příchod: jeden úsek a jeden navíc',
  (select string_agg(u.druh, ',' order by u.druh) from app.useky_dochazky(:'jana', '2026-06-12', '2026-06-12') u)
    = 'navic_prichod,usek');
select pg_temp.check('13. 6. odchod bez příchodu je vidět a úsek zvlášť',
  (select string_agg(u.druh, ',' order by u.poradi) from app.useky_dochazky(:'jana', '2026-06-13', '2026-06-13') u)
    = 'odchod_bez_prichodu,usek');
select pg_temp.check('14. 6. zapsaná přestávka 20 min má přednost před paušálem',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-14', '2026-06-14') u
           where u.druh = 'usek' and u.prestavky_sekund = 1200 and u.pausal_minut = 0
             and u.cistych_sekund = 31200));
select pg_temp.check('15. 6. pobočka B přebíjí paušál: 15 min od 4 h',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-15', '2026-06-15') u
           where u.druh = 'usek' and u.pausal_minut = 15 and u.cistych_sekund = 17100));
select pg_temp.check('16. 6. noc přes půlnoc patří ke dni příchodu (odchod 17. 6.)',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-16', '2026-06-17') u
           where u.den = '2026-06-16' and u.druh = 'usek'
             and u.odchod = '2026-06-17 02:30+02' and u.cistych_sekund = 21600));
select pg_temp.check('18. 6. příchod v A, odchod v B: paušál podle pobočky příchodu',
  exists (select 1 from app.useky_dochazky(:'jana', '2026-06-18', '2026-06-18') u
           where u.druh = 'usek' and u.prichod_pobocka = :'pob_a' and u.odchod_pobocka = :'pob_b'
             and u.pausal_minut = 0 and u.cistych_sekund = 14400));
select pg_temp.check('19. 6. jen příchod: otevřený úsek, 0 s',
  (select string_agg(u.druh || ':' || u.cistych_sekund, ',') from app.useky_dochazky(:'jana', '2026-06-19', '2026-06-19') u)
    = 'otevreny:0');
select pg_temp.check('20. 6. konec přestávky bez začátku: přestávka mimo (v odchodu), úsek dál',
  (select string_agg(u.druh || ':' || (u.odchod_id is not null)::text, ',' order by u.poradi)
     from app.useky_dochazky(:'jana', '2026-06-20', '2026-06-20') u)
    = 'prestavka_mimo:true,usek:true');
select pg_temp.check('21. 6. 20 sekund: úsek s 0 minutami, mzda ten den vrací 0',
  (select w.minut from app.worked_minutes(:'jana', '2026-06-21', '2026-06-21') w) = 0);
select pg_temp.check('23. 6. dva čtyřhodinové úseky: paušál po úsecích, tedy žádný',
  (select count(*) from app.useky_dochazky(:'jana', '2026-06-23', '2026-06-23') u
    where u.druh = 'usek' and u.pausal_minut = 0 and u.cistych_sekund = 14400) = 2);

-- GLOBÁLNĚ: všechno, co v databázi scénářů je (i data ostatních kroků).
select pg_temp.check('KONTROLA SHODY globálně: všichni lidé a měsíce v databázi',
  not exists (
    with mesice as (
      select distinct a.employee_id, date_trunc('month', a.business_date)::date as m
        from public.attendance_events a
    ),
    w as (
      select me.employee_id, x.den, x.minut
        from mesice me
        cross join lateral app.worked_minutes(me.employee_id, me.m, app.konec_mesice(me.m)) x
    ),
    u as (
      select me.employee_id, y.den,
             floor(sum(y.cistych_sekund) / 60)::integer as minut,
             sum(y.cistych_sekund) as s
        from mesice me
        cross join lateral app.useky_dochazky(me.employee_id, me.m, app.konec_mesice(me.m)) y
       group by me.employee_id, y.den
    )
    select 1
      from w full join u on u.employee_id = w.employee_id and u.den = w.den
     where w.minut is distinct from u.minut
       and not (w.den is null and u.s = 0)));

select pg_temp.check('… a porovnává desítky dnů, ne prázdnou množinu',
  (select count(*)
     from (select distinct a.employee_id, date_trunc('month', a.business_date)::date as m
             from public.attendance_events a) me
     cross join lateral app.worked_minutes(me.employee_id, me.m, app.konec_mesice(me.m)) x) >= 14);

-- Měsíc: earnings = vydelky_prehled = Σ vydelek_cloveka_po_dnech = Σ den_minut.
select odpracovano_minut as jana_e_min, vydelano_haleru as jana_e_hal
  from app.earnings(:'jana', '2026-06-01') \gset

set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select coalesce(sum(dm), -1) as jana_uc_min
  from (select distinct den, den_minut as dm
          from public.useky_cloveka(:'firma', :'jana', '2026-06-17')) x \gset
select coalesce(sum(minut), -1) as jana_vd_min, coalesce(sum(haleru), -1) as jana_vd_hal, count(*) as jana_vd_dny
  from public.vydelek_cloveka_po_dnech(:'firma', :'jana', '2026-06-01') \gset
select odpracovano_minut as jana_vp_min, vydelano_haleru as jana_vp_hal
  from public.vydelky_prehled(:'firma', null, '2026-06-01') where employee_id = :'jana' \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('earnings: 4209 min a 14 030 Kč (200 Kč/h)', :jana_e_min = 4209 and :jana_e_hal = 1403000);
select pg_temp.check('Σ den_minut z useky_cloveka = earnings (p_mesic uprostřed měsíce)', :jana_uc_min = :jana_e_min);
select pg_temp.check('Σ vydelek_cloveka_po_dnech = earnings (minuty i haléře)',
  :jana_vd_min = :jana_e_min and :jana_vd_hal = :jana_e_hal);
select pg_temp.check('vydelky_prehled = earnings', :jana_vp_min = :jana_e_min and :jana_vp_hal = :jana_e_hal);
select pg_temp.check('po dnech 13 řádků = dny, které mzda počítá (bez otevřeného 19. 6.)', :jana_vd_dny = 13);


-- =====================================================================
\echo '== 2. Čtení s právy (public RPC pod authenticated) ============'
-- =====================================================================

set role authenticated;

-- Majitel: branch_id NULL, členství „celá firma" — vidí všechno.
select set_config('test.user_id', :'u_majitel', false);
select count(*) filter (where druh <> 'stornovano')                     as m_radky,
       count(*) filter (where den_minut is null)                        as m_bez_souctu,
       coalesce(bool_and(smi_spravovat) filter (where druh <> 'stornovano'), false)::text as m_smi,
       coalesce(bool_and(mesic_cely), false)::text                      as m_cely,
       count(*) filter (where druh = 'stornovano' and prichod_pobocka = :'pob_b') as m_storno_b
  from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as m_vlastni_penize from public.vydelek_cloveka_po_dnech(:'firma', :'majitel', '2026-06-01') \gset

-- Vedoucí A: jen pobočka A a protějšek (18. 6. příchod A → odchod B).
select set_config('test.user_id', :'u_vedouci', false);
select count(*)                                                                    as v_radky,
       count(*) filter (where den = '2026-06-15')                                  as v_1506,
       count(*) filter (where den = '2026-06-18')                                  as v_1806,
       coalesce(bool_or(den_minut is not null) filter (where den = '2026-06-18'), false)::text as v_1806_soucet,
       coalesce(max(den_minut) filter (where den = '2026-06-02'), -1)              as v_0206,
       coalesce(bool_or(smi_spravovat) filter (where den = '2026-06-18'), false)::text as v_1806_smi,
       coalesce(bool_and(smi_spravovat) filter (where den = '2026-06-02'), false)::text as v_0206_smi,
       coalesce(bool_or(mesic_cely), true)::text                                   as v_cely,
       count(*) filter (where druh = 'stornovano' and prichod_pobocka = :'pob_b')  as v_storno_b
  from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as v_penize from public.vydelek_cloveka_po_dnech(:'firma', :'jana', '2026-06-01') \gset
-- Číšník pracoval v červnu jen na A: vedoucí A vidí celý jeho měsíc.
select count(*) as v_cisnik_radky, coalesce(bool_and(mesic_cely), false)::text as v_cisnik_cely
  from public.useky_cloveka(:'firma', :'cisnik', '2026-06-01') \gset

-- Béčková (B, payroll.read jen na B).
select set_config('test.user_id', :'u_beckova', false);
select count(*) filter (where druh <> 'stornovano')                 as b_radky,
       count(*) filter (where smi_spravovat)                        as b_smi,
       coalesce(max(den_minut) filter (where den = '2026-06-15'), -1) as b_1506,
       count(*) filter (where den = '2026-06-18' and den_minut is null) as b_1806_bez,
       coalesce(bool_or(mesic_cely), true)::text                    as b_cely,
       count(*) filter (where druh = 'stornovano' and prichod_pobocka = :'pob_b'
                          and duvod_storna = 'tajné na B')          as b_storno_b
  from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as b_penize_jana    from public.vydelek_cloveka_po_dnech(:'firma', :'jana', '2026-06-01') \gset
select count(*) as b_penize_majitel from public.vydelek_cloveka_po_dnech(:'firma', :'majitel', '2026-06-01') \gset

-- Číšník bez práv: cizí nic, svoje ano.
select set_config('test.user_id', :'u_cisnik', false);
select count(*) as c_jana from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as c_sam, coalesce(bool_or(smi_spravovat), false)::text as c_smi
  from public.useky_cloveka(:'firma', :'cisnik', '2026-06-01') \gset
-- Člen dvou firem: vlastní záznam z naší firmy pod cizí firmou nic.
select count(*) as c_pod_cizi from public.useky_cloveka(:'cizi_firma', :'cisnik', '2026-06-01') \gset

-- Účetní: peníze ano, úseky ne (otázka 30).
select set_config('test.user_id', :'u_ucetni', false);
select count(*) as u_useky from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as u_penize, coalesce(sum(haleru), -1) as u_penize_hal
  from public.vydelek_cloveka_po_dnech(:'firma', :'jana', '2026-06-01') \gset
select count(*) as u_penize_majitel from public.vydelek_cloveka_po_dnech(:'firma', :'majitel', '2026-06-01') \gset

-- Cizí majitel: pod naší firmou nic, pod svou firmou s naším člověkem nic.
select set_config('test.user_id', :'u_cizi', false);
select count(*) as x_nase     from public.useky_cloveka(:'firma', :'jana', '2026-06-01') \gset
select count(*) as x_pod_svou from public.useky_cloveka(:'cizi_firma', :'jana', '2026-06-01') \gset
select count(*) as x_penize   from public.vydelek_cloveka_po_dnech(:'cizi_firma', :'majitel', '2026-06-01') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('majitel (bez pobočky) vidí všech 19 řádků automatu', :m_radky = 19 and :m_radky = :jana_useku);
select pg_temp.check('majitel má součet u každého dne', :m_bez_souctu = 0);
select pg_temp.check('majitel smí spravovat všechno', :'m_smi' = 'true');
select pg_temp.check('majitel vidí vlastní peníze po dnech (payroll.read za firmu)', :m_vlastni_penize = 1);
select pg_temp.check('majitel: celý měsíc (mesic_cely)', :'m_cely' = 'true');
select pg_temp.check('majitel: stornovaný záznam Jany z B vidí', :m_storno_b = 1);

select pg_temp.check('vedoucí A: 17 řádků — bez 15. 6. (celý B) a bez úseku B→B 18. 6.', :v_radky = 17);
select pg_temp.check('vedoucí A: 15. 6. nevidí', :v_1506 = 0);
select pg_temp.check('vedoucí A: 18. 6. vidí jen úsek A→B (protějšek)', :v_1806 = 1);
select pg_temp.check('vedoucí A: 18. 6. bez součtu dne (celý den nevidí)', :'v_1806_soucet' = 'false');
select pg_temp.check('vedoucí A: 2. 6. součet 480', :v_0206 = 480);
select pg_temp.check('vedoucí A: úsek A→B upravit nesmí (správa jen A)', :'v_1806_smi' = 'false');
select pg_temp.check('vedoucí A: úsek na A upravit smí', :'v_0206_smi' = 'true');
select pg_temp.check('vedoucí A bez payroll.read: peníze nic', :v_penize = 0);
select pg_temp.check('vedoucí A: Janin měsíc NENÍ celý (15. 6. a část 18. 6. na B) — karta nesmí psát „jako mzda"',
  :'v_cely' = 'false');
select pg_temp.check('vedoucí A: číšníkův měsíc (jen A) celý je — příznak něco měří', :v_cisnik_radky = 1 and :'v_cisnik_cely' = 'true');
select pg_temp.check('vedoucí A: stornovaný záznam Jany z B nevidí (stornované po pobočce jako platné)', :v_storno_b = 0);

select pg_temp.check('béčková: 3 řádky (15. 6. a oba úseky 18. 6.)', :b_radky = 3);
select pg_temp.check('béčková: stornovaný záznam Jany z B vidí i s důvodem', :b_storno_b = 1);
select pg_temp.check('béčková: ani její pohled na Janin měsíc není celý', :'b_cely' = 'false');
select pg_temp.check('béčková: spravovat smí 15. 6. a B→B, ne A→B', :b_smi = 2);
select pg_temp.check('béčková: 15. 6. vidí celý → součet 285', :b_1506 = 285);
select pg_temp.check('béčková: 18. 6. bez součtu (příchod v A nevidí)', :b_1806_bez = 2);
select pg_temp.check('béčková (payroll jen B): peníze Jany z A nic', :b_penize_jana = 0);
select pg_temp.check('béčková: peníze majitele (bez pobočky) nic', :b_penize_majitel = 0);

select pg_temp.check('číšník: Janu nevidí', :c_jana = 0);
select pg_temp.check('číšník: sebe vidí', :c_sam = 1);
select pg_temp.check('číšník: sám sobě upravovat nesmí', :'c_smi' = 'false');
select pg_temp.check('člen dvou firem: vlastní záznam pod cizí firmou nic (e.tenant_id)', :c_pod_cizi = 0);

select pg_temp.check('účetní (jen payroll.read): úseky nic', :u_useky = 0);
select pg_temp.check('účetní: peníze po dnech ano, součet = earnings', :u_penize = 13 and :u_penize_hal = :jana_e_hal);
select pg_temp.check('účetní: peníze majitele ano (payroll.read za firmu)', :u_penize_majitel = 1);

select pg_temp.check('cizí majitel pod naší firmou nic', :x_nase = 0);
select pg_temp.check('cizí majitel pod svou firmou s naším člověkem nic', :x_pod_svou = 0);
select pg_temp.check('cizí majitel pod svou firmou peníze našeho majitele nic (e.tenant_id)', :x_penize = 0);

-- Pozastavené členství: ani vlastní úseky.
update public.memberships set status = 'suspended' where tenant_id = :'firma' and user_id = :'u_cisnik';
set role authenticated;
select set_config('test.user_id', :'u_cisnik', false);
select count(*) as c_pozastaven from public.useky_cloveka(:'firma', :'cisnik', '2026-06-01') \gset
reset role;
select set_config('test.user_id', '', false);
update public.memberships set status = 'active' where tenant_id = :'firma' and user_id = :'u_cisnik';
select pg_temp.check('pozastavené členství: ani vlastní úseky (modul_zapnuty)', :c_pozastaven = 0);

-- Smazaný člověk: nic, ani stornovaný řádek.
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select count(*) as s_pred, count(*) filter (where druh = 'stornovano') as s_pred_storno
  from public.useky_cloveka(:'firma', :'smazany', '2026-06-01') \gset
reset role;
select set_config('test.user_id', '', false);
update public.employees set deleted_at = now() where id = :'smazany';
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select count(*) as s_po from public.useky_cloveka(:'firma', :'smazany', '2026-06-01') \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('před smazáním majitel vidí úsek i stornovaný řádek', :s_pred = 2 and :s_pred_storno = 1);
select pg_temp.check('smazaný člověk: nic, ani stornované (e.deleted_at)', :s_po = 0);

-- Kdo to je (hlavička obrazovky, public.dochazka_clovek): týž okruh
-- jako úseky, ne politika employees_select (ta chce shifts.read).
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select count(*) as dc_m_jana, coalesce(max(full_name), '') as dc_m_jmeno,
       coalesce(bool_or(je_sam), true)::text as dc_m_sam
  from public.dochazka_clovek(:'firma', :'jana') \gset
select count(*) as dc_m_smazany from public.dochazka_clovek(:'firma', :'smazany') \gset
select count(*) as dc_m_firemni from public.dochazka_clovek(:'firma', :'firemni') \gset
select set_config('test.user_id', :'u_vedouci', false);
select count(*) as dc_v_novy from public.dochazka_clovek(:'firma', :'novy') \gset
select count(*) as dc_v_firemni from public.dochazka_clovek(:'firma', :'firemni') \gset
select count(*) as dc_v_majitel from public.dochazka_clovek(:'firma', :'majitel') \gset
select set_config('test.user_id', :'u_beckova', false);
select count(*) as dc_b_jana from public.dochazka_clovek(:'firma', :'jana') \gset
select count(*) as dc_b_novy from public.dochazka_clovek(:'firma', :'novy') \gset
select count(*) as dc_b_majitel from public.dochazka_clovek(:'firma', :'majitel') \gset
select set_config('test.user_id', :'u_cisnik', false);
select count(*) as dc_c_jana from public.dochazka_clovek(:'firma', :'jana') \gset
select count(*) as dc_c_sam, coalesce(bool_or(je_sam), false)::text as dc_c_je_sam
  from public.dochazka_clovek(:'firma', :'cisnik') \gset
select set_config('test.user_id', :'u_cizi', false);
select count(*) as dc_x_nas      from public.dochazka_clovek(:'firma', :'jana') \gset
select count(*) as dc_x_pod_svou from public.dochazka_clovek(:'cizi_firma', :'majitel') \gset
reset role;
select set_config('test.user_id', '', false);
update public.memberships set status = 'suspended' where tenant_id = :'firma' and user_id = :'u_cisnik';
set role authenticated;
select set_config('test.user_id', :'u_cisnik', false);
select count(*) as dc_c_pozastaven from public.dochazka_clovek(:'firma', :'cisnik') \gset
reset role;
select set_config('test.user_id', '', false);
update public.memberships set status = 'active' where tenant_id = :'firma' and user_id = :'u_cisnik';

select pg_temp.check('kdo to je: majitel vidí Janu jménem, není to on sám',
  :dc_m_jana = 1 and :'dc_m_jmeno' = 'Jana Šedesáttři' and :'dc_m_sam' = 'false');
select pg_temp.check('kdo to je: smazaného ani majitel (e.deleted_at)', :dc_m_smazany = 0);
select pg_temp.check('kdo to je: vedoucí A vidí nováčka z A bez jediného záznamu (domovská pobočka)', :dc_v_novy = 1);
select pg_temp.check('kdo to je: vedoucí B vidí Janu z A, protože pracovala i na B', :dc_b_jana = 1);
select pg_temp.check('kdo to je: vedoucí B nováčka z A nevidí', :dc_b_novy = 0);
-- Člověk BEZ pobočky (majitel, „celá firma"): domovská pobočka mu
-- nechybí jako „všechny" — jen docházka na úrovni firmy nebo záznam
-- na pobočce, kterou volající čte.
select pg_temp.check('kdo to je: majitel vidí člověka bez pobočky (docházka za firmu)', :dc_m_firemni = 1);
select pg_temp.check('kdo to je: vedoucí A člověka bez pobočky a bez záznamu nevidí', :dc_v_firemni = 0);
select pg_temp.check('kdo to je: vedoucí B majitele (bez pobočky, na B nic) nevidí', :dc_b_majitel = 0);
select pg_temp.check('kdo to je: vedoucí A majitele vidí — pracoval 5. 6. na A', :dc_v_majitel = 1);
select pg_temp.check('kdo to je: číšník Janu nevidí', :dc_c_jana = 0);
select pg_temp.check('kdo to je: číšník sebe ano, je_sam', :dc_c_sam = 1 and :'dc_c_je_sam' = 'true');
select pg_temp.check('kdo to je: pozastavené členství ani sebe (modul_zapnuty)', :dc_c_pozastaven = 0);
select pg_temp.check('kdo to je: cizí majitel pod naší firmou nic', :dc_x_nas = 0);
select pg_temp.check('kdo to je: cizí majitel pod svou firmou našeho majitele nic (e.tenant_id)', :dc_x_pod_svou = 0);


-- =====================================================================
\echo '== 3. Úprava úseku ==========================================='
-- =====================================================================

/*
  PETR, ČERVENEC 2026, pobočka A, píchnutí kódem (source 'app').
  Upravuje vedoucí A. Paušál 30 min od 6 h platí.

  POZOR NA DĚDĚNÍ DNE: odchod zdědí provozní den POSLEDNÍHO platného
  záznamu před ním, pokud to není odchod (spoušť set_business_date).
  Osamělý odchod 9. 7. proto nesmí stát hned za otevřeným příchodem —
  zavřel by ho, i kdyby byl o den dřív (napoprvé tu otevřený příchod
  stál 8. 7. a „osamělý" odchod 9. 7. se s ním spároval). Otevřený
  příchod P3 je proto až 16. 7., za všemi ostatními.
*/
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-06 08:00+02') returning id as p1_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-06 16:00+02') returning id as p1_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-07 08:00+02') returning id as p2_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-07 16:00+02') returning id as p2_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-16 08:00+02') returning id as p3_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-09 16:00+02') returning id as p4_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-11 22:00+02') returning id as p6_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-12 03:00+02') returning id as p6_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-15 08:00:37+02') returning id as p8_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-15 16:00:12+02') returning id as p8_out \gset

select pg_temp.check('přes půlnoc: odchod 12. 7. 3:00 zdědil provozní den 11. 7.',
  (select business_date from public.attendance_events where id = :'p6_out') = '2026-07-11');

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);

-- P1: odchod 16:00 → 17:00, příchod zůstává (posílá se týž čas).
select prichod_id as p1_in_po, odchod_id as p1_out_po, den as p1_den, minut_pred as p1_pred, minut_po as p1_po
  from public.upravit_usek_dochazky(:'firma', :'petr', :'p1_in', :'p1_out',
         '2026-07-06 08:00', null, '2026-07-06 17:00', null, 'zapomněl se odpíchnout') \gset

-- P2: příchod 8:00 → 7:30, odchod zůstává.
select prichod_id as p2_in_po, odchod_id as p2_out_po, minut_po as p2_po
  from public.upravit_usek_dochazky(:'firma', :'petr', :'p2_in', :'p2_out',
         '2026-07-07 07:30', null, '2026-07-07 16:00', null, 'přišel dřív') \gset

-- P3: doplnit odchod k otevřenému příchodu. Příchod se NEstornuje.
select prichod_id as p3_in_po, coalesce(odchod_id::text, '') as p3_out_po, minut_pred as p3_pred, minut_po as p3_po
  from public.upravit_usek_dochazky(:'firma', :'petr', :'p3_in', null,
         null, null, '2026-07-16 15:00', :'pob_a', 'zapomněl odejít') \gset

-- P4: doplnit příchod k osamělému odchodu.
select prichod_id as p4_in_po, odchod_id as p4_out_po, minut_po as p4_po
  from public.upravit_usek_dochazky(:'firma', :'petr', null, :'p4_out',
         '2026-07-09 09:00', :'pob_a', null, null, 'nepíchl si příchod') \gset

-- P5: celý nový úsek do prázdného dne.
select prichod_id as p5_in, odchod_id as p5_out, den as p5_den, minut_pred as p5_pred, minut_po as p5_po
  from public.upravit_usek_dochazky(:'firma', :'petr', null, null,
         '2026-07-10 10:00', :'pob_a', '2026-07-10 14:00', :'pob_a', 'zapomněl telefon') \gset

-- P6: noc — odchod 3:00 → 4:00 (12. 7.), úsek zůstává v 11. 7.
select odchod_id as p6_out_po, den as p6_den, minut_pred as p6_pred, minut_po as p6_po
  from public.upravit_usek_dochazky(:'firma', :'petr', :'p6_in', :'p6_out',
         '2026-07-11 22:00', null, '2026-07-12 04:00', null, 'odešel později') \gset

-- P7: nový úsek přes půlnoc.
select odchod_id as p7_out, den as p7_den, minut_po as p7_po
  from public.upravit_usek_dochazky(:'firma', :'petr', null, null,
         '2026-07-13 21:00', :'pob_a', '2026-07-14 01:30', :'pob_a', 'noční inventura') \gset

-- P8: příchod 8:00:37 poslaný jako „08:00" = beze změny (sekundy
-- formulář neposílá); mění se jen odchod.
select prichod_id as p8_in_po, odchod_id as p8_out_po
  from public.upravit_usek_dochazky(:'firma', :'petr', :'p8_in', :'p8_out',
         '2026-07-15 08:00', null, '2026-07-15 17:00', null, 'přesčas') \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('P1: příchod zůstal týž záznam', :'p1_in_po' = :'p1_in');
select pg_temp.check('P1: odchod je nový záznam', :'p1_out_po' <> :'p1_out');
select pg_temp.check('P1: den 6. 7., minuty 450 → 510', :'p1_den' = '2026-07-06' and :p1_pred = 450 and :p1_po = 510);
select pg_temp.check('P1: starý odchod stornovaný vedoucím s předponou „Oprava úseku:"',
  exists (select 1 from public.attendance_events
           where id = :'p1_out' and stornovano_kdy is not null
             and stornoval = :'u_vedouci'
             and duvod_storna = 'Oprava úseku: zapomněl se odpíchnout'));
select pg_temp.check('P1: příchod NEstornovaný',
  (select stornovano_kdy is null from public.attendance_events where id = :'p1_in'));
select pg_temp.check('P1: nový odchod — ruční, nahrazuje starý, zapsal vedoucí, důvod v poznámce, 17:00 Praha, den 6. 7.',
  exists (select 1 from public.attendance_events
           where id = :'p1_out_po' and source = 'manual' and kind = 'out'
             and nahrazuje = :'p1_out' and entered_by = :'u_vedouci'
             and note = 'zapomněl se odpíchnout'
             and occurred_at = '2026-07-06 17:00+02' and business_date = '2026-07-06'));
select pg_temp.check('P1: jeden souhrnný audit s minutami před a po, od vedoucího',
  (select count(*) from public.audit_log
    where action = 'attendance.usek_upraven' and entity_id = :'petr'
      and actor_id = :'u_vedouci'
      and (before ->> 'minut_dne')::int = 450 and (after ->> 'minut_dne')::int = 510
      and after ->> 'duvod' = 'zapomněl se odpíchnout') = 1);

select pg_temp.check('P2: starý příchod stornovaný, odchod zůstal, 7:30–16:00 = 480',
  (select stornovano_kdy is not null from public.attendance_events where id = :'p2_in')
  and :'p2_out_po' = :'p2_out'
  and (select stornovano_kdy is null from public.attendance_events where id = :'p2_out')
  and (select nahrazuje from public.attendance_events where id = :'p2_in_po') = :'p2_in'
  and :p2_po = 480);

select pg_temp.check('P3: doplněný odchod — příchod beze storna, minuty 0 → 390',
  :'p3_in_po' = :'p3_in' and :'p3_out_po' <> ''
  and (select stornovano_kdy is null from public.attendance_events where id = :'p3_in')
  and (select nahrazuje is null and source = 'manual' from public.attendance_events where id = :'p3_out_po')
  and :p3_pred = 0 and :p3_po = 390);

select pg_temp.check('P4: doplněný příchod — odchod beze storna, 9–16 = 390',
  :'p4_out_po' = :'p4_out'
  and (select stornovano_kdy is null from public.attendance_events where id = :'p4_out')
  and (select source = 'manual' and business_date = '2026-07-09' from public.attendance_events where id = :'p4_in_po')
  and :p4_po = 390);

select pg_temp.check('P5: nový úsek 10–14 v prázdném dni, 0 → 240',
  :'p5_den' = '2026-07-10' and :p5_pred = 0 and :p5_po = 240
  and (select count(*) from public.attendance_events
        where id in (:'p5_in', :'p5_out') and source = 'manual' and nahrazuje is null) = 2);

select pg_temp.check('P6: noc — nový odchod 12. 7. 4:00 v provozním dni 11. 7., 300 → 330',
  :'p6_den' = '2026-07-11' and :p6_pred = 300 and :p6_po = 330
  and (select business_date from public.attendance_events where id = :'p6_out_po') = '2026-07-11');

select pg_temp.check('P7: nový úsek 21:00–1:30 patří dni 13. 7. (odchod zdědil den), 270 min',
  :'p7_den' = '2026-07-13' and :p7_po = 270
  and (select business_date from public.attendance_events where id = :'p7_out') = '2026-07-13');

select pg_temp.check('P8: příchod 8:00:37 poslaný jako 08:00 zůstal i se sekundami',
  :'p8_in_po' = :'p8_in'
  and (select stornovano_kdy is null from public.attendance_events where id = :'p8_in'));

-- Co z toho uvidí obrazovka (majitel).
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select count(*) filter (where druh = 'usek' and odchod_id = :'p1_out_po'
                          and odchod_nahrazuje = :'p1_out' and odchod_zdroj = 'rucne'
                          and odchod_zadal = 'Vedoucí Šedesáttři'
                          and odchod_poznamka = 'zapomněl se odpíchnout'
                          and prichod_zdroj = 'kod') as o_usek,
       count(*) filter (where druh = 'stornovano' and odchod_id = :'p1_out'
                          and odchod_zdroj = 'kod' and udalost_druh = 'out'
                          and stornoval_jmeno = 'Vedoucí Šedesáttři'
                          and duvod_storna = 'Oprava úseku: zapomněl se odpíchnout'
                          and nahrazeno) as o_storno,
       coalesce(max(den_minut), -1) as o_minut
  from public.useky_cloveka(:'firma', :'petr', '2026-07-01')
 where den = '2026-07-06' \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('obrazovka: nový odchod „ručně · Vedoucí: důvod", nahrazuje starý, příchod „kód"', :o_usek = 1);
select pg_temp.check('obrazovka: starý odchod přeškrtnutý — kdo, proč, nahrazeno', :o_storno = 1);
select pg_temp.check('obrazovka: součet dne 510', :o_minut = 510);


-- =====================================================================
\echo '== 4. Odmítnutí — nic se nezapíše ============================'
-- =====================================================================

insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-20 08:00+02') returning id as r_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-20 16:00+02') returning id as r_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-21 08:00+02') returning id as s1_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-21 12:00+02') returning id as s1_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_b', :'petr', 'in',  '2026-07-21 13:00+02') returning id as s2_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_b', :'petr', 'out', '2026-07-21 17:00+02') returning id as s2_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-22 08:00+02') returning id as o_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-23 08:00+02') returning id as b_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'petr', 'break_start', '2026-07-23 12:00+02'),
  (:'firma', :'pob_a', :'petr', 'break_end',   '2026-07-23 12:30+02');
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-23 16:00+02') returning id as b_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'vedouci', 'in',  '2026-07-24 08:00+02') returning id as v_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'vedouci', 'out', '2026-07-24 16:00+02') returning id as v_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'majitel', 'in',  '2026-07-24 09:00+02') returning id as m_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'majitel', 'out', '2026-07-24 17:00+02') returning id as m_out \gset
-- Dvojí příchod (7:30 a 7:40) a jeden odchod.
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-25 07:30+02') returning id as d_in1 \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-25 07:40+02') returning id as d_in2 \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-25 16:38+02') returning id as d_out \gset

-- Hodina před a po „teď" na zdi v Praze — odmítnutí zápisu do budoucna.
select to_char((now() - interval '1 hour') at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as bud_od,
       to_char((now() + interval '1 hour') at time zone 'Europe/Prague', 'YYYY-MM-DD HH24:MI') as bud_do \gset

-- Cizí záznamy: Janin úsek 2. 6. a úsek smazaného 5. 6.
select max(id::text) filter (where kind = 'in')  as j_in,
       max(id::text) filter (where kind = 'out') as j_out
  from public.attendance_events where employee_id = :'jana' and business_date = '2026-06-02' \gset
select max(id::text) filter (where kind = 'in')  as sm_in,
       max(id::text) filter (where kind = 'out') as sm_out
  from public.attendance_events where employee_id = :'smazany' and business_date = '2026-06-05' \gset
-- Janin otevřený příchod 19. 6. (A) a konec přestávky mimo úsek 20. 6.
select max(id::text) filter (where business_date = '2026-06-19' and kind = 'in')        as j19_in,
       max(id::text) filter (where business_date = '2026-06-20' and kind = 'break_end') as j20_be
  from public.attendance_events where employee_id = :'jana' and stornovano_kdy is null \gset

select count(*) as pocet_pred,
       count(*) filter (where stornovano_kdy is not null) as storno_pred,
       (select count(*) from public.audit_log where action like 'attendance.%') as audit_pred
  from public.attendance_events \gset

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);

select pg_temp.check('odchod dřív než příchod → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 07:00', null, 'špatný odchod'), 'musí být až po příchodu'));
select pg_temp.check('úsek delší než 24 h → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-21 09:00', null, 'dlouhá směna'), 'déle než 24 hodin'));
select pg_temp.check('zápis do budoucna → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    :'bud_od', :'pob_a', :'bud_do', :'pob_a', 'ještě nebylo'), 'nezapisuje dopředu'));
select pg_temp.check('příchod 4:30 by patřil do provozního dne 19. 7. → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 04:30', null, '2026-07-20 16:00', null, 'přišel brzy'), 'by patřil do provozního dne 19. 7.'));
select pg_temp.check('překryv se záznamem na JINÉ pobočce (příchod v B 13:00) → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'s1_in', :'s1_out',
    '2026-07-21 08:00', null, '2026-07-21 14:00', null, 'odešel později'), 'jiným záznamem (příchod v 21. 7. 13:00)'));
select pg_temp.check('nový úsek uvnitř jiného úseku (bez záznamu uvnitř) → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    '2026-07-21 09:00', :'pob_a', '2026-07-21 11:00', :'pob_a', 'uvnitř'), 'překrýval s úsekem 21. 7. 08:00'));
select pg_temp.check('překryv s otevřeným úsekem téhož dne → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    '2026-07-22 10:00', :'pob_a', '2026-07-22 12:00', :'pob_a', 'vedle otevřeného'), 'otevřeným úsekem od 22. 7. 08:00'));
select pg_temp.check('přestávka by ležela mimo úsek → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'b_in', :'b_out',
    '2026-07-23 08:00', null, '2026-07-23 11:00', null, 'odešel dřív'), 'Přestávka v 23. 7. 12:00'));
select pg_temp.check('nic se nezměnilo → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 16:00', null, 'nic'), 'Nic se nezměnilo'));
select pg_temp.check('zastaralé id (odchod už nahrazený) → „Mezitím to někdo změnil"',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'p1_in', :'p1_out',
    '2026-07-06 08:00', null, '2026-07-06 18:00', null, 'znovu'), 'Mezitím to někdo změnil'));
select pg_temp.check('nespárovaná dvojice (příchod 20. 7., odchod 7. 7.) → „Mezitím"',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'p2_out',
    '2026-07-20 08:00', null, '2026-07-07 17:00', null, 'mix'), 'Mezitím to někdo změnil'));
select pg_temp.check('vedoucí A mění odchod na pobočce B → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'s2_in', :'s2_out',
    '2026-07-21 13:00', null, '2026-07-21 17:30', null, 'cizí pobočka'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('vedoucí A přesouvá příchod na pobočku B → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', :'pob_b', null, null, 'jiná pobočka'), 'kdo ji na té pobočce spravuje'));
-- Obráceně: ze spravované pobočky smí, ZE spravované ne. Stornuje se
-- totiž i starý záznam na B, a na ten vedoucí A právo nemá.
select pg_temp.check('vedoucí A přesune odchod z pobočky B na A → odmítnuto (starý záznam je na B)',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'s2_in', :'s2_out',
    '2026-07-21 13:00', null, '2026-07-21 17:00', :'pob_a', 'odešel z A'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('vedoucí A přesune příchod z pobočky B na A → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'s2_in', :'s2_out',
    '2026-07-21 13:00', :'pob_a', '2026-07-21 17:00', null, 'přišel do A'), 'kdo ji na té pobočce spravuje'));
-- Právo na pobočce NOVÉHO odchodu (starý odchod je na A, ten vedoucí
-- spravuje — drží to jen kontrola nového konce).
select pg_temp.check('vedoucí A přesune odchod z A na pobočku B → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 16:00', :'pob_b', 'odešel z B'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('vedoucí A zapíše nový úsek s odchodem na B → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    '2026-07-19 08:00', :'pob_a', '2026-07-19 12:00', :'pob_b', 'výpomoc'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('vedoucí A doplní Janě k otevřenému příchodu (A) odchod na B → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'jana', :'j19_in', null,
    null, null, '2026-06-19 16:00', :'pob_b', 'odešla z B'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('vedoucí sám sobě → odmítnuto (otázka 25)',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'vedouci', :'v_in', :'v_out',
    '2026-07-24 08:00', null, '2026-07-24 17:00', null, 'přesčas'), 'Vlastní docházku si upravit nemůžete'));
select pg_temp.check('přepárování: příchod za druhý příchod dne → odmítnuto po zápisu',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'d_in1', :'d_out',
    '2026-07-25 07:45', null, null, null, 'posun příchodu'), 'nespároval sám se sebou'));
-- Úsek sám se spáruje správně, ale druhý příchod dne by z „navíc"
-- zůstal otevřený — hlídá to druhá půlka kontroly po zápisu.
select pg_temp.check('odchod posunutý před druhý příchod: ten by zůstal otevřený → odmítnuto po zápisu',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'d_in1', :'d_out',
    '2026-07-25 07:30', null, '2026-07-25 07:35', null, 'krátký úsek'), 'změnila párování jiných záznamů'));
select pg_temp.check('důvod kratší než tři znaky → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 17:00', null, 'ab'), 'Aspoň tři znaky'));
select pg_temp.check('nový úsek bez odchodu → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    '2026-07-10 18:00', :'pob_a', null, null, 'jen příchod'), 'Vyplňte čas odchodu'));

select set_config('test.user_id', :'u_beckova', false);
select pg_temp.check('vedoucí B mění úsek na pobočce A → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 17:00', null, 'cizí pobočka'), 'kdo ji na té pobočce spravuje'));

select set_config('test.user_id', :'u_cizi', false);
select pg_temp.check('cizí majitel pod naší firmou → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 17:00', null, 'cizí firma'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('cizí majitel pod SVOU firmou s naším člověkem → „Takový zaměstnanec… není" (e.tenant_id)',
  pg_temp.odmitne(pg_temp.uprava(:'cizi_firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', null, '2026-07-20 17:00', null, 'cizí firma'), 'Takový zaměstnanec v téhle firmě není'));

select set_config('test.user_id', :'u_majitel', false);
select pg_temp.check('majitel přesouvá příchod na pobočku CIZÍ firmy → odmítnuto',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'r_in', :'r_out',
    '2026-07-20 08:00', :'pob_c', null, null, 'cizí pobočka'), 'Pobočka v téhle firmě není'));
select pg_temp.check('záznam JINÉHO člověka (Janin úsek) pod Petrem → „Mezitím"',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'j_in', :'j_out',
    '2026-06-02 08:00', null, '2026-06-02 17:00', null, 'cizí záznam'), 'Mezitím to někdo změnil'));
select pg_temp.check('nový úsek na ZRUŠENÉ pobočce vlastní firmy → odmítnuto (b.deleted_at)',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', null, null,
    '2026-07-19 10:00', :'pob_d', '2026-07-19 11:00', :'pob_d', 'zrušená pobočka'), 'Pobočka v téhle firmě není'));
-- Druh řádku automatu musí sedět s tím, co se posílá: druhý příchod
-- není otevřený úsek a konec přestávky není osamělý odchod.
select pg_temp.check('druhý příchod poslaný jako otevřený úsek (doplnit odchod) → „Mezitím"',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'petr', :'d_in2', null,
    null, null, '2026-07-25 17:00', :'pob_a', 'doplnit odchod'), 'Mezitím to někdo změnil'));
select pg_temp.check('konec přestávky mimo úsek poslaný jako osamělý odchod → „Mezitím"',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'jana', null, :'j20_be',
    '2026-06-20 07:00', :'pob_a', null, null, 'doplnit příchod'), 'Mezitím to někdo změnil'));
select pg_temp.check('smazanému člověku nový úsek nezapíše ani majitel (e.deleted_at)',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'smazany', null, null,
    '2026-06-08 08:00', :'pob_a', '2026-06-08 12:00', :'pob_a', 'dodatečně'), 'Takový zaměstnanec v téhle firmě není'));
select pg_temp.check('smazanému člověku úsek nestornuje ani majitel',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'smazany', :'sm_in', :'sm_out', 'dodatečně'), 'Takový zaměstnanec v téhle firmě není'));
select pg_temp.check('storno: záznam jiného člověka pod Petrem → „Mezitím"',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'j_in', :'j_out', 'cizí záznam'), 'Mezitím to někdo změnil'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po všech odmítnutích: počet záznamů, storen i auditu beze změny',
  (select count(*) from public.attendance_events) = :pocet_pred
  and (select count(*) from public.attendance_events where stornovano_kdy is not null) = :storno_pred
  and (select count(*) from public.audit_log where action like 'attendance.%') = :audit_pred);

-- Pořadí řádků dne podle času, ne podle automatu: 25. 7. automat vydá
-- nejdřív druhý příchod (7:40), pak úsek 7:30 → 16:38.
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select string_agg(u.druh, ',' order by u.ordinality) as poradi_2507
  from public.useky_cloveka(:'firma', :'petr', '2026-07-01') with ordinality u
 where u.den = '2026-07-25' \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('řádky dne podle času: úsek 7:30 před druhým příchodem 7:40 (automat je dá obráceně)',
  :'poradi_2507' = 'usek,navic_prichod'
  and (select string_agg(u.druh, ',' order by u.poradi) from app.useky_dochazky(:'petr', '2026-07-25', '2026-07-25') u)
      = 'navic_prichod,usek');

-- Majitel vlastní úsek upravit smí.
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select minut_po as m_po
  from public.upravit_usek_dochazky(:'firma', :'majitel', :'m_in', :'m_out',
         '2026-07-24 09:00', null, '2026-07-24 18:00', null, 'odešel později') \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('majitel smí upravit vlastní úsek (9–18 = 510)', :m_po = 510);

-- Tlačítka na obrazovce (smi_spravovat) říkají totéž: vedoucí u sebe
-- ne, majitel u sebe ano.
set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);
select count(*) as vs_radky, count(*) filter (where smi_spravovat) as vs_smi
  from public.useky_cloveka(:'firma', :'vedouci', '2026-07-01') \gset
select set_config('test.user_id', :'u_majitel', false);
select count(*) filter (where druh = 'usek') as ms_radky,
       count(*) filter (where druh = 'usek' and smi_spravovat) as ms_smi
  from public.useky_cloveka(:'firma', :'majitel', '2026-07-01') \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('obrazovka: vedoucí u vlastního úseku tlačítka nemá', :vs_radky = 1 and :vs_smi = 0);
select pg_temp.check('obrazovka: majitel u vlastního úseku tlačítka má', :ms_radky = 1 and :ms_smi = 1);


-- =====================================================================
\echo '== 4b. Navazující úseky (odchod 14:00 = příchod 14:00) ========'
-- =====================================================================

/*
  JANA, 17. 7.: 10:00–14:00 na A a hned 14:00–22:00 na B, na celé
  minuty (ručních záznamů na celou minutu je v ostré DB desítky).
  Nezměněný konec, který se dotýká souseda, úpravu blokovat nesmí —
  jinak navazující úseky nejdou upravit vůbec. NOVÝ čas ve stejné
  chvíli jako jiný záznam ano: o pořadí by rozhodla náhoda.

  created_at je dané, ať automat pořadí shodných časů zná. POZOR:
  worked_minutes shody neřadí, proto se oba úseky na konci oddílu
  stornují — závěrečná KONTROLA SHODY by jinak stála na náhodě.
*/
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, created_at)
values (:'firma', :'pob_a', :'jana', 'in',  '2026-07-17 10:00+02', now() - interval '4 minutes') returning id as n1_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, created_at)
values (:'firma', :'pob_a', :'jana', 'out', '2026-07-17 14:00+02', now() - interval '3 minutes') returning id as n1_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, created_at)
values (:'firma', :'pob_b', :'jana', 'in',  '2026-07-17 14:00+02', now() - interval '2 minutes') returning id as n2_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, created_at)
values (:'firma', :'pob_b', :'jana', 'out', '2026-07-17 22:00+02', now() - interval '1 minute') returning id as n2_out \gset

select pg_temp.check('navazující úseky: automat je vidí jako dva úseky (základ pro kontroly níž)',
  (select string_agg(u.druh, ',' order by u.poradi) from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17') u)
    = 'usek,usek');

set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
-- Formulář posílá obě hodnoty; mění se jen příchod prvního úseku.
select pg_temp.check('navazující: změna jen příchodu prvního úseku projde (odchod 14:00 se dotýká souseda)',
  pg_temp.projde(pg_temp.uprava(:'firma', :'jana', :'n1_in', :'n1_out',
    '2026-07-17 09:50', null, '2026-07-17 14:00', null, 'přišla dřív')));
select pg_temp.check('navazující: změna jen odchodu druhého úseku projde (příchod 14:00 se dotýká souseda)',
  pg_temp.projde(pg_temp.uprava(:'firma', :'jana', :'n2_in', :'n2_out',
    '2026-07-17 14:00', null, '2026-07-17 22:30', null, 'odešla později')));
select pg_temp.check('NOVÝ úsek přesně od konce jiného (22:30) → odmítnuto s radou posunout o minutu',
  pg_temp.odmitne(pg_temp.uprava(:'firma', :'jana', null, null,
    '2026-07-17 22:30', :'pob_b', '2026-07-17 23:00', :'pob_b', 'úklid'),
    'Nový čas je přesně ve chvíli jiného záznamu (odchod v 17. 7. 22:30)'));
select pg_temp.check('… posunutý o minutu projde',
  pg_temp.projde(pg_temp.uprava(:'firma', :'jana', null, null,
    '2026-07-17 22:31', :'pob_b', '2026-07-17 23:00', :'pob_b', 'úklid')));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('navazující: po úpravách tři úseky 9:50–14:00, 14:00–22:30, 22:31–23:00, nezměněné konce tytéž záznamy',
  (select string_agg(to_char(u.prichod at time zone 'Europe/Prague', 'HH24:MI') || '-'
                     || to_char(u.odchod at time zone 'Europe/Prague', 'HH24:MI'), ',' order by u.poradi)
     from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17') u where u.druh = 'usek')
    = '09:50-14:00,14:00-22:30,22:31-23:00'
  and exists (select 1 from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17') u
               where u.odchod_id = :'n1_out')
  and exists (select 1 from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17') u
               where u.prichod_id = :'n2_in'));

-- Úklid: všechny tři úseky stornuje majitel (viz POZOR výš). Jako
-- superuživatel s přihlášeným majitelem: app.useky_dochazky
-- přihlášenému nepatří.
select set_config('test.user_id', :'u_majitel', false);
select count(*) as n_uklid
  from (select u.prichod_id, u.odchod_id
          from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17') u
         where u.druh = 'usek') x
  cross join lateral public.stornovat_usek_dochazky(:'firma', :'jana', x.prichod_id, x.odchod_id, 'úklid scénáře') s \gset
select set_config('test.user_id', '', false);
select pg_temp.check('úklid: tři úseky 17. 7. stornované, mzda ani automat z toho dne nic nemají',
  :n_uklid = 3
  and not exists (select 1 from app.worked_minutes(:'jana', '2026-07-17', '2026-07-17'))
  and not exists (select 1 from app.useky_dochazky(:'jana', '2026-07-17', '2026-07-17')));


-- =====================================================================
\echo '== 5. Storno ================================================='
-- =====================================================================

-- 5a. Karel se dnes píchne omylem (tatáž cesta jako kód i PIN na
--     tabletu: app.pichnout).
select udalost as k_in from app.pichnout(:'firma', :'pob_a', :'karel', 'in') \gset
select pg_temp.check('po píchnutí je Karel „v práci" (app.otevreny_prichod)',
  (select id from app.otevreny_prichod(:'firma', :'karel')) = :'k_in');

set role authenticated;
select set_config('test.user_id', :'u_karel', false);
select v_praci::text as k_vpraci_pred from public.muj_den(:'firma') \gset
select set_config('test.user_id', :'u_vedouci', false);
select stornovano as k_pocet, minut_pred as k_pred, minut_po as k_po
  from public.stornovat_usek_dochazky(:'firma', :'karel', :'k_in', null, 'píchnutí omylem') \gset
select set_config('test.user_id', :'u_karel', false);
select v_praci::text as k_vpraci_po from public.muj_den(:'firma') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('muj_den před stornem: v práci', :'k_vpraci_pred' = 'true');
select pg_temp.check('storno příchodu: 1 záznam, minuty 0 → 0', :k_pocet = 1 and :k_pred = 0 and :k_po = 0);
select pg_temp.check('příchod stornovaný vedoucím s předponou „Storno úseku:", ne smazaný',
  exists (select 1 from public.attendance_events
           where id = :'k_in' and stornovano_kdy is not null and stornoval = :'u_vedouci'
             and duvod_storna = 'Storno úseku: píchnutí omylem'));
select pg_temp.check('po stornu Karel není „v práci" (otevreny_prichod nic)',
  not exists (select 1 from app.otevreny_prichod(:'firma', :'karel')));
select pg_temp.check('muj_den po stornu: není v práci', :'k_vpraci_po' = 'false');
select pg_temp.check('audit attendance.usek_stornovan od vedoucího',
  (select count(*) from public.audit_log
    where action = 'attendance.usek_stornovan' and entity_id = :'karel' and actor_id = :'u_vedouci') = 1);

select udalost as k_in2 from app.pichnout(:'firma', :'pob_a', :'karel', 'in') \gset
select pg_temp.check('a smí se píchnout znovu — nový příchod, ne ten stornovaný',
  :'k_in2' <> :'k_in' and (select id from app.otevreny_prichod(:'firma', :'karel')) = :'k_in2');

-- 5b. Úsek s přestávkou: mzda i Můj účet klesnou, zálohy ne.
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-26 08:00+02') returning id as u_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'petr', 'break_start', '2026-07-26 12:00+02'),
  (:'firma', :'pob_a', :'petr', 'break_end',   '2026-07-26 12:30+02');
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-26 16:00+02') returning id as u_out \gset
insert into public.advances
  (tenant_id, branch_id, employee_id, castka_haleru, business_date, stav, potvrzeno_kdy, storno_duvod)
values (:'firma', :'pob_a', :'petr', 100000, '2026-07-26', 'potvrzena', '2026-07-26 12:00+02', null);

select odpracovano_minut as e_min_pred, vydelano_haleru as e_hal_pred from app.earnings(:'petr', '2026-07-01') \gset
select count(*) as z_pocet_pred, sum(castka_haleru) as z_sum_pred from public.advances where employee_id = :'petr' \gset

set role authenticated;
select set_config('test.user_id', :'u_petr', false);
select sum(odpracovano_minut) as a_min_pred, sum(zalohy_haleru) as a_zal_pred,
       (array_agg(zustatek_haleru order by den desc))[1] as a_zust_pred,
       max(zobrazeni) as a_zobrazeni
  from public.muj_pracovni_ucet(:'firma', '2026-07-01') \gset
select set_config('test.user_id', :'u_vedouci', false);
select stornovano as u_pocet, minut_pred as u_pred, minut_po as u_po
  from public.stornovat_usek_dochazky(:'firma', :'petr', :'u_in', :'u_out', 'celý den omylem') \gset
select set_config('test.user_id', :'u_petr', false);
select sum(odpracovano_minut) as a_min_po, sum(zalohy_haleru) as a_zal_po,
       (array_agg(zustatek_haleru order by den desc))[1] as a_zust_po
  from public.muj_pracovni_ucet(:'firma', '2026-07-01') \gset
reset role;
select set_config('test.user_id', '', false);

select odpracovano_minut as e_min_po, vydelano_haleru as e_hal_po from app.earnings(:'petr', '2026-07-01') \gset

select pg_temp.check('storno úseku: příchod, odchod a obě přestávky (4 záznamy), 450 → 0',
  :u_pocet = 4 and :u_pred = 450 and :u_po = 0);
select pg_temp.check('earnings za červenec klesla o 450 min a 1 125 Kč (150 Kč/h)',
  :e_min_po = :e_min_pred - 450 and :e_hal_po = :e_hal_pred - 112500);
select pg_temp.check('Můj účet: odpracováno o 450 min méně', :a_min_po = :a_min_pred - 450);
select pg_temp.check('Můj účet: zůstatek o 1 125 Kč nižší (firma odečítá zálohy)',
  :'a_zobrazeni' = 'odecitat' and :a_zust_po = :a_zust_pred - 112500);
select pg_temp.check('zálohy beze změny (v účtu i v tabulce)',
  :a_zal_po = :a_zal_pred
  and (select count(*) from public.advances where employee_id = :'petr') = :z_pocet_pred
  and (select sum(castka_haleru) from public.advances where employee_id = :'petr') = :z_sum_pred);

-- 5c. Dvojí příchod: storno prvního páru by nechal druhý příchod otevřený.
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-27 16:00+02') returning id as l_out \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'in',  '2026-07-28 08:00+02') returning id as pm_in \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'break_end', '2026-07-28 10:00+02') returning id as pm_be \gset
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
values (:'firma', :'pob_a', :'petr', 'out', '2026-07-28 12:00+02') returning id as pm_out \gset

select count(*) as pocet_pred2, count(*) filter (where stornovano_kdy is not null) as storno_pred2
  from public.attendance_events \gset
-- Janin úsek 18. 6.: příchod na A, odchod na B.
select max(id::text) filter (where kind = 'in' and branch_id = :'pob_a')                 as j18_in,
       max(id::text) filter (where kind = 'out' and occurred_at = '2026-06-18 12:00+02') as j18_out
  from public.attendance_events
 where employee_id = :'jana' and business_date = '2026-06-18' and stornovano_kdy is null \gset

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);
select pg_temp.check('dvojí příchod: storno prvního páru odmítnuto s radou',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'d_in1', :'d_out', 'špatně'),
                  'Nejdřív stornujte nezapočítaný záznam'));
select pg_temp.check('zastaralé id (úsek už stornovaný) → „Mezitím"',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'u_in', :'u_out', 'znovu'), 'Mezitím to někdo změnil'));
select pg_temp.check('jen příchod uzavřeného úseku → „Mezitím" (storno je po řádcích automatu)',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'r_in', null, 'jen půlka'), 'Mezitím to někdo změnil'));
select pg_temp.check('vedoucí sám sobě storno → odmítnuto',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'vedouci', :'v_in', :'v_out', 'omyl'), 'Vlastní docházku si stornovat nemůžete'));
-- Právo na pobočce KAŽDÉHO stornovaného záznamu, ne jen prvního:
-- příchod je na A (spravuje), odchod na B (ne).
select pg_temp.check('vedoucí A storno Janina úseku A → B (odchod na B) → odmítnuto',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'jana', :'j18_in', :'j18_out', 'zkouška práv'), 'kdo ji na té pobočce spravuje'));
select pg_temp.check('storno bez důvodu → odmítnuto',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'r_in', :'r_out', ' x '), 'Aspoň tři znaky'));
select set_config('test.user_id', :'u_beckova', false);
select pg_temp.check('vedoucí B storno na pobočce A → odmítnuto',
  pg_temp.odmitne(pg_temp.storno(:'firma', :'petr', :'r_in', :'r_out', 'cizí pobočka'), 'kdo ji na té pobočce spravuje'));
select set_config('test.user_id', :'u_cizi', false);
select pg_temp.check('cizí majitel pod svou firmou s naším člověkem → odmítnuto',
  pg_temp.odmitne(pg_temp.storno(:'cizi_firma', :'petr', :'r_in', :'r_out', 'cizí'), 'Takový zaměstnanec v téhle firmě není'));
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('po odmítnutých stornech: nic nepřibylo ani se nestornovalo',
  (select count(*) from public.attendance_events) = :pocet_pred2
  and (select count(*) from public.attendance_events where stornovano_kdy is not null) = :storno_pred2);

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);
select stornovano as d_navic from public.stornovat_usek_dochazky(:'firma', :'petr', :'d_in2', null, 'dvakrát ťukl') \gset
select stornovano as d_par   from public.stornovat_usek_dochazky(:'firma', :'petr', :'d_in1', :'d_out', 'nepracoval') \gset
select stornovano as l_pocet from public.stornovat_usek_dochazky(:'firma', :'petr', null, :'l_out', 'odchod omylem') \gset
select stornovano as pm_pocet from public.stornovat_usek_dochazky(:'firma', :'petr', null, :'pm_be', 'přestávka omylem') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('dvojí příchod: nejdřív navíc (1), pak pár (2)', :d_navic = 1 and :d_par = 2);
select pg_temp.check('osamělý odchod stornovaný (1)', :l_pocet = 1);
select pg_temp.check('přestávka mimo stornovaná (1), úsek 28. 7. zůstal',
  :pm_pocet = 1
  and exists (select 1 from app.useky_dochazky(:'petr', '2026-07-28', '2026-07-28') u
               where u.druh = 'usek' and u.prichod_id = :'pm_in' and u.odchod_id = :'pm_out'));

-- Součet po úpravách a stornech = app.earnings (majitel, obrazovka).
select odpracovano_minut as pe_min, vydelano_haleru as pe_hal from app.earnings(:'petr', '2026-07-01') \gset
set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select coalesce(sum(dm), -1) as pu_min
  from (select distinct den, den_minut as dm from public.useky_cloveka(:'firma', :'petr', '2026-07-01')) x \gset
select coalesce(sum(minut), -1) as pv_min, coalesce(sum(haleru), -1) as pv_hal
  from public.vydelek_cloveka_po_dnech(:'firma', :'petr', '2026-07-01') \gset
select odpracovano_minut as pp_min, vydelano_haleru as pp_hal
  from public.vydelky_prehled(:'firma', null, '2026-07-01') where employee_id = :'petr' \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('po úpravách: Σ den_minut obrazovky = earnings = vydelky_prehled = Σ po dnech',
  :pu_min = :pe_min and :pv_min = :pe_min and :pp_min = :pe_min
  and :pv_hal = :pe_hal and :pp_hal = :pe_hal);


-- =====================================================================
\echo '== 6. Pravidlo 11: pásmo pobočky, změna času =================='
-- =====================================================================

set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
-- Pobočka Z v New Yorku: 9:00–17:00 na tamní zdi.
select prichod_id as z_in, odchod_id as z_out, den as z_den
  from public.upravit_usek_dochazky(:'firma', :'petr', null, null,
         '2026-07-29 09:00', :'pob_z', '2026-07-29 17:00', :'pob_z', 'výpomoc v Z') \gset
-- Noc přes jarní změnu času v Praze (28.→29. 3. 2026): 22:00–6:00 na zdi
-- je doopravdy 7 hodin.
select prichod_id as dst_in, odchod_id as dst_out, den as dst_den, minut_po as dst_min
  from public.upravit_usek_dochazky(:'firma', :'jana', null, null,
         '2026-03-28 22:00', :'pob_a', '2026-03-29 06:00', :'pob_a', 'noční inventura') \gset
select to_char(prichod at time zone prichod_zona, 'HH24:MI') as z_zobraz_od,
       to_char(odchod  at time zone odchod_zona,  'HH24:MI') as z_zobraz_do,
       to_char(prichod at time zone 'Europe/Prague', 'HH24:MI') as z_v_praze,
       prichod_zona as z_zona
  from public.useky_cloveka(:'firma', :'petr', '2026-07-01') where prichod_id = :'z_in' \gset
select to_char(prichod at time zone prichod_zona, 'HH24:MI') as dst_zobraz_od,
       to_char(odchod  at time zone odchod_zona,  'HH24:MI') as dst_zobraz_do,
       hrubych_sekund as dst_hrube
  from public.useky_cloveka(:'firma', :'jana', '2026-03-01') where prichod_id = :'dst_in' \gset
reset role;
select set_config('test.user_id', '', false);

-- ULOŽENÍ (okamžik), nezávisle na zobrazení.
select pg_temp.check('uložení: 9:00 v New Yorku = 13:00 UTC, 17:00 = 21:00 UTC (EDT −4)',
  (select occurred_at from public.attendance_events where id = :'z_in')  = '2026-07-29 13:00+00'
  and (select occurred_at from public.attendance_events where id = :'z_out') = '2026-07-29 21:00+00');
select pg_temp.check('provozní den podle pobočky Z: 29. 7.', :'z_den' = '2026-07-29');
-- ZOBRAZENÍ (pásmo pobočky záznamu), nezávisle na uložení.
select pg_temp.check('zobrazení: pásmo pobočky záznamu, 09:00–17:00', :'z_zona' = 'America/New_York'
  and :'z_zobraz_od' = '09:00' and :'z_zobraz_do' = '17:00');
select pg_temp.check('… a to není pražský čas (15:00) — kontrola zobrazení něco měří', :'z_v_praze' = '15:00');
select pg_temp.check('uložení přes změnu času: 22:00 SEČ = 21:00 UTC, 6:00 SELČ = 4:00 UTC',
  (select occurred_at from public.attendance_events where id = :'dst_in')  = '2026-03-28 21:00+00'
  and (select occurred_at from public.attendance_events where id = :'dst_out') = '2026-03-29 04:00+00');
select pg_temp.check('noc přes změnu času: 7 h skutečně (25 200 s), 420 min, den 28. 3.',
  :dst_hrube = 25200 and :dst_min = 420 and :'dst_den' = '2026-03-28');
select pg_temp.check('zobrazení přes změnu času: 22:00 a 06:00 na pražské zdi',
  :'dst_zobraz_od' = '22:00' and :'dst_zobraz_do' = '06:00');


-- =====================================================================
\echo '== 7. Kdo zapsal, zůstane i po stornu ========================='
-- =====================================================================

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);
select public.zapsat_rucni_dochazku(:'firma', :'pob_a', :'petr', 'in', '2026-07-30 08:00', 'zapomněl telefon') as r7_in \gset
select set_config('test.user_id', :'u_majitel', false);
select stornovano as r7_pocet from public.stornovat_usek_dochazky(:'firma', :'petr', :'r7_in', null, 'špatný den') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('ruční záznam po stornu majitelem: zapsal pořád vedoucí, stornoval majitel',
  :r7_pocet = 1
  and exists (select 1 from public.attendance_events
               where id = :'r7_in' and entered_by = :'u_vedouci' and stornoval = :'u_majitel'
                 and stornovano_kdy is not null));
select pg_temp.check('nové záznamy z úprav zapsal ten, kdo upravoval (P5: vedoucí)',
  (select count(*) from public.attendance_events
    where id in (:'p5_in', :'p5_out') and entered_by = :'u_vedouci') = 2);


-- =====================================================================
\echo '== 8. Granty, sloupec, funkce ================================'
-- =====================================================================

select pg_temp.check('authenticated nemá UPDATE ani DELETE na attendance_events (katalog)',
  not has_table_privilege('authenticated', 'public.attendance_events', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.attendance_events', 'DELETE'));
select pg_temp.check('SELECT zůstal celý, INSERT už ne na celé tabulce',
  has_table_privilege('authenticated', 'public.attendance_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.attendance_events', 'INSERT'));
-- Od 20260929110000 (otázka 31): INSERT zavřený úplně, i na těch
-- dřív povolených sedmi neutrálních sloupcích. Dřív tahle kontrola
-- čekala přesně ten seznam; teď čeká, že žádný sloupec insert nemá.
select pg_temp.check('INSERT nemá žádný sloupec — grant zavřený úplně (otázka 31)',
  not exists (
    select 1
      from pg_attribute a
     where a.attrelid = 'public.attendance_events'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')));
-- Katalog tabulky: authenticated má na úrovni tabulky JEN select (žádný
-- MAINTAIN z výchozích práv Supabase na PG 17). aclexplode projde na
-- PG 16 i 17 — has_table_privilege(…, 'MAINTAIN') by na PG 16 spadl.
select pg_temp.check('na úrovni tabulky má authenticated jen SELECT (ani MAINTAIN)',
  (select string_agg(distinct x.privilege_type, ',')
     from pg_class c cross join lateral aclexplode(c.relacl) x
    where c.oid = 'public.attendance_events'::regclass
      and x.grantee = 'authenticated'::regrole) = 'SELECT');
select pg_temp.check('sloupec nahrazuje je pro authenticated čitelný (katalog)',
  has_column_privilege('authenticated', 'public.attendance_events', 'nahrazuje', 'SELECT'));

set role authenticated;
select set_config('test.user_id', :'u_vedouci', false);
select count(*) as vid_nahr from public.attendance_events where nahrazuje = :'p1_out' \gset
select pg_temp.check('přímý update času pod authenticated spadne na právech',
  pg_temp.spadne_pravem(format(
    'update public.attendance_events set occurred_at = occurred_at + interval ''1 hour'' where id = %L', :'p2_out')));
select pg_temp.check('„odstornování" přímým update spadne na právech',
  pg_temp.spadne_pravem(format(
    'update public.attendance_events set stornovano_kdy = null where id = %L', :'p1_out')));
select pg_temp.check('přímý delete spadne na právech',
  pg_temp.spadne_pravem(format('delete from public.attendance_events where id = %L', :'p2_out')));
-- Přímý INSERT s tím, co obrazovka ukazuje jako fakt: storno „od
-- majitele", náhrada, jiný provozní den, tablet.
select pg_temp.check('přímý insert s podvrženým stornem (stornovano_kdy, stornoval, duvod_storna) spadne na právech',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source, stornovano_kdy, stornoval, duvod_storna) values (%L, %L, %L, ''in'', ''2026-07-02 08:00+02'', ''app'', now(), %L, ''Storno úseku: podvrh'')',
    :'firma', :'pob_a', :'novy', :'u_majitel')));
select pg_temp.check('přímý insert s cizím provozním dnem (business_date) spadne na právech',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, business_date) values (%L, %L, %L, ''in'', ''2026-07-02 09:00+02'', ''2026-06-05'')',
    :'firma', :'pob_a', :'novy')));
select pg_temp.check('přímý insert s nahrazuje („opraveno z …") spadne na právech',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source, note, nahrazuje) values (%L, %L, %L, ''in'', ''2026-07-02 10:00+02'', ''manual'', ''x'', %L)',
    :'firma', :'pob_a', :'novy', :'p1_out')));
-- Obráceně: od otázky 31 INSERT nejde už ani na těch sedmi dřív
-- neutrálních sloupcích krok2/krok6 — grant se zavřel úplně
-- (20260929110000). Dřív tu byl pozitivní test (`pg_temp.projde`);
-- teď je to `spadne_pravem`, jako tři kontroly výš.
select pg_temp.check('přímý insert i jen se sedmi sloupci (krok2, krok6) teď spadne na právech (otázka 31)',
  pg_temp.spadne_pravem(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at, source, note) values (%L, %L, %L, ''in'', ''2026-07-02 11:00+02'', ''app'', ''přímý zápis'')',
    :'firma', :'pob_a', :'novy')));
-- Stará storno funkce jednoho záznamu: vedoucí by si stornem vlastního
-- odchodu prodloužil směnu (nález d).
select pg_temp.check('stará stornovat_dochazku: vedoucí vlastní odchod → spadne na právech (EXECUTE)',
  pg_temp.spadne_pravem(format('select public.stornovat_dochazku(%L, %L, %L)', :'firma', :'v_out', 'oběd omylem')));
reset role;
select set_config('test.user_id', '', false);

-- Od otázky 31 nevloží authenticated přímým insertem nic vůbec — dřív
-- tu prošel právě jeden (sedm neutrálních sloupců), teď 0.
select pg_temp.check('po pokusech: authenticated nevložil přímým insertem nic (otázka 31) a odchod vedoucího platí',
  (select count(*) from public.attendance_events where employee_id = :'novy') = 0
  and (select stornovano_kdy is null from public.attendance_events where id = :'v_out'));
select pg_temp.check('stornovat_dochazku: EXECUTE nemá authenticated ani anon (katalog)',
  not has_function_privilege('authenticated', 'public.stornovat_dochazku(uuid, uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.stornovat_dochazku(uuid, uuid, text)', 'EXECUTE'));

select pg_temp.check('vedoucí přečte nahrazuje pod rolí authenticated', :vid_nahr = 1);
select pg_temp.check('po pokusech: čas i storno beze změny',
  (select occurred_at from public.attendance_events where id = :'p2_out') = '2026-07-07 16:00+02'
  and (select stornovano_kdy is not null from public.attendance_events where id = :'p1_out'));

select pg_temp.check('pět public funkcí: execute pro authenticated, ne pro anon',
  (select bool_and(has_function_privilege('authenticated', f, 'EXECUTE')
                   and not has_function_privilege('anon', f, 'EXECUTE'))
     from unnest(array[
       'public.useky_cloveka(uuid, uuid, date)',
       'public.dochazka_clovek(uuid, uuid)',
       'public.vydelek_cloveka_po_dnech(uuid, uuid, date)',
       'public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text)',
       'public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text)']) f));
select pg_temp.check('pomocné app funkce nemá nikdo z přihlášených ani anon',
  (select bool_and(not has_function_privilege('authenticated', f, 'EXECUTE')
                   and not has_function_privilege('anon', f, 'EXECUTE'))
     from unnest(array[
       'app.useky_dochazky(uuid, date, date)',
       'app.zapsat_rucni_zaznam(uuid, uuid, uuid, text, timestamptz, text, uuid, boolean, uuid)',
       'app.popis_zaznamu_dochazky(uuid, uuid)',
       'app.ostatni_useky(uuid, date, uuid[])',
       'app.cas_dochazky_slovy(timestamptz, uuid)',
       'app.hlida_firmu_dochazky()']) f));
select pg_temp.check('public funkce a spoušť firmy: security definer, search_path prázdný',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (('public', 'useky_cloveka'), ('public', 'vydelek_cloveka_po_dnech'),
                                     ('public', 'dochazka_clovek'),
                                     ('public', 'upravit_usek_dochazky'), ('public', 'stornovat_usek_dochazky'),
                                     ('app', 'hlida_firmu_dochazky'))
      and p.prosecdef
      and p.proconfig @> array['search_path=""']) = 6);
select pg_temp.check('app.useky_dochazky NENÍ definer (volají ji jen definer funkce)',
  (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'useky_dochazky'));
-- Souběh jedno sezení neověří. Hlídá se aspoň, že zámek z funkcí nezmizí.
select pg_temp.check('úprava i storno zamykají řádek zaměstnance (for update)',
  pg_get_functiondef('public.upravit_usek_dochazky(uuid, uuid, uuid, uuid, timestamp, uuid, timestamp, uuid, text)'::regprocedure)
    ~* 'from public\.employees e\s+where e\.id = p_employee\s+and e\.tenant_id = p_tenant\s+and e\.deleted_at is null\s+for update'
  and pg_get_functiondef('public.stornovat_usek_dochazky(uuid, uuid, uuid, uuid, text)'::regprocedure)
    ~* 'from public\.employees e\s+where e\.id = p_employee\s+and e\.tenant_id = p_tenant\s+and e\.deleted_at is null\s+for update');


-- =====================================================================
\echo '== 9. Spoušť firmy (nález c) ================================='
-- =====================================================================

select pg_temp.check('záznam naší firmy s CIZÍM zaměstnancem neprojde',
  pg_temp.odmitne(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values (%L, %L, %L, ''in'', ''2026-07-02 08:00+02'')',
    :'firma', :'pob_a', :'cizinec'), 'nepatří této firmě'));
select pg_temp.check('záznam naší firmy na CIZÍ pobočce neprojde',
  pg_temp.odmitne(format(
    'insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values (%L, %L, %L, ''in'', ''2026-07-02 08:00+02'')',
    :'firma', :'pob_c', :'petr'), 'nepatří této firmě'));
select pg_temp.check('přesun existujícího záznamu na cizí pobočku neprojde',
  pg_temp.odmitne(format('update public.attendance_events set branch_id = %L where id = %L', :'pob_c', :'r_in'),
                  'nepatří této firmě'));

set role authenticated;
select set_config('test.user_id', :'u_majitel', false);
select pg_temp.check('zapsat_rucni_dochazku: majitel zapíše hodiny člověku cizí firmy — neprojde',
  pg_temp.odmitne(format(
    'select public.zapsat_rucni_dochazku(%L, %L, %L, ''in'', ''2026-07-02 08:00'', ''zkouška'')',
    :'firma', :'pob_a', :'cizinec'), 'nepatří této firmě'));
reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
\echo '== Závěr: shoda po všech úpravách ============================'
-- =====================================================================

select pg_temp.check('KONTROLA SHODY globálně i po úpravách a stornech',
  not exists (
    with mesice as (
      select distinct a.employee_id, date_trunc('month', a.business_date)::date as m
        from public.attendance_events a
    ),
    w as (
      select me.employee_id, x.den, x.minut
        from mesice me
        cross join lateral app.worked_minutes(me.employee_id, me.m, app.konec_mesice(me.m)) x
    ),
    u as (
      select me.employee_id, y.den,
             floor(sum(y.cistych_sekund) / 60)::integer as minut,
             sum(y.cistych_sekund) as s
        from mesice me
        cross join lateral app.useky_dochazky(me.employee_id, me.m, app.konec_mesice(me.m)) y
       group by me.employee_id, y.den
    )
    select 1
      from w full join u on u.employee_id = w.employee_id and u.den = w.den
     where w.minut is distinct from u.minut
       and not (w.den is null and u.s = 0)));

select pg_temp.check('nic se nesmazalo: každý nahrazený záznam pořád existuje a je stornovaný',
  not exists (select 1 from public.attendance_events n
               left join public.attendance_events s on s.id = n.nahrazuje
               where n.nahrazuje is not null and (s.id is null or s.stornovano_kdy is null)));

\echo '== KROK 63 HOTOV ============================================='
