-- Scénář pro krok 65 — úklid otázek 25, 31 a 33 (docházka).
--
-- Pokrývá migraci 20260929110000_dochazka_uklid_otazek.sql a
-- docs/hlaseni/otazky.md, otázky 25, 31, 33 — tři technické nedodělky,
-- které autor sám identifikoval a doporučil (zadání Šéfíka 29. 9.:
-- „dotáhni ty, které jsou čistě technický nedodělek, ne obchodní
-- rozhodnutí").
--
-- Navazuje na etapa0_scenar.sql až krok64_scenar.sql.
--
-- ---------------------------------------------------------------------
-- CO TENHLE SCÉNÁŘ HLÍDÁ
--
--   1. otázka 25 — zapsat_rucni_dochazku odmítne vedoucímu zapsat
--      VLASTNÍ ruční záznam (stejné pravidlo a hláška jako
--      upravit_usek_dochazky / stornovat_usek_dochazky), ale pro
--      jiného člověka a majiteli dál funguje.
--   2. otázka 31 — přímý INSERT do attendance_events je pro
--      authenticated zavřený úplně, i majiteli (podrobněji krok2,
--      krok6 a krok63 oddíl 8).
--   3. otázka 33 — app.otevreny_prichod a app.useky_dochazky se na
--      „je otevřeno" shodnou i ve dvou případech, kde se dřív
--      rozcházely: odchod VE STEJNOU CHVÍLI jako příchod (přesně ostrá
--      DB 27. 9.) a dva příchody BEZ odchodu ve stejném provozním dni.

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
-- Vlastní lidé, ne ze seedu: schválně se jim zapisuje a stornuje
-- docházka a ostatní scénáře s nimi nepočítají.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('67670000-0000-0000-0000-000000000001', 'vedouci65@foodtab.cz', '{"full_name":"Vedoucí Pětašedesát"}');

-- Práva visí od zařazení na zaměstnanci, ne na roli u členství —
-- příprava scény proto běží bez přihlášeného, jako migrace.
select set_config('test.user_id', '', false);

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '67670000-0000-0000-0000-000000000001', 'Vedoucí Pětašedesát', 'hpp')
returning id as vedouci \gset

insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Obsluhovaná Pětašedesát', 'hpp')
returning id as obsluhovana \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '67670000-0000-0000-0000-000000000001', null, 'branch', 'active')
returning id as clen_vedouci \gset

insert into public.membership_branches (membership_id, branch_id)
values (:'clen_vedouci', :'perla');

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'vedouci', 'attendance.read',   true),
  (:'tenant', :'vedouci', 'attendance.manage', true);

select set_config('test.tenant',      :'tenant',      false);
select set_config('test.perla',       :'perla',       false);
select set_config('test.vedouci',     :'vedouci',     false);
select set_config('test.obsluhovana', :'obsluhovana', false);


\echo ''
\echo '== 1. Otázka 25 — vlastní docházku zapíše jen majitel ====='

set role authenticated;
select set_config('test.user_id', '67670000-0000-0000-0000-000000000001', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zapsat_rucni_dochazku(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
      current_setting('test.vedouci')::uuid, 'in', timestamp '2026-09-28 08:00', 'sám sobě');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: vedoucí si zapsal vlastní ruční docházku'; end if;
  raise notice '  OK    vedoucí si vlastní ruční docházku nezapíše (otázka 25)';
end $$;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'obsluhovana', 'in', timestamp '2026-09-28 08:00', 'zapsal vedoucí')
  as ud_jiny \gset
select pg_temp.check('vedoucí ale jinému člověku ruční záznam zapíše',
  :'ud_jiny' is not null);

reset role;
select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'vedouci', 'in', timestamp '2026-09-28 09:00', 'zapsal majitel')
  as ud_majitel \gset
select pg_temp.check('majitel vedoucímu vlastní ruční záznam zapíše (stejné pravidlo jako u úseku)',
  :'ud_majitel' is not null);

-- Uklidit: oba dnešní zápisy stornovat, ať do dalších oddílů
-- nezasahují (app.otevreny_prichod hledá napříč VŠEMI dny).
select public.stornovat_usek_dochazky(:'tenant', :'obsluhovana', :'ud_jiny', null, 'úklid scénáře');
select public.stornovat_usek_dochazky(:'tenant', :'vedouci', :'ud_majitel', null, 'úklid scénáře');
reset role;


\echo ''
\echo '== 2. Otázka 31 — přímý INSERT je pro authenticated zavřený'
\echo '      úplně, i majiteli ==================================='

-- Podrobně krok2, krok6 a krok63 (oddíl 8) — tady jen stručně, ať
-- krok67 sám dokládá všechny tři otázky ze zadání.
select pg_temp.check('katalog: authenticated nemá na attendance_events INSERT na žádném sloupci',
  not exists (
    select 1 from pg_attribute a
     where a.attrelid = 'public.attendance_events'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'INSERT')));

set role authenticated;
select set_config('test.user_id', :'majitel', false);
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.attendance_events (tenant_id, branch_id, employee_id, kind, occurred_at)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            current_setting('test.obsluhovana')::uuid, 'in', now());
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: přímý insert prošel i majiteli'; end if;
  raise notice '  OK    přímý insert do attendance_events neprojde ani majiteli (otázka 31)';
