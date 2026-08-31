-- Scénář pro krok 4 — nahrávání dat z tabulky a z pokladny.
-- Navazuje na etapa0_scenar.sql, krok2_scenar.sql a krok3_scenar.sql:
-- firma, dvě pobočky, majitel (1111…) i zaměstnanci už existují.
--
-- Zatím pokrývá jen oddíl A zadání (docs/nahravani-dat-zadani.md):
-- rozpoznávací klíče, bez kterých nemá smysl importy začínat. Zbylé
-- kontroly ze zadání — oprávnění, hranice firmy, neznámé značky, klíče
-- k pokladně — přibudou s tím, co budou testovat.
--
-- Kontroly jsou psané tak, aby ověřovaly, že něco NEJDE — druhé
-- spuštění importu nesmí zdvojit řádek. Že šťastná cesta funguje, se
-- pozná i bez testu.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

\echo ''
\echo '== Rozpoznávací klíče (oddíl A) ==========================='
-- Tohle je celý smysl oddílu A: nahrávání se pustí dvakrát a nesmí nic
-- zdvojit. Klíč je proto podmínka na tabulce, ne opatrnost ve skriptu —
-- skript jde obejít ručním vložením nebo druhým importérem.
--
-- Každý blok si zakládá vlastní data. Brát hodnotu z toho, co po sobě
-- nechaly předchozí scénáře, se neosvědčilo: pozice žádná neexistovala,
-- poddotaz vrátil NULL a celý soubor spadl dřív, než došlo na kontroly
-- dělené směny. Test nemá tušit, co je v databázi — má si to založit.

reset role;

-- Zaměstnanec ------------------------------------------------------
do $$
declare v_tenant uuid; v_ok boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  insert into public.employees (tenant_id, full_name)
    values (v_tenant, 'Klíčová Zkouška');

  begin
    insert into public.employees (tenant_id, full_name)
      values (v_tenant, 'Klíčová Zkouška');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: zaměstnanec šel nahrát dvakrát'; end if;
  raise notice '  OK    zaměstnanec: druhé nahrání téhož jména neprojde';

  -- Import dostane jméno z cizí tabulky, kde bývá jinak psané. Kdyby se
  -- porovnávalo přesně, založil by druhého člověka při každém nahrání.
  begin
    insert into public.employees (tenant_id, full_name)
      values (v_tenant, '  klíčová ZKOUŠKA ');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: jméno s jinými mezerami založilo druhý záznam'; end if;
  raise notice '  OK    zaměstnanec: liší-li se jen mezerami a velikostí, je to týž člověk';

  delete from public.employees where tenant_id = v_tenant and full_name = 'Klíčová Zkouška';
end $$;

-- Pravidlo 9: mazání je označení, ne výmaz. Smazaný záznam ale nesmí
-- držet jméno obsazené — po odchodu a návratu téhož člověka by se
-- nedal založit znovu.
do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants limit 1;
  insert into public.employees (tenant_id, full_name, deleted_at)
    values (v_tenant, 'Odešlá Brigádnice', now());
  insert into public.employees (tenant_id, full_name)
    values (v_tenant, 'Odešlá Brigádnice');
  raise notice '  OK    zaměstnanec: smazaný záznam jméno neblokuje';
  delete from public.employees where tenant_id = v_tenant and full_name = 'Odešlá Brigádnice';
end $$;

-- Pozice -----------------------------------------------------------
-- Zakládá se tu vlastní, ne že se vezme název existující: v čisté
-- databázi žádná pozice není a poddotaz by vrátil NULL.
do $$
declare v_tenant uuid; v_ok boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  insert into public.positions (tenant_id, key, label)
    values (v_tenant, 'zkusebni_pozice', 'Zkušební pozice');

  -- Jiný strojový klíč, tentýž název. Podle názvu se trefuje import,
  -- protože v tabulce od zákazníka žádný key není — je tam „Kuchař“.
  begin
    insert into public.positions (tenant_id, key, label)
      values (v_tenant, 'zkusebni_pozice_2', 'zkušební POZICE');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: pozice šla nahrát dvakrát'; end if;
  raise notice '  OK    pozice: druhé nahrání téhož názvu neprojde';

  delete from public.positions where tenant_id = v_tenant and key like 'zkusebni_pozice%';
end $$;

-- Receptura se váže na firmu, ne na pobočku — tak to má oddíl A.
do $$
declare v_tenant uuid; v_ok boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  insert into public.recipes (tenant_id, name) values (v_tenant, 'Svíčková na smetaně');
  begin
    insert into public.recipes (tenant_id, name) values (v_tenant, 'svíčková NA smetaně');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: receptura šla nahrát dvakrát'; end if;
  raise notice '  OK    receptura: druhé nahrání téhož názvu neprojde';
  delete from public.recipes where tenant_id = v_tenant and name ilike 'svíčková%';
