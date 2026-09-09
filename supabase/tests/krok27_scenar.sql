-- Scénář pro krok 27 — zadání úkolu na pracoviště, pozici a člověku.
--
-- Pokrývá migraci 20260906040000_zadani_ukolu a zadání
-- docs/nocni-prace-komunikace-2026-09-05.md, krok C.
--
-- Navazuje na etapa0_scenar.sql až krok26_scenar.sql.
--
-- ---------------------------------------------------------------------
-- NA ČEM TO STOJÍ
--
-- Dvě věci, u kterých se svět chová opačně než my, a obojí schválně:
--
-- 1. ÚKOL PO TERMÍNU NEZMIZÍ. 7shifts ho po dvou hodinách skryje. Úkol,
--    který se ztratí z očí, nikdo nedodělá — a pozdě zapsaná teplota
--    lednice je pořád lepší než žádná. Zůstane vidět, jde splnit,
--    a že bylo pozdě, se zapíše.
--
-- 2. JEDEN CÍL NA ÚKOL. Víc adresátů = víc úkolů. Hlídá to databáze,
--    ne formulář: přepínač na obrazovce se dá obejít jedním requestem.
--
-- A jedna věc, která se dnes v noci NEUDĚLALA a je to vidět i tady:
-- jmenovité přiřazení je pořád ZÁMEK, ne štítek. Uvolnění by shodilo
-- kontrolu „číšník zavřel cizí úkol" v krok3_scenar, což je cizí
-- soubor. Oddíl 5 tenhle stav popisuje pravdivě, aby se ráno vědělo,
-- co platí — až se to uvolní, spadne a bude se muset přepsat.

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

select user_id as sef  from public.profiles where email = 'majitel@foodtab.cz' \gset
select user_id as cizi from public.profiles where email = 'cizi@jinafirma.cz' \gset

-- Úsek a pozice, na které se bude cílit. Úseky vznikly v kroku D.
insert into public.useky (tenant_id, branch_id, nazev, poradi)
values (:'tenant', null, 'Zahrádka', 70)
on conflict do nothing;
select id as zahradka from public.useky
 where tenant_id = :'tenant' and nazev = 'Zahrádka' \gset

insert into public.positions (tenant_id, key, label, department)
values (:'tenant', 'zahradnik', 'Zahradník', 'servis')
on conflict (tenant_id, key) do nothing;
select id as pozice from public.positions
 where tenant_id = :'tenant' and key = 'zahradnik' \gset

/*
  Zařazení Zahradník nese od přepnutí i OPRÁVNĚNÍ, ne jen jméno.
  Gita měla práva z role Kuchyně; ta po přepnutí nedává nic, takže
  se táž sada připisuje jejímu zařazení. Bez toho by neviděla ani
  vlastní úkol a kontroly níž by měřily prázdno.
*/
select set_config('test.user_id', '', false);
insert into public.position_permissions (tenant_id, position_id, permission_key)
select :'tenant', :'pozice', pp.permission_key
from public.position_permissions pp
join public.positions po on po.id = pp.position_id and po.key = 'kuchyne'
where pp.tenant_id = :'tenant'
on conflict do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('9999aaaa-0000-0000-0000-000000000009', 'gita@foodtab.cz', '{"full_name":"Gita Zahradní"}');
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '9999aaaa-0000-0000-0000-000000000009', :'pozice',
        'Gita Zahradní', 'hpp');
select id as gita from public.employees
 where user_id = '9999aaaa-0000-0000-0000-000000000009' \gset

insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '9999aaaa-0000-0000-0000-000000000009', null, 'branch', 'active');
select id as clen_gita from public.memberships
 where user_id = '9999aaaa-0000-0000-0000-000000000009' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_gita', :'perla');

select set_config('test.tenant', :'tenant', false);
select set_config('test.perla', :'perla', false);
select set_config('test.zahradka', :'zahradka', false);
select set_config('test.pozice', :'pozice', false);
select set_config('test.gita', :'gita', false);