end $$;
reset role;


\echo ''
\echo '== 3. Otázka 33 — odchod VE STEJNOU CHVÍLI jako příchod ==='

/*
  Přesně ostrá DB 27. 9. 2026: ruční příchod i odchod v 09:00:00.
  Předtím app.otevreny_prichod chtěl odchod ostře později, takže
  tvrdil „v práci"; app.useky_dochazky ho spároval jako úsek 0 min —
  a storno samotného příchodu by databáze odmítla, protože v automatu
  ten příchod otevřený nebyl. Teď se obojí shodne.
*/
select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'obsluhovana', 'in', timestamp '2026-09-27 09:00', 'ruční příchod') as nula_in \gset
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'obsluhovana', 'out', timestamp '2026-09-27 09:00', 'ruční odchod') as nula_out \gset

reset role;

select pg_temp.check('app.useky_dochazky: úsek 0 min, NE otevřený (27. 9.)',
  (select string_agg(u.druh, ',') from app.useky_dochazky(:'obsluhovana', '2026-09-27', '2026-09-27') u) = 'usek'
  and (select u.cistych_sekund from app.useky_dochazky(:'obsluhovana', '2026-09-27', '2026-09-27') u) = 0);

select pg_temp.check('app.otevreny_prichod: NENÍ otevřený (sjednoceno s mzdou, otázka 33)',
  not exists (select 1 from app.otevreny_prichod(:'tenant', :'obsluhovana')));

-- A díky tomu storno projde — dřív by ho databáze odmítla větou
-- „Mezitím to někdo změnil", protože zámek řádku hledá otevřený úsek,
-- který dřív podle automatu nebyl.
select set_config('test.user_id', :'majitel', false);
set role authenticated;
select stornovano as nula_pocet
  from public.stornovat_usek_dochazky(:'tenant', :'obsluhovana', :'nula_in', :'nula_out', 'úklid scénáře') \gset
reset role;
select pg_temp.check('storno nulového úseku projde (dřív spadlo na „Mezitím to někdo změnil")',
  :nula_pocet = 2);


\echo ''
\echo '== 4. Otázka 33 — dva příchody bez odchodu, týž den ======='

/*
  app.pichnout druhý příchod téhož provozního dne vždy odmítne — tohle
  jde jen ručním zápisem (zapsat_rucni_dochazku příchod nikdy
  neodmítá, migrace 20260903020000). Zůstává otevřený jen PRVNÍ, stejně
  jako v app.useky_dochazky (druhý je tam druh navic_prichod) — mzda
  a přehled se teď na tom shodnou; dřív mohly ukázat každá jiného
  člověka jako „v práci".
*/
select set_config('test.user_id', :'majitel', false);
set role authenticated;

select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'obsluhovana', 'in', timestamp '2026-09-26 08:00', 'první příchod') as dvoj_prvni \gset
select public.zapsat_rucni_dochazku(
  :'tenant', :'perla', :'obsluhovana', 'in', timestamp '2026-09-26 08:05', 'druhý příchod, omylem') as dvoj_druhy \gset

reset role;

select pg_temp.check('app.useky_dochazky: první je otevřený',
  (select u.druh from app.useky_dochazky(:'obsluhovana', '2026-09-26', '2026-09-26') u
    where u.prichod_id = :'dvoj_prvni') = 'otevreny');
select pg_temp.check('app.useky_dochazky: druhý je navíc-příchod, ne druhé otevřeno',
  (select u.druh from app.useky_dochazky(:'obsluhovana', '2026-09-26', '2026-09-26') u
    where u.prichod_id = :'dvoj_druhy') = 'navic_prichod');
select pg_temp.check('app.otevreny_prichod ukazuje TENTÝŽ příchod jako mzda — ten PRVNÍ (otázka 33)',
  (select id from app.otevreny_prichod(:'tenant', :'obsluhovana')) = :'dvoj_prvni');

-- Uklidit. POŘADÍ ZÁLEŽÍ: nezapočítaný záznam (navic_prichod) dřív —
-- stornovat_usek_dochazky by storno toho PRVNÍHO (otevřeného) odmítl,
-- protože by tím druhý příchod tiše překlopilo z navic_prichod na
-- otevreny (pravidlo 12, „ostatní úseky dne se nesmí změnit"). Přesně
-- tahle hláška to hlídá — a je to další doklad, že se automat
-- a app.otevreny_prichod teď shodnou na tom, co je „otevřeno".
select set_config('test.user_id', :'majitel', false);
set role authenticated;
select public.stornovat_usek_dochazky(:'tenant', :'obsluhovana', :'dvoj_druhy', null, 'úklid scénáře');
select public.stornovat_usek_dochazky(:'tenant', :'obsluhovana', :'dvoj_prvni', null, 'úklid scénáře');
reset role;

select pg_temp.check('po úklidu: obsluhovaná už nemá žádný otevřený příchod',
  not exists (select 1 from app.otevreny_prichod(:'tenant', :'obsluhovana')));


\echo ''
\echo '=========================================================='
\echo ' KROK 67 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
