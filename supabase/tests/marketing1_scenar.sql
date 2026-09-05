-- Scénář marketing 1 — modul Marketing, první krok.
--
-- Pokrývá migraci 20260903040000_marketing_tabulky a docs/marketing-
-- zadani.md, oddíly 4, 7 a 8. Vlastní číselná řada (marketingN_scenar.sql),
-- oddělená od provozní krokN_scenar.sql (CLAUDE.md, „Dvě relace v jednom
-- repozitáři"). Navazuje na etapa0_scenar.sql a na všechny krokN_scenar.sql
-- — stejná firma, stejná Černá Perla, stejní lidé.
--
-- Kontroluje totéž, co u Tvorby menu (pravidlo 5): vypnutý modul
-- odmítne i přímé volání, ne jen schová položku v nabídce. Navíc
-- ověřuje jádro oddílu 4 — že marketing.publish je JEDINÉ oprávnění,
-- které smí posunout příspěvek do 'publikovano', a že marketing.manage
-- samo o sobě nestačí.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

select id as tenant from public.tenants limit 1 \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);

select user_id as majitel  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset


\echo ''
\echo '== Modul vypnutý — pravidlo 5 =============================='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

select pg_temp.check('majitel bez zapnutého modulu nemá marketing.read',
  not app.has_access(:'tenant', 'marketing.read', :'perla'));
select pg_temp.check('majitel bez zapnutého modulu nemá marketing.manage',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));
select pg_temp.check('majitel bez zapnutého modulu nemá marketing.publish',
  not app.has_access(:'tenant', 'marketing.publish', :'perla'));

reset role;
insert into public.marketing_settings (tenant_id, ton_hlasu)
values (:'tenant', 'neformalni');
select pg_temp.check('nastavení jde vložit i s vypnutým modulem (přímý zápis superuživatele)',
  exists (select 1 from public.marketing_settings where tenant_id = :'tenant'));

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('ale majitel ho s vypnutým modulem NEVIDÍ (RLS, ne jen skrytá položka)',
  (select count(*) from public.marketing_settings) = 0);

reset role;
delete from public.marketing_settings where tenant_id = :'tenant';


\echo ''
\echo '== Zapnutí modulu ==========================================='

reset role;
insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing');

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select pg_temp.check('po zapnutí má majitel marketing.read/manage/publish',
  app.has_access(:'tenant', 'marketing.read', :'perla')
  and app.has_access(:'tenant', 'marketing.manage', :'perla')
  and app.has_access(:'tenant', 'marketing.publish', :'perla'));

select set_config('test.user_id', :'provozni', false);
select pg_temp.check('provozní dostal marketing.* automaticky ze šablony (bez zásahu)',
  app.has_access(:'tenant', 'marketing.manage', :'perla'));


\echo ''
\echo '== Datový model: nastavení, integrace, šablony =============='

set role authenticated;
select set_config('test.user_id', :'majitel', false);

insert into public.marketing_settings (tenant_id, ton_hlasu, brand_barva_hlavni)
values (:'tenant', 'neformalni', '#7a1f2b');
select pg_temp.check('majitel založil branding firmy',
  exists (select 1 from public.marketing_settings where tenant_id = :'tenant'));

insert into public.marketing_integrations (tenant_id, branch_id, kategorie, typ_konektoru, nazev)
values (:'tenant', :'perla', 'fotky', 'nativni', 'Nahrávání v appce')
returning id as integrace_fotky \gset

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.marketing_integrations (tenant_id, branch_id, kategorie, typ_konektoru, nazev)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'fotky', 'onedrive', 'Druhý zdroj fotek omylem');
  exception when unique_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šly založit dvě aktivní integrace téže kategorie'; end if;
  raise notice '  OK    nejvýš jedna aktivní integrace na kategorii a pobočku';
end $$;

insert into public.marketing_templates (tenant_id, nazev, externi_sablona_id)
values (:'tenant', 'Krémová', 'tpl_kremova')
returning id as sablona1 \gset

insert into public.marketing_photos (tenant_id, branch_id, url, ai_popisek, zdroj_integrace)
values (:'tenant', :'perla', 'https://cdn.example/perla/interier-1.jpg', 'interiér', :'integrace_fotky')
returning id as foto1 \gset

select pg_temp.check('šablona i fotka firmy existují',
  exists (select 1 from public.marketing_templates where id = :'sablona1')
  and exists (select 1 from public.marketing_photos where id = :'foto1'));


\echo ''
\echo '== Návrh příspěvku a hranice marketing.publish ==============='

insert into public.marketing_posts (tenant_id, branch_id, business_date, text_prispevku, sablona_id, foto_id, zdrojovy_listek)
values (:'tenant', :'perla', current_date, 'Dnešní denní menu je tu!', :'sablona1', :'foto1',
        jsonb_build_object('zdroj', 'rucne_zadano'))
