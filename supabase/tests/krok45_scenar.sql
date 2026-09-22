-- Scénář pro krok 45 — Checklist → úkol.
--
-- Pokrývá migraci 20260922100000_checklist_ukol.
--
-- Navazuje na etapa0_scenar.sql až krok44_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Stejná past jako u zprávy → úkol (krok43, oddíl 4): `zalozit_ukol_z_checklistu`
-- i trigger `tasks_vazba_checklistu` jsou definer, uvnitř kterých neplatí RLS.
-- Proto se zkouší SKUTEČNĚ CIZÍ běh (jiná firma, existující řádek — ne jen
-- náhodné id) a SKUTEČNĚ JINÁ POBOČKA téže firmy (vedoucí s právem
-- tasks.manage, ale na Baru, ne na Perle, kde checklist leží).

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

create or replace function pg_temp.spadne(p_sql text, p_stav text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav;
end $$;

-- Totéž, ale i s částí hlášky: spadnout musí TA větev, kterou zkoušíme.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

create or replace function pg_temp.pocet(p_user uuid, p_druh text)
returns integer language sql as $$
  select count(*)::integer from public.notifications
   where user_id = p_user and druh = p_druh and read_at is null
$$;

reset role;


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

-- Práva dnes dává zařazení (employee_permissions/position_permissions,
-- 20260909100000_zarazeni_jadro.sql), ne `roles`/`role_permissions` — ty
-- zůstávají jen kvůli cizímu klíči na `memberships.role_id`. Kterou roli si
-- tu tři zaměstnanci vezmou, je proto jedno; použije se první dostupná.
select id as role_any from public.roles where tenant_id = :'tenant' limit 1 \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('45450000-0000-0000-0000-000000000001', 'petra45@foodtab.cz', '{"full_name":"Petra Vedoucí"}'),
  ('45450000-0000-0000-0000-000000000002', 'standa45@foodtab.cz', '{"full_name":"Standa Servis"}'),
  ('45450000-0000-0000-0000-000000000003', 'zuzana45@foodtab.cz', '{"full_name":"Zuzana Barmanka"}');

-- Petra: tasks.manage na PERLE — zakládá úkoly z checklistu.
-- Standa: jen tasks.read na PERLE — checklist vidí, úkol z něj nezaloží.
-- Zuzana: tasks.manage, ale NA JINÉ POBOČCE (Bar) — na checklist Perly jí
-- právo nedosáhne, i když „zadávat úkoly“ umí jinde.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '45450000-0000-0000-0000-000000000001', 'Petra Vedoucí',  'hpp'),
  (:'tenant', :'perla', '45450000-0000-0000-0000-000000000002', 'Standa Servis',  'hpp'),
  (:'tenant', :'bar',   '45450000-0000-0000-0000-000000000003', 'Zuzana Barmanka', 'hpp');

select id as petra  from public.employees where user_id = '45450000-0000-0000-0000-000000000001' \gset
select id as standa from public.employees where user_id = '45450000-0000-0000-0000-000000000002' \gset
select id as zuzana from public.employees where user_id = '45450000-0000-0000-0000-000000000003' \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted) values
  (:'tenant', :'petra',  'tasks.manage', true),
  (:'tenant', :'standa', 'tasks.read',   true),
  (:'tenant', :'zuzana', 'tasks.manage', true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '45450000-0000-0000-0000-000000000001', :'role_any', 'branch', 'active'),
  (:'tenant', '45450000-0000-0000-0000-000000000002', :'role_any', 'branch', 'active'),
  (:'tenant', '45450000-0000-0000-0000-000000000003', :'role_any', 'branch', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, x.b
  from public.memberships m
  join (values
    ('45450000-0000-0000-0000-000000000001'::uuid, :'perla'::uuid),
    ('45450000-0000-0000-0000-000000000002'::uuid, :'perla'::uuid),
    ('45450000-0000-0000-0000-000000000003'::uuid, :'bar'::uuid)
  ) x(u, b) on x.u = m.user_id
 where m.tenant_id = :'tenant';

-- Šablona s dvěma položkami na Perle + běh pro dnešek.
insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule)
values (:'tenant', :'perla', 'Otevírací — krok45', 'kuchyne', 'opening')
returning id as sablona \gset

