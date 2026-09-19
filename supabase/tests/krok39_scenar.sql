-- Scénář pro krok 39 — upozornění na změny směn.
--
-- Pokrývá migraci 20260919120000_smeny_upozorneni_obnoveni.
--
-- ---------------------------------------------------------------------
-- PROČ TENHLE SCÉNÁŘ VZNIKL
--
-- Od 16. 9. večer (migrace 20260916200000, trhaná směna) `ulozit_smenu`
-- upozornění na směny vůbec nezakládala — nová dvanáctiparametrová
-- podoba se psala podle starší verze bez nich. Žádný scénář to
-- nehlídal: žádný nekontroloval, že po uložení směny v `notifications`
-- něco přibylo. Tenhle to dělá jako první věc (oddíl 1).
--
-- Kontroly nejsou postavené na čtení pod rolí (`set role authenticated`
-- na superuživateli PGlite nic nedělá), ale na výsledku: co se v
-- `notifications` po zavolání skutečně objevilo.

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
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as vedouci from public.profiles where email = 'vedouci@foodtab.cz' \gset

update public.branches
  set timezone = 'Europe/Prague', day_starts_at = '05:00'
  where id in (:'perla', :'bar');

-- Zaměstnanec s účtem (dostává upozornění), autor s účtem (sám sobě
-- nic neposílá) a zaměstnanec bez účtu (není komu psát).
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'vedouci', 'Účet Vedoucí', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'vedouci');
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
select :'tenant', :'perla', :'majitel', 'Účet Majitel', 'hpp'
where not exists (select 1 from public.employees
                  where tenant_id = :'tenant' and user_id = :'majitel');
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bez Účtu Krok39', 'hpp')
returning id as e_bez \gset

select id as e_ucet   from public.employees where tenant_id = :'tenant' and user_id = :'vedouci' limit 1 \gset
select id as e_majitel from public.employees where tenant_id = :'tenant' and user_id = :'majitel' limit 1 \gset


\echo ''
\echo '== 1. Uložení směny upozorní (regrese z 16. 9.) =========='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s1 from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-10-12', time '08:00', time '16:00', 'první') \gset

reset role;

select pg_temp.check('nová směna zaměstnanci s účtem založí smena.nova',
  exists (select 1 from public.notifications
          where user_id = :'vedouci' and druh = 'smena.nova' and shift_id = :'s1'));

select pg_temp.check('a nese čas směny',
  (select telo->>'od' || '-' || (telo->>'do') from public.notifications
   where user_id = :'vedouci' and druh = 'smena.nova' and shift_id = :'s1')
  = '08:00-16:00');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_vlastni from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_majitel', null,
  date '2026-10-12', time '09:00', time '17:00', 'sám sobě') \gset
select smena as s_bez from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_bez', null,
  date '2026-10-12', time '10:00', time '18:00', 'bez účtu') \gset

reset role;

select pg_temp.check('autor si o vlastní směně upozornění nezakládá',
  not exists (select 1 from public.notifications where shift_id = :'s_vlastni'));
select pg_temp.check('zaměstnanci bez účtu není komu psát',
  not exists (select 1 from public.notifications where shift_id = :'s_bez'));


\echo ''
\echo '== 2. Změna času: „původně → nově“ ======================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-10-12', time '10:00', time '18:00', 'posun') \gset

reset role;

select pg_temp.check('posun času založí smena.zmenena s odkazem na směnu',
  exists (select 1 from public.notifications
          where user_id = :'vedouci' and druh = 'smena.zmenena' and shift_id = :'s1'));

select pg_temp.check('nese původní i nový čas',
  (select (telo->>'puvodni_od') || '-' || (telo->>'puvodni_do') || '>' ||
          (telo->>'od') || '-' || (telo->>'do')
   from public.notifications
   where user_id = :'vedouci' and druh = 'smena.zmenena' and shift_id = :'s1')
  = '08:00-16:00>10:00-18:00');


\echo ''
\echo '== 3. Úpravy za sebou se slučují a drží NEJSTARŠÍ původní stav =='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-10-12', time '09:00', time '17:00', 'krok 2') \gset
select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-10-12', time '11:00', time '19:00', 'krok 3') \gset

reset role;

