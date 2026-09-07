-- Scénář pro krok 29 — „Dnes": jsem v práci, nebo ne?
--
-- Pokrývá migraci 20260907010000_muj_den a zadání
-- docs/dnes-obrazovka-zadani.md, body 3 a 7.
--
-- Navazuje na etapa0_scenar.sql až krok28_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Na otázku „jsem v práci?" umí aplikace odpovědět třemi různými
-- způsoby a dva z nich se liší:
--
--   * Docházka se ptá na POSLEDNÍ UDÁLOST a nefiltruje ani storno, ani
--     příchod uzavřený systémem,
--   * `app.otevreny_prichod` se ptá na otevřený příchod a filtruje
--     obojí,
--   * `app.smena_ted` k tomu přidává, že musí jít o dnešní provozní den.
--
-- `muj_den` bere ten prostřední a je to schválně. Nejdůležitější
-- kontroly tady jsou proto ty, které měří rozdíl: stornovaný příchod
-- a příchod uzavřený systémem NESMÍ tvrdit „jste v práci", zatímco
-- otevřený příchod z včerejší noční ANO — ten se má ukázat právě proto,
-- že není z dneška.

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
-- Vlastní člověk, ne někdo ze seedu: bude se mu schválně přepisovat
-- docházka a ostatní scénáře s ním počítají jinak.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset

select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset
select id as role_servis from public.roles
 where tenant_id = :'tenant' and key = 'servis' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('77770000-0000-0000-0000-000000000077', 'karel@foodtab.cz',
   '{"full_name":"Karel Dnešní"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '77770000-0000-0000-0000-000000000077',
        'Karel Dnešní', 'hpp');
select id as karel from public.employees
 where user_id = '77770000-0000-0000-0000-000000000077' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '77770000-0000-0000-0000-000000000077', :'role_servis',
        'branch', 'active');
select id as clen_karel from public.memberships
 where user_id = '77770000-0000-0000-0000-000000000077' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_karel', :'perla');

select set_config('test.tenant', :'tenant', false);
select set_config('test.karel', :'karel', false);
select app.business_date(:'perla', now()) as dnes \gset


\echo ''
\echo '== 1. Bez příchodu není člověk v práci =================='

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;

select v_praci as vp0, pobocka as pob0, provozni_den as pd0
from public.muj_den(:'tenant') \gset

select pg_temp.check('bez příchodu není v práci', :'vp0' = 'f');
select pg_temp.check('a pobočka je ta domovská', :'pob0' = :'perla');
select pg_temp.check('provozní den je dnešní', :'pd0' = :'dnes');

reset role;


\echo ''
\echo '== 2. Po píchnutí je v práci ============================'

select udalost as u1 from app.pichnout(:'tenant', :'perla', :'karel', 'in') \gset

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp1, od_kdy as od1, den_prichodu as dp1
from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('po píchnutí je v práci', :'vp1' = 't');
select pg_temp.check('a ví se, od kdy', :'od1' <> '');
select pg_temp.check('příchod je z dnešního provozního dne', :'dp1' = :'dnes');


\echo ''
\echo '== 3. Stornovaný příchod „v práci" neznamená ============'

/*
  TOHLE JE ROZDÍL PROTI DOCHÁZCE.

  Docházka se ptá na poslední událost a `stornovano_kdy` nefiltruje —
  po stornu tedy pořád tvrdí „jste v práci". `muj_den` bere
  `app.otevreny_prichod`, která storno filtruje.

  Schválně rozbito: když se `muj_den` přepíše na „poslední událost",
  tahle kontrola spadne.
*/
reset role;
update public.attendance_events set stornovano_kdy = now() where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp2 from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('stornovaný příchod v práci nedrží', :'vp2' = 'f');

-- Vrátit, ať se dá pokračovat.
update public.attendance_events set stornovano_kdy = null where id = :'u1';


\echo ''
\echo '== 4. Příchod uzavřený systémem taky ne ================='

/*
  `uzavreno_systemem` znamená „tenhle už neblokuje další příchod"
  (20260905010000). Není to čas odchodu a do hodin se nezapočítá —
  ale hlavně: člověk podle něj v práci NENÍ.
*/
reset role;
update public.attendance_events set uzavreno_systemem = now() where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp3 from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('příchod uzavřený systémem v práci nedrží', :'vp3' = 'f');

update public.attendance_events set uzavreno_systemem = null where id = :'u1';


\echo ''
\echo '== 5. Noční směna z včerejška se UKÁŽE =================='