insert into public.checklist_items (template_id, position, label, requires_value, value_type, value_unit, min_value, max_value) values
  (:'sablona', 1, 'Teplota lednice — krok45', true, 'number', '°C', 0, 8),
  (:'sablona', 2, 'Podlaha uklizena — krok45', false, null, null, null, null);

select id as polozka_teplota  from public.checklist_items where template_id = :'sablona' and label = 'Teplota lednice — krok45' \gset
select id as polozka_podlaha  from public.checklist_items where template_id = :'sablona' and label = 'Podlaha uklizena — krok45' \gset

insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'tenant', :'perla', :'sablona', current_date)
returning id as beh \gset

-- Druhá šablona (s vlastní položkou), aby šlo zkusit „položka z jiného běhu“.
insert into public.checklist_templates (tenant_id, branch_id, name, department, schedule)
values (:'tenant', :'perla', 'Jiná šablona — krok45', 'kuchyne', 'opening')
returning id as jina_sablona \gset
insert into public.checklist_items (template_id, position, label) values (:'jina_sablona', 1, 'Cizí položka — krok45')
returning id as jina_polozka \gset

-- Cizí firma se SKUTEČNÝM checklistem, ať se pozná chybějící filtr firmy,
-- ne jen to, že náhodné id neexistuje (stejná past jako u zprávy → úkol).
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok45 Cizí s.r.o.', 'Krok45 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí pobočka', 'krok45-cizi-pobocka')
returning id as cizi_branch \gset
insert into public.checklist_templates (tenant_id, branch_id, name)
values (:'cizi_firma', :'cizi_branch', 'Cizí šablona — krok45')
returning id as cizi_sablona \gset
insert into public.checklist_items (template_id, position, label) values (:'cizi_sablona', 1, 'Cizí firmy položka')
returning id as cizi_polozka \gset
insert into public.checklist_runs (tenant_id, branch_id, template_id, business_date)
values (:'cizi_firma', :'cizi_branch', :'cizi_sablona', current_date)
returning id as cizi_beh \gset

select set_config('test.tenant', :'tenant', false);


\echo ''
\echo '== 1. Katalog: podpis, práva, trigger ======================='

select pg_temp.check('zalozit_ukol_z_checklistu smí přihlášený, ne anon',
  has_function_privilege('authenticated',
    'public.zalozit_ukol_z_checklistu(uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)',
    'execute')
  and not has_function_privilege('anon',
    'public.zalozit_ukol_z_checklistu(uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)',
    'execute'));

select pg_temp.check('trigger tasks_vazba_checklistu je na tasks',
  exists (select 1 from pg_trigger
           where tgname = 'tasks_vazba_checklistu' and tgrelid = 'public.tasks'::regclass));

select pg_temp.check('sloupce checklist_run_id a checklist_item_id existují',
  to_regprocedure('public.zalozit_ukol_z_checklistu(uuid, uuid, uuid, text, text, timestamp without time zone, text, uuid, uuid, uuid)') is not null
  and (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'tasks'
          and column_name in ('checklist_run_id', 'checklist_item_id')) = 2);


\echo ''
\echo '== 2. Úkol z položky — šťastná cesta ========================'

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', :'polozka_teplota', 'Zkontrolovat lednici', 'Displej ukazoval 11 °C.',
  timestamp '2026-12-01 09:00', 'high', null, null, :'standa') as ukol1 \gset
reset role;

select pg_temp.check('úkol vznikl a nese vazbu na běh, položku a pobočku',
  (select checklist_run_id = :'beh' and checklist_item_id = :'polozka_teplota'
          and zdroj = 'checklist' and branch_id = :'perla'
          and title = 'Zkontrolovat lednici' and employee_id = :'standa' and status = 'open'
     from public.tasks where id = :'ukol1'));

select pg_temp.check('termín se převedl na okamžik (den je vyplněný)',
  (select due_at is not null from public.tasks where id = :'ukol1'));

select pg_temp.check('adresát (Standa) dostal přesně jedno upozornění ukol.pridelen',
  pg_temp.pocet('45450000-0000-0000-0000-000000000002', 'ukol.pridelen') = 1);
select pg_temp.check('zadavatelka (Petra) si upozornění o vlastním úkolu nezaložila',
  pg_temp.pocet('45450000-0000-0000-0000-000000000001', 'ukol.pridelen') = 0);

