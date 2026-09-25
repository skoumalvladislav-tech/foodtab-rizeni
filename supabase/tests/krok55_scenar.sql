-- Scénář pro krok 55 — výdělky všech lidí: odpracováno, podle rozpisu,
-- zálohy.
--
-- Pokrývá 20260924140000_vydelky_prehled.sql (public.vydelky_prehled)
-- a rozhodnutí 4–8 z návrhu „Zálohy do Docházky + výdělky pro majitele"
-- (24. 9. 2026), shrnutá v hlavičce té migrace.
--
-- Stojí na VLASTNÍCH dvou firmách (naše a cizí) a na datech předchozích
-- scénářů nezávisí — dá se pustit i samotný:
--   node scripts/scenare-pglite.mjs krok55_scenar
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
-- * Kontrakt s aplikací: jména a typy sloupců, práva vlastníka, execute
--   jen pro přihlášené.
-- * „Vyděláno" je přesně app.earnings — i když se ptáme dnem uprostřed
--   měsíce.
-- * Plán jen od DNEŠNÍHO PROVOZNÍHO DNE POBOČKY SMĚNY. Dnešek ano,
--   včerejšek ne, minulý měsíc nic. Pobočka „Východ" (UTC+14) proti
--   domovské „Západ" (UTC−11) a sezení v pásmu Západu: kdyby funkce
--   vzala current_date nebo domovskou pobočku, včerejší směna Východu
--   by v plánu byla — rozdíl je 25 hodin, takže to platí v kteroukoli
--   denní dobu.
-- * PROVOZNÍ DEN SMĚNY, ne shift_date: noční směna od 3:00 na dnešní
--   datum (pobočka A, den od 5:00) je provozně včerejší a v plánu
--   není; na zítřejší datum je provozně dnešní a v plánu je.
-- * Nulový pár (příchod a odchod omylem v téže minutě) den z plánu
--   nevyřadí — worked_minutes pro něj vrátí řádek s nulou.
-- * Sazba plánu ke dni směny, zrušená směna, směna podstrčená cizí
--   firmou, den bez sazby (příznak, ne nula).
-- * Zálohy: nestornované, všechny pobočky, celý měsíc i s 1. dnem,
--   záloha podstrčená cizí firmou našemu člověku ne.
-- * Kdo je v tabulce: řádek bez hodin, plánu i záloh chybí, řádek jen se
--   zálohou je; s pobočkou jen lidé s tou DOMOVSKOU pobočkou.
-- * Práva: bez payroll.read nic; vedoucí s payroll.read jen na A nevidí
--   řádek majitele (bez pobočky) ani lidi z B; účetní s firemním
--   rozsahem ho vidí; cizí firma nic a její lidé nikdy k nám.
-- * KONTROLA SHODY (oddíl 8): směna odpracovaná přesně podle plánu dá
--   worked_minutes == plán minut téže směny. Paušál přestávky je teď na
--   dvou místech (worked_minutes a vydelky_prehled) a tohle je jediné,
--   co je drží pohromadě. Dvanáct případů: 8 h, přesně na prahu, těsně
--   pod ním, trhaná pod prahem i nad ním, přes půlnoc, před platností,
--   v den platnosti, přebití pobočkou, firma bez data platnosti, noční
--   směna před začátkem provozního dne (odpracovaná se nezapočte
--   dvakrát) a noční směna v kalendářní den platnosti paušálu, která
--   je provozně ještě před ním (paušál i sazba podle provozního dne).
--   A okraj měsíce: noční směna 1. dne patří provozně do minulého
--   měsíce, po odpracování z plánu zmizí a mzda je v minulém měsíci.
-- * employee_earnings (oddíl 9, oprava staré díry): vedoucí
--   s payroll.read jen na A nevidí řádek majitele bez pobočky; účetní
--   s firemním rozsahem a majitel ano.
--
-- POZOR NA PGLITE: funkce je SECURITY DEFINER a práva si ověřuje sama
-- přes auth.uid() → test.user_id, takže kontroly práv tady měří i pod
-- superuživatelem. Grant na funkci se hlídá katalogem
-- (has_function_privilege), ne voláním pod rolí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Majitel (…01) zakládá naši firmu, cizí majitel (…09) cizí. Majitel
-- má z app.create_tenant zaměstnanecký záznam BEZ pobočky — přesně ten
-- řádek, o který jde v bodě 8.
-- =====================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('55550000-0000-0000-0000-000000000001', 'majitel55@foodtab.cz',  '{"full_name":"Majitel Padesátpět"}'),
  ('55550000-0000-0000-0000-000000000002', 'vedouci55@foodtab.cz',  '{"full_name":"Vedoucí Padesátpět"}'),
  ('55550000-0000-0000-0000-000000000003', 'provozni55@foodtab.cz', '{"full_name":"Provozní Padesátpět"}'),
  ('55550000-0000-0000-0000-000000000004', 'ucetni55@foodtab.cz',   '{"full_name":"Účetní Padesátpět"}'),
  ('55550000-0000-0000-0000-000000000009', 'cizi55@jinafirma.cz',   '{"full_name":"Cizí Padesátpět"}');

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);
select app.create_tenant('Krok55 Výdělky s.r.o.', 'Majitel Padesátpět') as firma \gset
select set_config('test.user_id', '55550000-0000-0000-0000-000000000009', false);
select app.create_tenant('Krok55 Cizí s.r.o.', 'Cizí Padesátpět') as cizi_firma \gset
reset role;
select set_config('test.user_id', '', false);

