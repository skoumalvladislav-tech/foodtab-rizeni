-- Scénář pro krok 62 — přečtení kanálu nikoho nezapíše natrvalo (T1)
--                     a upozornění na oznámení jen se čtením Nástěnky (T9).
--
-- Pokrývá migraci 20260927100000_cteni_rozhovoru.sql a plán
-- docs/komunikace-stav-a-plan-2026-09-27.md, oddíl 10.
--
-- Navazuje na etapa0_scenar.sql (firma, Perla, majitel, role Kuchyně).
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Aplikace od 27. 9. zapisuje čtení rozhovoru při otevření. Záložka
-- „kam jsem dočetl" se ukládá jako ŘÁDEK v konverzace_ucastnici — a ten
-- řádek dřív dával přístup u všech druhů, i u kanálu pobočky a úseku.
-- Kdo by si přečetl kanál úseku a pak přešel jinam, četl by ho dál,
-- měl by ho v seznamu a chodila by mu z něj upozornění. Tenhle scénář
-- proto dělá přesně to: přečte, přeřadí, a ptá se všech šesti míst,
-- která řádek čtou.
--
-- Kladné kontroly (oddíly 1 a 6) hlídají druhou stranu: v kanálu, kam
-- člověk patří, čte dál s nulou nepřečtených, a v osobním rozhovoru
-- řádek přístup dávat MUSÍ — jinak by pojistka zavřela všechno.
--
-- ROZBITÍ (ověřeno 27. 9. 2026, každé zvlášť, viz hlášení v plánu):
--   * je_ucastnik bez app.ucastnici_vypsani      → oddíl 2 „nečte kanál"
--   * moje_rozhovory bez ní                      → oddíl 2 „nemá v seznamu"
--   * upozornit_na_vzkaz_trg bez ní              → oddíl 3
--   * lide_v_rozhovoru bez ní                    → oddíl 4
--   * kiosk_zpravy_pocet / _pinem bez ní         → oddíl 5
--   * ucastnici_vypsani vždy false               → oddíl 6 (osobní)
--   * upozornit_na_oznameni_trg bez práva        → oddíl 7
-- Doplněno 28. 9. (výsledky rozbití v plánu, oddíl 0):
--   * oddíl 10 migrace pryč                       → oddíl 8 „pridan_kdy"
--   * grant zpět s pridan_kdy / s precteno_do     → oddíl 8
--   * kdo_nepotvrdil bez práva čtení              → oddíl 9 „Nepotvrdili"
--   * ctenari_nastenky bez práva čtení / bez
--     kontroly communication.manage               → oddíl 9

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;
-- PGlite pouští všechny scénáře v jednom sezení a `reset role`
-- nevyprázdní test.user_id — bez tohohle by přímé inserty níž běžely
-- pod cizím auth.uid().
select set_config('test.user_id', '', false);


-- =====================================================================
-- PŘÍPRAVA
--
-- Vlastní pobočka „Pobočka 62", ať tablet v oddílu 5 počítá jen lidi
-- tohohle scénáře. Dva úseky: A (Kuchyně) a B (Bar).
--
--   Xenie  — pobočka 62 + dosah na Perlu, úsek A. Čte a pak se přeřadí.
--   Yvona  — pobočka 62, úsek A. Píše do kanálu úseku.
--   Zdeněk — pobočka 62, úsek A, má communication.read. Kladná strana.
--   Wanda  — Perla. Kladná strana kanálu pobočky.
-- =====================================================================

select id as tenant from public.tenants where name = 'Foodtab s.r.o.' \gset
select id as perla  from public.branches where slug = 'cerna-perla' \gset
select user_id as sef from public.profiles where email = 'majitel@foodtab.cz' \gset
select id as role_kuchyne from public.roles where tenant_id = :'tenant' and key = 'kuchyne' \gset

insert into public.branches (tenant_id, name, slug)
values (:'tenant', 'Pobočka 62', 'pobocka-62');
select id as p62 from public.branches where slug = 'pobocka-62' \gset