select pg_temp.check('v auditu jsou jen id běhu a položky, ne název ani poznámka',
  exists (select 1 from public.audit_log
           where action = 'ukol.z_checklistu' and entity_id = :'ukol1'::text
             and after->>'checklist_run' = :'beh' and after->>'checklist_polozka' = :'polozka_teplota')
  and not exists (select 1 from public.audit_log
                   where action = 'ukol.z_checklistu' and entity_id = :'ukol1'::text
                     and (after::text like '%lednici%' or after::text like '%Displej%')));


\echo ''
\echo '== 3. Úkol z CELÉHO běhu (bez položky) ======================'

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', null, 'Zkontrolovat celý checklist', '', null, 'normal', null, null, :'standa') as ukol2 \gset
reset role;

select pg_temp.check('úkol bez položky: run je vyplněný, položka null',
  (select checklist_run_id = :'beh' and checklist_item_id is null and zdroj = 'checklist'
     from public.tasks where id = :'ukol2'));


\echo ''
\echo '== 4. Bez tasks.manage NA TÉ POBOČCE úkol nevznikne =========='

-- Standa (jen tasks.read na Perle): zastaví ho zadat_ukol vlastní kontrolou
-- práva — schválně žádná druhá, slabší kontrola dřív (viz migrace).
select set_config('test.user_id', '45450000-0000-0000-0000-000000000002', false);
select pg_temp.check('kdo má jen tasks.read, úkol nezadá',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, %L, 'Podvrh', '', null, 'normal', null, null, null)$q$,
    :'tenant', :'beh', :'polozka_podlaha'),
    '42501', 'Zadávat úkoly'));

-- Zuzana MÁ tasks.manage — jenže na Baru. Pobočka jde od BĚHU (Perla), ne od
-- volajícího, takže její právo z jiné pobočky se sem nepřenese.
select set_config('test.user_id', '45450000-0000-0000-0000-000000000003', false);
select pg_temp.check('tasks.manage na JINÉ pobočce checklist Perly nezpřístupní',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, %L, 'Podvrh', '', null, 'normal', null, null, null)$q$,
    :'tenant', :'beh', :'polozka_podlaha'),
    '42501', 'Zadávat úkoly'));


\echo ''
\echo '== 5. Neexistující a cizí běh se tváří stejně ==============='

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);
select pg_temp.check('náhodné id běhu: přístup odepřen, ne pád na chybějícím řádku',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, null, 'Podvrh', '', null, 'normal', null, null, null)$q$,
    :'tenant', gen_random_uuid()),
    '42501', 'K tomuhle checklistu nemáte přístup'));

select pg_temp.check('SKUTEČNÝ běh cizí firmy: taky odepřeno (filtr firmy není jen na náhodném id)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, null, 'Podvrh', '', null, 'normal', null, null, null)$q$,
    :'tenant', :'cizi_beh'),
    '42501', 'K tomuhle checklistu nemáte přístup'));

select pg_temp.check('položka z jiné šablony k tomuhle běhu nepatří',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, %L, 'Podvrh', '', null, 'normal', null, null, null)$q$,
    :'tenant', :'beh', :'jina_polozka'),
    '23514', 'Ta položka k tomuhle checklistu nepatří'));

-- Adresát mimo firmu (cizí firmy zaměstnanec, skutečně existující řádek):
-- dokazuje, že se opravdu volá zadat_ukol, ne že by tahle funkce adresáta
-- ověřovala sama (a špatně).
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'cizi_firma', :'cizi_branch', 'Cizí zaměstnanec — krok45', 'hpp')
returning id as cizi_zamestnanec \gset

select pg_temp.check('adresát mimo firmu: delegace na zadat_ukol je skutečná, ne fasáda',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, null, 'Podvrh', '', null, 'normal', null, null, %L)$q$,
    :'tenant', :'beh', :'cizi_zamestnanec'),
    '42501', 'do téhle firmy nepatří'));

-- Adresát „úsek“ tu není skutečný (na existenci se dojde, až projde počet
-- adresátů) — jde jen o to, aby usek i clovek byly obě NEPRÁZDNÉ.
select pg_temp.check('dva adresáty najednou zastaví zadat_ukol („jeden cíl na úkol“)',
  pg_temp.spadne_hlaskou(format(
    $q$select public.zalozit_ukol_z_checklistu(%L, %L, null, 'Podvrh', '', null, 'normal', %L, null, %L)$q$,
    :'tenant', :'beh', gen_random_uuid(), :'standa'),
    '23514', 'jednoho adresáta'));


