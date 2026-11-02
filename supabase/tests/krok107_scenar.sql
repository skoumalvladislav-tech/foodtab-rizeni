-- Scénář pro krok 107 — Rezervace a akce: komu chodí upozornění.
--
-- Pokrývá migraci 20261106100000_rezervace_upozorneni.sql
-- (tabulka rezervace_upozorneni, rezervace_upozorneni_lide / _ulozit,
-- app.rezervace_prijemci, spoušť app.rezervace_upozornit a přepis
-- app.rezervace_souhrn_dne na vybrané příjemce).
--
-- Navazuje na etapa0_scenar.sql (firma Foodtab, Perla, Bar, majitel).
--
-- ---------------------------------------------------------------------
-- CO SE TU HLÍDÁ
--
--   1. granty, politika a druhá linie tabulky výběru;
--   2. kdo smí výběr vidět a měnit: jen rezervace.manage NA TÉ pobočce
--      — ne čtenář, ne vedoucí jiné pobočky, ne majitel přes cizí
--      pobočku (firemní členství pustí has_access na jakékoli id), ne cizí
--      firma;
--   3. koho jde vybrat: jen toho, kdo rezervace pobočky vidí; uložení je
--      celý výběr naráz, beze změny se řádek nepřepisuje;
--   4. akce: nová, změna (co se změnilo — každé pole zvlášť), druhá změna
--      nahradí nepřečtenou, změna jména hosta nic, zrušení; „proběhla“
--      nic a po ní ani úprava či změna na rezervaci; autor nic, kdo
--      vybraný není nic; v těle není jméno hosta ani kontakt; z akce
--      rezervace (kuchyni „z akce je rezervace“, na rezervace „nová“),
--      zrušení zároveň se změnou druhu jde podle druhu PŘED uložením;
--   5. rezervace: nová, změna nic, zrušení, obnovená zrušená = nová;
--      zápis majitele dostane i Věra (sama sobě nic jen jako autorka);
--      z rezervace akce (na rezervace „z rezervace je akce“, kuchyni
--      „nová akce“, zrušení pak jen kuchyni); minulý den nic, ale
--      přesunutá z minulého dne do budoucna je nová;
--   6. import: první den připojení nic, pak jedna dávka = jedno
--      upozornění s počtem („2 nové rezervace“), poslané až při potvrzení
--      dávky; zrušení ze zdroje ano, změna ze zdroje nic; první den se
--      počítá od načítání, které kalendář prošlo (ne od nepovedeného
--      pokusu), nebo od založení připojení — ne od první rezervace;
--      CSV nic, ruční „udělat z ní akci“ u řádku z CSV ano;
--   7. komu mezitím vzali právo, ukončili pracovní poměr nebo pozastavili
--      členství, tomu nic, i když ve výběru zůstal — a znovu vybrat nejde;
--   8. druhá pobočka: výběr platí jen pro svou pobočku (vybraný na Perle
--      o akci v Baru nic), kde nikdo vybraný není, tam akce ani rezervace
--      nikomu; uložení výběru Perly výběr Baru nesmaže;
--   9. ranní souhrn: nikdo vybraný = všem, kdo vidí (jako dosud), kromě
--      ukončených; někdo vybraný = jen jemu; pobočka bez výběru dál všem;
--      když všichni vybraní mezitím skončili, zase všem, kdo vidí.
--
-- Data rezervací jsou v roce 2099: spoušť porovnává se skutečným dneškem
-- a minulý den se nehlásí — s bližším rokem by scénář jednou sám spadl.
--
-- POZOR, SDÍLENÁ DATABÁZE: kontroly se ptají jen na lidi a rezervace
-- tohohle scénáře, nikdy na celkové počty.

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

-- Kolik upozornění daného druhu má člověk k rezervaci.
create or replace function pg_temp.ma(p_user uuid, p_druh text, p_rez uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.user_id = p_user and n.druh = p_druh
     and n.zdroj_typ = 'rezervace' and n.zdroj_id = p_rez
$$;

-- Id posledního upozornění (jako text, '' když žádné). Změna, která nic
-- nepošle, nechá poslední to staré — a to může mít stejný seznam změn.
create or replace function pg_temp.posledni(p_user uuid, p_druh text, p_rez uuid)
returns text language sql as $$
  select coalesce((select n.id::text from public.notifications n
    where n.user_id = p_user and n.druh = p_druh
      and n.zdroj_typ = 'rezervace' and n.zdroj_id = p_rez
    order by n.created_at desc, n.id
    limit 1), '')
$$;

-- Kolik upozornění (jakéhokoli druhu) má člověk k rezervaci.
create or replace function pg_temp.k_rezervaci(p_user uuid, p_rez uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.user_id = p_user and n.zdroj_typ = 'rezervace' and n.zdroj_id = p_rez
$$;

-- Kolik upozornění k rezervaci dostal kdokoli.
create or replace function pg_temp.komukoli(p_rez uuid)
returns integer language sql as $$
  select count(*)::integer from public.notifications n
   where n.zdroj_typ = 'rezervace' and n.zdroj_id = p_rez
$$;

create or replace function pg_temp.telo(p_user uuid, p_druh text, p_rez uuid)
returns jsonb language sql as $$
  select n.telo from public.notifications n
   where n.user_id = p_user and n.druh = p_druh
     and n.zdroj_typ = 'rezervace' and n.zdroj_id = p_rez
   order by n.created_at desc, n.id
   limit 1
$$;

-- Ranní souhrn člověka za den (nebo NULL).
create or replace function pg_temp.souhrn(p_user uuid, p_den text)
returns jsonb language sql as $$
  select n.telo from public.notifications n
   where n.user_id = p_user and n.druh = 'rezervace.souhrn_dne' and n.telo ->> 'den' = p_den
   order by n.created_at desc, n.id
   limit 1
$$;

reset role;
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select id as bar    from public.branches where slug = 'bernard-bar' \gset
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as e_majitel from public.employees where tenant_id = :'tenant' and user_id = :'majitel' \gset

\set vera  10710000-0000-0000-0000-000000000001
\set karel 10710000-0000-0000-0000-000000000002
\set cyril 10710000-0000-0000-0000-000000000003
\set nina  10710000-0000-0000-0000-000000000004
\set bara  10710000-0000-0000-0000-000000000005
\set otto  10710000-0000-0000-0000-000000000006
\set cizi  10710000-0000-0000-0000-000000000007

insert into auth.users (id, email, raw_user_meta_data) values
  (:'vera',  'vera107@foodtab.cz',  '{"full_name":"Věra Stosedmička"}'),
  (:'karel', 'karel107@foodtab.cz', '{"full_name":"Karel Stosedmička"}'),
  (:'cyril', 'cyril107@foodtab.cz', '{"full_name":"Cyril Stosedmička"}'),
  (:'nina',  'nina107@foodtab.cz',  '{"full_name":"Nina Stosedmička"}'),
  (:'bara',  'bara107@foodtab.cz',  '{"full_name":"Bára Stosedmička"}'),
  (:'otto',  'otto107@foodtab.cz',  '{"full_name":"Otto Stosedmička"}'),
  (:'cizi',  'cizi107@foodtab.cz',  '{"full_name":"Cecílie Stosedmička"}');

insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska107_cteni', 'Zkouška 107 — čtení', 'kuchyne', true) returning id as z_cteni \gset
insert into public.positions (tenant_id, key, label, department, active)
values (:'tenant', 'zkouska107_zapis', 'Zkouška 107 — zápis', 'provoz', true) returning id as z_zapis \gset
insert into public.position_permissions (tenant_id, position_id, permission_key) values
  (:'tenant', :'z_cteni', 'rezervace.read'),
  (:'tenant', :'z_zapis', 'rezervace.manage');

-- Věra zapisuje na Perle (vybírá), Karel, Cyril a Otto na Perle čtou,
-- Nina je na Perle bez práva, Bára zapisuje jen v Baru.
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'vera', :'z_zapis', 'Věra Stosedmička', 'hpp') returning id as e_vera \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'karel', :'z_cteni', 'Karel Stosedmička', 'hpp') returning id as e_karel \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'cyril', :'z_cteni', 'Cyril Stosedmička', 'hpp') returning id as e_cyril \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type)
values (:'tenant', :'perla', :'nina', 'Nina Stosedmička', 'hpp') returning id as e_nina \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'bar', :'bara', :'z_zapis', 'Bára Stosedmička', 'hpp') returning id as e_bara \gset
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', :'otto', :'z_cteni', 'Otto Stosedmička', 'hpp') returning id as e_otto \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', :'vera',  null, 'branch', 'active'),
  (:'tenant', :'karel', null, 'branch', 'active'),
  (:'tenant', :'cyril', null, 'branch', 'active'),
  (:'tenant', :'nina',  null, 'branch', 'active'),
  (:'tenant', :'bara',  null, 'branch', 'active'),
  (:'tenant', :'otto',  null, 'branch', 'active');
