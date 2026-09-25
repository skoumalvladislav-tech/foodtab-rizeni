-- Scénář pro krok 60 — potvrzení zálohy v telefonu, za zaměstnance
-- majitelem a zpráva tomu, kdo zálohu vydal.
--
-- Pokrývá migraci 20260925100000_zalohy_potvrzeni.sql.
--
-- Navazuje jen na etapa0_scenar.sql (firma Foodtab s.r.o., pobočky
-- Černá Perla a Bernard Bar, majitel). Pouští se i samostatně:
--   node scripts/scenare-pglite.mjs etapa0_scenar krok60_scenar
-- Kroky 58 a 59 patří jiným větvím.
--
-- ---------------------------------------------------------------------
-- ZADÁNÍ MAJITELE 25. 9. 2026
--
-- „…pracovníkovi který si zálohu bere přijde notifikace a potvrdí ve svém
-- telefonu že si ji vzal. zároveň pracovník který zálohu předal dostane
-- info že je potvrzeno." — „já jako majitel potřebuji umět potvrdit
-- zálohu každému zaměstnanci"
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. výplata: upozornění příjemci jde přes app.notifikovat (zdroj,
--      fronta doručení, bez aktivního členství nic);
--   2. moje nepotvrzené: jen vlastní, jen nepotvrzené, jen téhle firmy,
--      ne smazanému, ne s pozastaveným členstvím;
--   3. příjemce potvrdí svou v telefonu, cizí ne; zápis kdo/kdy/jak,
--      audit, zpráva vydávajícímu, zrušený čekající push;
--   4. stornovaná ani už potvrzená nejde;
--   5. majitel za kohokoli (i na jiné pobočce, i brigádníkovi bez účtu),
--      ne-majitel s advances.manage za jiného NE; zpráva vydávajícímu
--      i tomu, za koho se potvrdilo; majitel sám sobě nepíše;
--   6. PIN na kiosku: zpráva vydávajícímu jde i odsud;
--   7. cizí firma (majitel i člověk ve dvou firmách);
--   8. granty, sloupce a pojistka na hodnotu způsobu.
--
-- Každá odmítnutá cesta se kontroluje i HLÁŠKOU, ne jen kódem: několik
-- filtrů odmítá stejným kódem, a vyndání jednoho by jinak prošlo
-- nepoznané (spadlo by to jinou větou).
--
-- POZOR NA PGLITE: běží jako superuživatel, RLS ani sloupcové granty se
-- tam neuplatní. Tady nevadí — všechno, co se měří, je uvnitř definer
-- funkcí (tam RLS není ani na Supabase) a granty se čtou katalogem.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