end $$;

-- Rozpis: člověk + provozní den + pobočka + začátek směny.
--
-- shift_date JE provozní den. starts_at je v klíči proto, aby šla zadat
-- dělená směna — ráno a večer zvlášť je v gastru běžné, ne výjimka.
-- Rozlišuje se tedy podle času začátku: tentýž znovu je nahrání
-- dvakrát, jiný je druhá směna téhož dne.
do $$
declare
  v_tenant uuid; v_perla uuid; v_druha uuid; v_zam uuid;
  v_den date := date '2026-12-24'; v_ok boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  -- Pobočky jsou z etapy 0. Kdyby chyběly, ať je z hlášky poznat proč,
  -- místo aby se to projevilo jako podivná chyba o něco níž.
  select id into v_perla from public.branches
    where tenant_id = v_tenant order by created_at limit 1;
  select id into v_druha from public.branches
    where tenant_id = v_tenant and id <> v_perla order by created_at limit 1;
  if v_perla is null or v_druha is null then
    raise exception 'SELHALO: scénář čeká dvě pobočky z etapy 0, jsou %',
      (select count(*) from public.branches where tenant_id = v_tenant);
  end if;

  -- Vlastní zaměstnanec, ne první, který se v databázi najde. Cizí by
  -- mohl mít na zkušebním dni směnu už z jiného scénáře nebo ze seedu.
  insert into public.employees (tenant_id, full_name)
    values (v_tenant, 'Dělená Zkouška') returning id into v_zam;

  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, v_zam, v_den, time '07:00', time '15:00');

  -- Totéž ještě jednou = druhé spuštění importu. Nesmí projít, i když
  -- se liší konec — o tom, co je táž směna, rozhoduje začátek.
  begin
    insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
      values (v_tenant, v_perla, v_zam, v_den, time '07:00', time '16:00');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: táž směna šla nahrát dvakrát'; end if;
  raise notice '  OK    rozpis: táž směna (týž začátek) podruhé neprojde';

  -- Dělená směna: tentýž člověk, tentýž den, tatáž pobočka, jiný
  -- začátek. Tohle projít MUSÍ — kvůli tomu je starts_at v klíči.
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, v_zam, v_den, time '17:00', time '23:00');
  raise notice '  OK    rozpis: dělená směna téhož dne projde';

  -- Neobsazená směna je „sem někoho potřebujeme“ a na jednom dni jich
  -- může být víc. Prázdné employee_id se v jedinečném indexu nerovná
  -- prázdnému, takže je klíč neomezuje — a nesmí. Schválně se stejným
  -- začátkem, ať se ověří právě tohle, a ne rozdíl v čase.
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, null, v_den, time '07:00', time '15:00');
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, null, v_den, time '07:00', time '15:00');
  raise notice '  OK    rozpis: neobsazených směn smí být na jednom dni víc';

  -- Tentýž člověk na druhé pobočce téhož dne projít musí: klíč je
  -- vázaný i na pobočku.
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_druha, v_zam, v_den, time '07:00', time '15:00');
  raise notice '  OK    rozpis: druhá pobočka téhož dne projde';

  -- Uklidit po sobě: nejdřív směny, pak zaměstnanec.
  delete from public.shifts where tenant_id = v_tenant and shift_date = v_den;
  delete from public.employees where id = v_zam;
end $$;

-- Klíče, které tabulky měly už dřív. Kdyby některý zmizel, import by
-- začal zakládat kopie a poznalo by se to až podle zdvojených dat.
select pg_temp.check('pobočka se pozná podle slug',
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.branches'::regclass and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, slug)'));
select pg_temp.check('role se pozná podle key',
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.roles'::regclass and c.contype = 'u'
      and pg_get_constraintdef(c.oid) = 'UNIQUE (tenant_id, key)'));

\echo ''
\echo '== Mzdy: sazba a výdělek (docs/mzdy-zadani.md) ============'
-- Nejcitlivější data v aplikaci. Kontroly jsou psané tak, aby ověřovaly,
-- že se někdo NEDOSTANE k cizí sazbě — ne že se vlastní spočítá.
--
-- Postavy jsou z předchozích scénářů: majitel 1111…, číšník Marek 5555…
-- s rolí servis na Perle a vlastním zaměstnaneckým záznamem.

reset role;

select id as tenant  from public.tenants limit 1 \gset
select id as perla   from public.branches where slug = 'cerna-perla' \gset
select id as bar     from public.branches where slug = 'bernard-bar' \gset
select id as marek   from public.employees where full_name = 'Marek Číšník' \gset
select id as majitel from public.employees
  where user_id = '11111111-1111-1111-1111-111111111111' \gset