\echo ''
\echo '== 1. Čtyři adresáti, každý má kam zapsat =============='

/*
  Zadání tvrdilo, že tabulka tvar adresáta má. Pro „celá pobočka"
  a „člověk" to platilo; pro „úsek" a „pozici" ne. `tasks.role_id`
  totiž ukazuje na `roles`, což jsou v téhle aplikaci OPRÁVNĚNÍ
  (Majitel, Provozní), ne pozice — a brigádník má pozici a žádné
  oprávnění. Bez těch dvou sloupců by se „KOMU: pozice" nedalo uložit.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;

insert into public.tasks (tenant_id, branch_id, title, note, due_at, priority)
values (:'tenant', :'perla', 'Zamést celou pobočku', '', now() + interval '2 hours', 'normal')
returning id as t_pobocka \gset

insert into public.tasks (tenant_id, branch_id, title, usek_id, due_at)
values (:'tenant', :'perla', 'Zalít muškáty', :'zahradka', now() + interval '2 hours')
returning id as t_usek \gset

insert into public.tasks (tenant_id, branch_id, title, position_id, due_at)
values (:'tenant', :'perla', 'Převzít sazenice', :'pozice', now() + interval '2 hours')
returning id as t_pozice \gset

insert into public.tasks (tenant_id, branch_id, title, employee_id, due_at)
values (:'tenant', :'perla', 'Objednat hlínu', :'gita', now() + interval '2 hours')
returning id as t_clovek \gset

select pg_temp.check('úkol na celou pobočku bez adresáta',
  (select num_nonnulls(usek_id, position_id, employee_id, role_id)
   from public.tasks where id = :'t_pobocka') = 0);
select pg_temp.check('úkol na úsek se uložil na úsek',
  (select usek_id from public.tasks where id = :'t_usek') = :'zahradka');
select pg_temp.check('úkol na pozici míří na positions, ne na roles',
  (select position_id from public.tasks where id = :'t_pozice') = :'pozice');
select pg_temp.check('úkol na člověka míří na employees',
  (select employee_id from public.tasks where id = :'t_clovek') = :'gita');

reset role;


\echo ''
\echo '== 2. Jeden cíl na úkol, hlídá to databáze ============='

/*
  Formulář je přepínač, takže dva cíle „poslat nejde". Jenže rozhraní
  se dá obejít jedním requestem — a druhá obranná linie je přesně od
  toho, aby na formulář nespoléhala.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.tasks (tenant_id, branch_id, title, usek_id, employee_id)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'Dva cíle najednou', current_setting('test.zahradka')::uuid,
            current_setting('test.gita')::uuid);
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: úkol se dvěma cíli prošel'; end if;
  raise notice '  OK    úkol se dvěma cíli neprojde';
end $$;

do $$
declare v_ok boolean := false;
begin
  begin
    insert into public.tasks (tenant_id, branch_id, title, position_id, role_id)
    values (current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
            'Pozice i oprávnění', current_setting('test.pozice')::uuid,
            (select id from public.roles
             where tenant_id = current_setting('test.tenant')::uuid and key = 'kuchyne'));
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: pozice a oprávnění najednou prošly'; end if;
  raise notice '  OK    ani pozice a oprávnění najednou';
end $$;

reset role;


\echo ''
\echo '== 3. Úkol po termínu nezmizí a jde splnit ============='

/*
  Tohle je to místo, kde se schválně NEPŘEBÍRÁ, co dělá 7shifts (úkol
  po dvou hodinách skryje). Úkol, který se ztratí z očí, nikdo
  nedodělá.
*/

reset role;
update public.tasks set due_at = now() - interval '3 hours' where id = :'t_pobocka';

select set_config('test.user_id', '9999aaaa-0000-0000-0000-000000000009', false);
set role authenticated;