insert into public.membership_branches (membership_id, branch_id)
select m.id, case when m.user_id = :'bara' then :'bar'::uuid else :'perla'::uuid end
  from public.memberships m
 where m.tenant_id = :'tenant'
   and m.user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto');

-- Cizí firma, kde je Cecílie majitelka (celá firma).
insert into public.tenants (name, legal_name, currency, timezone)
values ('Krok107 Cizí s.r.o.', 'Krok107 Cizí s.r.o.', 'CZK', 'Europe/Prague')
returning id as cizi_firma \gset
insert into public.tenant_modules (tenant_id, module_key) values (:'cizi_firma', 'provoz')
on conflict do nothing;
insert into public.branches (tenant_id, name, slug)
values (:'cizi_firma', 'Cizí 107 Krok107', 'krok107-cizi') returning id as cizi_pobocka \gset
insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type, je_majitel)
values (:'cizi_firma', :'cizi_pobocka', :'cizi', 'Cecílie Stosedmička', 'hpp', true) returning id as e_cizi \gset
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'cizi_firma', :'cizi', null, 'tenant', 'active');


\echo ''
\echo '== 0. Příprava ==========================================='

select pg_temp.check('příprava: Věra zapisuje na Perle, Karel, Cyril a Otto tam čtou',
  exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'perla') where user_id = :'vera')
  and (select count(*) from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla')
        where user_id in (:'karel', :'cyril', :'otto')) = 3);
select pg_temp.check('příprava: Nina na Perle nic, Bára zapisuje jen v Baru',
  not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla') where user_id = :'nina')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'perla') where user_id = :'nina')
  and exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'bar') where user_id = :'bara')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.read', :'perla') where user_id = :'bara')
  and not exists (select 1 from app.kdo_ma_pravo_na_pobocce(:'tenant', 'rezervace.manage', :'perla') where user_id = :'bara'));
select pg_temp.check('příprava: výběr Perly i Baru je prázdný',
  not exists (select 1 from public.rezervace_upozorneni where branch_id in (:'perla', :'bar')));


\echo ''
\echo '== 1. Granty, politika, druhá linie ======================'

-- Čistá databáze testů nemá výchozí práva Supabase (grant all všem na
-- každou novou tabulku), takže tahle kontrola nepozná, že v migraci chybí
-- `revoke all … from public, anon, authenticated` — prošla by i bez něj.
-- Ten řádek hlídá text migrace: scripts/provoz-granty.test.mjs (vyzkoušeno
-- smazáním: „rezervace_upozorneni odebírá grant roli anon“). Tady se
-- hlídá, že grant select zůstal a nic navíc se nepřidalo.
select pg_temp.check('tabulku výběru klient jen čte (zápis jen funkcí), anon vůbec',
  has_table_privilege('authenticated', 'public.rezervace_upozorneni', 'select')
  and not has_table_privilege('authenticated', 'public.rezervace_upozorneni', 'insert')
  and not has_table_privilege('authenticated', 'public.rezervace_upozorneni', 'update')
  and not has_table_privilege('authenticated', 'public.rezervace_upozorneni', 'delete')
  and not has_table_privilege('authenticated', 'public.rezervace_upozorneni', 'truncate')
  and not has_table_privilege('anon', 'public.rezervace_upozorneni', 'select'));
select pg_temp.check('RLS zapnuté; jediná politika je čtení pro rezervace.manage',
  (select relrowsecurity from pg_class where oid = 'public.rezervace_upozorneni'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'rezervace_upozorneni') = 1
  and exists (select 1 from pg_policies
               where schemaname = 'public' and tablename = 'rezervace_upozorneni' and cmd = 'SELECT'
                 and qual like '%rezervace.manage%' and qual not like '%rezervace.read%'));
select pg_temp.check('obrazovku (seznam a uložení) volá přihlášený, anon ne',
  has_function_privilege('authenticated', 'public.rezervace_upozorneni_lide(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.rezervace_upozorneni_ulozit(uuid, uuid, uuid[], uuid[], uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_upozorneni_lide(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.rezervace_upozorneni_ulozit(uuid, uuid, uuid[], uuid[], uuid[])', 'execute'));
select pg_temp.check('vnitřní funkce klient nezavolá (kdo vidí, příjemci, spoušť, hlídač)',
  not has_function_privilege('authenticated', 'app.rezervace_kdo_vidi(uuid, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.rezervace_prijemci(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'app.rezervace_upozornit()', 'execute')
  and not has_function_privilege('authenticated', 'app.rezervace_upozorneni_hlida()', 'execute')
  and not has_function_privilege('anon', 'app.rezervace_prijemci(uuid, uuid, text)', 'execute'));

select pg_temp.check('druhá linie: řádek výběru s pobočkou cizí firmy neprojde ani přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_upozorneni (tenant_id, branch_id, employee_id, akce) values (%L, %L, %L, true)',
    :'tenant', :'cizi_pobocka', :'e_karel'), '23514', 'Pobočka nepatří'));
select pg_temp.check('druhá linie: řádek výběru s člověkem cizí firmy neprojde ani přímo',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_upozorneni (tenant_id, branch_id, employee_id, akce) values (%L, %L, %L, true)',
    :'tenant', :'perla', :'e_cizi'), '23514', 'Člověk nepatří'));
select pg_temp.check('řádek, kterému nic nechodí, se nezapíše',
  pg_temp.spadne_hlaskou(format(
    'insert into public.rezervace_upozorneni (tenant_id, branch_id, employee_id) values (%L, %L, %L)',
    :'tenant', :'perla', :'e_karel'), '23514', 'rezervace_upozorneni_check'));


\echo ''
\echo '== 2. Kdo smí výběr vidět a měnit ========================'

set role authenticated;
select set_config('test.user_id', :'karel', false);
select pg_temp.check('Karel (jen čte) seznam lidí nedostane',
  pg_temp.spadne_hlaskou(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'tenant', :'perla'),
    '42501', 'nastavovat nemůžete'));
select pg_temp.check('… ani výběr neuloží (třeba sebe)',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'perla', '{' || :'e_karel' || '}'), '42501', 'nastavovat nemůžete'));
-- Že Karel tabulku výběru nečte, se ptá oddíl 3 — až když v ní řádky jsou
-- (tady je prázdná, kontrola by prošla s jakoukoli politikou).

select set_config('test.user_id', :'bara', false);
select pg_temp.check('Bára (zapisuje v Baru) výběr Perly nedostane',
  pg_temp.spadne_hlaskou(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'tenant', :'perla'),
    '42501', 'nastavovat nemůžete'));
select pg_temp.check('… ve svém Baru ano',
  pg_temp.projde(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'tenant', :'bar')));

select set_config('test.user_id', :'majitel', false);
select pg_temp.check('majitel s pobočkou CIZÍ firmy neprojde (firemní členství pustí has_access na jakékoli id)',
  pg_temp.spadne_hlaskou(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'tenant', :'cizi_pobocka'),
    '42501', 'nastavovat nemůžete'));
select pg_temp.check('… a výběr na ni neuloží',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'cizi_pobocka', '{' || :'e_majitel' || '}'), '42501', 'nastavovat nemůžete'));

select set_config('test.user_id', :'cizi', false);
select pg_temp.check('majitelka cizí firmy výběr Perly nedostane — ani pod Foodtabem, ani pod svou firmou',
  pg_temp.spadne_hlaskou(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'tenant', :'perla'),
    '42501', 'nastavovat nemůžete')
  and pg_temp.spadne_hlaskou(format('select * from public.rezervace_upozorneni_lide(%L, %L)', :'cizi_firma', :'perla'),
    '42501', 'nastavovat nemůžete'));