-- Sazby zakládá majitel průzorem, ne přímým insertem — ať se ověří
-- i to, že set_rate funguje a zapisuje audit.
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select public.set_rate(:'tenant', :'marek',   22000, date '2026-09-01', 'nástup') as r1 \gset
select public.set_rate(:'tenant', :'majitel', 30000, date '2026-09-01', '')       as r2 \gset

select pg_temp.check('změna sazby je v auditu',
  exists (select 1 from public.audit_log
          where action = 'rate.set' and entity_id = :'marek'));

-- Zadání §5.3: přes API se sazby po řádcích nečtou. Průzor ano, tabulka ne.
do $$
declare v_ok boolean := false;
begin
  begin perform 1 from public.employee_rates limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: select nad employee_rates prošel'; end if;
  raise notice '  OK    sazby: select nad tabulkou jako authenticated selže';
end $$;

-- Historie se nepřepisuje ani nemaže. Pravidlo na tabulce platí i na
-- majitele — sazba je historie, ne údaj, který se přepíše.
reset role;
do $$
declare v_pred integer; v_po integer;
begin
  select count(*)::integer into v_pred from public.employee_rates;
  update public.employee_rates set hourly_haleru = 1;
  select count(*)::integer into v_po from public.employee_rates;
  if v_pred <> v_po then raise exception 'SELHALO: úpravou zmizel řádek'; end if;
  if exists (select 1 from public.employee_rates where hourly_haleru = 1) then
    raise exception 'SELHALO: sazba šla přepsat';
  end if;
  raise notice '  OK    sazby: řádek nejde přepsat, změna je nový řádek';
end $$;

-- Odpracovaná doba a přelom provozního dne. Příchod v 18:00 a odchod
-- ve 2:15 patří do TÉHOŽ provozního dne — a tím i do téhož měsíce.
reset role;
insert into public.attendance_events
  (tenant_id, branch_id, employee_id, kind, occurred_at, business_date)
values
  (:'tenant', :'perla', :'marek', 'in',  '2026-09-02 07:00+02', '2026-09-02'),
  (:'tenant', :'perla', :'marek', 'out', '2026-09-02 15:00+02', '2026-09-02'),
  (:'tenant', :'perla', :'marek', 'in',  '2026-09-03 07:00+02', '2026-09-03'),
  (:'tenant', :'perla', :'marek', 'in',  '2026-09-30 18:00+02', '2026-09-30'),
  (:'tenant', :'perla', :'marek', 'out', '2026-10-01 02:15+02', '2026-09-30');

select pg_temp.check('výdělek jen z uzavřené docházky (rozpracovaný den nezvýší částku)',
  (select odpracovano_minut from app.earnings(:'marek', date '2026-09-01')) = 480 + 495);

-- Přestávky. Zapsaná dvojice se odečítá, nezapsaná se neodhaduje.
-- Vlastní zaměstnanec, ať se to nemíchá s Markovými dny výš.
do $$
declare
  v_tenant uuid; v_perla uuid; v_zam uuid; v_minut integer;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches
    where tenant_id = v_tenant order by created_at limit 1;
  insert into public.employees (tenant_id, branch_id, full_name)
    values (v_tenant, v_perla, 'Pauzová Zkouška') returning id into v_zam;

  -- Osmihodinová směna s půlhodinovou přestávkou = 7,5 hodiny.
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, occurred_at, business_date)
  values
    (v_tenant, v_perla, v_zam, 'in',          '2026-09-05 07:00+02', '2026-09-05'),
    (v_tenant, v_perla, v_zam, 'break_start', '2026-09-05 11:00+02', '2026-09-05'),
    (v_tenant, v_perla, v_zam, 'break_end',   '2026-09-05 11:30+02', '2026-09-05'),
    (v_tenant, v_perla, v_zam, 'out',         '2026-09-05 15:00+02', '2026-09-05');

  select minut into v_minut
  from app.worked_minutes(v_zam, date '2026-09-05', date '2026-09-05');
  if v_minut is distinct from 450 then
    raise exception 'SELHALO: 8 h s půlhodinovou přestávkou dalo % min místo 450', v_minut;
  end if;
  raise notice '  OK    přestávka se odečítá: 8 h s půlhodinovou pauzou je 7,5 h';

  -- Nedokončená přestávka nesmí výpočet shodit ani odečíst odhadem.
  -- Kdo se z pauzy nevrátil píchnutím, má ji ve mzdě.
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, occurred_at, business_date)
  values
    (v_tenant, v_perla, v_zam, 'in',          '2026-09-06 07:00+02', '2026-09-06'),
    (v_tenant, v_perla, v_zam, 'break_start', '2026-09-06 11:00+02', '2026-09-06'),
    (v_tenant, v_perla, v_zam, 'out',         '2026-09-06 15:00+02', '2026-09-06');

  select minut into v_minut
  from app.worked_minutes(v_zam, date '2026-09-06', date '2026-09-06');
  if v_minut is distinct from 480 then
    raise exception 'SELHALO: nedokončená přestávka odečetla % min, měla nic', 480 - v_minut;
  end if;
  raise notice '  OK    nedokončená přestávka neodečte nic a nic neshodí';

  delete from public.attendance_events where employee_id = v_zam;
  delete from public.employees where id = v_zam;
