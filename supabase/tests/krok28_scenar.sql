-- Scénář pro krok 28 — kiosek: že zprávy jsou, obsah až po PINu.
--
-- Pokrývá migraci 20260906050000_kiosek_zpravy a zadání
-- docs/nocni-prace-komunikace-2026-09-05.md, krok E.
--
-- Navazuje na etapa0_scenar.sql až krok27_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Tablet stojí na baru a chodí kolem něj i hosté. Kontrola, která tady
-- rozhoduje, je proto ta ZÁPORNÁ v oddílu 1: před PINem se nesmí
-- objevit ani text, ani jméno. Kladná („po PINu to vidím") projde
-- i nad funkcí, která vrací všechno všem.
--
-- A druhá, ještě nepříjemnější: `kiosk_zpravy_pinem` běží pod rolí
-- `anon` a `security definer`, takže obchází RLS. Jediné, co drží
-- hranici mezi lidmi, je podmínka `u.employee_id = v_emp` uvnitř.
-- Kdyby vypadla, přečte tablet po libovolném platném PINu celou firmu.
-- Oddíl 3 je přesně na to.

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
-- Tablet na Perle, dva lidé s PINem a jedna osobní zpráva. Zprávu píše
-- Ivan Ivance — schválně jinému člověku, než kterým se pak budeme na
-- tabletu přihlašovat, ať je co v oddílu 3 nevidět.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as sef from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as role_kuchyne from public.roles
 where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('1111cccc-0000-0000-0000-00000000000c', 'ivan@foodtab.cz',   '{"full_name":"Ivan Ivance"}'),
  ('2222cccc-0000-0000-0000-00000000000c', 'jarmila@foodtab.cz','{"full_name":"Jarmila Kioskova"}');

insert into public.employees (tenant_id, branch_id, user_id, full_name, employment_type) values
  (:'tenant', :'perla', '1111cccc-0000-0000-0000-00000000000c', 'Ivan Ivance', 'hpp'),
  (:'tenant', :'perla', '2222cccc-0000-0000-0000-00000000000c', 'Jarmila Kioskova', 'hpp');

select id as ivan    from public.employees where user_id = '1111cccc-0000-0000-0000-00000000000c' \gset
select id as jarmila from public.employees where user_id = '2222cccc-0000-0000-0000-00000000000c' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status) values
  (:'tenant', '1111cccc-0000-0000-0000-00000000000c', :'role_kuchyne', 'branch', 'active'),
  (:'tenant', '2222cccc-0000-0000-0000-00000000000c', :'role_kuchyne', 'branch', 'active');
select id as clen_ivan from public.memberships
 where user_id = '1111cccc-0000-0000-0000-00000000000c' \gset
select id as clen_jarmila from public.memberships
 where user_id = '2222cccc-0000-0000-0000-00000000000c' \gset
insert into public.membership_branches (membership_id, branch_id) values
  (:'clen_ivan', :'perla'), (:'clen_jarmila', :'perla');

/*
  Tablet se registruje ve dvou krocích, jako doopravdy: vedení vyrobí
  párovací kód, tablet ho opíše. Registruje se pod rolí `anon` —
  na tabletu není přihlášený nikdo. Klíč se v databázi drží jako otisk,
  nikdy sám (pravidlo 7).
*/
select set_config('test.user_id', :'sef', false);
set role authenticated;
select kod as kod28 from public.vytvorit_registracni_kod(:'tenant', :'perla', 'Bar tablet') \gset
reset role;

select set_config('test.user_id', '', false);
set role anon;
select klic as tablet from public.registrovat_zarizeni(:'kod28') \gset
reset role;

/*
  PINy si nastavuje každý sám za sebe — `nastavit_pin` schválně nebere
  id člověka, takže cizí PIN nastavit nejde. Proto se sem musí každý
  „přihlásit" zvlášť.
*/
select set_config('test.user_id', '1111cccc-0000-0000-0000-00000000000c', false);
set role authenticated;
select public.nastavit_pin(:'tenant', '7431');
reset role;

select set_config('test.user_id', '2222cccc-0000-0000-0000-00000000000c', false);
set role authenticated;
select public.nastavit_pin(:'tenant', '9268');
reset role;