reset role;
select set_config('test.user_id', '', false);


\echo ''
\echo '== 3. Koho jde vybrat ===================================='

set role authenticated;
select set_config('test.user_id', :'vera', false);
select pg_temp.check('Ninu (na Perle bez práva) vybrat nejde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'perla', '{' || :'e_nina' || '}'), '23514', 'nevidí'));
select pg_temp.check('Báru (rezervace vidí jen v Baru) na Perlu vybrat nejde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, null, %L::uuid[], null)',
    :'tenant', :'perla', '{' || :'e_bara' || '}'), '23514', 'nevidí'));
select pg_temp.check('člověka cizí firmy vybrat nejde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, null, null, %L::uuid[])',
    :'tenant', :'perla', '{' || :'e_cizi' || '}'), '23514', 'nevidí'));
select pg_temp.check('vymyšlené id vybrat nejde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'perla', '{10710000-0000-0000-0000-0000000000ff}'), '23514', 'nevidí'));
select pg_temp.check('víc než 500 lidí neprojde',
  pg_temp.spadne_hlaskou(format(
    'select public.rezervace_upozorneni_ulozit(%L, %L, array(select gen_random_uuid() from generate_series(1, 501)), null, null)',
    :'tenant', :'perla'), '23514', 'moc'));

select public.rezervace_upozorneni_ulozit(:'tenant', :'perla',
  array[:'e_karel', :'e_vera', :'e_otto']::uuid[],
  array[:'e_cyril', :'e_vera']::uuid[],
  '{}'::uuid[]) as ulozeno \gset

select pg_temp.check('Věra (zapisuje na Perle) výběr Perly čte',
  (select count(*) from public.rezervace_upozorneni where branch_id = :'perla') = 4);
select pg_temp.check('nabídka: Karel, Cyril, Věra, Otto i majitel; Nina ani Bára ne',
  (select count(*) from public.rezervace_upozorneni_lide(:'tenant', :'perla')
    where employee_id in (:'e_karel', :'e_cyril', :'e_vera', :'e_otto', :'e_majitel')) = 5
  and not exists (select 1 from public.rezervace_upozorneni_lide(:'tenant', :'perla')
                   where employee_id in (:'e_nina', :'e_bara', :'e_cizi')));
select pg_temp.check('nabídka ukazuje jméno, zařazení a co komu chodí',
  (select jmeno = 'Karel Stosedmička' and zarazeni = 'Zkouška 107 — čtení' and akce and not rezervace and not souhrn
     from public.rezervace_upozorneni_lide(:'tenant', :'perla') where employee_id = :'e_karel')
  and (select akce and rezervace and not souhrn
     from public.rezervace_upozorneni_lide(:'tenant', :'perla') where employee_id = :'e_vera')
  and (select not akce and rezervace and not souhrn
     from public.rezervace_upozorneni_lide(:'tenant', :'perla') where employee_id = :'e_cyril')
  and (select not akce and not rezervace and not souhrn
     from public.rezervace_upozorneni_lide(:'tenant', :'perla') where employee_id = :'e_majitel'));
select set_config('test.user_id', :'karel', false);
select count(*) as karel_cte from public.rezervace_upozorneni where branch_id = :'perla' \gset
select set_config('test.user_id', :'bara', false);
select count(*) as bara_cte from public.rezervace_upozorneni where branch_id = :'perla' \gset
select pg_temp.check('… Karel (jen čte) ani Bára (zapisuje v Baru) ho nečtou ani teď, když řádky jsou',
  :'karel_cte'::int = 0 and :'bara_cte'::int = 0);
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('neplatný výběr nezapsal nic; platný vrátil 4 lidi',
  :'ulozeno'::int = 4
  and not exists (select 1 from public.rezervace_upozorneni
                   where employee_id in (:'e_nina', :'e_bara', :'e_cizi', :'e_majitel')));
select pg_temp.check('řádky: Karel akce, Cyril rezervace, Věra obojí, Otto akce; zapsala Věra',
  (select akce and not rezervace and not souhrn from public.rezervace_upozorneni where employee_id = :'e_karel')
  and (select not akce and rezervace and not souhrn from public.rezervace_upozorneni where employee_id = :'e_cyril')
  and (select akce and rezervace and not souhrn from public.rezervace_upozorneni where employee_id = :'e_vera')
  and (select akce and not rezervace from public.rezervace_upozorneni where employee_id = :'e_otto')
  and (select bool_and(zmenil = :'e_vera' and tenant_id = :'tenant')
         from public.rezervace_upozorneni where branch_id = :'perla'));

select max(zmeneno_kdy)::text as zmeneno1 from public.rezervace_upozorneni where branch_id = :'perla' \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_upozorneni_ulozit(:'tenant', :'perla',
  array[:'e_karel', :'e_vera', :'e_otto']::uuid[],
  array[:'e_cyril', :'e_vera']::uuid[],
  '{}'::uuid[]) as ulozeno2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('stejný výběr podruhé: žádný řádek se nepřepsal (audit bez prázdných úprav)',
  :'ulozeno2'::int = 4
  and (select max(zmeneno_kdy)::text from public.rezervace_upozorneni where branch_id = :'perla') = :'zmeneno1'
  and (select count(*) from public.rezervace_upozorneni where branch_id = :'perla') = 4);


\echo ''
\echo '== 4. Akce ==============================================='

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Svatba Krok107","jmeno_hosta":"Host Krok107","telefon":"+420 777 107 107","datum":"2099-04-10","od":"18:00","pocet_osob":"30"}'::jsonb) as a1 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('nová akce: Karel a Otto (vybraní na akce) ji dostali, každý jednou',
  pg_temp.ma(:'karel', 'akce.nova', :'a1') = 1 and pg_temp.ma(:'otto', 'akce.nova', :'a1') = 1);
select pg_temp.check('… Věra ne, i když je vybraná: akci zapsala sama',
  pg_temp.k_rezervaci(:'vera', :'a1') = 0);
select pg_temp.check('… Cyril (jen rezervace), majitel a Nina (nevybraní) ne',
  pg_temp.k_rezervaci(:'cyril', :'a1') = 0 and pg_temp.k_rezervaci(:'majitel', :'a1') = 0
  and pg_temp.k_rezervaci(:'nina', :'a1') = 0);
select pg_temp.check('tělo: den, čas na zdi pobočky, osoby, název a pobočka — nic víc',
  pg_temp.telo(:'karel', 'akce.nova', :'a1') = jsonb_build_object(
    'rezervace_id', :'a1', 'den', '2099-04-10', 'cas', '18:00', 'osob', 30,
    'nazev', 'Svatba Krok107', 'pobocka', 'Restaurace Černá Perla', 'pobocka_slug', 'cerna-perla'));
select pg_temp.check('jméno hosta ani telefon v upozornění nejsou',
  pg_temp.telo(:'karel', 'akce.nova', :'a1')::text not like '%Host Krok107%'
  and pg_temp.telo(:'karel', 'akce.nova', :'a1')::text not like '%107 107%');
select pg_temp.check('řádek upozornění: pobočka, běžná priorita, klíč podle akce',
  (select branch_id = :'perla' and priorita = 'normal' and dedupe_key = 'akce.nova:' || :'a1'
     from public.notifications where user_id = :'karel' and druh = 'akce.nova' and zdroj_id = :'a1'));

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a1', null, '{"pocet_osob":"35","prostor":"Salonek"}'::jsonb) as a1_z1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('změna akce: Karel dostal „změnil se počet osob a prostor“',
  pg_temp.ma(:'karel', 'akce.zmenena', :'a1') = 1
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a1') -> 'co_se_zmenilo' = '["osob","prostor"]'::jsonb
  and (pg_temp.telo(:'karel', 'akce.zmenena', :'a1') ->> 'osob')::int = 35
  and pg_temp.k_rezervaci(:'vera', :'a1') = 0);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a1', null, '{"datum":"2099-04-11","od":"19:00"}'::jsonb) as a1_z2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('druhá změna nahradila nepřečtenou první: jen „den“ (čas se při změně dne nehlásí zvlášť)',
  pg_temp.ma(:'karel', 'akce.zmenena', :'a1') = 1
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a1') -> 'co_se_zmenilo' = '["den"]'::jsonb
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a1') ->> 'den' = '2099-04-11'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a1') ->> 'cas' = '19:00');
select pg_temp.check('… „nová akce“ zůstala vedle (jiný klíč)',
  pg_temp.ma(:'karel', 'akce.nova', :'a1') = 1);