end $$;
select pg_temp.check('odchod ve 2:15 se počítá do včerejška, ne do dalšího měsíce',
  (select odpracovano_minut from app.earnings(:'marek', date '2026-10-01')) = 0);

-- Zvýšení sazby uprostřed měsíce nesmí sáhnout na dny před platností.
set role authenticated;
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select public.set_rate(:'tenant', :'marek', 30000, date '2026-09-15', 'přidáno') as r3 \gset

-- 2. 9. je před platností, tak zůstává na staré sazbě; 30. 9. je po ní,
-- tak dostane novou. Kdyby vyšly obě dny stejně, znamenalo by to, že se
-- zvýšení buď nepropsalo vůbec, nebo přepsalo i minulost — obojí špatně.
select pg_temp.check('zvýšení sazby platí od valid_from dál, dřívější dny nechává být',
  (select vydelano_haleru from app.earnings(:'marek', date '2026-09-01'))
    = round((480 * 22000 + 495 * 30000)::numeric / 60));

-- Zadání §4: na vlastní mzdu není potřeba právo.
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);
select pg_temp.check('číšník vidí svůj výdělek bez jakéhokoli oprávnění',
  (select odpracovano_minut from public.my_earnings(:'tenant', date '2026-09-01')) = 480 + 495);
select pg_temp.check('číšník vidí svou vlastní sazbu',
  (select hodinova_haleru from public.my_earnings(:'tenant', date '2026-09-01')) = 30000);

-- A tohle je jádro věci: na cizí mzdu právo potřebuje. Role servis
-- payroll.read nemá, takže průzor nevrátí ani řádek — ani jeho vlastní.
select pg_temp.check('číšník nevidí výdělky nikoho, ani své, přes cizí průzor',
  (select count(*) from public.employee_earnings(:'tenant', date '2026-09-01', null)) = 0);

-- Majitel má právo na všechno v aktivních modulech, takže vidí oba.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('majitel vidí výdělky lidí, na které má',
  (select count(*) from public.employee_earnings(:'tenant', date '2026-09-01', null)) >= 2);

-- Rozsah platí i u mezd (pravidlo 4): filtr na pobočku nesmí pustit
-- víc, než na co má volající členství.
select pg_temp.check('filtr na pobočku vrací jen její lidi',
  not exists (
    select 1 from public.employee_earnings(:'tenant', date '2026-09-01', :'bar') v
    where v.branch_id is distinct from :'bar'::uuid));

-- Zadání §4: people.manage NESTAČÍ. Kdo spravuje lidi, nemusí vidět
-- na mzdy — jsou to dvě různé role.
reset role;
do $$
declare v_role uuid;
begin
  select r.id into v_role from public.roles r where r.key = 'provozni' limit 1;

  if exists (select 1 from public.role_permissions
             where role_id = v_role and permission_key in ('payroll.read', 'payroll.manage')) then
    raise exception 'SELHALO: Provozní dostal mzdové oprávnění ze šablony';
  end if;
  if not exists (select 1 from public.role_permissions
                 where role_id = v_role and permission_key = 'people.manage') then
    raise exception 'SELHALO: Provozní nemá people.manage, test neměří, co má';
  end if;
  raise notice '  OK    Provozní má people.manage, ale ne mzdová oprávnění';
end $$;

select pg_temp.check('mzdová oprávnění jsou citlivá (nejdou pozvat přes SMS)',
  (select bool_and(sensitive) from public.permissions
   where key in ('payroll.read', 'payroll.manage')));

\echo ''
\echo '== Audit změn u lidí, rolí a oprávnění ===================='
-- Úprava zaměstnance a přidělení role se dělají obyčejným update přímo
-- z aplikace, takže po nich dřív nezůstávala žádná stopa. Hlídá to
-- spoušť, ne volání z akce — platí tak i na import a ruční SQL.

reset role;