returning id as post1 \gset

select pg_temp.check('příspěvek vzniká jako návrh, nikdy hotový',
  (select stav from public.marketing_posts where id = :'post1') = 'navrzeno');

update public.marketing_posts set stav = 'schvaleno', rozhodl = :'majitel', rozhodnuto_kdy = now()
where id = :'post1';
select pg_temp.check('marketing.manage smí schválit',
  (select stav from public.marketing_posts where id = :'post1') = 'schvaleno');

\echo ''
\echo '-- Vlastní role jen s marketing.manage, BEZ marketing.publish --'

insert into public.roles (tenant_id, key, label, is_owner)
values (:'tenant', 'marketing_editor', 'Marketingový editor', false)
returning id as r_editor \gset

insert into public.role_permissions (role_id, permission_key) values
  (:'r_editor', 'marketing.read'),
  (:'r_editor', 'marketing.manage');

-- Uživatele zakládá superuživatel: do auth.users má role authenticated
-- podle harnessu jen select, ne insert. Bez přepnutí tu scénář spadl
-- na "permission denied for table users".
reset role;

insert into auth.users (id, email, raw_user_meta_data) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'marketing-editor@foodtab.cz', '{"full_name":"Editor Marketingu"}')
on conflict (id) do nothing;
select user_id as editor from public.profiles where email = 'marketing-editor@foodtab.cz' \gset

-- Rozsah 'tenant', ne 'branch': ušetří vkládání do membership_branches
-- (tady se neověřuje rozsah pobočky, ten už ověřil krok9/krok10 —
-- tady jde jen o to, co smí a nesmí marketing.manage bez marketing.publish).
insert into public.memberships (tenant_id, user_id, role_id, status, scope)
values (:'tenant', :'editor', :'r_editor', 'active', 'tenant')
on conflict (tenant_id, user_id) do update
  set role_id = excluded.role_id, status = 'active', scope = excluded.scope;

set role authenticated;

select set_config('test.user_id', :'editor', false);
select pg_temp.check('editor má marketing.manage, ale NE marketing.publish',
  app.has_access(:'tenant', 'marketing.manage', :'perla')
  and not app.has_access(:'tenant', 'marketing.publish', :'perla'));

update public.marketing_posts set text_prispevku = 'Dnešní denní menu je tu! (upraveno)'
where id = :'post1';
select pg_temp.check('editor smí upravit text schváleného návrhu',
  (select text_prispevku from public.marketing_posts where id = :'post1') like '%upraveno%');

select set_config('test.post1', :'post1', false);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.marketing_posts set stav = 'publikovano', publikovano_kdy = now()
    where id = current_setting('test.post1')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: marketing.manage bez marketing.publish zveřejnil příspěvek'; end if;
  raise notice '  OK    marketing.manage sám o sobě nezveřejní (spoušť odmítla)';
end $$;

select set_config('test.user_id', :'majitel', false);
update public.marketing_posts set stav = 'publikovano', publikovano_kdy = now()
where id = :'post1';
select pg_temp.check('majitel (má i marketing.publish) příspěvek zveřejní',
  (select stav from public.marketing_posts where id = :'post1') = 'publikovano');


\echo ''
\echo '== Zamítnutí s připomínkou vyžaduje důvod ===================='

insert into public.marketing_posts (tenant_id, branch_id, business_date, text_prispevku, zdrojovy_listek)
values (:'tenant', :'perla', current_date + 1, 'Návrh na zítra', '{}'::jsonb)
returning id as post2 \gset

select set_config('test.post2', :'post2', false);

do $$
declare v_ok boolean := false;
begin
  begin
    update public.marketing_posts set stav = 'zamitnuto_s_pripominkou'
    where id = current_setting('test.post2')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: šlo zamítnout bez připomínky'; end if;
  raise notice '  OK    zamítnutí bez připomínky databáze odmítne';
end $$;

update public.marketing_posts
set stav = 'zamitnuto_s_pripominkou', pripominka = 'Chci jinou fotku interiéru.'
where id = :'post2';
select pg_temp.check('se skutečnou připomínkou zamítnutí projde',
  (select stav from public.marketing_posts where id = :'post2') = 'zamitnuto_s_pripominkou');


\echo ''
\echo '== Kdo do modulu nevidí vůbec ================================'

select user_id as marek_uid from public.profiles where email = 'cisnik@foodtab.cz' \gset
select set_config('test.user_id', :'marek_uid', false);
select pg_temp.check('číšník (role servis, bez marketing.*) nevidí marketingové příspěvky',
  (select count(*) from public.marketing_posts) = 0);
select pg_temp.check('a ani je nezaloží',
  not app.has_access(:'tenant', 'marketing.manage', :'perla'));


\echo ''
\echo '=========================================================='
\echo ' MARKETING 1 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