-- Spadne příkaz s TÍMHLE kódem a TOUHLE hláškou? Jiná výjimka = ne.
create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if not (sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%') then
    raise notice '  (spadlo jinak: % %)', sqlstate, sqlerrm;
  end if;
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

-- Projde příkaz BEZ výjimky? Když neprojde, ať to spadne pojmenovanou
-- kontrolou a důvod se vypíše.
create or replace function pg_temp.projde(p_sql text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  raise notice '  (neprošlo: % %)', sqlstate, sqlerrm;
  return false;
end $$;

reset role;
-- Předchozí scénář (v PGlite v témže sezení) nechává test.user_id
-- nastavené — bez tohohle by přímé inserty spadly na cizí kontrole.
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('60600000-0000-0000-0000-000000000001', 'petra60@foodtab.cz', '{"full_name":"Petra Šedesát"}'),
  ('60600000-0000-0000-0000-000000000002', 'radek60@foodtab.cz', '{"full_name":"Radek Šedesát"}'),
  ('60600000-0000-0000-0000-000000000003', 'olga60@foodtab.cz',  '{"full_name":"Olga Šedesát"}'),
  ('60600000-0000-0000-0000-000000000004', 'vera60@foodtab.cz',  '{"full_name":"Věra Šedesát"}'),
  ('60600000-0000-0000-0000-000000000005', 'dan60@foodtab.cz',   '{"full_name":"Dan Šedesát"}'),
  ('60600000-0000-0000-0000-000000000006', 'eva60@foodtab.cz',   '{"full_name":"Eva Šedesát"}'),
  ('60600000-0000-0000-0000-000000000007', 'ivo60@foodtab.cz',   '{"full_name":"Ivo Šedesát"}'),
  ('60600000-0000-0000-0000-000000000009', 'cizimajitel60@jinafirma.cz', '{"full_name":"Cizí Majitel Šedesát"}');

-- Petra vydává zálohy na Perle. Právo dává zařazení, ne role.
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska60_vydej', 'Zkouška 60 — výdej záloh', 'servis', true)
returning id as z_vydej \gset

insert into public.position_permissions (tenant_id, position_id, permission_key)
values (:'tenant', :'z_vydej', 'advances.manage');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000001', :'z_vydej', 'Petra Šedesát', 'hpp')
returning id as petra \gset

-- Příjemci na Perle.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000002', 'Radek Šedesát', 'hpp')
returning id as radek \gset

-- Olga: účet má, členství POZASTAVENÉ.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000003', 'Olga Šedesát', 'hpp')
returning id as olga \gset

-- Věra: zaměstnaná ve DVOU firmách (tady a v cizí níž).
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000004', 'Věra Šedesát', 'hpp')
returning id as vera \gset

-- Dan: po výplatě se označí jako smazaný.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000005', 'Dan Šedesát', 'hpp')
returning id as dan \gset

-- Brigádník bez účtu.
insert into public.employees (tenant_id, branch_id, full_name, employment_type)
values (:'tenant', :'perla', 'Bohouš Šedesát', 'dpp')
returning id as bohous \gset

-- Eva z Baru — tam jí zálohu vyplatí a potvrdí majitel.
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'bar', '60600000-0000-0000-0000-000000000006', 'Eva Šedesát', 'hpp')
returning id as eva \gset

-- Ivo: vyplácet zálohy smí v CELÉ firmě (výjimka u člověka, členství
-- s rozsahem firmy), majitel ale není. Na něm se zkouší, že potvrzení
-- za zaměstnance nepouští ani nejširší advances.manage — Petra s právem
-- jen na Perle by nepoznala bránu „advances.manage za celou firmu".
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', '60600000-0000-0000-0000-000000000007', 'Ivo Šedesát', 'hpp')
returning id as ivo \gset

insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'ivo', 'advances.manage', true);

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '60600000-0000-0000-0000-000000000001', null, 'branch', 'active'),
  (:'tenant', '60600000-0000-0000-0000-000000000002', null, 'branch', 'active'),
  (:'tenant', '60600000-0000-0000-0000-000000000003', null, 'branch', 'suspended'),
  (:'tenant', '60600000-0000-0000-0000-000000000004', null, 'branch', 'active'),
  (:'tenant', '60600000-0000-0000-0000-000000000005', null, 'branch', 'active'),
  (:'tenant', '60600000-0000-0000-0000-000000000006', null, 'branch', 'active'),
  (:'tenant', '60600000-0000-0000-0000-000000000007', null, 'tenant', 'active');

insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = '60600000-0000-0000-0000-000000000006'
                  then :'bar'::uuid else :'perla'::uuid end
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.scope = 'branch'
   and m.user_id::text like '60600000-0000-0000-0000-00000000000%';

-- Cizí firma: majitel, pobočka, Věra jako zaměstnankyně i tam a jedna
-- záloha (přímým zápisem — výplata v cizí firmě tu není předmětem).
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok60 Cizí s.r.o.', 'Krok60 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset

insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 60', 'krok60-cizi')
returning id as cizi_pobocka \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'cizi_firma', null, '60600000-0000-0000-0000-000000000009', 'Cizí Majitel Krok60', 'ico', true)
returning id as cizi_majitel_e \gset

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'cizi_firma', :'cizi_pobocka', '60600000-0000-0000-0000-000000000004', 'Věra Šedesát', 'hpp')
returning id as vera_cizi \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'cizi_firma', '60600000-0000-0000-0000-000000000009', null, 'tenant', 'active'),
  (:'cizi_firma', '60600000-0000-0000-0000-000000000004', null, 'tenant', 'active');

