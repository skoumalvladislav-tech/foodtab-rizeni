-- Scénář pro krok 32 — mazání směn
--
-- Pokrývá migraci 20260909080000_mazani_smen a hlášení Šéfíka
-- z provozu 9. 9.: „v kalendáři směn nejdou mazat směny, jenom
-- přidávat."
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Maže se JEN NEVYDANÁ směna. Lidem se ukazuje vydaná podoba rozpisu,
-- takže smazání vydané směny by ji z jejich rozpisu odstranilo hned —
-- bez vydání a bez upozornění. To je ta nejdražší záměna, jaká tu jde
-- udělat: „nemusíš přijít" se nesmí stát potichu.
--
-- A protože `public.smazat_smenu` je `security definer`, neuplatní se
-- uvnitř ní RLS (nálezy, oddíl 7b). Druhá obranná linie tam není,
-- takže si filtr na firmu musí udělat sama — a právě na to míří
-- kontrola s cizí firmou níž.

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
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as majitel from public.profiles
 where email = 'majitel@foodtab.cz' \gset

/*
  Zaměstnanec s ÚČTEM. Rozdíl rozpisu hlásí jen lidem, kteří se můžou
  přihlásit (`e.user_id is not null`, 20260901130000 ř. 153) — komu
  jinému by se zrušení oznamovalo. Bez účtu by se směna do rozdílu
  nedostala a kontrola níž by spadla nad správným kódem.
*/
insert into auth.users (id, email)
values ('32320000-0000-0000-0000-000000000032', 'smenar.k32@foodtab.cz')
on conflict (id) do nothing;

insert into public.profiles (user_id, email, full_name)
values ('32320000-0000-0000-0000-000000000032', 'smenar.k32@foodtab.cz', 'Krok32 Smenar')
on conflict (user_id) do nothing;

insert into public.employees
  (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '32320000-0000-0000-0000-000000000032',
        'Krok32 Smenar', 'hpp')
returning id as e_smenar \gset

-- Nevydaná směna.
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'e_smenar', date '2026-10-20', '08:00', '16:00')
returning id as s_nevydana \gset

/*
  Vydaná směna. Nese i to, CO bylo vydané — a je to podstatné:
  `app.rozdil_rozpisu` porovnává `published_status` (20260901130000,
  ř. 160), takže směna jen s `published_at` se z rozdílu vyfiltruje
  a kontrola níž by spadla nad SPRÁVNÝM kódem.
*/
insert into public.shifts
  (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at,
   published_at, published_status, published_employee_id,
   published_starts_at, published_ends_at)
values (:'tenant', :'perla', :'e_smenar', date '2026-10-21', '08:00', '16:00',
        now(), 'planned', :'e_smenar', '08:00', '16:00')
returning id as s_vydana \gset

select id as cizi_tenant from public.tenants
 where name <> 'Foodtab s.r.o.' limit 1 \gset

-- Do `do $$` bloků se psql proměnné nedostanou — předávají se přes
-- nastavení sezení, a nastavit se musí DŘÍV, než je někdo přečte.
-- Vzor je krok7_scenar.
select set_config('test.tenant', :'tenant', false);
select set_config('test.vydana', :'s_vydana', false);
select set_config('test.cizi',   :'cizi_tenant', false);

select pg_temp.check('příprava: obě směny stojí',
  (select count(*) from public.shifts
    where id in (:'s_nevydana', :'s_vydana')) = 2);


\echo ''
\echo '== 1. Nevydaná směna se smaže ==========================='

select set_config('test.user_id', :'majitel', false);

select public.smazat_smenu(:'tenant', :'s_nevydana');

select pg_temp.check('nevydaná směna je pryč',
  not exists (select 1 from public.shifts where id = :'s_nevydana'));


\echo ''
\echo '== 2. Vydaná se ZRUŠÍ, ale nezmizí ======================'

/*
  Tohle je ta kontrola, kvůli které tu scénář je — a do 9. 9. mířila
  obráceně. Tvrdila, že vydanou směnu smazat nejde, což byla pravda
  o tehdejší funkci, ale nepoužitelná v provozu: rozpis se VYDÁ
  a teprve pak se v něm škrtá.

  Správně se vydaná směna ZRUŠÍ. Řádek zůstane stát, protože lidem se
  ukazuje vydaná podoba — zmizí jim až vydáním rozpisu, kde jim to
  `app.rozdil_rozpisu` ohlásí jako „zrusena". Kdyby se řádek smazal,
  neměl by co ohlašovat a směna by jim zmizela potichu.
*/
select pg_temp.check('vydanou směnu funkce označí jako zrušenou',
  public.smazat_smenu(:'tenant', :'s_vydana') = 'zrusena');