do $$
declare
  v_tenant uuid; v_perla uuid; v_id uuid; v_pred bigint; v_zaznam record;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches
    where tenant_id = v_tenant order by created_at limit 1;

  insert into public.employees (tenant_id, branch_id, full_name, employment_type)
    values (v_tenant, v_perla, 'Auditovaná Osoba', 'hpp') returning id into v_id;

  update public.employees set employment_type = 'jine' where id = v_id;

  select action, before, after into v_zaznam
  from public.audit_log
  where entity_type = 'employee' and entity_id = v_id::text and action = 'employee.update'
  order by occurred_at desc limit 1;

  if v_zaznam is null then
    raise exception 'SELHALO: úprava zaměstnance se nezapsala do auditu';
  end if;
  if v_zaznam.before <> jsonb_build_object('employment_type', 'hpp')
     or v_zaznam.after <> jsonb_build_object('employment_type', 'jine') then
    raise exception 'SELHALO: audit nezapsal, co se změnilo z čeho na co (% → %)',
      v_zaznam.before, v_zaznam.after;
  end if;
  raise notice '  OK    úprava zaměstnance je v auditu i s hodnotou před a po';

  -- Uložení formuláře beze změny nemá audit zaplevelit.
  select count(*) into v_pred from public.audit_log where entity_id = v_id::text;
  update public.employees set employment_type = 'jine' where id = v_id;
  if (select count(*) from public.audit_log where entity_id = v_id::text) <> v_pred then
    raise exception 'SELHALO: uložení beze změny zapsalo audit';
  end if;
  raise notice '  OK    uložení beze změny do auditu nejde';

  -- Pravidlo 9: mazání je označení, tedy update. Musí být vidět taky.
  update public.employees set deleted_at = now() where id = v_id;
  if not exists (
    select 1 from public.audit_log
    where entity_id = v_id::text and after ? 'deleted_at'
  ) then
    raise exception 'SELHALO: označení za smazané není v auditu';
  end if;
  raise notice '  OK    označení zaměstnance za smazaného je v auditu';

  delete from public.employees where id = v_id;
end $$;

-- Oprávnění: role_permissions nemá tenant_id, firma se dohledává přes
-- roli. Kdyby to přestalo fungovat, audit by u oprávnění mlčel.
do $$
declare v_role uuid;
begin
  select id into v_role from public.roles where key = 'servis' limit 1;
  insert into public.role_permissions (role_id, permission_key)
    values (v_role, 'payroll.read') on conflict do nothing;

  if not exists (
    select 1 from public.audit_log
    where entity_type = 'permission'
      and entity_id = v_role::text || ':payroll.read'
  ) then
    raise exception 'SELHALO: přidání oprávnění není v auditu';
  end if;
  raise notice '  OK    přidání oprávnění roli je v auditu';

  delete from public.role_permissions
  where role_id = v_role and permission_key = 'payroll.read';
  if not exists (
    select 1 from public.audit_log
    where entity_type = 'permission' and action = 'permission.delete'
  ) then
    raise exception 'SELHALO: odebrání oprávnění není v auditu';
  end if;
  raise notice '  OK    odebrání oprávnění roli je v auditu';
end $$;

\echo ''
\echo '== Obrazovka Oprávnění ===================================='
-- Obrazovka je zavřená na settings.manage. Schovaná položka v nabídce
-- není zámek — zámek je kontrola na stránce a politiky pod ní. Kdo si
-- adresu napíše ručně, nesmí se dostat dál.

set role authenticated;

-- Číšník Marek (role servis) settings.manage nemá.
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);
select pg_temp.check('číšník nemá settings.manage, obrazovka Oprávnění ho odmítne',
  not app.has_access(:'tenant', 'settings.manage', null));

-- A nesmí ani zapisovat. Politika role_permissions_write ho zastaví
-- i tehdy, když by kontrolu na stránce nějak obešel.
do $$
declare v_role uuid; v_ok boolean := false;
begin
  select id into v_role from public.roles where key = 'servis' limit 1;
  begin
    insert into public.role_permissions (role_id, permission_key)
      values (v_role, 'settings.manage');
  -- Chytá se jenom 42501. Kdyby se chytalo „others“, prošel by test
  -- i po překlepu v názvu sloupce — a tvářil by se jako důkaz.
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok and exists (
    select 1 from public.role_permissions
    where role_id = v_role and permission_key = 'settings.manage'
  ) then
    raise exception 'SELHALO: číšník si přidal settings.manage';
  end if;
  raise notice '  OK    číšník si oprávnění nepřidá ani přímým zápisem';
end $$;

-- Provozní má people.manage a NEMÁ settings.manage. Přesně o něm to je:
-- kdo zakládá lidi, nesmí rozhodovat, kdo uvidí mzdy. Dokud politika
-- role_permissions_write stála na people.manage, přidal si payroll.read
-- k vlastní roli přímým dotazem — obrazovka ho nepustila, databáze ano.

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-7777-7777-777777777777', 'provozni@foodtab.cz',
   '{"full_name":"Provozní Zkouška"}')
on conflict (id) do nothing;