insert into public.advances (tenant_id, branch_id, employee_id, castka_haleru, business_date, poznamka)
values (:'cizi_firma', :'cizi_pobocka', :'vera_cizi', 70000, current_date, 'krok60 cizí')
returning id as zal_cizi \gset

-- Telefony (push) Radka a Petry — podle řádku ve frontě doručení se
-- pozná, že upozornění prošlo app.notifikovat (app.zaradit_doruceni).
set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/krok60-radek',
                                'klic-p256dh-radek-60', 'auth-radek-60');
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select public.push_odber_ulozit('https://fcm.googleapis.com/fcm/send/krok60-petra',
                                'klic-p256dh-petra-60', 'auth-petra-60');
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 0. Příprava měří to, co má ============================'

select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select pg_temp.check('příprava: Petra smí vyplácet zálohy na Perle',
  app.has_access(:'tenant', 'advances.manage', :'perla'));
select pg_temp.check('příprava: Petra NENÍ majitelka',
  not app.is_owner(:'tenant'));

select set_config('test.user_id', '60600000-0000-0000-0000-000000000007', false);
select pg_temp.check('příprava: Ivo smí vyplácet za CELOU firmu i na Perle, majitel není',
  app.has_access(:'tenant', 'advances.manage')
  and app.has_access(:'tenant', 'advances.manage', :'perla')
  and not app.is_owner(:'tenant'));

select set_config('test.user_id', :'majitel', false);
select pg_temp.check('příprava: majitel je majitel',
  app.is_owner(:'tenant'));

select set_config('test.user_id', '60600000-0000-0000-0000-000000000009', false);
select pg_temp.check('příprava: cizí majitel je majitel SVÉ firmy, ne téhle',
  app.is_owner(:'cizi_firma') and not app.is_owner(:'tenant'));

select set_config('test.user_id', '60600000-0000-0000-0000-000000000004', false);
select pg_temp.check('příprava: Věra je aktivní členkou obou firem',
  app.is_member(:'tenant') and app.is_member(:'cizi_firma'));

select set_config('test.user_id', '60600000-0000-0000-0000-000000000003', false);
select pg_temp.check('příprava: Olga má pozastavené členství',
  not app.is_member(:'tenant'));

select set_config('test.user_id', '', false);


\echo ''
\echo '== 1. Výplata — upozornění přes Notification Service ===='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);

select zaloha as zal1 from public.vyplatit_zalohu(
  :'tenant', :'radek', 150000, 'krok60 1', :'perla') \gset
select zaloha as zal_olga from public.vyplatit_zalohu(
  :'tenant', :'olga', 20000, 'krok60 olga', :'perla') \gset
select zaloha as zal_dan from public.vyplatit_zalohu(
  :'tenant', :'dan', 30000, 'krok60 dan', :'perla') \gset
select zaloha as zal_vera from public.vyplatit_zalohu(
  :'tenant', :'vera', 40000, 'krok60 věra', :'perla') \gset

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Radek dostal JEDNO upozornění zaloha.vyplacena',
  (select count(*) from public.notifications n
    where n.druh = 'zaloha.vyplacena'
      and n.user_id = '60600000-0000-0000-0000-000000000002'
      and n.telo ->> 'zaloha' = :'zal1') = 1);

select pg_temp.check('… se zdrojem záloha/id (podle něj jde push hned i zrušení)',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.vyplacena'
             and n.user_id = '60600000-0000-0000-0000-000000000002'
             and n.zdroj_typ = 'zaloha' and n.zdroj_id = :'zal1'));

select pg_temp.check('… se stejným tělem jako dřív (částka, záloha, den)',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.vyplacena'
             and n.zdroj_id = :'zal1'
             and (n.telo ->> 'castka_haleru')::integer = 150000
             and n.telo ? 'den'));