select pg_temp.check('úkol po termínu je pořád vidět',
  exists (select 1 from public.tasks
          where id = :'t_pobocka' and status = 'open'));

select public.complete_task(:'t_pobocka');

select pg_temp.check('a jde splnit',
  (select status from public.tasks where id = :'t_pobocka') = 'done');

reset role;

select pg_temp.check('pozdní splnění je v auditu označené',
  exists (select 1 from public.audit_log
          where action = 'task.done_pozde'
            and entity_id = :'t_pobocka'
            and (after ->> 'pozde')::boolean = true));

select pg_temp.check('a je u něj, o kolik minut se to přetáhlo',
  (select (after ->> 'po_termine_minut')::int from public.audit_log
   where action = 'task.done_pozde' and entity_id = :'t_pobocka') >= 179);

-- Úkol splněný včas se jako pozdní NEOZNAČÍ. Bez téhle kontroly by
-- „pozdě" mohlo být napevno true a nikdo by si toho nevšiml.
select set_config('test.user_id', '9999aaaa-0000-0000-0000-000000000009', false);
set role authenticated;
select public.complete_task(:'t_clovek');
reset role;

select pg_temp.check('včasné splnění se jako pozdní neoznačí',
  exists (select 1 from public.audit_log
          where action = 'task.done' and entity_id = :'t_clovek'
            and (after ->> 'pozde')::boolean = false));


\echo ''
\echo '== 4. Kdo splnil, se zapisuje vždycky =================='

/*
  Tohle je ta polovina, která se uvolněním zámku NESMÍ ztratit: až
  bude úkol se štítkem „Anna" smět splnit kdokoli, je `done_by`
  jediné, co drží odpovědnost.
*/

select pg_temp.check('done_by sedí na toho, kdo úkol splnil',
  (select done_by from public.tasks where id = :'t_clovek') = :'gita');
select pg_temp.check('done_at se vyplnil',
  (select done_at is not null from public.tasks where id = :'t_clovek'));
select pg_temp.check('audit ví, kdo splnil, i na koho zněl štítek',
  exists (select 1 from public.audit_log
          where entity_id = :'t_clovek'
            and after ->> 'splnil' = :'gita'
            and after ->> 'stitek_na' = :'gita'));


\echo ''
\echo '== 5. Jmenovité přiřazení je štítek, ne zámek =========='

/*
  6. 9. 2026 se pravidlo OBRÁTILO a tenhle oddíl s ním.

  Do té doby tu stálo, že cizí jmenovitý úkol kolega nezavře, a byla
  u toho poznámka, že se to nezměnilo jen proto, že by to shodilo
  kontrolu v cizím scénáři. Šéfík obojí odblokoval
  (docs/odpovedi-na-nocni-praci-2026-09-06.md) a `krok3_scenar` je
  přepsaný v témže commitu jako `20260906060000_stitek_ne_zamek.sql`.

  Měří se teď to, na čem po uvolnění zámku všechno stojí: kolega úkol
  zavřít SMÍ, ale `done_by` musí sedět na NĚM, ne na tom, komu úkol
  zněl. Kdyby se `done_by` bralo z adresáta, vypadalo by v datech, že
  úkol splnil někdo, kdo u toho nebyl — a to je horší než zámek.
*/

reset role;
insert into public.tasks (tenant_id, branch_id, title, employee_id, due_at)
values (:'tenant', :'perla', 'Jen pro Gitu', :'gita', now() + interval '1 day')
returning id as t_gita \gset
select set_config('test.t_gita', :'t_gita', false);