select pg_temp.check('a ta směna pořád STOJÍ, jen je zrušená',
  exists (select 1 from public.shifts
           where id = :'s_vydana' and status = 'cancelled'));

-- Druhé zrušení nic nerozbije a pozná se.
select pg_temp.check('druhé zrušení už jen řekne, že je zrušená',
  public.smazat_smenu(:'tenant', :'s_vydana') = 'uz_zrusena');

/*
  A to podstatné: zrušení se dostane do rozdílu k vydání. Bez toho by
  se lidi o zrušené směně nedozvěděli nikdy — řádek by stál, ale nic
  by ho neohlásilo.
*/
select pg_temp.check('zrušení čeká na vydání rozpisu',
  exists (
    select 1 from app.rozdil_rozpisu(:'tenant', :'perla',
                                     date '2026-10-21', date '2026-10-21') r
    where r.zmena = 'zrusena'));


\echo ''
\echo '== 3. Cizí firma na ni nedosáhne ========================'

/*
  ODDÍL 7b: uvnitř `security definer` funkce se RLS neuplatní, takže si
  filtr na firmu musí udělat funkce sama. Kdyby v dotazu nebo v mazání
  chybělo `tenant_id = p_tenant`, smazala by se směna cizí firmy —
  a nechytilo by to nic, protože druhá obranná linie tam není.

  Zkouší se to POD MAJITELEM CIZÍ FIRMY: kdyby se to zkoušelo pod
  majitelem téhle, spadlo by to na právu a o filtru na firmu by to
  neřeklo nic.
*/
insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
values (:'tenant', :'perla', :'e_smenar', date '2026-10-22', '08:00', '16:00')
returning id as s_cizi_pokus \gset

select set_config('test.pokus', :'s_cizi_pokus', false);

/*
  Čeká se PRÁVĚ `no_data_found`, ne „jakékoli odmítnutí". Je v tom
  rozdíl, který stojí za to: když se z funkce vyndá `tenant_id =
  p_tenant`, směna se NAJDE a zastaví ji až kontrola práva — tedy jiná
  výjimka. Kontrola na „spadlo to nějak" by takové zeslabení
  propustila, protože odmítnuto by pořád bylo.

  Vyzkoušeno: po vyndání toho filtru tahle kontrola spadne.
*/
do $$
declare v_spadlo boolean := false;
begin
  begin
    -- Cizí firma se ptá na NAŠI směnu. Funkce ji nesmí ani najít.
    perform public.smazat_smenu(
      current_setting('test.cizi')::uuid,
      current_setting('test.pokus')::uuid);
  exception
    when no_data_found then
      v_spadlo := true;
    when others then
      raise exception
        'SELHALO: cizí firma tu směnu NAŠLA a zastavilo ji až něco jiného (%). Filtr na firmu ve smazat_smenu chybí.',
        sqlerrm;
  end;
  if not v_spadlo then
    raise exception 'SELHALO: cizí firma tu směnu smazala';
  end if;
  raise notice '  OK    cizí firma o té směně ani neví';
end $$;

select pg_temp.check('a směna zůstala',
  exists (select 1 from public.shifts where id = :'s_cizi_pokus'));


\echo ''
\echo '== 4. Bez práva na tu pobočku ne ========================'

/*
  Právo se ptá na pobočku TÉ SMĚNY, ne na tu z adresy — pravidlo 4:
  co přišlo z prohlížeče, je návrh.
*/
select set_config('test.user_id', '', false);

do $$
declare v_spadlo boolean := false;
begin
  begin
    perform public.smazat_smenu(
      current_setting('test.tenant')::uuid,
      current_setting('test.pokus')::uuid);
  exception when insufficient_privilege then
    v_spadlo := true;
  end;
  if not v_spadlo then
    raise exception 'SELHALO: nepřihlášený směnu smazal';
  end if;
  raise notice '  OK    bez práva shifts.manage to neprojde';
end $$;


-- Uklidit po sobě: `run.sh` na konci porovnává počty řádků.
reset role;
delete from public.shifts where id = :'s_cizi_pokus' or id = :'s_vydana';
delete from public.employees where id = :'e_smenar';


\echo ''
\echo '== KROK 32 HOTOV ========================================'