\set pin_ivan 7431
\set pin_jarmila 9268

-- Zpráva pro Jarmilu od Ivana.
select set_config('test.user_id', '1111cccc-0000-0000-0000-00000000000c', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Ivan a Jarmila', null,
  array[:'jarmila']::uuid[]) as rozhovor \gset
select public.poslat_zpravu(:'rozhovor', 'Přines zítra ten nůž, co jsi slíbila.') as zprava \gset
reset role;

select set_config('test.tablet', :'tablet', false);
select set_config('test.pin_jarmila', :'pin_jarmila', false);


\echo ''
\echo '== 1. Před PINem: že zprávy jsou, ale nic víc ==========='

-- Role `anon`, jako opravdový tablet. Ne superuživatel a ne přihlášený
-- účet — kiosek žádný nemá.
set role anon;

select public.kiosk_zpravy_pocet(:'tablet') as pocet \gset

select pg_temp.check('tablet ví, že někomu něco leží',
  :'pocet'::int >= 1);

/*
  A TEĎ TA ZÁPORNÁ, kvůli které to celé je. Funkce vrací JEDNO ČÍSLO:
  ani jméno, ani text. Kdyby vracela cokoli dalšího, přečte si to
  host, který jde kolem baru.

  Zkoušel jsem to i obráceně — když se návratový typ změní tak, aby
  vracel jména, tahle kontrola spadne na typu.
*/
select pg_temp.check('vrací se číslo, ne text ani struktura',
  pg_typeof(public.kiosk_zpravy_pocet(:'tablet'))::text = 'integer');

-- A obsah se přes tabulky rovnou přečíst nedá: `anon` na konverzace
-- nemá ani grant, natož politiku.
select pg_temp.check('anon na zprávy přímo nedosáhne',
  not has_table_privilege('anon', 'public.konverzace_zpravy', 'select'));
select pg_temp.check('a ani na konverzace',
  not has_table_privilege('anon', 'public.konverzace', 'select'));

reset role;


\echo ''
\echo '== 2. Špatný PIN nevrací nic — a nevrací ani výjimku ===='

/*
  Výjimka by vrátila zpět celou příkazovou dávku, a s ní i počítadlo
  nezdarů, které `pin_overit` zrovna zvedlo. Zámek po pěti pokusech by
  pak nikdy nezabral: každý nezdar by se sám smazal tou chybou, která
  ho hlásí. Našlo se to u `pichnout_pinem` a platí to tady stejně.
*/

set role anon;

select ok as ok_spatny, zpravy as zpravy_spatny
from public.kiosk_zpravy_pinem(:'tablet', '000000') \gset

select pg_temp.check('špatný PIN vrátí řádek s ok = false',
  :'ok_spatny' = 'f');
select pg_temp.check('a žádný obsah', :'zpravy_spatny' = '');

reset role;

-- Počítadlo nezdarů se opravdu zvedlo — tohle je ta polovina, kterou
-- by výjimka smazala.
select pg_temp.check('nezdařený pokus se započítal',
  (select max(chyb) from public.employee_pins p
   join public.employees e on e.id = p.employee_id
   where e.branch_id = :'perla') >= 1);


\echo ''
\echo '== 3. Po PINu jen SVOJE zprávy ==========================='

set role anon;

select ok as ok_j, jmeno as jmeno_j, do_kdy as do_kdy_j, zpravy as zpravy_j
from public.kiosk_zpravy_pinem(:'tablet', :'pin_jarmila') \gset

select pg_temp.check('PIN sedl', :'ok_j' = 't');
select pg_temp.check('a tablet ví, kdo to je', :'jmeno_j' = 'Jarmila Kioskova');
select pg_temp.check('zpráva se ukázala',
  :'zpravy_j'::jsonb @> '[{"text": "Přines zítra ten nůž, co jsi slíbila."}]'::jsonb);