select id as zmena_id from public.notifications where user_id = :'karel' and druh = 'akce.zmenena' and zdroj_id = :'a1' \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a1', null, '{"jmeno_hosta":"Host2 Krok107"}'::jsonb) as a1_z3 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('změna jména hosta se nehlásí (upozornění se nepřepsalo)',
  (select id from public.notifications where user_id = :'karel' and druh = 'akce.zmenena' and zdroj_id = :'a1') = :'zmena_id'
  and pg_temp.k_rezervaci(:'karel', :'a1') = 2);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_zmenit_stav(:'a1', 'zrusena');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušená akce: Karel a Otto dostali „Zrušená akce“, Věra nic',
  pg_temp.ma(:'karel', 'akce.zrusena', :'a1') = 1 and pg_temp.ma(:'otto', 'akce.zrusena', :'a1') = 1
  and pg_temp.k_rezervaci(:'vera', :'a1') = 0);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Raut Krok107","datum":"2099-04-10","od":"12:00","pocet_osob":"20"}'::jsonb) as a3 \gset
select public.rezervace_zmenit_stav(:'a3', 'dokonceno');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('„proběhla“ se po akci nikomu nehlásí (Karel má jen novou akci)',
  pg_temp.ma(:'karel', 'akce.nova', :'a3') = 1 and pg_temp.k_rezervaci(:'karel', :'a3') = 1);

-- Po proběhlé akci ani doplněný počet hostů, ani změna na rezervaci.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a3', null, '{"pocet_osob":"22"}'::jsonb) as a3_z1 \gset
select public.rezervace_ulozit(:'tenant', :'a3', null, '{"druh":"rezervace"}'::jsonb) as a3_z2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('po proběhlé akci: doplněný počet hostů ani změna na rezervaci nikomu nic (ani Cyrilovi)',
  (select stav = 'dokonceno' and druh = 'rezervace' and pocet_osob = 22 from public.rezervace where id = :'a3')
  and pg_temp.komukoli(:'a3') = 2 and pg_temp.k_rezervaci(:'cyril', :'a3') = 0);

-- Další změny akce, každá zvlášť. Další změna nahradí nepřečtenou, takže
-- se po každém uložení ptá, jestli přišlo NOVÉ upozornění a co v něm je
-- (bez toho by „konec“ prošel se seznamem z předchozí změny začátku).
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Změny Krok107","stav":"ceka","datum":"2099-04-10","od":"16:00","do":"18:00","pocet_osob":"10"}'::jsonb) as a5 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') as pred \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a5', null, '{"datum":"2099-04-10","od":"16:30","do":"18:00"}'::jsonb) as a5_z1 \gset
reset role;
select set_config('test.user_id', '', false);
select coalesce(pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') <> :'pred'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a5') -> 'co_se_zmenilo' = '["cas"]'::jsonb, false) as zm_od \gset
select pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') as pred \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a5', null, '{"datum":"2099-04-10","od":"16:30","do":"19:00"}'::jsonb) as a5_z2 \gset
reset role;
select set_config('test.user_id', '', false);
select coalesce(pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') <> :'pred'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a5') -> 'co_se_zmenilo' = '["cas"]'::jsonb, false) as zm_do \gset
select (select konec from public.rezervace where id = :'a5') = '2099-04-10 19:00+02'::timestamptz as zm_do_ulozeno \gset
select pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') as pred \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a5', null, '{"menu":"Polévka, svíčková"}'::jsonb) as a5_z3 \gset
reset role;
select set_config('test.user_id', '', false);
select coalesce(pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') <> :'pred'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a5') -> 'co_se_zmenilo' = '["menu"]'::jsonb, false) as zm_menu \gset
select pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') as pred \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a5', null, '{"typ_akce":"Raut"}'::jsonb) as a5_z4 \gset
reset role;
select set_config('test.user_id', '', false);
select coalesce(pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') <> :'pred'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a5') -> 'co_se_zmenilo' = '["nazev"]'::jsonb, false) as zm_typ \gset
select pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') as pred \gset
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_zmenit_stav(:'a5', 'potvrzeno');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('změna akce jen začátku: „čas“',  :'zm_od'::boolean);
select pg_temp.check('… jen konce: „čas“',             :'zm_do'::boolean and :'zm_do_ulozeno'::boolean);
select pg_temp.check('… menu: „menu“',                 :'zm_menu'::boolean);
select pg_temp.check('… typu akce: „název“',           :'zm_typ'::boolean);
select pg_temp.check('… potvrzení předběžné: „stav“; pořád jedno nepřečtené',
  pg_temp.posledni(:'karel', 'akce.zmenena', :'a5') <> :'pred'
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a5') -> 'co_se_zmenilo' = '["stav"]'::jsonb
  and pg_temp.ma(:'karel', 'akce.zmenena', :'a5') = 1);

-- Z akce rezervace: kuchyně (vybraní na akce) to musí vědět, pod názvem
-- akce; vybraným na rezervace je to nová rezervace.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Degustace Krok107","jmeno_hosta":"Host degustace Krok107","datum":"2099-04-10","od":"17:00","pocet_osob":"12"}'::jsonb) as a4 \gset
select public.rezervace_ulozit(:'tenant', :'a4', null, '{"druh":"rezervace","nazev":""}'::jsonb) as a4_z \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('z akce rezervace: Karel dostal „Změna: z akce je rezervace“ pod názvem akce',
  pg_temp.ma(:'karel', 'akce.zmenena', :'a4') = 1
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a4') -> 'co_se_zmenilo' = '["druh"]'::jsonb
  and pg_temp.telo(:'karel', 'akce.zmenena', :'a4') ->> 'nazev' = 'Degustace Krok107');
select pg_temp.check('… Cyril (jen rezervace) ji dostal jako „Nová rezervace“, bez názvu; Věra (zapsala) nic',
  pg_temp.ma(:'cyril', 'rezervace.nova', :'a4') = 1
  and not pg_temp.telo(:'cyril', 'rezervace.nova', :'a4') ? 'nazev'
  and pg_temp.k_rezervaci(:'cyril', :'a4') = 1
  and pg_temp.k_rezervaci(:'vera', :'a4') = 0);

-- Zpátky na akci a zároveň zrušit: zrušení jde těm, kdo o ní věděli jako
-- o rezervaci — podle druhu PŘED uložením.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'a4', null, '{"druh":"akce","stav":"zrusena"}'::jsonb) as a4_z2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('rezervace změněná na akci a zároveň zrušená: Cyril „Zrušená rezervace“, Karel žádnou „Zrušenou akci“',
  pg_temp.ma(:'cyril', 'rezervace.zrusena', :'a4') = 1
  and pg_temp.ma(:'karel', 'akce.zrusena', :'a4') = 0
  and pg_temp.ma(:'karel', 'akce.nova', :'a4') = 1);


\echo ''
\echo '== 5. Rezervace =========================================='

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Novák Krok107","email":"novak107@example.cz","datum":"2099-04-10","od":"19:30","pocet_osob":"4"}'::jsonb) as r1 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('nová rezervace: Cyril (vybraný na rezervace) ji dostal',
  pg_temp.ma(:'cyril', 'rezervace.nova', :'r1') = 1);
select pg_temp.check('… tělo bez názvu, jména, e-mailu a počtu sloučených',
  pg_temp.telo(:'cyril', 'rezervace.nova', :'r1') = jsonb_build_object(
    'rezervace_id', :'r1', 'den', '2099-04-10', 'cas', '19:30', 'osob', 4,
    'pobocka', 'Restaurace Černá Perla', 'pobocka_slug', 'cerna-perla'));