-- Frontu doručení zakládá jen app.zaradit_doruceni, a tu volá jen
-- app.notifikovat. Přímý insert (jak to bylo) by řádek nezaložil.
select pg_temp.check('… a je ve frontě doručení na telefon (čeká na směnu — Radek není v práci)',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal1' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'ceka_na_smenu'));

select pg_temp.check('Olga (účet má, členství pozastavené) upozornění nedostala',
  not exists (select 1 from public.notifications n
               where n.user_id = '60600000-0000-0000-0000-000000000003'
                 and n.druh = 'zaloha.vyplacena'));

select pg_temp.check('důkaz: Olgina záloha se zapsala a Olga účet má',
  exists (select 1 from public.advances a join public.employees e on e.id = a.employee_id
           where a.id = :'zal_olga' and e.user_id is not null));


\echo ''
\echo '== 2. Moje nepotvrzené zálohy ==========================='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);

select pg_temp.check('Radek svou nepotvrzenou vidí — částka, kdo vydal, pobočka',
  exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
           where m.id = :'zal1'
             and m.castka_haleru = 150000
             and m.vydal = 'Petra Šedesát'
             and m.pobocka = 'Restaurace Černá Perla'));

select pg_temp.check('a cizí (Danovu) v ní nemá',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal_dan'));

reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select pg_temp.check('Petra (vydala ji) Radkovu zálohu mezi svými nevidí',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal1'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000003', false);
select pg_temp.check('Olga s pozastaveným členstvím nevidí ani svou',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal_olga'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000004', false);
select pg_temp.check('Věra svou vidí u SVÉ firmy',
  exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
           where m.id = :'zal_vera'));
select pg_temp.check('ale ne, když se ptá za druhou firmu',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'cizi_firma') m
               where m.id = :'zal_vera'));
reset role;