/*
  Zadání, bod 3: „Když je otevřený příchod z včerejška (noční), karta
  ukáže jeho, ne dnešek."

  Je to schválně jinak než u doručování zpráv. `app.smena_ted` od 6. 9.
  končí s provozním dnem, ve kterém se píchlo — tam jde o to, aby
  aplikace nezvonila ve tři ráno zapomenutému odchodu. Na kartě je to
  obráceně: člověk se na to potřebuje podívat PRÁVĚ PROTO, že je to
  z včerejška.

  Posouvá se o 26 hodin, ne o 20: dvacet hodin zpátky je jiný
  kalendářní den jen do osmé večer (CLAUDE.md, „Testy, které závisí
  na kalendáři").
*/
reset role;
update public.attendance_events
   set occurred_at = now() - interval '26 hours',
       business_date = :'dnes'::date - 1
 where id = :'u1';

select set_config('test.user_id', '77770000-0000-0000-0000-000000000077', false);
set role authenticated;
select v_praci as vp4, den_prichodu as dp4, provozni_den as pd4
from public.muj_den(:'tenant') \gset
reset role;

select pg_temp.check('otevřený příchod z včerejška je pořád „v práci"', :'vp4' = 't');
select pg_temp.check('a je poznat, že je ze staršího dne',
  :'dp4'::date < :'pd4'::date);

/*
  A pro srovnání: doručování zpráv ho už za směnu NEBERE. Ty dvě
  odpovědi se schválně liší a tahle kontrola to drží — kdyby se
  `muj_den` někdo pokusil „sjednotit" se `smena_ted`, spadne oddíl 5.
*/
select pg_temp.check('doručování zpráv ho za směnu už nebere',
  app.smena_ted(:'tenant', :'karel') is null);


\echo ''
\echo '== 6. Vypnutý modul a cizí firma ========================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma nedostane nic',
  (select count(*) from public.muj_den(:'tenant')) = 0);

reset role;

select pg_temp.check('muj_den se ptá na zapnutý modul',
  pg_get_functiondef('public.muj_den(uuid)'::regprocedure) like '%modul_zapnuty%');

/*
  A že se „v práci" bere z otevřeného příchodu, ne z poslední události.
  Je to strukturální kontrola, ale drží tvrzení z hlavičky: tři různé
  odpovědi na jednu otázku by se časem rozešly.
*/
select pg_temp.check('a „v práci" staví na app.otevreny_prichod',
  pg_get_functiondef('public.muj_den(uuid)'::regprocedure) like '%otevreny_prichod%');


\echo ''
\echo ''
\echo '== 7. Gastro AI nemá nikdo ============================='

/*
  Modul Gastro AI neexistuje, takže právo `ai.use` nemá mít nikdo
  (rozhodnutí Šéfíka 7. 9., migrace 20260907020000).

  MIGRACE MAŽE NA DVOU MÍSTECH A TO DRUHÉ JE TO PODSTATNÉ. Šablona
  řídí jen nově zakládané firmy; `app.create_tenant` z ní při založení
  udělá KOPII do `public.role_permissions` a od té chvíle je firma na
  šabloně nezávislá. Kdyby se smazala jen šablona, na Šéfíkově
  aplikaci by se nezměnilo vůbec nic.

  PROČ SE TU MIGRACE POUŠTÍ ZNOVU. Scénáře běží nad prázdnou databází:
  migrace projdou dřív, než vůbec nějaká firma vznikne, takže druhé
  `delete` v nich nemá co mazat. Kontrola „nikdo to nemá" by tedy
  prošla i nad migrací, ve které to druhé mazání chybí — a to je přesně
  ta kontrola, co projde nad rozbitým kódem.

  Simuluje se proto firma, která vznikla DŘÍV: řádek se do
  `role_permissions` vrátí ručně a migrace se pustí ještě jednou
  (`\ir`). Obě mazání jsou idempotentní, takže se to smí.
*/

reset role;

/*
  Do oddílu se vchází s uživatelem nastaveným v oddílu 6 na CIZINCE
  (ř. 201) — `reset role` mění databázovou roli, ne tuhle proměnnou.
  Auditní řádky, které mazání vyrobí přes `trg_audit_role_permissions`,
  by se pak pod firmou Foodtab připsaly někomu z jiné firmy. Nuluje se
  proto: `auth.uid()` v harness čte `test.user_id` a nad prázdnou
  hodnotou vrátí NULL, takže se zapíše `actor_type = 'system'` — což je
  i to, co se stane při opravdovém `supabase db push`.
*/
select set_config('test.user_id', '', false);