/*
  KOLEGA MUSÍ BÝT BEZ `tasks.manage`, jinak kontrola neměří nic.

  Platilo to za starého pravidla a platí to i za nového, jen obráceně:
  se `tasks.manage` by úkol zavřel odjakživa jako správce a o štítku by
  to neřeklo nic. Napoprvé tu byla Danuše z krok25 — jenže ta má roli
  `kuchyne`, která `tasks.manage` v šabloně má, a kontrola tak měřila
  oprávnění správce, ne pravidlo.

  Proto `servis`: má `tasks.read`, takže úkol VIDÍ, a nemá
  `tasks.manage`. Přesně ten člověk, o kterém rozhodnutí mluví —
  kolega, co zaskakuje.
*/
select id as z_servis from public.positions
 where tenant_id = :'tenant' and key = 'servis' \gset
select set_config('test.user_id', '', false);

insert into auth.users (id, email, raw_user_meta_data) values
  ('9999bbbb-0000-0000-0000-00000000000b', 'honza@foodtab.cz', '{"full_name":"Honza Číšník"}');
insert into public.employees (tenant_id, branch_id, user_id, position_id, full_name, employment_type)
values (:'tenant', :'perla', '9999bbbb-0000-0000-0000-00000000000b', :'z_servis',
        'Honza Číšník', 'hpp');
insert into public.memberships (tenant_id, user_id, role_id, scope, status)
values (:'tenant', '9999bbbb-0000-0000-0000-00000000000b', null, 'branch', 'active');
select id as clen_honza from public.memberships
 where user_id = '9999bbbb-0000-0000-0000-00000000000b' \gset
insert into public.membership_branches (membership_id, branch_id)
values (:'clen_honza', :'perla');

select id as honza from public.employees
 where user_id = '9999bbbb-0000-0000-0000-00000000000b' \gset

select set_config('test.user_id', '9999bbbb-0000-0000-0000-00000000000b', false);
set role authenticated;

select pg_temp.check('číšník tasks.manage nemá',
  not app.has_access(:'tenant', 'tasks.manage', :'perla'));
select pg_temp.check('ale na ten úkol vidí',
  exists (select 1 from public.tasks where id = :'t_gita'));

select public.complete_task(:'t_gita');

select pg_temp.check('kolega cizí jmenovitý úkol zavřít SMÍ',
  (select status from public.tasks where id = :'t_gita') = 'done');
select pg_temp.check('a done_by sedí na něm, ne na tom, komu úkol zněl',
  (select done_by from public.tasks where id = :'t_gita') = :'honza'
  and (select employee_id from public.tasks where id = :'t_gita') = :'gita');

reset role;

-- A v auditu je vidět obojí: kdo zavřel a na koho zněl štítek. Od
-- uvolnění zámku se ty dva údaje běžně LIŠÍ, takže teprve tady se
-- pozná, jestli se zapisují oba.
select pg_temp.check('audit rozlišuje, kdo splnil a na koho zněl štítek',
  exists (select 1 from public.audit_log
          where entity_id = :'t_gita'
            and after ->> 'splnil' = :'honza'
            and after ->> 'stitek_na' = :'gita'));

-- Úkol na ÚSEK smí zavřít taky každý, kdo ho vidí (odpověď 3): úkol na
-- úsek, který smí zavřít jen někdo, zůstane v pátek večer nesplněný.
reset role;
insert into public.tasks (tenant_id, branch_id, title, usek_id, due_at)
values (:'tenant', :'perla', 'Zamést zahrádku', :'zahradka', now() + interval '1 day')
returning id as t_usek2 \gset

select set_config('test.user_id', '9999bbbb-0000-0000-0000-00000000000b', false);
set role authenticated;
select public.complete_task(:'t_usek2');
select pg_temp.check('úkol na úsek zavře kdokoli, kdo na něj vidí',
  (select status from public.tasks where id = :'t_usek2') = 'done');
reset role;


\echo ''
\echo '== 6. Termín je hodina na zdi, ne okamžik =============='