select pg_temp.check('… Karel (jen akce) ne, Věra (zapsala) ne',
  pg_temp.k_rezervaci(:'karel', :'r1') = 0 and pg_temp.k_rezervaci(:'vera', :'r1') = 0);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'r1', null, '{"pocet_osob":"6","datum":"2099-04-10","od":"20:00"}'::jsonb) as r1_z \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('změna rezervace (čas, osoby) se nehlásí',
  pg_temp.komukoli(:'r1') = 1);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_zmenit_stav(:'r1', 'zrusena');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('zrušená rezervace: Cyril dostal „Zrušená rezervace“',
  pg_temp.ma(:'cyril', 'rezervace.zrusena', :'r1') = 1 and pg_temp.k_rezervaci(:'vera', :'r1') = 0);

-- Obnovená zrušená: Cyril „Nová rezervace“ přečetl, pak dostal
-- „Zrušená“ — bez nového upozornění by s ní nepočítal.
update public.notifications set read_at = now()
 where user_id = :'cyril' and druh = 'rezervace.nova' and zdroj_id = :'r1';
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_zmenit_stav(:'r1', 'potvrzeno');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('obnovená zrušená rezervace: Cyril má novou nepřečtenou „Nová rezervace“, Věra nic',
  (select count(*) from public.notifications
    where user_id = :'cyril' and druh = 'rezervace.nova' and zdroj_id = :'r1' and read_at is null) = 1
  and pg_temp.k_rezervaci(:'vera', :'r1') = 0);

set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Majitelův Krok107","datum":"2099-04-10","od":"21:00","pocet_osob":"2"}'::jsonb) as r2 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('rezervaci zapsal majitel: dostala ji Věra i Cyril, majitel ne',
  pg_temp.ma(:'vera', 'rezervace.nova', :'r2') = 1 and pg_temp.ma(:'cyril', 'rezervace.nova', :'r2') = 1
  and pg_temp.k_rezervaci(:'majitel', :'r2') = 0);

-- Z rezervace akce: kuchyni nová akce, vybraným na rezervace „z rezervace
-- je akce“. Zrušení pak už jde jen kuchyni.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Na akci Krok107","datum":"2099-04-10","od":"20:30","pocet_osob":"8"}'::jsonb) as r_na_akci \gset
select public.rezervace_ulozit(:'tenant', :'r_na_akci', null, '{"druh":"akce","nazev":"Narozeniny Krok107"}'::jsonb) as r_na_akci_z \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('z rezervace akce: Karel „Nová akce“, Cyril „Změna rezervace“ s „druh“ a bez názvu, Věra nic',
  pg_temp.ma(:'karel', 'akce.nova', :'r_na_akci') = 1
  and pg_temp.ma(:'cyril', 'rezervace.zmenena', :'r_na_akci') = 1
  and pg_temp.telo(:'cyril', 'rezervace.zmenena', :'r_na_akci') -> 'co_se_zmenilo' = '["druh"]'::jsonb
  and not pg_temp.telo(:'cyril', 'rezervace.zmenena', :'r_na_akci') ? 'nazev'
  and (select dedupe_key = 'rezervace.zmenena:' || :'r_na_akci' from public.notifications
        where user_id = :'cyril' and druh = 'rezervace.zmenena' and zdroj_id = :'r_na_akci')
  and pg_temp.k_rezervaci(:'vera', :'r_na_akci') = 0);
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_zmenit_stav(:'r_na_akci', 'zrusena');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('… její zrušení jde už jen kuchyni (Karel ano, Cyril ne)',
  pg_temp.ma(:'karel', 'akce.zrusena', :'r_na_akci') = 1
  and pg_temp.k_rezervaci(:'cyril', :'r_na_akci') = 2);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Minulá Krok107","datum":"2020-01-10","od":"19:00","pocet_osob":"3"}'::jsonb) as r_minula \gset
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Minulá akce Krok107","datum":"2020-01-10","od":"18:00"}'::jsonb) as a_minula \gset
select public.rezervace_zmenit_stav(:'r_minula', 'zrusena');
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('minulý den: dopsaná rezervace, akce ani zrušení se nehlásí',
  pg_temp.komukoli(:'r_minula') = 0 and pg_temp.komukoli(:'a_minula') = 0);

-- Překlep v datu: zapsané na minulý den a opravené na skutečný den jsou
-- nové — vybraní o nich jinak nevědí.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Překlep Krok107","datum":"2020-04-12","od":"19:00","pocet_osob":"5"}'::jsonb) as r_preklep \gset
select public.rezervace_ulozit(:'tenant', :'r_preklep', null, '{"datum":"2099-04-12","od":"19:00"}'::jsonb) as r_preklep_z \gset
select public.rezervace_ulozit(:'tenant', :'a_minula', null, '{"datum":"2099-04-12","od":"18:00"}'::jsonb) as a_minula_z \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('přesunuté z minulého dne do budoucna: Cyril „Nová rezervace“, Karel „Nová akce“ (ne „Změna“)',
  pg_temp.ma(:'cyril', 'rezervace.nova', :'r_preklep') = 1
  and pg_temp.ma(:'karel', 'akce.nova', :'a_minula') = 1
  and pg_temp.ma(:'karel', 'akce.zmenena', :'a_minula') = 0);


\echo ''
\echo '== 6. Import =============================================='

insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev)
values (:'tenant', :'perla', 'rezervace', 'krok107', 'zakaznicky', 'Rezervační systém Krok107') returning id as pripojeni \gset

select '[{"externi_id":"I1-107","stav":"potvrzeno","zacatek":"2099-04-12T19:00:00+02:00","jmeno_hosta":"I1 Krok107","pocet_osob":"4"},{"externi_id":"I2-107","stav":"potvrzeno","zacatek":"2099-04-12T18:00:00+02:00","jmeno_hosta":"I2 Krok107","pocet_osob":"2"}]' as davka1 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107', :'pripojeni', :'davka1'::jsonb)::text as imp1 \gset
select pg_temp.check('první načtení nového připojení (2 rezervace): nikomu nic',
  (:'imp1'::jsonb ->> 'nove')::int = 2
  and not exists (select 1 from public.notifications n
                   where n.zdroj_typ = 'rezervace'
                     and n.zdroj_id in (select id from public.rezervace where pripojeni_id = :'pripojeni')));

-- Připojení je „staré“: založené předevčírem (načítání se u něj nezapisuje
-- — jako u příjmového API, počítá se od založení).
update public.integrace_pripojeni set vytvoreno_kdy = now() - interval '2 days' where id = :'pripojeni';

-- Dávka v jedné transakci: dokud běží, upozornění není; vznikne jedno
-- za dávku až při potvrzení.
select '[{"externi_id":"I3-107","stav":"potvrzeno","zacatek":"2099-04-12T20:00:00+02:00","jmeno_hosta":"I3 Krok107","pocet_osob":"3","telefon":"+420 603 107 003"},{"externi_id":"I4-107","stav":"potvrzeno","zacatek":"2099-04-12T20:30:00+02:00","jmeno_hosta":"I4 Krok107","pocet_osob":"5"}]' as davka2 \gset
begin;
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107', :'pripojeni', :'davka2'::jsonb)::text as imp2 \gset
select count(*) as pred_potvrzenim from public.notifications
 where dedupe_key = 'rezervace.nova:pobocka:' || :'perla' and user_id in (:'cyril', :'vera') \gset
commit;
select pg_temp.check('dávka z rezervačního systému: dokud se nepotvrdí, nikdo nic nemá',
  :'pred_potvrzenim'::int = 0);
select id as i2 from public.rezervace where pripojeni_id = :'pripojeni' and externi_id = 'I2-107' \gset
select id as i3 from public.rezervace where pripojeni_id = :'pripojeni' and externi_id = 'I3-107' \gset
select id as i4 from public.rezervace where pripojeni_id = :'pripojeni' and externi_id = 'I4-107' \gset

