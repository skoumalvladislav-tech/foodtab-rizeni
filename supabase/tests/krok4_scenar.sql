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
\echo '=========================================================='
\echo ' KROK 4 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