-- A: obyčejná pobočka (Praha, den od 5:00). B: přebíjí paušál firmy
-- (45 min od 5 h). Východ a Západ: pásma 25 hodin od sebe, den od
-- půlnoci — na nich stojí kontrola „provozní den pobočky směny".
insert into public.branches (tenant_id, name, slug)
values (:'firma', 'Krok55 A', 'krok55-a') returning id as pob_a \gset
insert into public.branches (tenant_id, name, slug, prestavka_minut, prestavka_od_minut)
values (:'firma', 'Krok55 B', 'krok55-b', 45, 300) returning id as pob_b \gset
insert into public.branches (tenant_id, name, slug, timezone, day_starts_at)
values (:'firma', 'Krok55 Východ', 'krok55-vychod', 'Pacific/Kiritimati', '00:00')
returning id as pob_v \gset
insert into public.branches (tenant_id, name, slug, timezone, day_starts_at)
values (:'firma', 'Krok55 Západ', 'krok55-zapad', 'Pacific/Pago_Pago', '00:00')
returning id as pob_z \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Krok55 Cizí', 'krok55-cizi') returning id as pob_c \gset

-- Dnešek a měsíce se berou z provozního dne pobočky A, ne z kalendáře.
-- M1 a M2 jsou celé v budoucnosti, ať scénář platí kterýkoli den.
select app.business_date(:'pob_a', now())                                                      as dnes,
       (date_trunc('month', app.business_date(:'pob_a', now())) + interval '1 month')::date   as m1,
       (date_trunc('month', app.business_date(:'pob_a', now())) + interval '2 months')::date  as m2,
       app.business_date(:'pob_v', now())                                                      as dnes_v,
       app.business_date(:'pob_z', now())                                                      as dnes_z
\gset

-- Paušál naší firmy platí od 15. dne měsíce M2 — před tím dnem v M2
-- a ve všech dřívějších měsících se neodečítá. Cizí firma má paušál
-- nastavený (výchozích 30 min od 6 h), ale BEZ data platnosti: podle
-- worked_minutes tedy neplatí vůbec.
insert into public.tenant_settings (tenant_id, prestavka_minut, prestavka_od_minut, prestavka_platna_od)
values (:'firma', 30, 360, :'m2'::date + 14);
insert into public.tenant_settings (tenant_id) values (:'cizi_firma');

select id as majitel      from public.employees where tenant_id = :'firma'      and je_majitel \gset
select id as cizi_majitel from public.employees where tenant_id = :'cizi_firma' and je_majitel \gset
select id as role_f from public.roles where tenant_id = :'firma' and not is_owner order by key limit 1 \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name) values
  (:'firma', :'pob_a', null, 'Aneta Padesátpět'),
  (:'firma', :'pob_b', null, 'Bedřich Padesátpět'),
  (:'firma', :'pob_a', null, 'Cyril Padesátpět'),
  (:'firma', :'pob_a', null, 'Cecílie Padesátpět'),
  (:'firma', :'pob_z', null, 'Dana Padesátpět'),
  (:'firma', :'pob_z', null, 'Emil Padesátpět'),
  (:'firma', :'pob_a', null, 'Filip Padesátpět'),
  (:'firma', :'pob_a', null, 'Gustav Padesátpět'),
  (:'firma', :'pob_a', null, 'Hana Padesátpět'),
  (:'firma', :'pob_a', null, 'Ivan Padesátpět'),
  (:'firma', :'pob_a', null, 'Jana Padesátpět'),
  (:'firma', :'pob_a', null, 'Karel Padesátpět'),
  (:'firma', :'pob_a', null, 'Lucie Padesátpět'),
  (:'firma', :'pob_a', null, 'Marek Padesátpět'),
  (:'firma', :'pob_a', null, 'Nora Padesátpět'),
  (:'firma', :'pob_a', '55550000-0000-0000-0000-000000000002', 'Vedoucí Padesátpět'),
  (:'firma', :'pob_a', '55550000-0000-0000-0000-000000000003', 'Provozní Padesátpět'),
  (:'firma', :'pob_b', '55550000-0000-0000-0000-000000000004', 'Účetní Padesátpět');

select max(id::text) filter (where full_name = 'Aneta Padesátpět')    as aneta,
       max(id::text) filter (where full_name = 'Bedřich Padesátpět')  as bedrich,
       max(id::text) filter (where full_name = 'Cyril Padesátpět')    as cyril,
       max(id::text) filter (where full_name = 'Cecílie Padesátpět')  as cecilie,
       max(id::text) filter (where full_name = 'Dana Padesátpět')     as dana,
       max(id::text) filter (where full_name = 'Emil Padesátpět')     as emil,
       max(id::text) filter (where full_name = 'Filip Padesátpět')    as filip,
       max(id::text) filter (where full_name = 'Gustav Padesátpět')   as gustav,
       max(id::text) filter (where full_name = 'Hana Padesátpět')     as hana,
       max(id::text) filter (where full_name = 'Ivan Padesátpět')     as ivan,
       max(id::text) filter (where full_name = 'Jana Padesátpět')     as jana,
       max(id::text) filter (where full_name = 'Karel Padesátpět')    as karel,
       max(id::text) filter (where full_name = 'Lucie Padesátpět')    as lucie,
       max(id::text) filter (where full_name = 'Marek Padesátpět')    as marek,
       max(id::text) filter (where full_name = 'Nora Padesátpět')     as nora,
       max(id::text) filter (where full_name = 'Vedoucí Padesátpět')  as vedouci,
       max(id::text) filter (where full_name = 'Provozní Padesátpět') as provozni,
       max(id::text) filter (where full_name = 'Účetní Padesátpět')   as ucetni
from public.employees where tenant_id = :'firma' \gset