select pg_temp.check('tři úpravy = jedno nepřečtené upozornění, ne tři',
  (select count(*) from public.notifications
   where user_id = :'vedouci' and druh = 'smena.zmenena'
     and shift_id = :'s1' and read_at is null) = 1);

select pg_temp.check('a ukazuje původní 08:00–16:00, ne mezikrok 09:00–17:00',
  (select (telo->>'puvodni_od') || '-' || (telo->>'puvodni_do') || '>' ||
          (telo->>'od') || '-' || (telo->>'do')
   from public.notifications
   where user_id = :'vedouci' and druh = 'smena.zmenena' and shift_id = :'s1' and read_at is null)
  = '08:00-16:00>11:00-19:00');


\echo ''
\echo '== 4. Vrácení do původního stavu neupozorní ============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-10-12', time '08:00', time '16:00', 'zpět') \gset

reset role;

select pg_temp.check('po návratu na 08:00–16:00 žádné nepřečtené „změněno“ nezbylo',
  not exists (select 1 from public.notifications
              where user_id = :'vedouci' and druh = 'smena.zmenena'
                and shift_id = :'s1' and read_at is null));


\echo ''
\echo '== 5. Změna JEN pobočky se nesmí ztratit ================'

/*
  Časy zůstanou stejné, mění se jen pobočka. Kdyby návrat do původního
  stavu porovnával jen časy, tahle změna by se jako „vrácení“ potlačila
  a člověk by se o přesunu na jinou provozovnu nedozvěděl.
*/
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'bar', :'e_ucet', null,
  date '2026-10-12', time '08:00', time '16:00', 'na bar') \gset

reset role;

select pg_temp.check('přesun na jinou pobočku upozorní, i když časy zůstaly',
  exists (select 1 from public.notifications
          where user_id = :'vedouci' and druh = 'smena.zmenena'
            and shift_id = :'s1' and read_at is null));

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s1', :'perla', :'e_ucet', null,
  date '2026-10-12', time '08:00', time '16:00', 'zpět na perlu') \gset

reset role;

select pg_temp.check('a návrat na původní pobočku ho zase zruší',
  not exists (select 1 from public.notifications
              where user_id = :'vedouci' and druh = 'smena.zmenena'
                and shift_id = :'s1' and read_at is null));


\echo ''
\echo '== 6. Přeřazení: starý dostane „odebrána“, nový „nová“ ==='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_prerad from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-10-13', time '08:00', time '16:00', 'přeřadit') \gset
select smena from public.ulozit_smenu(
  :'tenant', :'s_prerad', :'perla', :'e_bez', null,
  date '2026-10-13', time '08:00', time '16:00', 'přeřazeno') \gset

reset role;

select pg_temp.check('původní zaměstnanec dostal smena.odebrana',
  exists (select 1 from public.notifications
          where user_id = :'vedouci' and druh = 'smena.odebrana'
            and telo->>'den' = '2026-10-13'));

select pg_temp.check('a odebraná se NEODKAZUJE na směnu, která už není jeho',
  (select shift_id from public.notifications
   where user_id = :'vedouci' and druh = 'smena.odebrana'
     and telo->>'den' = '2026-10-13') is null);


\echo ''
\echo '== 7. Vlastní změna neupozorňuje ========================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_sam from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  date '2026-10-14', time '08:00', time '16:00', 'sám') \gset

-- Teď to samé upraví ten, komu směna patří (vedoucí spravuje Perlu).
select set_config('test.user_id', :'vedouci', false);

select smena from public.ulozit_smenu(
  :'tenant', :'s_sam', :'perla', :'e_ucet', null,
  date '2026-10-14', time '12:00', time '20:00', 'sám sobě') \gset

reset role;

select pg_temp.check('kdo změnu udělal, tomu žádné „změněno“ nechodí',
  not exists (select 1 from public.notifications
              where user_id = :'vedouci' and druh = 'smena.zmenena' and shift_id = :'s_sam'));


\echo ''
\echo '== 8. Důležitost podle nastavení firmy ==================='

select (current_date + 1)::text  as zitra  \gset
select (current_date + 20)::text as pozdeji \gset