select pg_temp.check('dvě nové z rezervačního systému: Cyril má JEDNO upozornění „2 nové“, poslední je I4',
  (:'imp2'::jsonb ->> 'nove')::int = 2
  and (select count(*) from public.notifications
        where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla') = 1
  and (select druh = 'rezervace.nova' and (telo ->> 'pocet')::int = 2 and telo ->> 'rezervace_id' = :'i4'
         from public.notifications
        where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla'));
select pg_temp.check('… Věra taky (zápis ze zdroje nemá autora), majitel a Karel ne',
  (select (telo ->> 'pocet')::int from public.notifications
    where user_id = :'vera' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla') = 2
  and pg_temp.k_rezervaci(:'majitel', :'i4') = 0 and pg_temp.k_rezervaci(:'karel', :'i4') = 0);
select pg_temp.check('… jméno hosta ani telefon ze zdroje v upozornění nejsou',
  not exists (select 1 from public.notifications
               where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla'
                 and (telo::text like '%Krok107%' or telo::text like '%107 003%')));

select '[{"externi_id":"I2-107","stav":"zrusena","zacatek":"2099-04-12T18:00:00+02:00","jmeno_hosta":"I2 Krok107","pocet_osob":"2"},{"externi_id":"I3-107","stav":"potvrzeno","zacatek":"2099-04-12T20:00:00+02:00","jmeno_hosta":"I3 Krok107","pocet_osob":"6","telefon":"+420 603 107 003"}]' as davka3 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107', :'pripojeni', :'davka3'::jsonb)::text as imp3 \gset
select pg_temp.check('zrušení ze zdroje: Cyril a Věra dostali „Zrušená rezervace“ I2',
  (:'imp3'::jsonb ->> 'zmenene')::int = 2
  and pg_temp.ma(:'cyril', 'rezervace.zrusena', :'i2') = 1 and pg_temp.ma(:'vera', 'rezervace.zrusena', :'i2') = 1);
select pg_temp.check('změna počtu osob ze zdroje (I3) nic neposlala',
  pg_temp.komukoli(:'i3') = 0);

-- Příjmové API založené před týdnem: systém posílá jen nové, první přišla
-- až teď — je skutečně nová (první den se nepočítá od první rezervace).
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, vytvoreno_kdy)
values (:'tenant', :'perla', 'rezervace', 'krok107-api', 'zakaznicky', 'Příjmové API Krok107', now() - interval '7 days')
returning id as pripojeni_api \gset
select '[{"externi_id":"A1-107","stav":"potvrzeno","zacatek":"2099-04-12T21:00:00+02:00","jmeno_hosta":"A1 Krok107","pocet_osob":"2"}]' as davka_api \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107-api', :'pripojeni_api', :'davka_api'::jsonb)::text as imp_api \gset
select id as a1_api from public.rezervace where pripojeni_id = :'pripojeni_api' and externi_id = 'A1-107' \gset
select pg_temp.check('připojení starší než den, jeho první rezervace přišla až teď: Cyril ji má (přičtená k nepřečteným: 3)',
  (:'imp_api'::jsonb ->> 'nove')::int = 1
  and (select (telo ->> 'pocet')::int = 3 and telo ->> 'rezervace_id' = :'a1_api'
         from public.notifications
        where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla'));

-- Choice založené před týdnem. Dva pokusy o načtení kalendář neprošly:
-- před 7 dny neplatný klíč (chyba), před 6 dny plná fronta (doběhl bez
-- dotazu na zdroj, počet prázdný). První skutečné načítání běží teď —
-- první den se počítá od něj: nová ani zrušená nic.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, vytvoreno_kdy)
values (:'tenant', :'perla', 'rezervace', 'krok107-choice', 'zakaznicky', 'Choice Krok107', now() - interval '7 days')
returning id as pripojeni_ch \gset
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, zahajeno_kdy, dokonceno_kdy, stav, pocet_novych_radku, chyba) values
  (:'tenant', :'pripojeni_ch', now() - interval '7 days', now() - interval '7 days', 'chyba', 0, 'Neplatný klíč (Krok107)'),
  (:'tenant', :'pripojeni_ch', now() - interval '6 days', now() - interval '6 days', 'hotovo', null, null),
  (:'tenant', :'pripojeni_ch', now() - interval '1 minute', null, 'bezi', null, null);
select '[{"externi_id":"CH1-107","stav":"potvrzeno","zacatek":"2099-04-12T21:30:00+02:00","jmeno_hosta":"CH1 Krok107","pocet_osob":"2"}]' as davka_ch1 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107-choice', :'pripojeni_ch', :'davka_ch1'::jsonb)::text as imp_ch1 \gset
-- To načítání doběhlo; další (zrušení CH1) je pořád v prvním dni.
update public.synchronizace_behy set stav = 'hotovo', dokonceno_kdy = now(), pocet_novych_radku = 1
 where integrace_pripojeni_id = :'pripojeni_ch' and stav = 'bezi';
select '[{"externi_id":"CH1-107","stav":"zrusena","zacatek":"2099-04-12T21:30:00+02:00","jmeno_hosta":"CH1 Krok107","pocet_osob":"2"}]' as davka_ch2 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107-choice', :'pripojeni_ch', :'davka_ch2'::jsonb)::text as imp_ch2 \gset
select id as ch1 from public.rezervace where pripojeni_id = :'pripojeni_ch' and externi_id = 'CH1-107' \gset
select pg_temp.check('Choice: první den od prvního načítání, které kalendář prošlo (nepovedené pokusy před týdnem se nepočítají): nová ani zrušená nic, počet u Cyrila dál 3',
  (:'imp_ch1'::jsonb ->> 'nove')::int = 1 and (:'imp_ch2'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.komukoli(:'ch1') = 0
  and (select (telo ->> 'pocet')::int from public.notifications
        where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla') = 3);

-- Choice, které kalendář prošlo před třemi dny; teď běží další načítání.
-- Nová rezervace z něj je skutečně nová.
insert into public.integrace_pripojeni (tenant_id, branch_id, oblast, poskytovatel, rezim, nazev, vytvoreno_kdy)
values (:'tenant', :'perla', 'rezervace', 'krok107-choice2', 'zakaznicky', 'Choice 2 Krok107', now() - interval '3 days')
returning id as pripojeni_ch2 \gset
insert into public.synchronizace_behy (tenant_id, integrace_pripojeni_id, zahajeno_kdy, dokonceno_kdy, stav, pocet_novych_radku) values
  (:'tenant', :'pripojeni_ch2', now() - interval '3 days', now() - interval '3 days', 'hotovo', 5),
  (:'tenant', :'pripojeni_ch2', now() - interval '1 minute', null, 'bezi', null);
select '[{"externi_id":"CH2-107","stav":"potvrzeno","zacatek":"2099-04-12T22:00:00+02:00","jmeno_hosta":"CH2 Krok107","pocet_osob":"2"}]' as davka_ch3 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'externi', 'krok107-choice2', :'pripojeni_ch2', :'davka_ch3'::jsonb)::text as imp_ch3 \gset
select id as ch2 from public.rezervace where pripojeni_id = :'pripojeni_ch2' and externi_id = 'CH2-107' \gset
select pg_temp.check('Choice, které kalendář prošlo před 3 dny, při dalším načítání: nová došla Cyrilovi (počet 4)',
  (:'imp_ch3'::jsonb ->> 'nove')::int = 1
  and (select (telo ->> 'pocet')::int = 4 and telo ->> 'rezervace_id' = :'ch2'
         from public.notifications
        where user_id = :'cyril' and dedupe_key = 'rezervace.nova:pobocka:' || :'perla'));

select '[{"externi_id":"C1-107","stav":"potvrzeno","datum":"2099-04-12","od":"21:00","jmeno_hosta":"C1 Krok107","pocet_osob":"2"},{"externi_id":"C2-107","stav":"potvrzeno","datum":"2099-04-12","od":"21:30","jmeno_hosta":"C2 Krok107","pocet_osob":"12"}]' as csv1 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'csv', 'krok107-csv', null, :'csv1'::jsonb)::text as imp_csv \gset
select id as c1 from public.rezervace where poskytovatel = 'krok107-csv' and externi_id = 'C1-107' \gset
select id as c2 from public.rezervace where poskytovatel = 'krok107-csv' and externi_id = 'C2-107' \gset
select '[{"externi_id":"C1-107","stav":"zrusena","datum":"2099-04-12","od":"21:00","jmeno_hosta":"C1 Krok107","pocet_osob":"2"}]' as csv2 \gset
select app.rezervace_zapsat_radky(:'tenant', :'perla', 'csv', 'krok107-csv', null, :'csv2'::jsonb)::text as imp_csv2 \gset
select pg_temp.check('import ze souboru: nové ani zrušené se nehlásí',
  (:'imp_csv'::jsonb ->> 'nove')::int = 2 and (:'imp_csv2'::jsonb ->> 'zmenene')::int = 1
  and pg_temp.komukoli(:'c1') = 0 and pg_temp.komukoli(:'c2') = 0);

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', :'c2', null, '{"druh":"akce","nazev":"Firemní Krok107"}'::jsonb) as c2_akce \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('řádek ze souboru ručně změněný na akci: Karel dostal „Nová akce“',
  pg_temp.ma(:'karel', 'akce.nova', :'c2') = 1
  and pg_temp.telo(:'karel', 'akce.nova', :'c2') ->> 'nazev' = 'Firemní Krok107'
  and pg_temp.k_rezervaci(:'vera', :'c2') = 0);


\echo ''
\echo '== 7. Komu mezitím vzali právo ==========================='

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_upozorneni_ulozit(:'tenant', :'perla',
  array[:'e_karel', :'e_vera', :'e_otto', :'e_majitel']::uuid[],
  array[:'e_cyril', :'e_vera']::uuid[],
  '{}'::uuid[]) as ulozeno3 \gset
reset role;
select set_config('test.user_id', '', false);

-- Karlovi vzali zařazení (právo na rezervace), Otto skončil.
update public.employees set position_id = null where id = :'e_karel';
update public.employees set active = false where id = :'e_otto';

set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"druh":"akce","nazev":"Oslava Krok107","datum":"2099-04-13","od":"18:00","pocet_osob":"15"}'::jsonb) as a2 \gset
reset role;
select set_config('test.user_id', '', false);

select pg_temp.check('nová akce došla majiteli (vybraný, vidí)',
  pg_temp.ma(:'majitel', 'akce.nova', :'a2') = 1);
select pg_temp.check('… Karlovi (vzali mu právo) ne, i když ve výběru zůstal',
  pg_temp.k_rezervaci(:'karel', :'a2') = 0
  and exists (select 1 from public.rezervace_upozorneni where employee_id = :'e_karel' and akce));
select pg_temp.check('… Ottovi (ukončený pracovní poměr) ne, i když ve výběru zůstal',
  pg_temp.k_rezervaci(:'otto', :'a2') = 0
  and exists (select 1 from public.rezervace_upozorneni where employee_id = :'e_otto' and akce));

-- Cyrilovi pozastavili členství (zaměstnanec dál aktivní, ve výběru zůstal).
update public.memberships set status = 'suspended' where tenant_id = :'tenant' and user_id = :'cyril';
set role authenticated;
select set_config('test.user_id', :'majitel', false);
select public.rezervace_ulozit(:'tenant', null, :'perla',
  '{"jmeno_hosta":"Pozastavený Krok107","datum":"2099-04-13","od":"19:00","pocet_osob":"2"}'::jsonb) as r3 \gset
reset role;
select set_config('test.user_id', '', false);
-- Pozastaveného by zastavilo i app.notifikovat; seznam příjemců (a s ním
-- nabídka na obrazovce) ho ale nesmí obsahovat sám — ptá se na něj zvlášť.
select exists (select 1 from app.rezervace_prijemci(:'tenant', :'perla', 'rezervace') p
                where p.user_id = :'cyril') as cyril_pozastaveny_prijemce \gset
update public.memberships set status = 'active' where tenant_id = :'tenant' and user_id = :'cyril';
select pg_temp.check('… Cyrilovi (pozastavené členství) nová rezervace ne a mezi příjemci není (po obnovení zase je), Věře ano',
  pg_temp.k_rezervaci(:'cyril', :'r3') = 0 and pg_temp.ma(:'vera', 'rezervace.nova', :'r3') = 1
  and not :'cyril_pozastaveny_prijemce'::boolean
  and exists (select 1 from app.rezervace_prijemci(:'tenant', :'perla', 'rezervace') p
               where p.user_id = :'cyril')
  and exists (select 1 from public.rezervace_upozorneni where employee_id = :'e_cyril' and rezervace));

set role authenticated;
select set_config('test.user_id', :'vera', false);
select pg_temp.check('nabídka už Karla ani Otta neukazuje',
  not exists (select 1 from public.rezervace_upozorneni_lide(:'tenant', :'perla')
               where employee_id in (:'e_karel', :'e_otto')));
select pg_temp.check('… a znovu je vybrat nejde',
  pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'perla', '{' || :'e_karel' || '}'), '23514', 'nevidí')
  and pg_temp.spadne_hlaskou(format('select public.rezervace_upozorneni_ulozit(%L, %L, %L::uuid[], null, null)',
    :'tenant', :'perla', '{' || :'e_otto' || '}'), '23514', 'nevidí'));
