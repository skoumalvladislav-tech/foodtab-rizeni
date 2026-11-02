-- Scénář pro krok 108 — Rezervace a akce: dokument Word (.docx) v přílohách.
--
-- Pokrývá migraci 20261106110000_rezervace_prilohy_word.sql (kbelík
-- `rezervace`, CHECK na rezervace_prilohy.mime, app.rezervace_cesta).
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab, Perla, majitel).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. kbelík přijímá přesně fotky, PDF a .docx — ne starý .doc ani .docm
--      s makry;
--   2. cesta v úložišti smí končit .docx (a dál .pdf/.jpg/…), ne .doc,
--      .docm, .DOCX ani .docx.exe;
--   3. řádek přílohy nese .docx, ne application/msword ani macroEnabled —
--      ani kdyby úložiště nějak pustilo jiný typ;
--   4. člověk s rezervace.manage nahraje .docx a připojí ho ke dni; typ
--      a velikost se berou z úložiště;
--   5. přepsaná funkce cesty si nechala granty (klient ano, anon ne).
--
-- POZOR, SDÍLENÁ DATABÁZE: kontroly se ptají jen na soubory a lidi
-- tohohle scénáře.

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
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset

select 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as mime_docx \gset
select 'application/vnd.ms-word.document.macroEnabled.12' as mime_docm \gset

\set wanda 10810000-0000-0000-0000-000000000001

insert into auth.users (id, email, raw_user_meta_data) values
  (:'wanda', 'wanda108@foodtab.cz', '{"full_name":"Wanda Stoosmička"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska108_zapis', 'Zkouška 108 — zápis', 'provoz', true) returning id as z_zapis \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_zapis', 'rezervace.manage');

insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'wanda', :'z_zapis', 'Wanda Stoosmička', 'hpp') returning id as e_wanda \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', :'wanda', null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, :'perla' from public.memberships m where m.tenant_id = :'tenant' and m.user_id = :'wanda';

select format('%s/%s/%s.docx', :'tenant', :'perla', '10810000-dddd-0000-0000-000000000001') as c_docx \gset
select format('%s/%s/%s.docx', :'tenant', :'perla', '10810000-dddd-0000-0000-000000000002') as c_docx2 \gset
select format('%s/%s/%s.docx', :'tenant', :'perla', '10810000-dddd-0000-0000-000000000003') as c_docx3 \gset
select format('%s/%s/%s.doc',  :'tenant', :'perla', '10810000-dddd-0000-0000-000000000004') as c_doc \gset
select format('%s/%s/%s.docm', :'tenant', :'perla', '10810000-dddd-0000-0000-000000000005') as c_docm \gset
select format('%s/%s/%s.pdf',  :'tenant', :'perla', '10810000-dddd-0000-0000-000000000006') as c_pdf \gset


\echo ''
\echo '== 0. Příprava ==========================================='

select pg_temp.check('příprava: Wanda zapisuje rezervace na Perle',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'perla') where user_id = :'wanda'));


\echo ''
\echo '== 1. Kbelík ============================================='

-- Přesný seznam: starý .doc ani .docm s makry v něm tedy nejsou.
select pg_temp.check('kbelík přijímá přesně fotky, PDF a Word .docx',
  (select allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', :'mime_docx']
     from storage.buckets where id = 'rezervace'));
select pg_temp.check('… a dál je soukromý a do 10 MB',
  (select not public and file_size_limit = 10485760 from storage.buckets where id = 'rezervace'));


\echo ''
\echo '== 2. Cesta v úložišti ==================================='

select pg_temp.check('cesta s .docx patří firmě a pobočce',
  (select tenant_id = :'tenant' and branch_id = :'perla' from app.rezervace_cesta(:'c_docx')));
select pg_temp.check('cesta s .pdf platí dál',
  exists (select 1 from app.rezervace_cesta(:'c_pdf')));
select pg_temp.check('cesta s .doc neplatí',
  not exists (select 1 from app.rezervace_cesta(:'c_doc')));
select pg_temp.check('cesta s .docm neplatí',
  not exists (select 1 from app.rezervace_cesta(:'c_docm')));
select pg_temp.check('cesta s .DOCX (velká písmena) neplatí — appka píše malými',
  not exists (select 1 from app.rezervace_cesta(left(:'c_docx', length(:'c_docx') - 4) || 'DOCX')));
select pg_temp.check('cesta s .docx.exe neplatí',
  not exists (select 1 from app.rezervace_cesta(:'c_docx' || '.exe')));
select pg_temp.check('přepsaná funkce cesty: klient ji volat smí, anon ne',
  has_function_privilege('authenticated', 'app.rezervace_cesta(text)', 'execute')
  and not has_function_privilege('anon', 'app.rezervace_cesta(text)', 'execute'));


\echo ''
\echo '== 3. Typ v řádku přílohy ================================'

-- Přímý zápis jako vlastník databáze: granty neplatí, CHECK ano.
select pg_temp.check('řádek přílohy s .docx projde',
  pg_temp.projde(format(
    'insert into public.rezervace_prilohy (tenant_id, branch_id, den, cesta, nazev, mime, velikost) values (%L, %L, %L, %L, %L, %L, 1)',
    :'tenant', :'perla', '2031-05-10', :'c_docx3', 'zkouska.docx', :'mime_docx')));