\echo ''
\echo '== 6. Vazba úkolu na checklist nejde podvrhnout (přímý zápis) ='

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);

-- Petra smí zapsat na SVOU pobočku (Perla) s vazbou na checklist Perly.
select pg_temp.check('legitimní přímý zápis (vlastní pobočka, vlastní checklist) projde',
  not pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, checklist_run_id, checklist_item_id)
    values (%L::uuid, %L::uuid, 'Přímý zápis', %L::uuid, %L::uuid)$q$,
    :'tenant', :'perla', :'beh', :'polozka_podlaha'), '42501'));

-- Vazba na checklist JINÉ FIRMY (skutečně existující běh) se odmítne.
select pg_temp.check('vazba na checklist jiné firmy se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, checklist_run_id)
    values (%L::uuid, %L::uuid, 'Podvrh 2', %L::uuid)$q$,
    :'tenant', :'perla', :'cizi_beh'), '42501'));

-- Položka bez běhu nedává smysl.
select pg_temp.check('položka bez běhu se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, checklist_item_id)
    values (%L::uuid, %L::uuid, 'Podvrh 3', %L::uuid)$q$,
    :'tenant', :'perla', :'polozka_podlaha'), '23514'));

-- Zuzana (tasks.manage na Baru) zapíše úkol na SVOU pobočku (Bar), ale
-- s vazbou na checklist Perly téže firmy — jiná pobočka, stejná firma.
select set_config('test.user_id', '45450000-0000-0000-0000-000000000003', false);
select pg_temp.check('vazba na checklist JINÉ POBOČKY téže firmy se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, checklist_run_id)
    values (%L::uuid, %L::uuid, 'Podvrh 4', %L::uuid)$q$,
    :'tenant', :'bar', :'beh'), '42501'));

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);

-- Položka z jiné šablony (i na správné pobočce a firmě) se odmítne.
select pg_temp.check('vazba na položku z jiné šablony se odmítne',
  pg_temp.spadne(format($q$insert into public.tasks (tenant_id, branch_id, title, checklist_run_id, checklist_item_id)
    values (%L::uuid, %L::uuid, 'Podvrh 5', %L::uuid, %L::uuid)$q$,
    :'tenant', :'perla', :'beh', :'jina_polozka'), '23514'));

-- Nezměněná vazba při jiné úpravě úkolu (např. přejmenování) neprojde
-- zbytečně přes kontrolu — trigger ji přeskočí.
select pg_temp.check('nezměněná vazba při úpravě jiného pole projde',
  not pg_temp.spadne(format($q$update public.tasks set title = 'Přímý zápis (přejmenováno)' where id =
    (select id from public.tasks where title = 'Přímý zápis' limit 1)$q$), '42501'));

reset role;


\echo ''
\echo '== 7. Smazání běhu nebo položky jen ruší vazbu, úkol zůstává ='

select set_config('test.user_id', '45450000-0000-0000-0000-000000000001', false);
set role authenticated;
select public.zalozit_ukol_z_checklistu(
  :'tenant', :'beh', :'polozka_podlaha', 'Úkol k mazání běhu', '', null, 'normal', null, null, :'standa') as ukol_mazani \gset
reset role;

-- Smazání BĚHU (den skončil, běh se uklidil) — položka jako taková (a její
-- šablona) dál existuje, takže se ruší jen odkaz na běh.
delete from public.checklist_runs where id = :'beh';

select pg_temp.check('smazání běhu projde a vynuluje jen checklist_run_id',
  (select checklist_run_id is null and checklist_item_id = :'polozka_podlaha'
     from public.tasks where id = :'ukol_mazani'));

-- Smazání POLOŽKY (šablona se later upravila) ruší i checklist_item_id.
delete from public.checklist_items where id = :'polozka_podlaha';

select pg_temp.check('smazání položky navíc vynuluje checklist_item_id',
  (select checklist_run_id is null and checklist_item_id is null
     from public.tasks where id = :'ukol_mazani'));
select pg_temp.check('úkol samotný smazáním běhu ani položky nezmizel',
  exists (select 1 from public.tasks where id = :'ukol_mazani'));


\echo ''
\echo '== KROK 45 HOTOV ========================================'