-- Vedoucí: payroll.read, ale členství jen na pobočku A.
-- Provozní: docházka a zálohy na A, payroll.read NE.
-- Účetní: payroll.read s firemním rozsahem — není majitel.
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'firma', :'vedouci',  'payroll.read',    true),
  (:'firma', :'vedouci',  'attendance.read', true),
  (:'firma', :'provozni', 'attendance.read', true),
  (:'firma', :'provozni', 'advances.manage', true),
  (:'firma', :'ucetni',   'payroll.read',    true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'firma', '55550000-0000-0000-0000-000000000002', :'role_f', 'branch', 'active'),
  (:'firma', '55550000-0000-0000-0000-000000000003', :'role_f', 'branch', 'active'),
  (:'firma', '55550000-0000-0000-0000-000000000004', :'role_f', 'tenant', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, :'pob_a'::uuid
  from public.memberships m
 where m.tenant_id = :'firma'
   and m.user_id in ('55550000-0000-0000-0000-000000000002',
                     '55550000-0000-0000-0000-000000000003');

-- Sazby. Jana schválně žádnou nemá. Ivan ji má — kdyby v tabulce
-- chyběl, nesmí to být tím.
insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from) values
  (:'firma', :'majitel', 30000, '2026-01-01'),
  (:'firma', :'aneta',   20000, '2026-01-01'),
  (:'firma', :'aneta',   26000, '2026-06-15'),
  (:'firma', :'aneta',   30000, :'m1'::date + 15),
  (:'firma', :'bedrich', 18000, '2026-01-01'),
  (:'firma', :'cyril',   15000, '2026-01-01'),
  (:'firma', :'cecilie', 15000, '2026-01-01'),
  (:'firma', :'dana',    15000, '2026-01-01'),
  (:'firma', :'emil',    15000, '2026-01-01'),
  (:'firma', :'filip',   15000, '2026-01-01'),
  (:'firma', :'filip',   17000, '2026-06-30'),
  (:'firma', :'filip',   19000, '2026-07-01'),
  (:'firma', :'filip',   21000, :'dnes'::date + 1),
  (:'firma', :'filip',   23000, :'m2'::date + 10),
  (:'firma', :'gustav',  15000, '2026-01-01'),
  (:'firma', :'hana',    15000, '2026-01-01'),
  (:'firma', :'ivan',    15000, '2026-01-01'),
  (:'firma', :'karel',   15000, '2026-01-01'),
  (:'firma', :'lucie',   15000, '2026-01-01'),
  (:'firma', :'marek',   15000, '2026-01-01'),
  (:'firma', :'nora',    15000, '2026-01-01'),
  (:'cizi_firma', :'cizi_majitel', 25000, '2026-01-01');

-- Docházka v červnu 2026 (uzavřený měsíc, paušál tehdy ještě neplatí).
insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'aneta',   'in',  '2026-06-10 10:00+02'),
  (:'firma', :'pob_a', :'aneta',   'out', '2026-06-10 18:00+02'),
  (:'firma', :'pob_a', :'aneta',   'in',  '2026-06-20 10:00+02'),
  (:'firma', :'pob_a', :'aneta',   'out', '2026-06-20 18:00+02'),
  (:'firma', :'pob_b', :'bedrich', 'in',  '2026-06-11 10:00+02'),
  (:'firma', :'pob_b', :'bedrich', 'out', '2026-06-11 16:00+02'),
  (:'firma', :'pob_a', :'filip',   'in',  '2026-06-05 10:00+02'),
  (:'firma', :'pob_a', :'filip',   'out', '2026-06-05 12:00+02'),
  (:'firma', :'pob_a', :'jana',    'in',  '2026-06-15 10:00+02'),
  (:'firma', :'pob_a', :'jana',    'out', '2026-06-15 14:00+02'),
  -- Nora: příchod a odchod omylem pípnuté po sobě (30 s) v den její
  -- směny v M1 — worked_minutes pro ten den vrátí řádek s nulou.
  (:'firma', :'pob_a', :'nora',    'in',  (:'m1'::date + 10 + time '09:00:00') at time zone 'Europe/Prague'),
  (:'firma', :'pob_a', :'nora',    'out', (:'m1'::date + 10 + time '09:00:30') at time zone 'Europe/Prague');

insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, status) values
  -- Aneta: červnová směna bez docházky (minulý měsíc → do plánu ne)
  -- a dvě směny v M1 kolem změny sazby 16. dne.
  (:'firma', :'pob_a', :'aneta',   '2026-06-25',          '10:00', '18:00', 'planned'),
  (:'firma', :'pob_a', :'aneta',   :'m1'::date + 4,       '08:00', '12:00', 'planned'),
  (:'firma', :'pob_a', :'aneta',   :'m1'::date + 19,      '08:00', '12:00', 'planned'),
  -- Majitel bez pobočky má směnu na A — ať je vidět, že pobočkový
  -- pohled filtruje podle domovské pobočky člověka, ne podle směny.
  (:'firma', :'pob_a', :'majitel', :'m1'::date + 2,       '10:00', '14:00', 'planned'),
  (:'firma', :'pob_b', :'bedrich', :'m1'::date + 3,       '10:00', '14:00', 'planned'),
  -- Cyril jen včera, Cecílie jen dnes — každý svou směnu, ať se nemíchají,
  -- když je včerejšek v témž měsíci.
  (:'firma', :'pob_a', :'cyril',   :'dnes'::date - 1,     '10:00', '14:00', 'planned'),
  (:'firma', :'pob_a', :'cecilie', :'dnes'::date,         '10:00', '14:00', 'planned'),
  (:'firma', :'pob_v', :'dana',    :'dnes_v'::date - 1,   '10:00', '14:00', 'planned'),
  (:'firma', :'pob_v', :'emil',    :'dnes_v'::date,       '10:00', '14:00', 'planned'),
  (:'firma', :'pob_a', :'filip',   :'dnes'::date,         '10:00', '12:00', 'planned'),
  (:'firma', :'pob_a', :'filip',   :'m2'::date + 20,      '10:00', '12:00', 'planned'),
  (:'firma', :'pob_a', :'gustav',  :'m1'::date + 5,       '10:00', '14:00', 'planned'),
  (:'firma', :'pob_a', :'gustav',  :'m1'::date + 6,       '10:00', '14:00', 'cancelled'),
  (:'firma', :'pob_a', :'hana',    :'m1'::date + 7,       '10:00', '14:00', 'planned'),
  (:'firma', :'pob_a', :'jana',    :'m1'::date + 9,       '10:00', '14:00', 'planned'),
  -- Noční směny před začátkem provozního dne (A: den od 5:00). Lucie
  -- na DNEŠNÍ datum od 3:00 = provozně včerejší, už je po ní. Marek na
  -- ZÍTŘEJŠÍ datum od 3:00 = provozně dnešní, patří do plánu.
  (:'firma', :'pob_a', :'lucie',   :'dnes'::date,         '03:00', '04:30', 'planned'),
  (:'firma', :'pob_a', :'marek',   :'dnes'::date + 1,     '03:00', '04:30', 'planned'),
  (:'firma', :'pob_a', :'nora',    :'m1'::date + 10,      '10:00', '14:00', 'planned'),
  (:'cizi_firma', :'pob_c', :'cizi_majitel', :'m1'::date + 6, '10:00', '18:00', 'planned'),
  -- PODVRŽENÁ: cizí firma, cizí pobočka, NÁŠ člověk. Politika
  -- shifts_write to vedoucímu cizí firmy dovolí zapsat napřímo a cizí
  -- klíč employee_id firmu nekontroluje.
  (:'cizi_firma', :'pob_c', :'hana', :'m1'::date + 8,   '10:00', '14:00', 'planned');