-- Výchozí stav: nastavení prázdné, nic není „důležité“.
update public.tenant_settings set smeny_dulezita_hodin = null where tenant_id = :'tenant';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_bez_pravidla from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  :'zitra'::date, time '12:00', time '20:00', 'bez pravidla') \gset

reset role;

select pg_temp.check('bez nastaveného pravidla je i zítřejší směna „normal“',
  (select priorita from public.notifications
   where user_id = :'vedouci' and shift_id = :'s_bez_pravidla') = 'normal');

-- Zapnout pravidlo (přes průzor, jako v aplikaci): do 48 hodin = důležité.
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.nastavit_dulezitou_zmenu_smeny(:'tenant', 48);

select smena as s_blizka from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  :'zitra'::date, time '13:00', time '21:00', 'blízká') \gset
select smena as s_daleka from public.ulozit_smenu(
  :'tenant', null, :'perla', :'e_ucet', null,
  :'pozdeji'::date, time '13:00', time '21:00', 'daleká') \gset

reset role;

select pg_temp.check('s pravidlem 48 h je zítřejší směna „important“',
  (select priorita from public.notifications
   where user_id = :'vedouci' and shift_id = :'s_blizka') = 'important');
select pg_temp.check('a směna za tři týdny zůstává „normal“',
  (select priorita from public.notifications
   where user_id = :'vedouci' and shift_id = :'s_daleka') = 'normal');

select pg_temp.check('nastavení je v tenant_settings',
  (select smeny_dulezita_hodin from public.tenant_settings where tenant_id = :'tenant') = 48);

select pg_temp.check('a změna nastavení je v auditu',
  exists (select 1 from public.audit_log where action = 'settings.smeny_dulezita_hodin'));

update public.tenant_settings set smeny_dulezita_hodin = null where tenant_id = :'tenant';


\echo ''
\echo '== 9. Průzor pro vedoucího: kdo potvrdil ================='

/*
  Bere se `s_blizka`, ne `s_bez_pravidla`: obě jsou na zítřek, a stávající
  slučování (C4, upozornění téhož druhu a dne se nahradí novým) druhou
  směnou přepsalo upozornění o první. Odkaz na směnu tedy drží ta
  POSLEDNÍ z dne — tak to je už od 13. 9. a nemění se to.
*/
select id as n_s1 from public.notifications
  where user_id = :'vedouci' and shift_id = :'s_blizka' limit 1 \gset

set role authenticated;
select set_config('test.user_id', :'majitel', false);

-- Boolean místo hodnot: `\gset` s NULL se v psql a v běhu nad PGlite
-- chová jinak, a kontrola nemá záviset na tom.
-- Jméno se porovnává s tím, které má zaměstnanec v databázi: účet vedoucího
-- už v seedu jeden záznam měl, takže vlastní vložení se přeskočilo.
select (jmeno = (select e.full_name from public.employees e where e.id = :'e_ucet'))::text
                                                                as ps_jmeno_ok,
       (precteno_at is null and potvrzeno_at is null)::text     as ps_nic
from public.stav_potvrzeni_smeny(:'tenant', :'s_blizka') \gset

reset role;

select pg_temp.check('vedoucí vidí, komu upozornění šlo', :'ps_jmeno_ok' = 'true');
select pg_temp.check('a že ho zatím nepřečetl ani nepotvrdil', :'ps_nic' = 'true');

update public.notifications
   set read_at = now(), acknowledged_at = now()
 where id = :'n_s1';

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select (potvrzeno_at is not null and precteno_at is not null)::text as ps_hotovo
from public.stav_potvrzeni_smeny(:'tenant', :'s_blizka') \gset

reset role;

select pg_temp.check('po přečtení a potvrzení vedoucí vidí obojí', :'ps_hotovo' = 'true');

-- Bezpečnost: průzor vrací jen časy a jméno, ne obsah upozornění.
select pg_temp.check('výsledek nemá sloupec s obsahem (telo)',
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'stav_potvrzeni_smeny'
      and pg_get_function_result(p.oid) ilike '%telo%'));

-- Vedoucí Perly nesmí vidět potvrzení u směny na Baru, kterou nespravuje.
set role authenticated;
select set_config('test.user_id', :'majitel', false);