reset role;
select set_config('test.user_id', '', false);

update public.employees set position_id = :'z_cteni' where id = :'e_karel';
update public.employees set active = true where id = :'e_otto';


\echo ''
\echo '== 8. Druhá pobočka (Bar) ================================'

-- Bára si v Baru vybrala sebe na akce; na rezervace v Baru nikdo.
-- Majitel je od oddílu 7 vybraný na akce na Perle.
set role authenticated;
select set_config('test.user_id', :'bara', false);
select public.rezervace_upozorneni_ulozit(:'tenant', :'bar',
  array[:'e_bara']::uuid[], '{}'::uuid[], '{}'::uuid[]) as ulozeno_bar \gset
-- Věra potom uloží výběr Perly (stejný jako v oddílu 7).
select set_config('test.user_id', :'vera', false);
select public.rezervace_upozorneni_ulozit(:'tenant', :'perla',
  array[:'e_karel', :'e_vera', :'e_otto', :'e_majitel']::uuid[],
  array[:'e_cyril', :'e_vera']::uuid[],
  '{}'::uuid[]) as ulozeno_perla \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('uložení výběru Perly výběr Baru nesmaže (Bára dál na akce v Baru)',
  :'ulozeno_bar'::int = 1
  and exists (select 1 from public.rezervace_upozorneni
               where branch_id = :'bar' and employee_id = :'e_bara' and akce and not rezervace and not souhrn));

-- Akce a rezervace v Baru zapsané bez autora (jako z přípravy).
insert into public.rezervace (tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, pocet_osob)
values (:'tenant', :'bar', 'akce', 'potvrzeno', 'Barová akce Krok107', 'Host baru Krok107', '2099-04-14 18:00+02', 20)
returning id as a_bar \gset
insert into public.rezervace (tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, pocet_osob)
values (:'tenant', :'bar', 'rezervace', 'potvrzeno', '', 'Barová Krok107', '2099-04-14 19:00+02', 3)
returning id as r_bar \gset
select pg_temp.check('akce v Baru: Bára (vybraná v Baru) ji dostala',
  pg_temp.ma(:'bara', 'akce.nova', :'a_bar') = 1);
select pg_temp.check('… majitel ne: na akce je vybraný jen na Perle (výběr platí pro svou pobočku)',
  pg_temp.k_rezervaci(:'majitel', :'a_bar') = 0 and pg_temp.komukoli(:'a_bar') = 1);
select pg_temp.check('rezervace v Baru, kde na rezervace nikdo vybraný není: nikomu nic (ani majiteli, ani Báře)',
  pg_temp.komukoli(:'r_bar') = 0);


\echo ''
\echo '== 9. Ranní souhrn ======================================='

-- Perla 15. 4. a 16. 4., Bar 16. 4. (zápis bez autora, z přípravy).
insert into public.rezervace (tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, pocet_osob) values
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'S1 Krok107', '2099-04-15 19:00+02', 4),
  (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'S2 Krok107', '2099-04-16 19:00+02', 6),
  (:'tenant', :'bar',   'rezervace', 'potvrzeno', '', 'S3 Krok107', '2099-04-16 20:00+02', 8);