-- Zálohy Anety v červnu: 1. 6., 12. 6., 18. 6. na pobočce B (potvrzená),
-- 19. 6. stornovaná a 1. 7. už do června nepatří. Karel má jen zálohu.
-- PODVRŽENÁ: cizí firma, cizí pobočka, NÁŠ Karel. Přes RPC to dnes
-- nejde, ale cizí klíč employee_id firmu nekontroluje — filtr firmy
-- ve funkci nesmí stát na tom, že jiná cesta dovnitř zatím není.
insert into public.advances
  (tenant_id, branch_id, employee_id, castka_haleru, business_date, stav, potvrzeno_kdy, storno_duvod)
values
  (:'firma', :'pob_a', :'aneta', 10000, '2026-06-01', 'nepotvrzena', null, null),
  (:'firma', :'pob_a', :'aneta', 50000, '2026-06-12', 'nepotvrzena', null, null),
  (:'firma', :'pob_b', :'aneta', 30000, '2026-06-18', 'potvrzena', '2026-06-18 12:00+02', null),
  (:'firma', :'pob_a', :'aneta', 99900, '2026-06-19', 'stornovana', null, 'Překlep v částce'),
  (:'firma', :'pob_a', :'aneta', 70000, '2026-07-01', 'nepotvrzena', null, null),
  (:'firma', :'pob_b', :'karel', 15000, '2026-06-08', 'nepotvrzena', null, null),
  (:'cizi_firma', :'pob_c', :'karel', 77700, '2026-06-09', 'nepotvrzena', null, null);


\echo ''
\echo '== 1. Kontrakt s aplikací ===================================='

select pg_temp.check('sloupce a typy přesně podle kontraktu (UI se na ně spoléhá)',
  pg_get_function_result('public.vydelky_prehled(uuid, uuid, date)'::regprocedure)
  = 'TABLE(employee_id uuid, full_name text, branch_id uuid, odpracovano_minut integer, '
    'vydelano_haleru bigint, sazba_chybi boolean, hodinova_haleru integer, plan_minut integer, '
    'plan_haleru bigint, plan_sazba_chybi boolean, plan_smen integer, zalohy_haleru bigint, '
    'predbezne_haleru bigint)');

select pg_temp.check('běží s právy vlastníka a s prázdnou search_path',
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p
    where p.oid = 'public.vydelky_prehled(uuid, uuid, date)'::regprocedure));

select pg_temp.check('volat ji smí přihlášený, anon ne',
  has_function_privilege('authenticated', 'public.vydelky_prehled(uuid, uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.vydelky_prehled(uuid, uuid, date)', 'execute'));


\echo ''
\echo '== 2. Vyděláno = app.earnings ================================'

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

-- 480 × 200 Kč + 480 × 260 Kč za hodinu = 1 600 + 2 080 = 3 680 Kč.
select pg_temp.check('Aneta v červnu: 2 × 8 h = 960 min, se změnou sazby 15. 6. = 3 680 Kč',
  (select odpracovano_minut = 960 and vydelano_haleru = 368000 and not sazba_chybi
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'aneta'));

reset role;
select pg_temp.check('… a je to přesně app.earnings, i když se ptáme dnem uprostřed měsíce',
  (select v.odpracovano_minut = e.odpracovano_minut
          and v.vydelano_haleru = e.vydelano_haleru
          and v.sazba_chybi = e.sazba_chybi
     from public.vydelky_prehled(:'firma', null, '2026-06-17') v
     cross join app.earnings(:'aneta', '2026-06-01') e
    where v.employee_id = :'aneta'));

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('Jana bez sazby: odpracováno 240 min, příznak sazba_chybi, sazba NULL — ne „0 Kč"',
  (select odpracovano_minut = 240 and sazba_chybi and vydelano_haleru = 0
          and hodinova_haleru is null
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'jana'));


\echo ''
\echo '== 3. Plán jen od dnešního provozního dne ===================='

select pg_temp.check('minulý měsíc má plán 0, i když Aneta měla 25. 6. směnu bez docházky',
  (select plan_smen = 0 and plan_minut = 0 and plan_haleru = 0
          and predbezne_haleru = vydelano_haleru
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'aneta'));

select pg_temp.check('Cecílie: DNEŠNÍ směna v plánu je',
  (select plan_smen = 1 and plan_minut = 240
     from public.vydelky_prehled(:'firma', null, :'dnes')
    where employee_id = :'cecilie'));

-- Když je dnes prvního, včerejšek je v minulém měsíci a tahle kontrola
-- hlídá „minulý měsíc je nula"; jinak hlídá včerejšek v běžícím měsíci.
select pg_temp.check('Cyril: včerejší směna v plánu NENÍ (to je den bez docházky, ne plán)',
  coalesce((select plan_smen
              from public.vydelky_prehled(:'firma', null, (:'dnes'::date - 1))
             where employee_id = :'cyril'), 0) = 0);