insert into public.useky (tenant_id, branch_id, nazev, poradi) values
  (:'tenant', null, 'Kuchyně — krok62', 962),
  (:'tenant', null, 'Bar — krok62', 963);
select id as usek_a from public.useky where tenant_id = :'tenant' and nazev = 'Kuchyně — krok62' \gset
select id as usek_b from public.useky where tenant_id = :'tenant' and nazev = 'Bar — krok62' \gset

insert into auth.users (id, email, raw_user_meta_data) values
  ('62620000-0000-0000-0000-00000000000a', 'xenie62@foodtab.cz',  '{"full_name":"Xenie Dvaašedesát"}'),
  ('62620000-0000-0000-0000-00000000000b', 'yvona62@foodtab.cz',  '{"full_name":"Yvona Dvaašedesát"}'),
  ('62620000-0000-0000-0000-00000000000c', 'zdenek62@foodtab.cz', '{"full_name":"Zdeněk Dvaašedesát"}'),
  ('62620000-0000-0000-0000-00000000000d', 'wanda62@foodtab.cz',  '{"full_name":"Wanda Dvaašedesát"}');

insert into public.employees (tenant_id, branch_id, usek_id, user_id, full_name, employment_type) values
  (:'tenant', :'p62',   :'usek_a', '62620000-0000-0000-0000-00000000000a', 'Xenie Dvaašedesát',  'hpp'),
  (:'tenant', :'p62',   :'usek_a', '62620000-0000-0000-0000-00000000000b', 'Yvona Dvaašedesát',  'hpp'),
  (:'tenant', :'p62',   :'usek_a', '62620000-0000-0000-0000-00000000000c', 'Zdeněk Dvaašedesát', 'hpp'),
  (:'tenant', :'perla', null,      '62620000-0000-0000-0000-00000000000d', 'Wanda Dvaašedesát',  'hpp');

select id as xenie  from public.employees where user_id = '62620000-0000-0000-0000-00000000000a' \gset
select id as yvona  from public.employees where user_id = '62620000-0000-0000-0000-00000000000b' \gset
select id as zdenek from public.employees where user_id = '62620000-0000-0000-0000-00000000000c' \gset
select id as wanda  from public.employees where user_id = '62620000-0000-0000-0000-00000000000d' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
select :'tenant', u, :'role_kuchyne', 'branch', 'active'
from (values
  ('62620000-0000-0000-0000-00000000000a'::uuid),
  ('62620000-0000-0000-0000-00000000000b'::uuid),
  ('62620000-0000-0000-0000-00000000000c'::uuid),
  ('62620000-0000-0000-0000-00000000000d'::uuid)
) t(u);

-- Xenie dosáhne na obě pobočky, ostatní na svou domovskou.
insert into public.membership_branches (membership_id, branch_id)
select m.id, b.branch_id
  from public.memberships m
  join (values
    ('62620000-0000-0000-0000-00000000000a'::uuid, :'p62'::uuid),
    ('62620000-0000-0000-0000-00000000000a'::uuid, :'perla'::uuid),
    ('62620000-0000-0000-0000-00000000000b'::uuid, :'p62'::uuid),
    ('62620000-0000-0000-0000-00000000000c'::uuid, :'p62'::uuid),
    ('62620000-0000-0000-0000-00000000000d'::uuid, :'perla'::uuid)
  ) b(u, branch_id) on b.u = m.user_id
 where m.tenant_id = :'tenant';

-- Nástěnku smí číst jen Zdeněk (oddíl 7). Práva dává zařazení, ne role.
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'zdenek', 'communication.read', true);