-- Dan: označený smazaný (po výplatě). Vrací se v oddílu 3.
select set_config('test.user_id', '', false);
update public.employees set deleted_at = now() where id = :'dan';

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000005', false);
select pg_temp.check('označený smazaný Dan svou zálohu nevidí',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal_dan'));
reset role;


\echo ''
\echo '== 3. Příjemce potvrdí ve svém telefonu ================='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000005', false);
select pg_temp.check('smazaný Dan svou zálohu nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'tenant', :'zal_dan'), 'P0002', 'Takovou zálohu tu nemáte'));
reset role;

select set_config('test.user_id', '', false);
update public.employees set deleted_at = null where id = :'dan';

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000005', false);
select pg_temp.check('důkaz: po vrácení ji Dan vidí (bránilo jen smazání)',
  exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
           where m.id = :'zal_dan'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000003', false);
select pg_temp.check('Olga s pozastaveným členstvím svou nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'tenant', :'zal_olga'), '42501', 'Do téhle firmy nepatříte'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000004', false);
select pg_temp.check('Věra svou zálohu nepotvrdí voláním za DRUHOU firmu',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'cizi_firma', :'zal_vera'), 'P0002', 'Takovou zálohu tu nemáte'));
reset role;

select pg_temp.check('Věřina záloha zůstala nepotvrzená',
  (select stav from public.advances where id = :'zal_vera') = 'nepotvrzena');

-- Cizí záloha: Petra ji vydala, ale potvrdit ji nesmí.
set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select pg_temp.check('Petra (vydávající) Radkovu zálohu „jako svou" nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'tenant', :'zal1'), 'P0002', 'Takovou zálohu tu nemáte'));
reset role;

select pg_temp.check('Radkova záloha je pořád nepotvrzená',
  (select stav from public.advances where id = :'zal1') = 'nepotvrzena');

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select potvrdit_moji_zalohu as zal1_vraceno
  from public.potvrdit_moji_zalohu(:'tenant', :'zal1') \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('funkce vrací id zálohy (pro push hned)',
  :'zal1_vraceno' = :'zal1');

select pg_temp.check('záloha je potvrzená — v telefonu, Radkem, teď',
  exists (select 1 from public.advances
           where id = :'zal1'
             and stav = 'potvrzena'
             and potvrzeno_jak = 'telefon'
             and potvrdil = '60600000-0000-0000-0000-000000000002'
             and potvrzeno_zarizenim is null
             and potvrzeno_kdy > now() - interval '1 hour'));

select pg_temp.check('potvrzení je v auditu i se způsobem',
  exists (select 1 from public.audit_log
           where action = 'advance.potvrzeno' and entity_id = :'zal1'
             and after ->> 'jak' = 'telefon'));

select pg_temp.check('Petra (vydala ji) dostala zaloha.potvrzena — jednu',
  (select count(*) from public.notifications n
    where n.druh = 'zaloha.potvrzena'
      and n.user_id = '60600000-0000-0000-0000-000000000001'
      and n.zdroj_typ = 'zaloha' and n.zdroj_id = :'zal1') = 1);

select pg_temp.check('… s kým, kolik a jak',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.potvrzena' and n.zdroj_id = :'zal1'
             and n.telo ->> 'jmeno' = 'Radek Šedesát'
             and (n.telo ->> 'castka_haleru')::integer = 150000
             and n.telo ->> 'jak' = 'telefon'));

select pg_temp.check('… a jde na její telefon (fronta doručení)',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal1' and n.druh = 'zaloha.potvrzena'));

select pg_temp.check('Radek sám žádné „potvrzeno" nedostal',
  not exists (select 1 from public.notifications n
               where n.user_id = '60600000-0000-0000-0000-000000000002'
                 and n.druh like 'zaloha.potvrzena%' and n.zdroj_id = :'zal1'));

select pg_temp.check('čekající push „máte zálohu k potvrzení" se zrušil',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal1' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'zruseno')
  and not exists (select 1 from public.notifikace_doruceni d
                    join public.notifications n on n.id = d.notification_id
                   where n.zdroj_id = :'zal1' and n.druh = 'zaloha.vyplacena'
                     and d.stav in ('ceka_na_smenu', 'k_odeslani')));

select pg_temp.check('záznam v aplikaci ale zůstal',
  exists (select 1 from public.notifications n
           where n.zdroj_id = :'zal1' and n.druh = 'zaloha.vyplacena'));

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select pg_temp.check('potvrzená z „mých nepotvrzených" zmizela',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal1'));
select pg_temp.check('podruhé potvrdit nejde',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'tenant', :'zal1'), '23514', 'je už potvrzená'));
reset role;

select pg_temp.check('a druhé zprávě vydávající nepřišlo nic',
  (select count(*) from public.notifications n
    where n.druh = 'zaloha.potvrzena' and n.zdroj_id = :'zal1') = 1);


\echo ''
\echo '== 4. Stornovaná se nepotvrzuje =========================='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select zaloha as zal_storno from public.vyplatit_zalohu(
  :'tenant', :'radek', 5000, 'krok60 storno', :'perla') \gset
select public.stornovat_zalohu(:'tenant', :'zal_storno', 'krok60 překlep');
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select pg_temp.check('stornovaná není mezi „mými nepotvrzenými"',
  not exists (select 1 from public.moje_nepotvrzene_zalohy(:'tenant') m
               where m.id = :'zal_storno'));
select pg_temp.check('příjemce stornovanou nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_moji_zalohu(%L, %L)',
    :'tenant', :'zal_storno'), '23514', 'Stornovaná záloha se nepotvrzuje'));
reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel stornovanou taky ne',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal_storno'), '23514', 'Stornovaná záloha se nepotvrzuje'));
reset role;

select pg_temp.check('stornovaná zůstala stornovaná',
  (select stav from public.advances where id = :'zal_storno') = 'stornovana');


\echo ''
\echo '== 5. Majitel potvrdí za kohokoli ======================='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select zaloha as zal2 from public.vyplatit_zalohu(
  :'tenant', :'radek', 60000, 'krok60 majitel', :'perla') \gset
select zaloha as zal_bohous from public.vyplatit_zalohu(
  :'tenant', :'bohous', 25000, 'krok60 brigádník', :'perla') \gset