-- Noční směny před začátkem provozního dne. Obě kontroly platí
-- v kteroukoli denní dobu: 3:00 je před 5:00 každý den.
select pg_temp.check('příprava: směna od 3:00 na dnešní datum je provozně včerejší, na zítřejší dnešní',
  app.business_date(:'pob_a', (:'dnes'::date + time '03:00') at time zone app.zona_pobocky(:'pob_a'))
    = :'dnes'::date - 1
  and app.business_date(:'pob_a', (:'dnes'::date + 1 + time '03:00') at time zone app.zona_pobocky(:'pob_a'))
    = :'dnes'::date);

select pg_temp.check('Lucie: noční směna od 3:00 na DNEŠNÍ datum v plánu NENÍ — provozně je včerejší, už skončila',
  coalesce((select plan_smen
              from public.vydelky_prehled(:'firma', null, :'dnes')
             where employee_id = :'lucie'), 0) = 0);

-- Zítřek může být už v dalším měsíci, proto se ptáme jeho měsícem —
-- do měsíce patří směna podle shift_date (hlavička migrace).
select pg_temp.check('Marek: noční směna od 3:00 na ZÍTŘEJŠÍ datum v plánu JE — provozně je dnešní',
  (select plan_smen = 1 and plan_minut = 90
     from public.vydelky_prehled(:'firma', null, (:'dnes'::date + 1))
    where employee_id = :'marek'));

-- Sezení v pásmu Západu: current_date i provozní den domovské pobočky
-- Dany a Emila jsou o den až dva POZADU za Východem, kde mají směny.
set timezone = 'Pacific/Pago_Pago';

select pg_temp.check('příprava: Východ je o 1–2 dny napřed; current_date sezení = provozní den Západu',
  (:'dnes_v'::date - :'dnes_z'::date) between 1 and 2
  and current_date = :'dnes_z'::date);

select pg_temp.check('Dana: včerejší směna VÝCHODU v plánu není — rozhoduje pobočka směny, ne current_date ani domovská pobočka',
  coalesce((select plan_smen
              from public.vydelky_prehled(:'firma', null, (:'dnes_v'::date - 1))
             where employee_id = :'dana'), 0) = 0);

select pg_temp.check('Emil: dnešní směna Východu v plánu je',
  (select plan_smen = 1
     from public.vydelky_prehled(:'firma', null, :'dnes_v')
    where employee_id = :'emil'));

reset timezone;


\echo ''
\echo '== 4. Plán: sazba ke dni, zrušené a podvržené směny ========='

-- 240 × 260 Kč + 240 × 300 Kč za hodinu = 1 040 + 1 200 = 2 240 Kč.
select pg_temp.check('Aneta v M1: dvě směny po 4 h, sazba KE DNI SMĚNY (260 → 300 Kč od 16.) = 2 240 Kč',
  (select plan_smen = 2 and plan_minut = 480 and plan_haleru = 224000
          and not plan_sazba_chybi and vydelano_haleru = 0 and predbezne_haleru = 224000
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'aneta'));

select pg_temp.check('Gustav: zrušená směna se do plánu nepočítá',
  (select plan_smen = 1 and plan_minut = 240
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'gustav'));

reset role;
select pg_temp.check('příprava: cizí firma má u Hany zapsanou nezrušenou směnu v M1',
  exists (select 1 from public.shifts
           where employee_id = :'hana' and tenant_id = :'cizi_firma' and status <> 'cancelled'));

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('Hana: směnu podstrčenou cizí firmou plán nepočítá',
  (select plan_smen = 1 and plan_minut = 240
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'hana'));

reset role;
select pg_temp.check('příprava: Nořin omylem pípnutý pár (30 s) dá ve worked_minutes řádek s NULOU minut',
  exists (select 1 from app.worked_minutes(:'nora', :'m1'::date + 10, :'m1'::date + 10) w
           where w.den = :'m1'::date + 10 and w.minut = 0));

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('Nora: nulový pár směnu z plánu NEVYŘADÍ — jinak by nebyla ve výdělku ani v plánu',
  (select plan_smen = 1 and plan_minut = 240 and odpracovano_minut = 0
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'nora'));

select pg_temp.check('Jana bez sazby: plán má minuty, částku 0 a příznak plan_sazba_chybi',
  (select plan_minut = 240 and plan_haleru = 0 and plan_sazba_chybi and hodinova_haleru is null
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'jana'));

-- Sazba vedle částky (hodinova_haleru). Poslední den měsíce splývá
-- „dnes" s „koncem měsíce" a prostřední kontrola to pak nerozliší;
-- rozliší to ta první a poslední.
select pg_temp.check('Filip, minulý měsíc: sazba ke konci měsíce (170 Kč od 30. 6.), ne dnešní',
  (select hodinova_haleru = 17000
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'filip'));

select pg_temp.check('Filip, běžící měsíc: sazba k dnešnímu provoznímu dni, ne ta od zítřka',
  (select hodinova_haleru = 19000
     from public.vydelky_prehled(:'firma', null, :'dnes')
    where employee_id = :'filip'));

select pg_temp.check('Filip, budoucí měsíc: sazba k 1. dni (210 Kč), ne ke konci (230 Kč)',
  (select hodinova_haleru = 21000
     from public.vydelky_prehled(:'firma', null, :'m2')
    where employee_id = :'filip'));


\echo ''
\echo '== 5. Zálohy ================================================='

select pg_temp.check('Aneta v červnu: 100 + 500 + 300 (pobočka B) = 900 Kč — bez stornované a bez červencové, i s tou z 1. 6.',
  (select zalohy_haleru = 90000
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'aneta'));

select pg_temp.check('Karel jen se zálohou: řádek je (přeplaceno), vyděláno i předběžně 0',
  (select vydelano_haleru = 0 and plan_smen = 0 and predbezne_haleru = 0
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'karel'));

reset role;
select pg_temp.check('příprava: cizí firma má u Karla v červnu zapsanou nestornovanou zálohu',
  exists (select 1 from public.advances
           where employee_id = :'karel' and tenant_id = :'cizi_firma' and stav <> 'stornovana'));

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('… a zálohy má jen naše 150 Kč — zálohu podstrčenou cizí firmou (777 Kč) nepočítá',
  (select zalohy_haleru = 15000
     from public.vydelky_prehled(:'firma', null, '2026-06-17')
    where employee_id = :'karel'));