\echo ''
\echo '== 1. Xenie si přečte kanál úseku a kanál pobočky =========='

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.kanal_useku(:'tenant', :'usek_a') as kanal_a \gset
select public.kanal_pobocky(:'tenant', :'perla') as kanal_p \gset
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.poslat_zpravu(:'kanal_a', 'Krok62: první zpráva v Kuchyni.') as m1 \gset
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('před přečtením má Xenie v kanálu úseku 1 nepřečtenou',
  (select neprectenych from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal_a') = 1);

-- Kanál úseku cestou aplikace (`precist_rozhovor`, vzniká touto
-- migrací), kanál pobočky starou `oznacit_precteno` — záložku zakládají obě.
select public.precist_rozhovor(:'kanal_a') as cteno_a \gset
select public.oznacit_precteno(:'kanal_p') as cteno_p \gset

select pg_temp.check('KLADNĚ: v úseku A čte dál',
  app.je_ucastnik(:'kanal_a') = true);
select pg_temp.check('KLADNĚ: a má v kanálu 0 nepřečtených',
  (select neprectenych from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal_a') = 0);
select pg_temp.check('KLADNĚ: kanál Perly čte, dokud na Perlu dosáhne',
  app.je_ucastnik(:'kanal_p') = true);

reset role;

-- Bez těchhle řádků by oddíly 2–5 nic neměřily: past vzniká právě tím,
-- že čtení kanálu řádek ZALOŽÍ.
select pg_temp.check('čtení kanálu úseku založilo řádek se záložkou',
  exists (select 1 from public.konverzace_ucastnici
           where konverzace_id = :'kanal_a' and employee_id = :'xenie'
             and precteno_do is not null and odesel_kdy is null));
select pg_temp.check('čtení kanálu pobočky taky',
  exists (select 1 from public.konverzace_ucastnici
           where konverzace_id = :'kanal_p' and employee_id = :'xenie'
             and precteno_do is not null and odesel_kdy is null));

-- `precist_rozhovor` je jen obálka: do cizího rozhovoru nepustí.
-- Wanda (Perla, bez úseku A) si kanál úseku A „přečíst“ nesmí.
select set_config('test.kanal_a', :'kanal_a', false);
select set_config('test.user_id', '62620000-0000-0000-0000-00000000000d', false);
set role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.precist_rozhovor(current_setting('test.kanal_a')::uuid);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: precist_rozhovor pustil do cizího kanálu'; end if;
  raise notice '  OK    precist_rozhovor do cizího kanálu nepustí (kontrola zůstává v oznacit_precteno)';
end $$;
reset role;
select pg_temp.check('a žádná záložka Wandě v kanálu A nevznikla',
  not exists (select 1 from public.konverzace_ucastnici
               where konverzace_id = :'kanal_a' and employee_id = :'wanda'));


\echo ''
\echo '== 2. Přeřazení: úsek B a bez dosahu na Perlu ============='

update public.employees set usek_id = :'usek_b' where id = :'xenie';
delete from public.membership_branches mb
 using public.memberships m
 where mb.membership_id = m.id
   and m.user_id = '62620000-0000-0000-0000-00000000000a'
   and mb.branch_id = :'perla';

select pg_temp.check('řádky se záložkou zůstaly (pojistka nic nemaže)',
  (select count(*) from public.konverzace_ucastnici
    where employee_id = :'xenie' and konverzace_id in (:'kanal_a', :'kanal_p')) = 2);

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;

select pg_temp.check('po přeřazení kanál úseku A nečte (je_ucastnik)',
  app.je_ucastnik(:'kanal_a') = false);
select pg_temp.check('po ztrátě dosahu kanál Perly nečte (je_ucastnik)',
  app.je_ucastnik(:'kanal_p') = false);
select pg_temp.check('kanál úseku A nemá v seznamu (moje_rozhovory)',
  not exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal_a'));
select pg_temp.check('kanál Perly nemá v seznamu (moje_rozhovory)',
  not exists (select 1 from public.moje_rozhovory(:'tenant') where konverzace_id = :'kanal_p'));

reset role;


\echo ''
\echo '== 3. Nová zpráva v kanálu: Xenie upozornění nedostane ====='

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.poslat_zpravu(:'kanal_a', 'Krok62: druhá zpráva v Kuchyni.') as m2 \gset
reset role;

-- Kontroluje se HNED, před další zprávou. „Nový vzkaz" se slučuje za
-- den: další zpráva by nepřečtené upozornění nahradila novým s jiným
-- zdroj_id a kontrola níž by prošla, i kdyby Xenie upozornění dostala
-- (schválné rozbití triggeru to 27. 9. prozradilo).
select pg_temp.check('KLADNĚ: Zdeněk (úsek A) „nový vzkaz" z kanálu úseku dostal',
  exists (select 1 from public.notifications
           where user_id = '62620000-0000-0000-0000-00000000000c'
             and druh = 'vzkaz.novy' and zdroj_id = :'m2'));
select pg_temp.check('Xenie (už úsek B) „nový vzkaz" z kanálu úseku A nedostala',
  not exists (select 1 from public.notifications
               where user_id = '62620000-0000-0000-0000-00000000000a'
                 and druh = 'vzkaz.novy' and zdroj_id = :'m2'));

select set_config('test.user_id', :'sef', false);
set role authenticated;
select public.poslat_zpravu(:'kanal_p', 'Krok62: zpráva do kanálu Perly.') as m3 \gset
reset role;

select pg_temp.check('KLADNĚ: Wanda (Perla) „nový vzkaz" z kanálu Perly dostala',
  exists (select 1 from public.notifications
           where user_id = '62620000-0000-0000-0000-00000000000d'
             and druh = 'vzkaz.novy' and zdroj_id = :'m3'));
select pg_temp.check('Xenie (bez dosahu na Perlu) z kanálu Perly nedostala nic',
  not exists (select 1 from public.notifications
               where user_id = '62620000-0000-0000-0000-00000000000a'
                 and druh = 'vzkaz.novy' and zdroj_id = :'m3'));


\echo ''
\echo '== 4. Jména v kanálu: čtenář, který odešel, v nich není ===='

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000b', false);
set role authenticated;
select pg_temp.check('KLADNĚ: Yvona v kanálu úseku vidí sebe jako autorku',
  exists (select 1 from public.lide_v_rozhovoru(:'kanal_a') where employee_id = :'yvona'));
select pg_temp.check('Xenii (jen četla, pak odešla) jí lide_v_rozhovoru nevrací',
  not exists (select 1 from public.lide_v_rozhovoru(:'kanal_a') where employee_id = :'xenie'));
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;
select pg_temp.check('Xenie sama jména z kanálu A nedostane',
  (select count(*) from public.lide_v_rozhovoru(:'kanal_a')) = 0);
reset role;


\echo ''
\echo '== 5. Tablet: kanál se po PINu neukáže ===================='

select set_config('test.user_id', :'sef', false);
set role authenticated;
select kod as kod62 from public.vytvorit_registracni_kod(:'tenant', :'p62', 'Tablet 62') \gset
reset role;

select set_config('test.user_id', '', false);
set role anon;
select klic as tablet62 from public.registrovat_zarizeni(:'kod62') \gset
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;
select public.nastavit_pin(:'tenant', '5827');
reset role;

select set_config('test.user_id', '', false);
set role anon;
select pg_temp.check('tablet nepočítá Xenii kvůli kanálům (0 lidí se zprávami)',
  public.kiosk_zpravy_pocet(:'tablet62') = 0);
select ok as ok_x, zpravy as zpravy_x from public.kiosk_zpravy_pinem(:'tablet62', '5827') \gset
reset role;

select pg_temp.check('PIN Xenie sedl', :'ok_x' = 't');
select pg_temp.check('po PINu žádná zpráva z kanálů (ani A, ani Perla)',
  :'zpravy_x'::jsonb = '[]'::jsonb);


\echo ''
\echo '== 6. KLADNĚ: osobní rozhovor dál funguje přes řádek ======='

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.zalozit_rozhovor(:'tenant', 'osobni', null, 'Krok62 osobní', null,
  array[:'xenie']::uuid[]) as osobni \gset
select public.poslat_zpravu(:'osobni', 'Krok62: osobní zpráva pro Xenii.') as m4 \gset
select pg_temp.check('Yvona v osobním rozhovoru vidí Xenii mezi lidmi (řádek platí)',
  exists (select 1 from public.lide_v_rozhovoru(:'osobni') where employee_id = :'xenie'));
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000a', false);
set role authenticated;
select pg_temp.check('Xenie je účastnicí osobního rozhovoru',
  app.je_ucastnik(:'osobni') = true);
select pg_temp.check('má ho v seznamu s 1 nepřečtenou',
  (select neprectenych from public.moje_rozhovory(:'tenant') where konverzace_id = :'osobni') = 1);
reset role;

select pg_temp.check('a dostala na něj „nový vzkaz"',
  exists (select 1 from public.notifications
           where user_id = '62620000-0000-0000-0000-00000000000a'
             and druh = 'vzkaz.novy' and zdroj_id = :'m4'));

select set_config('test.user_id', '', false);
set role anon;
select pg_temp.check('tablet ji teď počítá (osobní zpráva)',
  public.kiosk_zpravy_pocet(:'tablet62') = 1);
select zpravy as zpravy_x2 from public.kiosk_zpravy_pinem(:'tablet62', '5827') \gset
reset role;

select pg_temp.check('po PINu přesně ta osobní zpráva',
  jsonb_array_length(:'zpravy_x2'::jsonb) = 1
  and :'zpravy_x2'::jsonb @> '[{"text": "Krok62: osobní zpráva pro Xenii."}]'::jsonb);


\echo ''
\echo '== 7. Oznámení: upozornění jen se čtením Nástěnky ========='

select pg_temp.check('Xenie communication.read nemá',
  not app.ma_pravo_clovek(:'tenant', :'xenie', 'communication.read'));
select pg_temp.check('Zdeněk ho má',
  app.ma_pravo_clovek(:'tenant', :'zdenek', 'communication.read'));

insert into public.announcements (tenant_id, branch_id, body, author_id)
values (:'tenant', :'p62', 'Krok62: zítra inventura.', :'sef')
returning id as oz62 \gset

select pg_temp.check('KLADNĚ: Zdeněk (smí číst) upozornění na oznámení dostal',
  exists (select 1 from public.notifications
           where user_id = '62620000-0000-0000-0000-00000000000c'
             and druh = 'oznameni.nova' and zdroj_id = :'oz62'));
select pg_temp.check('Xenie (nesmí číst) upozornění na oznámení nedostala',
  not exists (select 1 from public.notifications
               where user_id = '62620000-0000-0000-0000-00000000000a'
                 and druh = 'oznameni.nova' and zdroj_id = :'oz62'));

select pg_temp.check('u tabulky oznámení je poznámka, co na Nástěnku nepatří',
  obj_description('public.announcements'::regclass, 'pg_class') like '%NEPATŘÍ sem osobní dokumenty%');


\echo ''
\echo '== 8. Kdy kdo kanál otevřel a dočetl, nepřečte nikdo cizí =='

-- Xenie má v kanálu úseku A řádek se záložkou (oddíl 1) — `pridan_kdy`
-- je u kanálu čas, kdy si ho poprvé otevřela, `precteno_do` kam dočetla.
-- Zdeněk je v úseku A, takže mu RLS (je_ucastnik) řádky kanálu pustí.
-- Přečíst z nich smí jen to, kdo v kanálu je, ne KDY.
--
-- Proč i `pridan_kdy`: v čisté databázi (CI, PGlite) nemá authenticated
-- tabulkové select ani bez oddílu 10 migrace — `precteno_do` by tu prošlo
-- vždycky. `pridan_kdy` ale dostal sloupcový grant 3. 9., takže bez
-- oddílu 10 spadne kontrola níž i tady. (Ověřeno rozbitím 28. 9.)

select pg_temp.check('authenticated nemá na konverzace_ucastnici tabulkové SELECT',
  not has_table_privilege('authenticated', 'public.konverzace_ucastnici', 'SELECT'));
select pg_temp.check('ani sloupcové na precteno_do (kam kdo dočetl)',
  not has_column_privilege('authenticated', 'public.konverzace_ucastnici', 'precteno_do', 'SELECT'));
select pg_temp.check('ani na pridan_kdy (u kanálu čas prvního otevření)',
  not has_column_privilege('authenticated', 'public.konverzace_ucastnici', 'pridan_kdy', 'SELECT'));
select pg_temp.check('KLADNĚ: konverzace_id, employee_id a odesel_kdy číst jde (detail rozhovoru)',
  has_column_privilege('authenticated', 'public.konverzace_ucastnici', 'konverzace_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.konverzace_ucastnici', 'employee_id', 'SELECT')
  and has_column_privilege('authenticated', 'public.konverzace_ucastnici', 'odesel_kdy', 'SELECT'));

select set_config('test.xenie', :'xenie', false);
select set_config('test.user_id', '62620000-0000-0000-0000-00000000000c', false);
set role authenticated;
do $$
declare v_ok boolean;
begin
  v_ok := false;
  begin
    perform u.pridan_kdy from public.konverzace_ucastnici u
     where u.konverzace_id = current_setting('test.kanal_a')::uuid
       and u.employee_id   = current_setting('test.xenie')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: Zdeněk přečetl, kdy si Xenie kanál poprvé otevřela (pridan_kdy)'; end if;
  raise notice '  OK    Zdeněk nepřečte, kdy si Xenie kanál poprvé otevřela (pridan_kdy)';

  v_ok := false;
  begin
    perform u.precteno_do from public.konverzace_ucastnici u
     where u.konverzace_id = current_setting('test.kanal_a')::uuid
       and u.employee_id   = current_setting('test.xenie')::uuid;
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: Zdeněk přečetl, kam Xenie v kanálu dočetla (precteno_do)'; end if;
  raise notice '  OK    ani kam v kanálu dočetla (precteno_do)';
end $$;
reset role;

-- Kladná strana: detail rozhovoru čte účastníky přesně takhle (osobní
-- rozhovor z oddílu 6, Yvona + Xenie).
select set_config('test.user_id', '62620000-0000-0000-0000-00000000000b', false);
set role authenticated;
select pg_temp.check('KLADNĚ: Yvona přečte, kdo je v jejím osobním rozhovoru (employee_id)',
  (select count(*) from public.konverzace_ucastnici
    where konverzace_id = :'osobni' and odesel_kdy is null) = 2);
reset role;


\echo ''
\echo '== 9. Nástěnka: urgovat a adresovat jen ty, kdo ji čtou ===='

-- Pobočka 62 je domovská pro Xenii, Yvonu a Zdeňka; číst Nástěnku smí
-- jen Zdeněk (oddíl 7). Oznámení s „Beru na vědomí" píše majitel.
insert into public.announcements (tenant_id, branch_id, body, author_id, requires_acknowledgment)
values (:'tenant', :'p62', 'Krok62: potvrďte, že víte o inventuře.', :'sef', true)
returning id as oz62_potvrdit \gset

select set_config('test.user_id', :'sef', false);
set role authenticated;
select pg_temp.check('„Nepotvrdili" má jen Zdeňka — Xenie a Yvona Nástěnku nečtou',
  (select count(*) from public.kdo_nepotvrdil(:'tenant', :'oz62_potvrdit')) = 1
  and exists (select 1 from public.kdo_nepotvrdil(:'tenant', :'oz62_potvrdit') where jmeno like 'Zdeněk%'));
select pg_temp.check('výběr „Konkrétní člověk": ze čtyř lidí jen Zdeněk (ctenari_nastenky)',
  (select array_agg(employee_id) from public.ctenari_nastenky(:'tenant',
     array[:'xenie', :'yvona', :'zdenek', :'wanda']::uuid[])) = array[:'zdenek']::uuid[]);
reset role;

select set_config('test.user_id', '62620000-0000-0000-0000-00000000000c', false);
set role authenticated;
select pg_temp.check('bez communication.manage vrátí ctenari_nastenky prázdno (Zdeněk jen čte)',
  not exists (select 1 from public.ctenari_nastenky(:'tenant', array[:'zdenek']::uuid[])));
reset role;

select set_config('test.user_id', '', false);
set role anon;
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.ctenari_nastenky(gen_random_uuid(), '{}'::uuid[]);
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: anon smí volat ctenari_nastenky'; end if;
  raise notice '  OK    anon ctenari_nastenky volat nesmí';
end $$;
reset role;


\echo ''
\echo '== KROK 62 HOTOV =========================================='