select pg_temp.check('Petra (advances.manage, ne majitelka) za Radka nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal2'), '42501', 'jen majitel'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select pg_temp.check('ani Radek sám cestou majitele',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal2'), '42501', 'jen majitel'));
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000007', false);
select pg_temp.check('ani Ivo s advances.manage za CELOU firmu (ne majitel)',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal2'), '42501', 'jen majitel'));
reset role;

select pg_temp.check('Radkova druhá záloha je pořád nepotvrzená',
  (select stav from public.advances where id = :'zal2') = 'nepotvrzena');

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel potvrdí za Radka',
  pg_temp.projde(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal2')));

select pg_temp.check('majitel potvrdí i za brigádníka bez účtu',
  pg_temp.projde(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal_bohous')));

-- Na Baru — vyplatí i potvrdí sám majitel.
select zaloha as zal_eva from public.vyplatit_zalohu(
  :'tenant', :'eva', 35000, 'krok60 bar', :'bar') \gset
select pg_temp.check('majitel potvrdí i na druhé pobočce (Bar)',
  pg_temp.projde(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal_eva')));

select pg_temp.check('podruhé ani majitel nepotvrdí',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal2'), '23514', 'je už potvrzená'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('zapsáno, že potvrdil majitel (kdo a jak)',
  (select count(*) from public.advances
    where id in (:'zal2', :'zal_bohous', :'zal_eva')
      and stav = 'potvrzena'
      and potvrzeno_jak = 'majitel'
      and potvrdil = :'majitel'::uuid) = 3);

select pg_temp.check('v auditu se způsobem majitel',
  (select count(*) from public.audit_log
    where action = 'advance.potvrzeno'
      and entity_id in (:'zal2', :'zal_bohous', :'zal_eva')
      and after ->> 'jak' = 'majitel') = 3);

select pg_temp.check('Petra dostala zaloha.potvrzena za Radka i za brigádníka (jak = majitel)',
  (select count(*) from public.notifications n
    where n.druh = 'zaloha.potvrzena'
      and n.user_id = '60600000-0000-0000-0000-000000000001'
      and n.zdroj_id in (:'zal2', :'zal_bohous')
      and n.telo ->> 'jak' = 'majitel') = 2);

select pg_temp.check('Radek se dozvěděl, že za něj potvrdil majitel',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.potvrzena_za_vas'
             and n.user_id = '60600000-0000-0000-0000-000000000002'
             and n.zdroj_typ = 'zaloha' and n.zdroj_id = :'zal2'));

select pg_temp.check('Eva taky (Bar)',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.potvrzena_za_vas'
             and n.user_id = '60600000-0000-0000-0000-000000000006'
             and n.zdroj_id = :'zal_eva'));

select pg_temp.check('majitel, který Evě vyplatil i potvrdil, sám sobě nepíše',
  not exists (select 1 from public.notifications n
               where n.user_id = :'majitel'::uuid
                 and n.zdroj_id = :'zal_eva'));

select pg_temp.check('„za vás" jde jen při potvrzení majitelem (u telefonu ne)',
  not exists (select 1 from public.notifications n
               where n.druh = 'zaloha.potvrzena_za_vas' and n.zdroj_id = :'zal1'));


\echo ''
\echo '== 6. PIN na kiosku — i odsud zpráva vydávajícímu ======='

select set_config('test.user_id', :'majitel', false);
select kod as kod60 from public.vytvorit_registracni_kod(
  :'tenant', :'perla', 'tablet krok60') \gset
select klic as klic60 from public.registrovat_zarizeni(:'kod60') \gset
select set_config('test.user_id', '', false);

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000002', false);
select public.nastavit_pin(:'tenant', '6039');
reset role;

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select zaloha as zal3 from public.vyplatit_zalohu(
  :'tenant', :'radek', 80000, 'krok60 pin', :'perla') \gset
reset role;
select set_config('test.user_id', '', false);

set role anon;
select ok as pin_ok from public.potvrdit_zalohu_pinem(:'klic60', '6039', :'zal3') \gset
reset role;

select pg_temp.check('PIN na tabletu zálohu potvrdil',
  :'pin_ok'::boolean);

select pg_temp.check('zapsáno jako PIN, s tabletem, bez účtu',
  exists (select 1 from public.advances
           where id = :'zal3' and stav = 'potvrzena'
             and potvrzeno_jak = 'pin'
             and potvrdil is null
             and potvrzeno_zarizenim is not null));

select pg_temp.check('Petra dostala zaloha.potvrzena i z kiosku (jak = pin)',
  exists (select 1 from public.notifications n
           where n.druh = 'zaloha.potvrzena'
             and n.user_id = '60600000-0000-0000-0000-000000000001'
             and n.zdroj_id = :'zal3'
             and n.telo ->> 'jak' = 'pin'));

select pg_temp.check('i tady se zrušil čekající push k výplatě',
  exists (select 1 from public.notifikace_doruceni d
            join public.notifications n on n.id = d.notification_id
           where n.zdroj_id = :'zal3' and n.druh = 'zaloha.vyplacena'
             and d.stav = 'zruseno'));

set role anon;
select ok as pin_ok2 from public.potvrdit_zalohu_pinem(:'klic60', '6039', :'zal3') \gset
reset role;

select pg_temp.check('druhé potvrzení PINem je jen „ok", nic nového',
  :'pin_ok2'::boolean
  and (select count(*) from public.notifications n
        where n.druh = 'zaloha.potvrzena' and n.zdroj_id = :'zal3') = 1);


\echo ''
\echo '== 7. Cizí firma =========================================='

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000009', false);

-- Majitel SVÉ firmy (is_owner projde) s id zálohy z téhle. Zastavit ho
-- musí filtr firmy u zálohy.
select pg_temp.check('cizí majitel zálohu téhle firmy nepotvrdí (volá za svou)',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'cizi_firma', :'zal_vera'), 'P0002', 'Taková záloha tu není'));

select pg_temp.check('ani když se vydává za majitele téhle',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal_vera'), '42501', 'jen majitel'));
reset role;

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel téhle firmy nepotvrdí zálohu cizí firmy',
  pg_temp.spadne_hlaskou(format('select public.potvrdit_zalohu_za_zamestnance(%L, %L)',
    :'tenant', :'zal_cizi'), 'P0002', 'Taková záloha tu není'));
reset role;

select pg_temp.check('obě zálohy zůstaly nepotvrzené',
  (select count(*) from public.advances
    where id in (:'zal_vera', :'zal_cizi') and stav = 'nepotvrzena') = 2);


\echo ''
\echo '== 8. Granty, sloupce, pojistka ==========================='

select pg_temp.check('potvrzení v telefonu: přihlášený ano, anonym ne',
  has_function_privilege('authenticated', 'public.potvrdit_moji_zalohu(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_moji_zalohu(uuid, uuid)', 'execute'));

select pg_temp.check('potvrzení za zaměstnance: přihlášený ano (rozhoduje is_owner), anonym ne',
  has_function_privilege('authenticated', 'public.potvrdit_zalohu_za_zamestnance(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.potvrdit_zalohu_za_zamestnance(uuid, uuid)', 'execute'));

select pg_temp.check('moje nepotvrzené: přihlášený ano, anonym ne',
  has_function_privilege('authenticated', 'public.moje_nepotvrzene_zalohy(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.moje_nepotvrzene_zalohy(uuid)', 'execute'));

select pg_temp.check('pomocnou funkci nevolá zvenku nikdo',
  not has_function_privilege('authenticated', 'app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'app.zapsat_potvrzeni_zalohy(uuid, text, uuid, uuid)', 'execute'));

select pg_temp.check('kiosek (anon) potvrzuje PINem dál',
  has_function_privilege('anon', 'public.potvrdit_zalohu_pinem(text, text, uuid)', 'execute'));

select pg_temp.check('nové sloupce jde číst pod authenticated (sloupcový grant)',
  has_column_privilege('authenticated', 'public.advances', 'potvrzeno_jak', 'select')
  and has_column_privilege('authenticated', 'public.advances', 'potvrdil', 'select'));

select pg_temp.check('zapisovat do nich přímo nejde',
  not has_column_privilege('authenticated', 'public.advances', 'potvrzeno_jak', 'update')
  and not has_column_privilege('authenticated', 'public.advances', 'potvrdil', 'update'));

select pg_temp.check('zalohy_pobocky existuje JEDNOU a smí ji jen přihlášený',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'zalohy_pobocky') = 1
  and has_function_privilege('authenticated', 'public.zalohy_pobocky(uuid, date, date, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.zalohy_pobocky(uuid, date, date, uuid)', 'execute'));

set role authenticated;
select set_config('test.user_id', '60600000-0000-0000-0000-000000000001', false);
select pg_temp.check('seznam záloh pobočky ukazuje, JAK se potvrdilo',
  (select z.potvrzeno_jak from public.zalohy_pobocky(:'tenant', current_date - 40, current_date + 1) z
    where z.id = :'zal1') = 'telefon'
  and (select z.potvrzeno_jak from public.zalohy_pobocky(:'tenant', current_date - 40, current_date + 1) z
        where z.id = :'zal2') = 'majitel'
  and (select z.potvrzeno_jak from public.zalohy_pobocky(:'tenant', current_date - 40, current_date + 1) z
        where z.id = :'zal3') = 'pin');
reset role;
select set_config('test.user_id', '', false);

-- Pojistka na hodnotu způsobu. (Podmínku „potvrzená MUSÍ mít způsob"
-- migrace schválně nemá — viz její hlavička; že ho píše každá cesta,
-- kontrolují oddíly 3, 5 a 6.)
select pg_temp.check('neznámý způsob nejde uložit',
  pg_temp.spadne_hlaskou(format(
    'update public.advances set potvrzeno_jak = %L where id = %L',
    'sms', :'zal_dan'), '23514', 'advances_potvrzeno_jak_hodnoty'));


\echo ''
\echo '== Úklid ================================================='

/*
  Uklízí se zálohy, upozornění (i fronta doručení) a telefony lidí
  z kroku 60, PIN, členství, lidé a zařazení.

  CIZÍ FIRMA ZŮSTÁVÁ (stejně jako po krocích 54 a 57) — má pobočku
  a audit_log ji nedovolí smazat (viz úklid kroku 57). Maže se aspoň
  její záloha, lidé a členství. Tablet zůstává, stejně jako po kroku 8.
*/
select set_config('test.user_id', '', false);

delete from public.notifikace_doruceni
 where user_id::text like '60600000-0000-0000-0000-00000000000%';
delete from public.notifications
 where user_id::text like '60600000-0000-0000-0000-00000000000%'
    or (zdroj_typ = 'zaloha' and zdroj_id in (
         select a.id from public.advances a
          where a.employee_id in (:'petra', :'radek', :'olga', :'vera', :'dan', :'bohous', :'eva', :'vera_cizi')));
delete from public.push_odbery
 where user_id::text like '60600000-0000-0000-0000-00000000000%';
delete from public.advances
 where employee_id in (:'petra', :'radek', :'olga', :'vera', :'dan', :'bohous', :'eva', :'vera_cizi');
delete from public.employee_pins where employee_id = :'radek';
delete from public.employee_permissions where employee_id = :'ivo';
delete from public.memberships
 where user_id::text like '60600000-0000-0000-0000-00000000000%'
   and user_id <> '60600000-0000-0000-0000-000000000009';
delete from public.employees
 where id in (:'petra', :'radek', :'olga', :'vera', :'dan', :'bohous', :'eva',
              :'ivo', :'vera_cizi');
delete from public.position_permissions where position_id = :'z_vydej';
delete from public.positions where id = :'z_vydej';

select pg_temp.check('úklid: po scénáři nezůstal nikdo z kroku 60',
  not exists (select 1 from public.employees where full_name like '%Šedesát')
  and not exists (select 1 from public.advances where poznamka like 'krok60%')
  and not exists (select 1 from public.notifications
                   where user_id::text like '60600000-0000-0000-0000-00000000000%')
  and not exists (select 1 from public.positions where id = :'z_vydej'));

\echo ''
\echo '== KROK 60 HOTOV ========================================'