insert into public.memberships (tenant_id, user_id, role_id, status, scope)
select :'tenant', '77777777-7777-7777-7777-777777777777', r.id, 'active', 'tenant'
from public.roles r where r.tenant_id = :'tenant' and r.key = 'provozni'
on conflict do nothing;

set role authenticated;
select set_config('test.user_id', '77777777-7777-7777-7777-777777777777', false);
select pg_temp.check('provozní zakládá lidi',
  app.has_access(:'tenant', 'people.manage', null));
select pg_temp.check('a nastavení firmy nemá',
  not app.has_access(:'tenant', 'settings.manage', null));

do $
declare v_role uuid; v_ok boolean := false; v_pred int; v_po int;
begin
  select id into v_role from public.roles where key = 'servis' limit 1;

  begin
    insert into public.role_permissions (role_id, permission_key)
      values (v_role, 'payroll.read');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok and exists (
    select 1 from public.role_permissions
    where role_id = v_role and permission_key = 'payroll.read'
  ) then
    raise exception 'SELHALO: provozní si přidal payroll.read přímým dotazem';
  end if;
  raise notice '  OK    provozní oprávnění nepřidá ani přímým dotazem';

  -- Mazání RLS nezakřičí, jen nic nesmaže. Kontroluje se proto počet
  -- před a po — tichý průchod by jinak vypadal jako úspěch.
  select count(*) into v_pred from public.role_permissions where role_id = v_role;
  delete from public.role_permissions where role_id = v_role;
  select count(*) into v_po from public.role_permissions where role_id = v_role;
  if v_po <> v_pred then
    raise exception 'SELHALO: provozní smazal % oprávnění', v_pred - v_po;
  end if;
  raise notice '  OK    provozní oprávnění ani nemaže';
end $;

-- Majitel se needituje: jeho sada se nebere z role_permissions, ale
-- z aktivních modulů. Obrazovka ho proto kreslí jen ke čtení.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('majitel má settings.manage a na obrazovku se dostane',
  app.has_access(:'tenant', 'settings.manage', null));
select pg_temp.check('majitel má právo, které nemá v role_permissions',
  app.has_access(:'tenant', 'payroll.read', null)
  and not exists (
    select 1 from public.role_permissions rp
    join public.roles r on r.id = rp.role_id
    where r.tenant_id = :'tenant' and r.is_owner and rp.permission_key = 'payroll.read'));

-- Mzdy a docházka musí být označené jako citlivé — obrazovka je podle
-- toho odlišuje a app.create_invitation podle toho zakazuje SMS.
select pg_temp.check('mzdová a docházková práva jsou citlivá',
  (select bool_and(sensitive) from public.permissions
   where key in ('payroll.read', 'payroll.manage', 'payroll.export',
                 'attendance.read', 'attendance.manage')));

\echo ''
\echo '== Nahrání lidí z tabulky (oddíl B) ======================='
-- Import nesmí být obchvat oprávnění ani hranice firmy. Obojí drží
-- databáze, ne aplikace: import běží pod přihlášeným člověkem, obyčejným
-- klientem a se zapnutou RLS — žádné security definer, žádný servisní
-- klíč. Kontroly jsou proto psané tak, aby ověřovaly, že to NEJDE.
--
-- Že se druhé spuštění nezdvojí, se ověřuje výš u rozpoznávacích klíčů.
-- Co aplikace nepozná (neznámá pobočka, neznámý typ poměru), řeší náhled
-- ještě před zápisem — na to je scripts/nahrani-lidi.test.mjs.

set role authenticated;

-- Číšník Marek people.manage nemá.
select set_config('test.user_id', '55555555-5555-5555-5555-555555555555', false);
select pg_temp.check('číšník nesmí zakládat lidi ani souborem',
  not app.has_access(:'tenant', 'people.manage', null));

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.employees (tenant_id, full_name)
      values ((select id from public.tenants limit 1), 'Importem Podstrčený');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then
    raise exception 'SELHALO: bez people.manage šel zaměstnanec založit';
  end if;
  raise notice '  OK    bez people.manage se zaměstnanec nezaloží';
end $$;

-- Zápis do auditu o nahrání je zavřený na totéž právo. Kdo nesmí
-- nahrávat, nesmí ani zapsat, že nahrál.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.audit_import(
      (select id from public.tenants limit 1), 'lide', 'podvrh.csv', 99, 0, 0);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí člověk zapsal nahrání do auditu'; end if;
  raise notice '  OK    bez práva se do auditu nahrání nezapíše';
end $$;

-- Hranice firmy. Řádek s cizím tenant_id neprojde ani majiteli téhle.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
do $$
declare v_cizi uuid := gen_random_uuid(); v_ok boolean := false;
begin
  begin
    insert into public.employees (tenant_id, full_name)
      values (v_cizi, 'Cizí Firma Zkouška');
  exception when insufficient_privilege or foreign_key_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: řádek s cizím tenant_id prošel'; end if;
  raise notice '  OK    řádek s cizí firmou se nenahraje';
