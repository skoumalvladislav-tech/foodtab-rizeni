-- Scénář pro krok 91 — automatické párování plateb s fakturami.
--
-- Migrace: 20261008120000_platby_automaticke_parovani.sql.
--
-- Pokrývá:
--   1. funkci smí volat JEN úloha (service_role) — přihlášený ani anonym ne;
--   2. jednoznačná shoda se zapíše jako potvrzená s `zpusob = 'automaticky'`;
--   3. cokoli už spárovaného, nesedící částka, příjem místo výdaje nebo
--      platba cizí firmy → nic se nezapíše (false), nikdy výjimka;
--   4. ruční párování dál vzniká se `zpusob = 'rucne'`.
--
-- Navazuje na etapa0_scenar.sql (firma "Foodtab s.r.o.").

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

create or replace function pg_temp.spadne_hlaskou(p_sql text, p_stav text, p_hlaska text)
returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  return sqlstate = p_stav and sqlerrm like '%' || p_hlaska || '%';
end $$;

reset role;
select set_config('test.user_id', '', false);

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' limit 1 \gset
insert into public.tenants (name) values ('Krok91 Cizí s.r.o.') returning id as cizi \gset

insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'tenant', 'Krok91 firemní účet', 'banka')
returning id as ucet \gset
insert into public.platebni_ucty (tenant_id, nazev, typ)
values (:'cizi', 'Krok91 cizí účet', 'banka')
returning id as ucet_cizi \gset

insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 500000, current_date, '2026091', 'fio_api') returning id as t_ok \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 500000, current_date, '2026091', 'fio_api') returning id as t_druha \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'prijem', 70000, current_date, '2026092', 'fio_api') returning id as t_prijem \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 30000, current_date, '2026093', 'fio_api') returning id as t_mala \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'cizi', :'ucet_cizi', 'vydaj', 90000, current_date, '2026094', 'fio_api') returning id as t_cizi \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 60000, current_date, '2026095', 'rucni') returning id as t_rucni \gset
insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj)
values (:'tenant', :'ucet', 'vydaj', 61000, current_date, '2026096', 'csv_pokladna') returning id as t_pokladna \gset


\echo ''
\echo '== 1. Volat smí jen úloha =================================================='

set role authenticated;
select pg_temp.check('přihlášený uživatel funkci nezavolá (42501)',
  pg_temp.spadne_hlaskou(format('select public.automaticky_sparovat_platbu(%L, %L, %L, %s, %s)',
    :'tenant', :'t_ok', 'faktura-91-a', 500000, 500000), '42501', ''));
select pg_temp.check('… ani vnitřní app. funkci',
  pg_temp.spadne_hlaskou(format('select app.automaticky_sparovat_platbu(%L, %L, %L, %s, %s)',
    :'tenant', :'t_ok', 'faktura-91-a', 500000, 500000), '42501', ''));
reset role;

set role anon;
select pg_temp.check('anonym funkci nezavolá (42501)',
  pg_temp.spadne_hlaskou(format('select public.automaticky_sparovat_platbu(%L, %L, %L, %s, %s)',
    :'tenant', :'t_ok', 'faktura-91-a', 500000, 500000), '42501', ''));
reset role;


\echo ''
\echo '== 1b. Platbu „z banky přes API" nezapíše přihlášený uživatel ============'

set role authenticated;
select pg_temp.check('přihlášený nezapíše platbu se zdrojem fio_api',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj) values (%L, %L, %L, %s, current_date, %L, %L)',
    :'tenant', :'ucet', 'vydaj', 12345, '2026099', 'fio_api'), '42501', 'synchronizace'));
select pg_temp.check('… ani se zdrojem bankovni_agregator',
  pg_temp.spadne_hlaskou(format(
    'insert into public.transakce (tenant_id, ucet_id, smer, castka_haleru, datum, vs, zdroj) values (%L, %L, %L, %s, current_date, %L, %L)',
    :'tenant', :'ucet', 'vydaj', 12345, '2026099', 'bankovni_agregator'), '42501', 'synchronizace'));
reset role;
select pg_temp.check('synchronizace (mimo roli authenticated) zapsat smí',
  exists (select 1 from public.transakce where id = :'t_ok' and zdroj = 'fio_api'));


\echo ''
\echo '== 2. Jednoznačná shoda se zapíše =========================================='

set role service_role;
select pg_temp.check('úloha spáruje platbu s fakturou (true)',
  public.automaticky_sparovat_platbu(:'tenant', :'t_ok', 'faktura-91-a', 500000, 500000));
reset role;

select pg_temp.check('… potvrzená, celá částka, jistota 1, zpusob = automaticky, bez člověka',
  exists (select 1 from public.platby_faktury
           where transakce_id = :'t_ok' and faktura_id = 'faktura-91-a' and stav = 'potvrzeno'
             and castka_haleru = 500000 and jistota = 1 and zpusob = 'automaticky'
             and potvrdil is null and potvrzeno_kdy is not null));


\echo ''
\echo '== 3. Cokoli nejednoznačného → nic, bez výjimky ============================'