\echo ''
\echo '== 6. Kdo je v tabulce ======================================='

select pg_temp.check('Ivan bez hodin, plánu i záloh v tabulce není (sazbu má)',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, '2026-06-17')
               where employee_id = :'ivan')
  and not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
                   where employee_id = :'ivan'));

select pg_temp.check('majitel na firmě vidí sebe (bez pobočky) i lidi z obou poboček',
  (select count(*) from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id in (:'majitel', :'aneta', :'bedrich')) = 3);

select pg_temp.check('s pobočkou A jen lidé s DOMOVSKOU pobočkou A — majitel se směnou na A ne, Bedřich ne',
  exists (select 1 from public.vydelky_prehled(:'firma', :'pob_a', :'m1')
           where employee_id = :'aneta')
  and not exists (select 1 from public.vydelky_prehled(:'firma', :'pob_a', :'m1')
                   where branch_id is distinct from :'pob_a'));

select pg_temp.check('předběžně = vyděláno + plán u každého řádku',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
               where predbezne_haleru <> vydelano_haleru + plan_haleru));


\echo ''
\echo '== 7. Práva ================================================='

select set_config('test.user_id', '55550000-0000-0000-0000-000000000002', false);

select pg_temp.check('vedoucí s payroll.read jen na A vidí Anetu',
  exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
           where employee_id = :'aneta'));

select pg_temp.check('… ale ne řádek majitele bez pobočky (patří firemní úrovni)',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
               where employee_id = :'majitel'));

select pg_temp.check('… ani lidi z B, ani nikoho mimo A',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
               where branch_id is distinct from :'pob_a'));

select pg_temp.check('… a když si o pobočku B řekne sám, nedostane nic',
  not exists (select 1 from public.vydelky_prehled(:'firma', :'pob_b', :'m1')));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000004', false);

select pg_temp.check('účetní s payroll.read na celou firmu (není majitel) vidí majitele i Bedřicha',
  exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
           where employee_id = :'majitel')
  and exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
               where employee_id = :'bedrich'));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000003', false);

select pg_temp.check('docházka a zálohy bez payroll.read: nic, ani na své pobočce',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1'))
  and not exists (select 1 from public.vydelky_prehled(:'firma', :'pob_a', '2026-06-17')));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000009', false);