end $$;

-- A nahrání jako celek je v auditu: kdo, co, kdy a kolik řádků.
do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants limit 1;
  perform public.audit_import(v_tenant, 'lide', 'lidi.xlsx', 14, 6, 2);
  if not exists (
    select 1 from public.audit_log
    where action = 'import.lide'
      and after ->> 'soubor' = 'lidi.xlsx'
      and (after ->> 'zalozeno')::int = 14
      and (after ->> 'aktualizovano')::int = 6
      and (after ->> 'preskoceno')::int = 2
  ) then
    raise exception 'SELHALO: nahrání není v auditu i s počty';
  end if;
  raise notice '  OK    nahrání je v auditu i s počty řádků';
end $$;

-- Co aplikace neumí nahrávat, se do auditu nedostane pod cizí hlavičkou.
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.audit_import(
      (select id from public.tenants limit 1), 'mzdy', 'x.csv', 1, 0, 0);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neznámý druh nahrávání prošel'; end if;
  raise notice '  OK    neznámý druh nahrávání se odmítne';
end $$;

\echo ''
\echo '== Nikdo nepřidělí víc, než má sám ======================='
-- Zadání: docs/pravidlo-neprideluj-vic.md
--
-- Kdo přiděluje roli, musí sám mít všechno, co ta role obsahuje,
-- v rozsahu, který přiděluje. Dřív stačil people.manage — kdo zakládá
-- lidi, mohl komukoli i sobě přidělit Majitele a získat všechno.
--
-- Zámek je na třech místech a testují se všechna: členství, rozsah
-- členství a pozvánka. Pozvánka je ta, na kterou se zapomíná — kdo
-- nemůže přidělit roli přímo, poslal by ji s pozvánkou.

reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('88888888-8888-8888-8888-888888888888', 'cil@foodtab.cz',
   '{"full_name":"Cíl Přidělení"}')
on conflict (id) do nothing;

select id as r_majitel from public.roles
  where tenant_id = :'tenant' and is_owner \gset
select id as r_servis from public.roles
  where tenant_id = :'tenant' and key = 'servis' \gset
select id as r_ucetni from public.roles
  where tenant_id = :'tenant' and key = 'ucetni' \gset

-- Provozní: people.manage má, settings.manage ani payroll.read ne.
set role authenticated;
select set_config('test.user_id', '77777777-7777-7777-7777-777777777777', false);

-- 1. Majitelskou roli jen vlastník.
do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.memberships (tenant_id, user_id, role_id, scope)
    select t.id, '88888888-8888-8888-8888-888888888888',
           (select id from public.roles where tenant_id = t.id and is_owner), 'tenant'
    from public.tenants t limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: provozní přidělil roli Majitel'; end if;
  raise notice '  OK    provozní roli Majitel nepřidělí';
end $$;

-- A ani sám sobě. Úprava přes RLS nekřičí, jen nic neudělá — porovnává
-- se proto stav před a po, ne návratový kód.
do $$
declare v_pred uuid; v_po uuid; v_majitel uuid;
begin
  select role_id into v_pred from public.memberships
   where user_id = '77777777-7777-7777-7777-777777777777';
  select id into v_majitel from public.roles where is_owner limit 1;

  update public.memberships set role_id = v_majitel
   where user_id = '77777777-7777-7777-7777-777777777777';

  select role_id into v_po from public.memberships
   where user_id = '77777777-7777-7777-7777-777777777777';
  if v_po is distinct from v_pred then
    raise exception 'SELHALO: provozní se povýšil na Majitele';
  end if;
  raise notice '  OK    provozní se nepovýší ani sám sobě';
end $$;

-- 2. Roli s právem, které sám nemá, taky ne.
select pg_temp.check('provozní payroll.read opravdu nemá',
  not app.has_access(:'tenant', 'payroll.read', null));

do $$
declare v_ok boolean := false; v_ucetni uuid;
begin
  select id into v_ucetni from public.roles where key = 'ucetni' limit 1;
  begin
    insert into public.memberships (tenant_id, user_id, role_id, scope)
    select t.id, '88888888-8888-8888-8888-888888888888', v_ucetni, 'tenant'
    from public.tenants t limit 1;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: provozní přidělil Účetní i bez payroll.read'; end if;
  raise notice '  OK    provozní nepřidělí roli s právem, které nemá';
end $$;