/*
  TOHLE JE TA NEJDŮLEŽITĚJŠÍ KONTROLA V SOUBORU.

  Funkce běží pod `anon` a `security definer`, takže obchází RLS.
  Jediné, co drží hranici mezi lidmi, je `u.employee_id = v_emp`.
  Ivanovým PINem se proto nesmí objevit Jarmilina zpráva — a Ivan je
  přitom její AUTOR, takže je to zpráva, kterou napsal on sám.

  Schválně rozbito: po vyndání té podmínky vrátí Ivanův PIN i Jarmiliny
  zprávy a tahle kontrola spadne. Ověřeno.
*/
select ok as ok_i, zpravy as zpravy_i
from public.kiosk_zpravy_pinem(:'tablet', :'pin_ivan') \gset

select pg_temp.check('Ivanův PIN taky sedl', :'ok_i' = 't');
select pg_temp.check('ale Jarmilinu zprávu Ivanovi neukáže',
  not (:'zpravy_i'::jsonb @> '[{"text": "Přines zítra ten nůž, co jsi slíbila."}]'::jsonb));

-- Vlastní odeslaná zpráva se člověku jako nepřečtená nevrací. Jinak by
-- měl každý na tabletu plno „nepřečtených" od sebe samého.
select pg_temp.check('a svoji vlastní odeslanou zprávu nevidí jako nepřečtenou',
  :'zpravy_i'::jsonb = '[]'::jsonb);

reset role;


\echo ''
\echo '== 4. Odpočet je údaj firmy, ne konstanta v kódu ========'

/*
  Jolt: v rohu běží viditelný odpočet do automatického odhlášení. Je to
  jediné, co člověku na baru řekne, že za chvíli přestane být sebou.
  Délka je proto nastavení firmy — bistro s jedním pultem a hotel
  s recepcí mají jiný provoz.
*/

select pg_temp.check('do_kdy se vrací a je v budoucnosti',
  :'do_kdy_j'::timestamptz > now());

reset role;
insert into public.tenant_settings (tenant_id, kiosek_odhlaseni_s)
values (:'tenant', 20)
on conflict (tenant_id) do update set kiosek_odhlaseni_s = 20;

set role anon;
select do_kdy as do_kdy2 from public.kiosk_zpravy_pinem(:'tablet', :'pin_jarmila') \gset
reset role;

select pg_temp.check('kratší nastavení firmy se projeví',
  :'do_kdy2'::timestamptz < now() + interval '25 seconds');

-- Nesmyslná délka se odmítne. Nula by znamenala „zmizí dřív, než to
-- člověk přečte", tisíc vteřin „svítí to na baru čtvrt hodiny".
do $$
declare v_ok boolean := false;
begin
  begin
    update public.tenant_settings set kiosek_odhlaseni_s = 0
     where tenant_id = current_setting('test.tenant')::uuid;
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: nulový odpočet prošel'; end if;
  raise notice '  OK    nesmyslná délka odpočtu neprojde';
end $$;

/*
  A ten nový sloupec musí jít přečíst POD ROLÍ. `tenant_settings` má
  práva po sloupcích a `add column` do toho výčtu nový sloupec nepřidá
  — dotaz by dostal 42501 dřív, než se dostane na řádky, a spadla by
  celá obrazovka nastavení, ne jen tenhle údaj.
*/
select set_config('test.user_id', :'sef', false);
set role authenticated;
select pg_temp.check('nový sloupec je čitelný pod rolí authenticated',
  (select kiosek_odhlaseni_s from public.tenant_settings
   where tenant_id = :'tenant') = 20);
reset role;

-- Uklidit, ať další scénáře nenajdou nastavení, které nečekají.
update public.tenant_settings set kiosek_odhlaseni_s = 45 where tenant_id = :'tenant';


\echo ''
\echo '== 5. Cizí tablet a cizí firma =========================='

set role anon;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kiosk_zpravy_pocet('NEEXISTUJICI-KLIC-0000000000000000');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neregistrovaný tablet dostal počet'; end if;
  raise notice '  OK    neregistrovaný tablet nedostane ani počet';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.kiosk_zpravy_pinem('NEEXISTUJICI-KLIC-0000000000000000', '1234');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: neregistrovaný tablet dostal zprávy'; end if;
  raise notice '  OK    ani zprávy';
end $$;

reset role;


\echo ''
\echo '== KROK 28 HOTOV ========================================'