delete from public.rezervace_prilohy where cesta = :'c_docx3';
select pg_temp.check('řádek s application/msword neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_prilohy (tenant_id, branch_id, den, cesta, nazev, mime, velikost) values (%L, %L, %L, %L, %L, %L, 1)',
    :'tenant', :'perla', '2031-05-10', :'c_docx3', 'zkouska.doc', 'application/msword'),
    '23514', 'rezervace_prilohy_mime_check'));
select pg_temp.check('řádek s .docm (makra) neprojde',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_prilohy (tenant_id, branch_id, den, cesta, nazev, mime, velikost) values (%L, %L, %L, %L, %L, %L, 1)',
    :'tenant', :'perla', '2031-05-10', :'c_docx3', 'zkouska.docm', :'mime_docm'),
    '23514', 'rezervace_prilohy_mime_check'));


\echo ''
\echo '== 4. Nahrání a připojení ================================'

set role authenticated;
select set_config('test.user_id', :'wanda', false);

select pg_temp.check('Wanda nahraje .docx do cesty Perly',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'c_docx', :'wanda', jsonb_build_object('mimetype', :'mime_docx', 'size', 23456))));
select pg_temp.check('… .doc do cesty nenahraje (politika kbelíku cestu nepustí)',
  not pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'c_doc', :'wanda', '{"mimetype":"application/msword","size":10}')));
select pg_temp.check('… ani .docm',
  not pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'c_docm', :'wanda', jsonb_build_object('mimetype', :'mime_docm', 'size', 10))));
-- Soubor s cestou .docx, o kterém úložiště tvrdí, že je to starý .doc
-- (skutečné úložiště ho podle kbelíku nepřijme; tady se zkouší třetí
-- zámek, kdyby to někdy prošlo).
select pg_temp.check('… a soubor .docx, který úložiště vede jako .doc, nahraje (zkouška třetího zámku)',
  pg_temp.projde(format('insert into storage.objects (bucket_id, name, owner, metadata) values (%L, %L, %L, %L)',
    'rezervace', :'c_docx2', :'wanda', '{"mimetype":"application/msword","size":10}')));

select public.rezervace_pripojit_prilohu(:'tenant', :'perla', null, '2031-05-10', :'c_docx',
  'Smlouva o akci.docx', :'mime_docx', 23456) as pr_docx \gset

select pg_temp.check('soubor vedený jako .doc nejde připojit jako .doc',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, %L, null, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', '2031-05-10', :'c_docx2', 'stary.doc', 'application/msword', 10),
    '23514', 'rezervace_prilohy_mime_check'));
select pg_temp.check('… ani se za .docx vydávat',
  pg_temp.spadne_hlaskou(format('select public.rezervace_pripojit_prilohu(%L, %L, null, %L, %L, %L, %L, %L)',
    :'tenant', :'perla', '2031-05-10', :'c_docx2', 'stary.docx', :'mime_docx', 10),
    '23514', 'je jiný'));

reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('Wanda připojila .docx ke dni: název, typ a velikost z úložiště, nahrála ona',
  (select nazev = 'Smlouva o akci.docx' and mime = :'mime_docx' and velikost = 23456
          and den = date '2031-05-10' and branch_id = :'perla' and nahral = :'e_wanda'
     from public.rezervace_prilohy where id = :'pr_docx'));
set role authenticated;
select set_config('test.user_id', :'wanda', false);
select pg_temp.check('Wanda si přílohu i soubor přečte (RLS)',
  exists (select 1 from public.rezervace_prilohy where id = :'pr_docx')
  and exists (select 1 from storage.objects where bucket_id = 'rezervace' and name = :'c_docx'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== Úklid ================================================='

delete from public.rezervace_prilohy where cesta in (:'c_docx', :'c_docx2', :'c_docx3');
delete from storage.objects
 where bucket_id = 'rezervace' and name in (:'c_docx', :'c_docx2', :'c_docx3', :'c_doc', :'c_docm', :'c_pdf');
delete from public.notifikace_doruceni
 where notification_id in (select id from public.notifications where tenant_id = :'tenant' and user_id = :'wanda');
delete from public.notifications where tenant_id = :'tenant' and user_id = :'wanda';
delete from public.membership_branches
 where membership_id in (select id from public.memberships where tenant_id = :'tenant' and user_id = :'wanda');
delete from public.memberships where tenant_id = :'tenant' and user_id = :'wanda';
delete from public.employees where id = :'e_wanda';
delete from public.position_permissions where position_id = :'z_zapis';
delete from public.positions where id = :'z_zapis';

select pg_temp.check('úklid: přílohy a soubory z kroku 108 pryč',
  not exists (select 1 from public.rezervace_prilohy where cesta like '%10810000-dddd-%')
  and not exists (select 1 from storage.objects where bucket_id = 'rezervace' and name like '%10810000-dddd-%'));
select pg_temp.check('úklid: Wanda ve Foodtabu pryč',
  not exists (select 1 from public.employees where tenant_id = :'tenant' and full_name like '%Stoosmička')
  and not exists (select 1 from public.memberships where tenant_id = :'tenant' and user_id = :'wanda'));

\echo ''
\echo '== KROK 108 HOTOV ========================================'