select pg_temp.check('majitel cizí firmy do naší nevidí',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')));

-- Tahle kontrola je zároveň příprava pro tu pod ní: cizí majitel v M1
-- řádek má, takže kdyby se ztratil filtr firmy, vyskočil by u nás.
select pg_temp.check('ve své firmě vidí sám sebe: 8 h podle rozpisu BEZ paušálu (firma nemá datum platnosti)',
  (select plan_minut = 480 and plan_smen = 1
     from public.vydelky_prehled(:'cizi_firma', null, :'m1')
    where employee_id = :'cizi_majitel'));

-- Z jeho strany je to ta skutečná díra: náš majitel je bez pobočky
-- a v M1 má směnu, takže bez filtru firmy by mu vyskočil jako „jeho".
select pg_temp.check('… a ve své firmě nevidí našeho majitele (bez pobočky, se směnou v M1)',
  not exists (select 1 from public.vydelky_prehled(:'cizi_firma', null, :'m1')
               where employee_id = :'majitel'));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('náš majitel nevidí nikoho z cizí firmy — ani jejího majitele bez pobočky',
  not exists (select 1 from public.vydelky_prehled(:'firma', null, :'m1')
               where employee_id = :'cizi_majitel'));

reset role;


\echo ''
\echo '== 8. KONTROLA SHODY: plán = mzda za tutéž směnu ============'

/*
  Paušál přestávky je na dvou místech. Každý případ: nový člověk
  s jedinou směnou v M2 → plán (musí dát očekávané minuty) → docházka
  PŘESNĚ podle plánu → worked_minutes musí dát totéž číslo, den zmizí
  z plánu a „předběžně" se nezmění.

  Očekávané minuty jsou vepsané ručně, ne dopočítané — kontrola, která
  si hodnotu sestaví stejným vzorcem jako funkce, ověřuje jen ten vzorec.

  Noční směny (11, 12) docházka zapíše na provozní den PŘED datem
  směny, proto se worked_minutes ptá od v_den − 1. Případ 12 má navíc
  od kalendářního dne směny vyšší sazbu: plán, který by bral sazbu
  (nebo platnost paušálu) podle shift_date místo provozního dne, by se
  po odpracování rozešel s „předběžně" — to hlídá poslední podmínka.
*/
select set_config('test.firma',      :'firma',      false);
select set_config('test.cizi_firma', :'cizi_firma', false);
select set_config('test.pob_a',      :'pob_a',      false);
select set_config('test.pob_b',      :'pob_b',      false);
select set_config('test.pob_c',      :'pob_c',      false);
select set_config('test.m2',         :'m2',         false);

do $$
declare
  c        record;
  v_tenant uuid;
  v_branch uuid;
  v_den    date;
  v_zam    uuid;
  v_pred   record;
  v_po     record;
  v_wm     integer;
  i        integer;
begin
  for c in
    select * from (values
      ( 1, '8 h — paušál 30 min od 6 h', 'firma', 'pob_a', 19,
        time '10:00', time '18:00', null::time, null::time,
        array['10:00', '18:00']::interval[], 450, null::integer),
      ( 2, 'přesně 6 h — práh platí včetně', 'firma', 'pob_a', 19,
        time '10:00', time '16:00', null, null,
        array['10:00', '16:00']::interval[], 330, null),
      ( 3, '5 h 59 min — těsně pod prahem', 'firma', 'pob_a', 19,
        time '10:00', time '15:59', null, null,
        array['10:00', '15:59']::interval[], 359, null),
      ( 4, 'trhaná 10–14 a 18–22 — obě části pod prahem', 'firma', 'pob_a', 19,
        time '10:00', time '22:00', time '14:00', time '18:00',
        array['10:00', '14:00', '18:00', '22:00']::interval[], 480, null),
      ( 5, 'trhaná 6–13 a 15–22 — paušál u každé části', 'firma', 'pob_a', 19,
        time '06:00', time '22:00', time '13:00', time '15:00',
        array['06:00', '13:00', '15:00', '22:00']::interval[], 780, null),
      ( 6, 'přes půlnoc 20:00–4:00', 'firma', 'pob_a', 19,
        time '20:00', time '04:00', null, null,
        array['20:00', '28:00']::interval[], 450, null),
      ( 7, 'před platností paušálu (5. den)', 'firma', 'pob_a', 4,
        time '10:00', time '18:00', null, null,
        array['10:00', '18:00']::interval[], 480, null),
      ( 8, 'v den platnosti paušálu (15. den)', 'firma', 'pob_a', 14,
        time '10:00', time '18:00', null, null,
        array['10:00', '18:00']::interval[], 450, null),
      ( 9, 'pobočka B přebíjí firmu: 45 min od 5 h', 'firma', 'pob_b', 19,
        time '10:00', time '15:00', null, null,
        array['10:00', '15:00']::interval[], 255, null),
      (10, 'firma bez data platnosti — paušál neplatí', 'cizi_firma', 'pob_c', 19,
        time '10:00', time '18:00', null, null,
        array['10:00', '18:00']::interval[], 480, null),
      (11, 'noční 2:00–4:00 před začátkem provozního dne (5:00) — patří do dne předtím', 'firma', 'pob_a', 19,
        time '02:00', time '04:00', null, null,
        array['02:00', '04:00']::interval[], 120, null),
      (12, 'noční 1:00–8:00 v kalendářní den platnosti (15.) — provozně 14.: bez paušálu, stará sazba', 'firma', 'pob_a', 14,
        time '01:00', time '08:00', null, null,
        array['01:00', '08:00']::interval[], 420, 14)
    ) t(n, popis, firma, pob, den, od, do_, pauza_od, pauza_do, pichnuti, ocekavano, nova_sazba_den)
    order by n
  loop
    v_tenant := current_setting('test.' || c.firma)::uuid;
    v_branch := current_setting('test.' || c.pob)::uuid;
    v_den    := current_setting('test.m2')::date + c.den;

    -- Ptá se majitel té firmy, které směna patří.
    perform set_config('test.user_id',
      case c.firma when 'firma' then '55550000-0000-0000-0000-000000000001'
                   else '55550000-0000-0000-0000-000000000009' end, false);

    insert into public.employees (tenant_id, branch_id, full_name)
    values (v_tenant, v_branch, 'Shoda Padesátpět ' || c.n)
    returning id into v_zam;
    insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from)
    values (v_tenant, v_zam, 15000, '2026-01-01');
    if c.nova_sazba_den is not null then
      insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from)
      values (v_tenant, v_zam, 30000, current_setting('test.m2')::date + c.nova_sazba_den);
    end if;
    insert into public.shifts
      (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at, pauza_od, pauza_do)
    values (v_tenant, v_branch, v_zam, v_den, c.od, c.do_, c.pauza_od, c.pauza_do);

    select v.* into v_pred
      from public.vydelky_prehled(v_tenant, null, v_den) v
     where v.employee_id = v_zam;
    if v_pred.plan_minut is distinct from c.ocekavano
       or v_pred.plan_smen is distinct from 1
       or v_pred.odpracovano_minut is distinct from 0 then
      raise exception 'SELHALO: plán % (%): % min ve % směnách, čekalo se % min v jedné',
        c.n, c.popis, v_pred.plan_minut, v_pred.plan_smen, c.ocekavano;
    end if;
    raise notice '  OK    plán %: % — % min', c.n, c.popis, c.ocekavano;

    -- Odpracováno přesně podle plánu: příchod a odchod na minutu, u
    -- trhané dva páry. Provozní den dopočítá spoušť z pobočky.
    for i in 1 .. array_length(c.pichnuti, 1) loop
      insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
      values (v_tenant, v_branch, v_zam,
              case when i % 2 = 1 then 'in' else 'out' end,
              (v_den + c.pichnuti[i]) at time zone 'Europe/Prague');
    end loop;

    select coalesce(sum(w.minut), 0)::integer into v_wm
      from app.worked_minutes(v_zam, v_den - 1, v_den) w;

    -- Příprava nočních případů (začátek před 5:00 pobočky A): docházka
    -- musí opravdu padnout na provozní den PŘED datem směny, jinak by
    -- případ neměřil to, kvůli čemu tu je.
    if c.od < time '05:00'
       and exists (select 1 from app.worked_minutes(v_zam, v_den, v_den)) then
      raise exception 'SELHALO: příprava % (%): docházka nepadla na provozní den před datem směny',
        c.n, c.popis;
    end if;

    if v_wm is distinct from v_pred.plan_minut then
      raise exception 'SELHALO: shoda % (%): worked_minutes dal % min, plán % min — paušál se rozešel',
        c.n, c.popis, v_wm, v_pred.plan_minut;
    end if;

    select v.* into v_po
      from public.vydelky_prehled(v_tenant, null, v_den) v
     where v.employee_id = v_zam;
    if v_po.odpracovano_minut is distinct from v_wm
       or v_po.plan_smen is distinct from 0
       or v_po.plan_minut is distinct from 0
       or v_po.predbezne_haleru is distinct from v_pred.predbezne_haleru then
      raise exception 'SELHALO: shoda % (%): po odpracování odpracováno %, plán % min v % směnách, předběžně % → %',
        c.n, c.popis, v_po.odpracovano_minut, v_po.plan_minut, v_po.plan_smen,
        v_pred.predbezne_haleru, v_po.predbezne_haleru;
    end if;
    raise notice '  OK    shoda %: odpracováno podle plánu = plán (% min), den se nezapočetl dvakrát',
      c.n, v_wm;
  end loop;
end $$;