-- 3. Roli, kterou má celou, přidělit smí.
do $$
declare v_servis uuid;
begin
  select id into v_servis from public.roles where key = 'servis' limit 1;
  insert into public.memberships (tenant_id, user_id, role_id, scope)
  select t.id, '88888888-8888-8888-8888-888888888888', v_servis, 'branch'
  from public.tenants t limit 1;
  raise notice '  OK    provozní roli Servis přidělí';
end $$;

reset role;
delete from public.memberships where user_id = '88888888-8888-8888-8888-888888888888';
set role authenticated;
select set_config('test.user_id', '77777777-7777-7777-7777-777777777777', false);

-- 3b. Právo z modulu, který firma nemá, nesmí bránit v přidělení.
-- Šablona Účetní nosí finance.read; bez modulu Finance to nikomu nic
-- neotevírá a strop se z něj počítat nesmí, jinak by roli nepřidělil
-- ani vlastník firmy.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
select pg_temp.check('finance.read nedává ve firmě bez modulu nic ani vlastníkovi',
  not app.has_access(:'tenant', 'finance.read', null));
select pg_temp.check('a přesto vlastník roli Účetní přidělí',
  app.smi_pridelit(:'tenant', :'r_ucetni', 'tenant'));

select set_config('test.user_id', '77777777-7777-7777-7777-777777777777', false);

-- 4. Totéž přes pozvánku. Bez toho by se tabulka obešla.
do $$
declare v_ok boolean; v_role uuid;
begin
  for v_role in
    select id from public.roles where is_owner
    union all
    select id from public.roles where key = 'ucetni'
  loop
    v_ok := false;
    begin
      perform app.create_invitation(
        (select id from public.tenants limit 1), v_role, 'email', 'cil@foodtab.cz');
    exception when insufficient_privilege then v_ok := true;
    end;
    if not v_ok then
      raise exception 'SELHALO: pozvánka obešla strop u role %', v_role;
    end if;
  end loop;
  raise notice '  OK    pozvánka s cizí rolí neprojde';

  select id into v_role from public.roles where key = 'servis' limit 1;
  perform app.create_invitation(
    (select id from public.tenants limit 1), v_role, 'email', 'cil@foodtab.cz');
  raise notice '  OK    pozvánka se Servisem projde';
end $$;

-- 5. Rozsah. Klára je vedoucí směny na Perle — people.manage nemá vůbec,
-- takže ji zastaví už první závora. Strop na rozsahu se proto ověřuje
-- přímo na funkci: drží, až se správa lidí po pobočkách povolí.
select set_config('test.user_id', '22222222-2222-2222-2222-222222222222', false);
select pg_temp.check('vedoucí směny lidi nespravuje',
  not app.has_access(:'tenant', 'people.manage', null));
select pg_temp.check('na své pobočce by Servis přidělila',
  app.smi_pridelit(:'tenant', :'r_servis', 'branch', array[:'perla']::uuid[]));
select pg_temp.check('na cizí pobočce ne',
  not app.smi_pridelit(:'tenant', :'r_servis', 'branch', array[:'bar']::uuid[]));
select pg_temp.check('a Účetní nikde',
  not app.smi_pridelit(:'tenant', :'r_ucetni', 'branch', array[:'perla']::uuid[]));
select pg_temp.check('majitelskou roli nepřidělí ani na vlastní pobočce',
  not app.smi_pridelit(:'tenant', :'r_majitel', 'branch', array[:'perla']::uuid[]));

-- 6. Vlastní členství neupraví nikdo, ani vlastník.
select set_config('test.user_id', '11111111-1111-1111-1111-111111111111', false);
do $$
declare v_pred text; v_po text;
begin
  select scope into v_pred from public.memberships
   where user_id = '11111111-1111-1111-1111-111111111111';
  update public.memberships set scope = 'branch'
   where user_id = '11111111-1111-1111-1111-111111111111';
  select scope into v_po from public.memberships
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_po is distinct from v_pred then
    raise exception 'SELHALO: vlastník si upravil vlastní členství';
  end if;
  raise notice '  OK    vlastní členství neupraví ani vlastník';
end $$;

-- Vlastník ale Majitele přidělit smí — strop nesmí zavřít i to, co má
-- zůstat otevřené.
do $$
declare v_majitel uuid;
begin
  select id into v_majitel from public.roles where is_owner limit 1;
  insert into public.memberships (tenant_id, user_id, role_id, scope)
  select t.id, '88888888-8888-8888-8888-888888888888', v_majitel, 'tenant'
  from public.tenants t limit 1;
  raise notice '  OK    vlastník roli Majitel přidělí';
end $$;

reset role;
delete from public.memberships where user_id = '88888888-8888-8888-8888-888888888888';
delete from public.invitations where email = 'cil@foodtab.cz';
set role authenticated;

reset role;
select set_config('test.user_id', '', false);

\echo ''
\echo '=========================================================='
\echo ' KROK 4 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