select smena as s_barova from public.ulozit_smenu(
  :'tenant', null, :'bar', :'e_ucet', null,
  date '2026-10-15', time '08:00', time '16:00', 'na baru') \gset

select set_config('test.tenant',   :'tenant',   false);
select set_config('test.s_barova', :'s_barova', false);
select set_config('test.user_id', :'vedouci', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform * from public.stav_potvrzeni_smeny(
      current_setting('test.tenant')::uuid, current_setting('test.s_barova')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: vedoucí Perly viděl potvrzení na Baru'; end if;
end $$;

reset role;

select pg_temp.check('vedoucí Perly nevidí potvrzení u směny na Baru (cizí pobočka)', true);

-- Cizí firma: stejná směna, jiné tenant_id → prázdno, ne chyba a ne únik.
select pg_temp.check('s cizím tenant_id průzor nevrátí nic',
  not exists (select 1 from public.stav_potvrzeni_smeny(gen_random_uuid(), :'s1')));

select pg_temp.check('neexistující směna vrátí prázdno, ne chybu',
  not exists (select 1 from public.stav_potvrzeni_smeny(:'tenant', gen_random_uuid())));


\echo ''
\echo '== 10. Nastavení: kdo ho smí měnit ======================='

set role authenticated;
select set_config('test.user_id', :'vedouci', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.nastavit_dulezitou_zmenu_smeny(current_setting('test.tenant')::uuid, 24);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: vedoucí bez settings.manage změnil nastavení firmy'; end if;
end $$;

select set_config('test.user_id', :'majitel', false);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.nastavit_dulezitou_zmenu_smeny(current_setting('test.tenant')::uuid, 0);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nula hodin prošla'; end if;
end $$;

-- Prázdné je platné: vypne pravidlo.
select public.nastavit_dulezitou_zmenu_smeny(:'tenant', null);

reset role;

select pg_temp.check('vedoucí bez settings.manage nastavení nezměnil', true);
select pg_temp.check('nula hodin se odmítla a prázdné pravidlo vypne',
  (select smeny_dulezita_hodin from public.tenant_settings where tenant_id = :'tenant') is null);


\echo ''
\echo '== 11. Sloupcové granty — jen přidané, nic nezavřené ======'

/*
  Poučení z 19. 9. (branches): sloupec bez grantu shodí stránku na 42501
  a kód to nepozná jako chybějící migraci. Kontroluje se KATALOG, protože
  PGlite běží jako superuživatel a čtení pod rolí by prošlo i bez grantu.
*/
select pg_temp.check('authenticated čte tenant_settings.smeny_dulezita_hodin',
  has_column_privilege('authenticated', 'public.tenant_settings', 'smeny_dulezita_hodin', 'SELECT'));
select pg_temp.check('a smí ho měnit (přes průzor stejně rozhoduje settings.manage)',
  has_column_privilege('authenticated', 'public.tenant_settings', 'smeny_dulezita_hodin', 'UPDATE'));
select pg_temp.check('authenticated čte notifications.shift_id',
  has_column_privilege('authenticated', 'public.notifications', 'shift_id', 'SELECT'));
select pg_temp.check('anon nečte ani jedno z nich',
  not has_column_privilege('anon', 'public.tenant_settings', 'smeny_dulezita_hodin', 'SELECT')
  and not has_column_privilege('anon', 'public.notifications', 'shift_id', 'SELECT'));

-- Sloupce, které měly grant před tím, ho MAJÍ dál (nic se nepřepsalo).
select pg_temp.check('tenant_settings.prestavka_minut je pořád čitelný',
  has_column_privilege('authenticated', 'public.tenant_settings', 'prestavka_minut', 'SELECT'));
select pg_temp.check('tenant_settings.zapomenuty_odchod_hodin je pořád čitelný',
  has_column_privilege('authenticated', 'public.tenant_settings', 'zapomenuty_odchod_hodin', 'SELECT'));

select pg_temp.check('upozornit_smenu nemá přístup pro přihlášeného (volá se jen z průzorů)',
  not has_function_privilege('authenticated',
    'app.upozornit_smenu(uuid, uuid, uuid, text, date, time, time, uuid, date, time, time, uuid)',
    'EXECUTE'));


\echo ''
\echo '== KROK 39 HOTOV ========================================'