/*
  OKRAJ MĚSÍCE. Noční směna 1. dne M2 od 3:00 je provozně poslední den
  M1. Do plánu M2 patří (měsíc podle shift_date, jako Rozpis), po
  odpracování z něj musí zmizet, i když mzda za ni padne do M1 — proto
  se worked_minutes ve funkci ptá od dne PŘED začátkem měsíce.
*/
select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

insert into public.employees (tenant_id, branch_id, full_name)
values (:'firma', :'pob_a', 'Okraj Padesátpět') returning id as okraj \gset
insert into public.employee_rates (tenant_id, employee_id, hourly_haleru, valid_from)
values (:'firma', :'okraj', 15000, '2026-01-01');
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'firma', :'pob_a', :'okraj', :'m2', '03:00', '04:00');

select pg_temp.check('okraj: noční směna 1. dne M2 od 3:00 je v plánu M2 (60 min), v M1 ne',
  (select plan_smen = 1 and plan_minut = 60
     from public.vydelky_prehled(:'firma', null, :'m2')
    where employee_id = :'okraj')
  and coalesce((select plan_smen
                  from public.vydelky_prehled(:'firma', null, :'m1')
                 where employee_id = :'okraj'), 0) = 0);

insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at) values
  (:'firma', :'pob_a', :'okraj', 'in',  (:'m2'::date + time '03:00') at time zone 'Europe/Prague'),
  (:'firma', :'pob_a', :'okraj', 'out', (:'m2'::date + time '04:00') at time zone 'Europe/Prague');

select pg_temp.check('příprava: odpracovaná padla na poslední den M1 (60 min), ne na 1. den M2',
  exists (select 1 from app.worked_minutes(:'okraj', :'m2'::date - 1, :'m2'::date - 1) w
           where w.minut = 60)
  and not exists (select 1 from app.worked_minutes(:'okraj', :'m2', :'m2')));

select pg_temp.check('okraj: po odpracování v plánu M2 NENÍ — nezapočte se dvakrát',
  coalesce((select plan_smen
              from public.vydelky_prehled(:'firma', null, :'m2')
             where employee_id = :'okraj'), 0) = 0);

select pg_temp.check('… a mzda za ni je v M1: 60 min, 150 Kč',
  (select odpracovano_minut = 60 and vydelano_haleru = 15000
     from public.vydelky_prehled(:'firma', null, :'m1')
    where employee_id = :'okraj'));


\echo ''
\echo '== 9. employee_earnings: řádek bez pobočky jen firmě ========'

/*
  Oprava staré díry (oddíl 2 migrace): can_read_scoped pouštěl řádek
  s branch_id NULL každému s payroll.read kdekoli. Panel člověka
  v Docházce tak vedoucímu jedné pobočky ukázal majitelův měsíc.
*/
select pg_temp.check('employee_earnings: sloupce beze změny (panel člověka, Nastavení → Lidé)',
  pg_get_function_result('public.employee_earnings(uuid, date, uuid)'::regprocedure)
  = 'TABLE(employee_id uuid, full_name text, branch_id uuid, odpracovano_minut integer, '
    'vydelano_haleru integer, dnu_bez_dochazky integer, sazba_chybi boolean, hodinova_haleru integer)');

select pg_temp.check('… s právy vlastníka a prázdnou search_path, volat smí přihlášený, anon ne',
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p
    where p.oid = 'public.employee_earnings(uuid, date, uuid)'::regprocedure)
  and has_function_privilege('authenticated', 'public.employee_earnings(uuid, date, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.employee_earnings(uuid, date, uuid)', 'execute'));

set role authenticated;
select set_config('test.user_id', '55550000-0000-0000-0000-000000000002', false);

select pg_temp.check('vedoucí s payroll.read jen na A: employee_earnings mu vrátí Anetu',
  exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
           where employee_id = :'aneta'));

select pg_temp.check('… ale NE řádek majitele bez pobočky',
  not exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
               where employee_id = :'majitel'));

select pg_temp.check('… ani nikoho mimo A, ani když si o B řekne sám',
  not exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
               where branch_id is distinct from :'pob_a')
  and not exists (select 1 from public.employee_earnings(:'firma', :'m1', :'pob_b')));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000004', false);

select pg_temp.check('účetní s payroll.read na celou firmu (není majitel) vidí majitele i Bedřicha',
  exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
           where employee_id = :'majitel')
  and exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
               where employee_id = :'bedrich'));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000001', false);

select pg_temp.check('majitel vidí v employee_earnings i sám sebe',
  exists (select 1 from public.employee_earnings(:'firma', :'m1', null)
           where employee_id = :'majitel'));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000003', false);

select pg_temp.check('docházka a zálohy bez payroll.read: employee_earnings nic, jako dosud',
  not exists (select 1 from public.employee_earnings(:'firma', :'m1', null)));

select set_config('test.user_id', '55550000-0000-0000-0000-000000000009', false);

select pg_temp.check('majitel cizí firmy přes employee_earnings do naší nevidí',
  not exists (select 1 from public.employee_earnings(:'firma', :'m1', null)));


reset role;
select set_config('test.user_id', '', false);

/*
  ÚKLID TU SCHVÁLNĚ NENÍ — firmy s pobočkami smazat nejde.

  Zaměstnanec s domovskou pobočkou se audituje i s její branch_id.
  Kaskáda z tenants pak maže pobočky, audit_log.branch_id má
  `on delete set null` a pravidlo audit_log_no_update ten update
  spolkne; výsledek je „referential integrity query on "branches" from
  constraint "audit_log_branch_id_fkey" … gave unexpected result".
  Zjištěno tady 24. 9. — krok42 a krok43 mažou cizí firmu jen proto,
  že žádnou pobočku nemá. Týká se to i skutečného výmazu firmy, patří
  to do otázek, ne do tohohle scénáře.

  Obě firmy tedy zůstávají, stejně jako po krok54. Seed si bere první
  firmu podle created_at, marketingové scénáře `tenants limit 1` —
  stejně jako po krok11 a krok54, které cizí firmy taky nechávají.
*/


\echo ''
\echo '== KROK 55 HOTOV ========================================'
