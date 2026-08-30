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

-- Zkusí příkaz a řekne, jestli spadl na porušení jedinečnosti. Cokoli
-- jiného propustí dál — test nemá tvrdit „klíč drží“, když se ve
-- skutečnosti narazilo na chybějící sloupec nebo odepřený přístup.
create or replace function pg_temp.zdvojeni(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception
  when unique_violation then return true;
end $$;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

\echo ''
\echo '== Rozpoznávací klíče (oddíl A) ==========================='
-- Tohle je celý smysl oddílu A: nahrávání se pustí dvakrát a nesmí nic
-- zdvojit. Klíč je proto podmínka na tabulce, ne opatrnost ve skriptu —
-- skript jde obejít ručním vložením nebo druhým importérem.

reset role;

select pg_temp.check('zaměstnanec: druhé nahrání téhož jména neprojde',
  pg_temp.zdvojeni(format(
    'insert into public.employees (tenant_id, full_name) values (%L, %L)',
    :'tenant', 'Jana Kuchařka')));

-- Import dostane jméno z cizí tabulky, kde bývá jinak psané. Kdyby se
-- porovnávalo přesně, založil by druhou Janu při každém nahrání.
select pg_temp.check('zaměstnanec: liší-li se jen mezerami a velikostí, je to týž člověk',
  pg_temp.zdvojeni(format(
    'insert into public.employees (tenant_id, full_name) values (%L, %L)',
    :'tenant', '  jana KUCHAŘKA ')));

-- Pravidlo 9: mazání je označení, ne výmaz. Smazaný záznam ale nesmí
-- držet jméno obsazené — po odchodu a návratu téhož člověka by se
-- nedal založit znovu.
do $$
declare v_id uuid; v_tenant uuid;
begin
  select id into v_tenant from public.tenants limit 1;
  insert into public.employees (tenant_id, full_name, deleted_at)
    values (v_tenant, 'Odešlá Brigádnice', now()) returning id into v_id;
  insert into public.employees (tenant_id, full_name)
    values (v_tenant, 'Odešlá Brigádnice');
  raise notice '  OK    zaměstnanec: smazaný záznam jméno neblokuje';
  delete from public.employees where full_name = 'Odešlá Brigádnice';
end $$;

select pg_temp.check('pozice: druhé nahrání téhož názvu neprojde',
  pg_temp.zdvojeni(format(
    'insert into public.positions (tenant_id, key, label) values (%L, %L, %L)',
    :'tenant', 'kuchar_2', (select label from public.positions
                            where tenant_id = :'tenant' limit 1))));

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

-- Rozpis: člověk + provozní den + pobočka. shift_date JE provozní den.
do $$
declare v_tenant uuid; v_perla uuid; v_zam uuid; v_den date := date '2026-12-24'; v_ok boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_perla from public.branches where slug = 'cerna-perla';
  select id into v_zam from public.employees
    where tenant_id = v_tenant and deleted_at is null limit 1;

  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, v_zam, v_den, time '07:00', time '15:00');
  begin
    insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
      values (v_tenant, v_perla, v_zam, v_den, time '15:00', time '23:00');
    v_ok := false;
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: rozpis šlo nahrát dvakrát'; end if;
  raise notice '  OK    rozpis: druhá směna téhož člověka na tentýž den a pobočku neprojde';

  -- Neobsazená směna je „sem někoho potřebujeme“ a na jednom dni jich
  -- může být víc. Prázdné employee_id se v jedinečném indexu nerovná
  -- prázdnému, takže je klíč neomezuje — a nesmí.
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, null, v_den, time '07:00', time '15:00');
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    values (v_tenant, v_perla, null, v_den, time '15:00', time '23:00');
  raise notice '  OK    rozpis: neobsazených směn smí být na jednom dni víc';

  -- Tentýž člověk na druhé pobočce téhož dne projít musí: klíč je
  -- vázaný i na pobočku.
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
    select v_tenant, b.id, v_zam, v_den, time '07:00', time '15:00'
    from public.branches b where b.slug = 'bernard-bar';
  raise notice '  OK    rozpis: druhá pobočka téhož dne projde';

  delete from public.shifts where shift_date = v_den;
end $$;

-- Klíče, které tabulky měly už dřív. Kdyby některý zmizel, import by
-- začal zakládat kopie a poznalo by se to až podle zdvojených dat.
select pg_temp.check('pobočka se pozná podle slug',
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.branches'::regclass and c.contype = 'u'
      and pg_get_constraintdef(c) = 'UNIQUE (tenant_id, slug)'));
select pg_temp.check('role se pozná podle key',
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.roles'::regclass and c.contype = 'u'
      and pg_get_constraintdef(c) = 'UNIQUE (tenant_id, key)'));

\echo ''
\echo '=========================================================='
\echo ' KROK 4 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