-- ---------------------------------------------------------------------
-- NEJDŘÍV NAD OPRAVDOVÝMI DATY, TEPRVE POTOM NAD SIMULACÍ
--
-- Tahle první kontrola je ta, která hlídá ROZSAH rozhodnutí. Firma
-- Foodtab vznikla v `etapa0_scenar` PO migracích, takže má všech sedm
-- rolí z katalogu — včetně těch pěti, kterým `ai.use` patřilo — a jejich
-- práva jsou kopie šablon po migraci. Kdyby se mazání zúžilo zpátky na
-- tři role ze zadání, zůstalo by `ai.use` u `vedouci_smeny`
-- a `provozni` — v šabloně i tady — a spadne to.
-- ---------------------------------------------------------------------
select pg_temp.check('po migracích nemá Gastro AI ŽÁDNÁ z rolí firmy',
  not exists (select 1
              from public.role_permissions rp
              join public.roles r on r.id = rp.role_id
              where r.tenant_id = :'tenant'
                and rp.permission_key = 'ai.use'));

select id as role_bar from public.roles
 where tenant_id = :'tenant' and key = 'bar' \gset

-- Firma založená před migrací: právo má v role_permissions, ne jen
-- v šabloně.
insert into public.role_permissions (role_id, permission_key)
values (:'role_bar', 'ai.use') on conflict do nothing;

-- A někdo mezitím vrátil i šablonu.
insert into app.role_template_permissions (template_key, permission_key)
values ('bar', 'ai.use') on conflict do nothing;

/*
  KANÁREK: `menu_ai.use` je JINÉ právo — patří modulu `menu` a ptá se
  na něj obrazovka Tvorba menu. Hlavička migrace před tím varuje, ale
  varování v komentáři není kontrola: v testovací databázi nemá
  `menu_ai.*` nikdo (žádná šablona ho nerozdává), takže by přepis obou
  mazání na `like '%ai.use'` neměl co smazat navíc a celá sada by
  zůstala zelená. Vkládá se proto schválně a níž se ověřuje, že přežil.
*/
insert into public.role_permissions (role_id, permission_key)
values (:'role_bar', 'menu_ai.use') on conflict do nothing;

insert into app.role_template_permissions (template_key, permission_key)
values ('bar', 'menu_ai.use') on conflict do nothing;

/*
  Kontrola „příprava se povedla" tu SCHVÁLNĚ NENÍ. Po
  `insert … on conflict do nothing` řádek existuje v obou případech —
  buď se vložil, nebo tam už byl —, takže průchod, ve kterém by byla
  nepravdivá, neexistuje. Cokoli jiného je chyba a při `ON_ERROR_STOP`
  se soubor utne dřív, než se k ní dojde. Byla by to kontrola, která
  nemůže spadnout, a jen by nafoukla počet „X kontrol prošlo".
*/

\ir ../migrations/20260907020000_ai_use_pryc.sql

select pg_temp.check('žádná šablona role už Gastro AI nerozdává',
  not exists (select 1 from app.role_template_permissions
              where permission_key = 'ai.use'));

select pg_temp.check('a nemá ho ani žádná role UŽ ZALOŽENÉ firmy',
  not exists (select 1 from public.role_permissions
              where permission_key = 'ai.use'));

-- Kanárek žije: mazání se trefilo do klíče na rovnost, ne přes `like`.
select pg_temp.check('Tvorbu menu to nezavřelo — menu_ai.use zůstal',
  exists (select 1 from public.role_permissions
          where role_id = :'role_bar' and permission_key = 'menu_ai.use')
  and exists (select 1 from app.role_template_permissions
              where template_key = 'bar' and permission_key = 'menu_ai.use'));

/*
  A kanárek se zase uklidí. Není to kosmetika: `menu_ai.use` je živé
  právo modulu `menu`, takže by se počítalo do stropu „nikdo nepřidělí
  víc, než má sám" (`app.smi_pridelit`) a role Bar by ho po zbytek běhu
  nesla navíc oproti tomu, co dělá `app.create_tenant`. Scénář po sobě
  nechává stav, jaký zastal — `ai.use` uklidila migrace sama.
*/
delete from public.role_permissions
 where role_id = :'role_bar' and permission_key = 'menu_ai.use';

delete from app.role_template_permissions
 where template_key = 'bar' and permission_key = 'menu_ai.use';

/*
  Právo ale z KATALOGU nemizí — až modul vznikne, přidá se zpátky.

  Drží to i `krok3_scenar`: ten porovnává `public.permissions` s ručně
  psaným seznamem 34 klíčů uvnitř svého SQL (ř. 30–43). Pozor na to,
  co to opravdu znamená — `lib/authz.ts` se při běhu NEČTE. Kdyby klíč
  zmizel odsud, `krok3` spadne a někdo se na to musí podívat; že se
  srovná i seznam v aplikaci, hlídá ten člověk, ne databáze.
*/
select pg_temp.check('v katalogu oprávnění ale zůstává',
  exists (select 1 from public.permissions where key = 'ai.use'));


\echo ''
\echo '== KROK 29 HOTOV ========================================'