/*
  Pravidlo 11. Co člověk napíše do políčka, nemá pásmo — dodává ho
  pobočka a převod dělá databáze. Kdyby okamžik vyráběla aplikace přes
  `new Date('…T22:00')`, přečte se ten řetězec v pásmu serveru, a ten
  je na Vercelu v UTC: termín by na obrazovce seděl a v databázi byl
  o dvě hodiny vedle.

  Zkouší se na LETNÍM datu (červenec, +02:00) i na ZIMNÍM (leden,
  +01:00). Jedno datum by nestačilo — posun o pevnou hodinu by prošel
  a chyba by se ukázala až na podzim.
*/

select set_config('test.user_id', :'sef', false);
set role authenticated;

select public.zadat_ukol(:'tenant', :'perla', 'Letní termín', '',
  timestamp '2026-07-15 22:00', 'normal') as t_leto \gset
select public.zadat_ukol(:'tenant', :'perla', 'Zimní termín', '',
  timestamp '2026-01-15 22:00', 'normal') as t_zima \gset

reset role;

select pg_temp.check('letní termín je 22:00 v pásmu pobočky',
  to_char((select due_at from public.tasks where id = :'t_leto')
          at time zone app.zona_pobocky(:'perla'), 'YYYY-MM-DD HH24:MI')
  = '2026-07-15 22:00');
select pg_temp.check('zimní termín je taky 22:00 v pásmu pobočky',
  to_char((select due_at from public.tasks where id = :'t_zima')
          at time zone app.zona_pobocky(:'perla'), 'YYYY-MM-DD HH24:MI')
  = '2026-01-15 22:00');

-- A že to opravdu NENÍ týž posun: v létě +2, v zimě +1. Bez téhle
-- kontroly by prošel i převod, který letní čas nezná.
select pg_temp.check('a posun proti UTC se mezi létem a zimou LIŠÍ',
  to_char((select due_at from public.tasks where id = :'t_leto') at time zone 'UTC', 'HH24')
  <> to_char((select due_at from public.tasks where id = :'t_zima') at time zone 'UTC', 'HH24'));

-- Průzor hlídá jednoho adresáta větou, ne porušením omezení.
select set_config('test.user_id', :'sef', false);
set role authenticated;
do $$
declare v_ok boolean := false; v_text text;
begin
  begin
    perform public.zadat_ukol(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
      'Dva cíle', '', null, 'normal',
      current_setting('test.zahradka')::uuid, null, current_setting('test.gita')::uuid);
  exception when check_violation then
    v_ok := true; get stacked diagnostics v_text = message_text;
  end;
  if not v_ok then raise exception 'SELHALO: průzor pustil dva adresáty'; end if;
  if v_text not like '%jednoho adresáta%' then
    raise exception 'SELHALO: hláška to člověku nevysvětlí: %', v_text;
  end if;
  raise notice '  OK    průzor dva adresáty odmítne větou (%)', v_text;
end $$;

-- Kdo nemá tasks.manage, úkol nezadá.
select set_config('test.user_id', '9999bbbb-0000-0000-0000-00000000000b', false);
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.zadat_ukol(
      current_setting('test.tenant')::uuid, current_setting('test.perla')::uuid,
      'Číšníkův úkol', '', null, 'normal');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: číšník zadal úkol bez tasks.manage'; end if;
  raise notice '  OK    bez tasks.manage se úkol nezadá';
end $$;

reset role;


\echo ''
\echo '== 7. Cizí firma ========================================'

select set_config('test.user_id', :'cizi', false);
set role authenticated;

select pg_temp.check('cizí firma úkoly nevidí',
  (select count(*) from public.tasks where tenant_id = :'tenant') = 0);

do $$
declare v_ok boolean := false;
begin
  begin
    perform public.complete_task(current_setting('test.t_gita')::uuid);
  exception when no_data_found then v_ok := true;
  end;
  if not v_ok then raise exception 'SELHALO: cizí firma zavřela úkol'; end if;
  raise notice '  OK    cizí firma úkol nezavře — a nedozví se ani, že existuje';
end $$;

reset role;


\echo ''
\echo '== KROK 27 HOTOV ========================================'