set role service_role;
select pg_temp.check('tatáž platba podruhé (už spárovaná) → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_ok', 'faktura-91-b', 500000, 500000));
select pg_temp.check('jiná platba na už spárovanou fakturu → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_druha', 'faktura-91-a', 500000, 500000));
select pg_temp.check('částka ≠ celková částka faktury (částečná úhrada) → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_mala', 'faktura-91-c', 30000, 50000));
select pg_temp.check('částka ≠ částka platby → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_mala', 'faktura-91-c', 20000, 20000));
select pg_temp.check('příjem (ne výdaj) → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_prijem', 'faktura-91-d', 70000, 70000));
select pg_temp.check('platba cizí firmy pod naší firmou → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_cizi', 'faktura-91-e', 90000, 90000));
select pg_temp.check('ručně zapsaná platba (ne z banky) → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_rucni', 'faktura-91-h', 60000, 60000));
select pg_temp.check('platba z pokladny → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_pokladna', 'faktura-91-i', 61000, 61000));
select pg_temp.check('nulová částka → false',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_mala', 'faktura-91-c', 0, 0));
reset role;

select pg_temp.check('… a nic z toho se nezapsalo (jediný řádek je ten z bodu 2)',
  (select count(*) from public.platby_faktury where transakce_id in (:'t_ok', :'t_druha', :'t_prijem', :'t_mala', :'t_cizi', :'t_rucni', :'t_pokladna')) = 1);


\echo ''
\echo '== 3b. Zrušené párování se samo nevrátí ===================================='

update public.platby_faktury set stav = 'zamitnuto' where transakce_id = :'t_ok' and faktura_id = 'faktura-91-a';
set role service_role;
select pg_temp.check('člověk párování zrušil (zamítnuto) → automatika ho znovu nezaloží',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_ok', 'faktura-91-a', 500000, 500000));
select pg_temp.check('… ale tatáž platba k JINÉ jednoznačné faktuře projde',
  public.automaticky_sparovat_platbu(:'tenant', :'t_ok', 'faktura-91-g', 500000, 500000));
reset role;


\echo ''
\echo '== 3c. Zrušení automatického párování („Vrátit mezi neuhrazené") ========'

select id as alokace_g from public.platby_faktury where transakce_id = :'t_ok' and faktura_id = 'faktura-91-g' \gset

set role authenticated;
select pg_temp.check('přihlášený automatické párování přímo nezruší (42501)',
  pg_temp.spadne_hlaskou(format('select public.zrusit_automaticke_parovani(%L, %L, %L)', :'tenant', :'alokace_g', 'x'), '42501', ''));
reset role;

set role service_role;
select pg_temp.check('cizí firma ho nezruší (false)',
  not public.zrusit_automaticke_parovani(:'cizi', :'alokace_g', 'test'));
select pg_temp.check('úloha automatické párování zruší (true)',
  public.zrusit_automaticke_parovani(:'tenant', :'alokace_g', 'Ve Fakturách vráceno mezi neuhrazené.'));
select pg_temp.check('… podruhé už ne (není potvrzené)',
  not public.zrusit_automaticke_parovani(:'tenant', :'alokace_g', 'znovu'));
reset role;

select pg_temp.check('… řádek je zamítnutý — automatika ho znovu nezaloží',
  (select stav from public.platby_faktury where id = :'alokace_g') = 'zamitnuto');
set role service_role;
select pg_temp.check('… a opravdu: tatáž dvojice se znovu nespáruje',
  not public.automaticky_sparovat_platbu(:'tenant', :'t_ok', 'faktura-91-g', 500000, 500000));
reset role;


\echo ''
\echo '== 4. Ruční párování je dál „rucne" ========================================'

insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, potvrzeno_kdy)
values (:'tenant', :'t_mala', 'faktura-91-c', 30000, 'potvrzeno', now());
select pg_temp.check('řádek bez uvedení způsobu je ruční',
  (select zpusob from public.platby_faktury where transakce_id = :'t_mala') = 'rucne');
select id as alokace_rucni from public.platby_faktury where transakce_id = :'t_mala' \gset
set role service_role;
select pg_temp.check('ruční párování úloha jako „automatické" nezruší',
  not public.zrusit_automaticke_parovani(:'tenant', :'alokace_rucni', 'x'));
reset role;

select pg_temp.check('neznámý způsob spadne na CHECK',
  pg_temp.spadne_hlaskou(format(
    'insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, stav, zpusob) values (%L, %L, %L, %s, %L, %L)',
    :'tenant', :'t_druha', 'faktura-91-f', 100, 'navrzeno', 'magicky'), '23514', ''));


\echo ''
\echo '== Úklid =================================================================='

reset role;
delete from public.platby_faktury where transakce_id in (:'t_ok', :'t_druha', :'t_prijem', :'t_mala', :'t_cizi', :'t_rucni', :'t_pokladna');
delete from public.transakce where id in (:'t_ok', :'t_druha', :'t_prijem', :'t_mala', :'t_cizi', :'t_rucni', :'t_pokladna');
delete from public.platebni_ucty where id in (:'ucet', :'ucet_cizi');

select pg_temp.check('úklid: po scénáři nezůstala žádná platba kroku 91',
  not exists (select 1 from public.transakce where id in (:'t_ok', :'t_druha', :'t_prijem', :'t_mala', :'t_cizi', :'t_rucni', :'t_pokladna')));

\echo ''
\echo '== KROK 91 HOTOV =============================================='