-- Otto skončil (Perlu jinak vidí): souhrn bez výběru mu nepatří.
update public.employees set active = false where id = :'e_otto';
select app.rezervace_souhrn_dne('2099-04-15 09:00+02', :'tenant')::text as souhrn1 \gset
update public.employees set active = true where id = :'e_otto';
select pg_temp.check('nikdo vybraný na souhrn: 15. 4. ho mají všichni, kdo Perlu vidí (Karel, Cyril, Věra, majitel)',
  (:'souhrn1'::jsonb ->> 'chyb')::int = 0
  and pg_temp.souhrn(:'karel', '2099-04-15') is not null
  and pg_temp.souhrn(:'cyril', '2099-04-15') is not null
  and pg_temp.souhrn(:'vera', '2099-04-15') is not null
  and pg_temp.souhrn(:'majitel', '2099-04-15') is not null
  and pg_temp.souhrn(:'nina', '2099-04-15') is null);
select pg_temp.check('… Otto (ukončený pracovní poměr) ne',
  pg_temp.souhrn(:'otto', '2099-04-15') is null);

-- Na souhrn jen Cyril. Otto ve výběru není → jeho řádek zmizí.
set role authenticated;
select set_config('test.user_id', :'vera', false);
select public.rezervace_upozorneni_ulozit(:'tenant', :'perla',
  array[:'e_karel', :'e_vera', :'e_majitel']::uuid[],
  array[:'e_cyril', :'e_vera']::uuid[],
  array[:'e_cyril']::uuid[]) as ulozeno4 \gset
reset role;
select set_config('test.user_id', '', false);
select pg_temp.check('kdo z výběru vypadl (Otto), jeho řádek zmizel; Cyril má souhrn',
  not exists (select 1 from public.rezervace_upozorneni where employee_id = :'e_otto')
  and (select souhrn and rezervace and not akce from public.rezervace_upozorneni where employee_id = :'e_cyril'));

select app.rezervace_souhrn_dne('2099-04-16 09:00+02', :'tenant')::text as souhrn2 \gset
select pg_temp.check('vybraný jen Cyril: souhrn Perly 16. 4. dostal on',
  (:'souhrn2'::jsonb ->> 'chyb')::int = 0
  and pg_temp.souhrn(:'cyril', '2099-04-16') ->> 'den' = '2099-04-16'
  and pg_temp.souhrn(:'cyril', '2099-04-16') -> 'souhrn' -> 0 ->> 'pobocka' = 'Restaurace Černá Perla');
select pg_temp.check('… Karel a Věra (vidí, ale vybraní nejsou) ne',
  pg_temp.souhrn(:'karel', '2099-04-16') is null and pg_temp.souhrn(:'vera', '2099-04-16') is null);
select pg_temp.check('majitel: v souhrnu 16. 4. Bar (tam na souhrn nikdo vybraný není), Perla ne',
  exists (select 1 from jsonb_array_elements(pg_temp.souhrn(:'majitel', '2099-04-16') -> 'souhrn') s
           where s ->> 'pobocka' = 'Bernard Bar Tábor')
  and not exists (select 1 from jsonb_array_elements(pg_temp.souhrn(:'majitel', '2099-04-16') -> 'souhrn') s
                   where s ->> 'pobocka' = 'Restaurace Černá Perla'));
select pg_temp.check('Bára (v Baru na souhrn nikdo vybraný) souhrn Baru dostala jako dosud',
  pg_temp.souhrn(:'bara', '2099-04-16') -> 'souhrn' -> 0 ->> 'pobocka' = 'Bernard Bar Tábor');

-- Jediný vybraný na souhrn (Cyril) skončil: souhrn nesmí potichu přestat
-- chodit — dostanou ho zase všichni, kdo Perlu vidí.
insert into public.rezervace (tenant_id, branch_id, druh, stav, nazev, jmeno_hosta, zacatek, pocet_osob)
values (:'tenant', :'perla', 'rezervace', 'potvrzeno', '', 'S4 Krok107', '2099-04-17 19:00+02', 2);
update public.employees set active = false where id = :'e_cyril';
select app.rezervace_souhrn_dne('2099-04-17 09:00+02', :'tenant')::text as souhrn3 \gset
update public.employees set active = true where id = :'e_cyril';
select pg_temp.check('jediný vybraný na souhrn (Cyril) skončil: souhrn Perly 17. 4. mají zase Karel a Věra, Cyril ne',
  (:'souhrn3'::jsonb ->> 'chyb')::int = 0
  and exists (select 1 from public.rezervace_upozorneni where employee_id = :'e_cyril' and souhrn)
  and pg_temp.souhrn(:'karel', '2099-04-17') -> 'souhrn' -> 0 ->> 'pobocka' = 'Restaurace Černá Perla'
  and pg_temp.souhrn(:'vera', '2099-04-17') is not null
  and pg_temp.souhrn(:'cyril', '2099-04-17') is null);


\echo ''
\echo '== Úklid ================================================='

reset role;
select set_config('test.user_id', '', false);

delete from public.notifikace_doruceni
 where notification_id in (
   select n.id from public.notifications n
    where (n.zdroj_typ = 'rezervace'
           and n.zdroj_id in (select r.id from public.rezervace r
                               where r.jmeno_hosta like '%Krok107' or r.nazev like '%Krok107'))
       or (n.druh = 'rezervace.souhrn_dne' and n.telo ->> 'den' between '2099-04-15' and '2099-04-17'));
delete from public.notifications n
 where (n.zdroj_typ = 'rezervace'
        and n.zdroj_id in (select r.id from public.rezervace r
                            where r.jmeno_hosta like '%Krok107' or r.nazev like '%Krok107'))
    or (n.druh = 'rezervace.souhrn_dne' and n.telo ->> 'den' between '2099-04-15' and '2099-04-17');
delete from public.rezervace_souhrn_dne where den between date '2099-04-15' and date '2099-04-17';
-- Lidé scénáře mohli dostat i jiná upozornění (třeba ke změně zařazení).
delete from public.notifikace_doruceni
 where notification_id in (
   select id from public.notifications
    where tenant_id = :'tenant' and user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto'));
delete from public.notifications
 where tenant_id = :'tenant' and user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto');

delete from public.rezervace_kontakty
 where rezervace_id in (select id from public.rezervace where jmeno_hosta like '%Krok107' or nazev like '%Krok107');
delete from public.rezervace where jmeno_hosta like '%Krok107' or nazev like '%Krok107';
delete from public.integrace_pripojeni where id in (:'pripojeni', :'pripojeni_api', :'pripojeni_ch', :'pripojeni_ch2');
delete from public.rezervace_upozorneni
 where employee_id in (:'e_vera', :'e_karel', :'e_cyril', :'e_nina', :'e_bara', :'e_otto', :'e_majitel');
-- Cizí firma s Cecílií jako majitelkou zůstává (jako v krocích 103 a 106):
-- poslední majitelku firmy pojistka smazat nedovolí. Z Foodtabu pryč všechno.
delete from public.membership_branches
 where membership_id in (select id from public.memberships
                          where tenant_id = :'tenant'
                            and user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto'));
delete from public.memberships
 where tenant_id = :'tenant' and user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto');
delete from public.employees where id in (:'e_vera', :'e_karel', :'e_cyril', :'e_nina', :'e_bara', :'e_otto');
delete from public.position_permissions where position_id in (:'z_cteni', :'z_zapis');
delete from public.positions where id in (:'z_cteni', :'z_zapis');

select pg_temp.check('úklid: rezervace a připojení z kroku 107 pryč',
  not exists (select 1 from public.rezervace where jmeno_hosta like '%Krok107' or nazev like '%Krok107')
  and not exists (select 1 from public.integrace_pripojeni where nazev like '%Krok107'));
select pg_temp.check('úklid: upozornění k nim a souhrny 15.–17. 4. 2099 pryč',
  not exists (select 1 from public.notifications
               where druh = 'rezervace.souhrn_dne' and telo ->> 'den' between '2099-04-15' and '2099-04-17')
  and not exists (select 1 from public.notifications
                   where user_id in (:'vera', :'karel', :'cyril', :'nina', :'bara', :'otto')
                     and tenant_id = :'tenant'));
select pg_temp.check('úklid: výběr a lidé z kroku 107 ve Foodtabu pryč',
  not exists (select 1 from public.rezervace_upozorneni where tenant_id = :'tenant')
  and not exists (select 1 from public.employees where tenant_id = :'tenant' and full_name like '%Stosedmička'));

\echo ''
\echo '== KROK 107 HOTOV ========================================'
