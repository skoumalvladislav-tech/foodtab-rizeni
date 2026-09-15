-- Scénář marketing 11 — přesun termínu z kalendáře.
--
-- Zadání: master prompt, oddíl 15 („přesunutí termínu s kontrolou
-- oprávnění a auditním záznamem"). Obrazovka je
-- app/[rozsah]/marketing/kalendar, akce `presunoutTermin`
-- v app/[rozsah]/marketing/akce.ts.
--
-- ---------------------------------------------------------------------
-- CO SE TU DOKAZUJE A PROČ TO NESTAČÍ HLÍDAT V APLIKACI
--
-- Akce si právo `marketing.publish` ověřuje sama. To je první linie.
-- Tenhle scénář je ta DRUHÁ (CLAUDE.md, pravidlo 3): kdyby někdo volal
-- PostgREST přímo mimo obrazovku, musí ho zastavit politika.
--
-- Konkrétně jde o `marketing_publikace_ulohy_write`. Ta se do dneška
-- nikde neověřovala pod omezenou rolí — marketing5 na tabulku sahá,
-- ale jako majitel, kterému politika nic nezakáže. Kontrola, která se
-- pouští jen pod tím, kdo smí všechno, nedokazuje nic.
--
-- ---------------------------------------------------------------------
-- ČAS SE POSOUVÁ O 26 HODIN, NE O 20
--
-- CLAUDE.md, „Testy, které závisí na kalendáři": posun kratší než den
-- vyjde jako jiné datum jen část dne. `krok23_scenar` na tom 6. 9.
-- spadl ve 20:23. Tady se posouvá o 26 hodin, což je jiný kalendářní
-- den vždycky — v poledne i o půlnoci.
--
-- ---------------------------------------------------------------------
-- PRÁVA SE DÁVAJÍ PŘES `employee_permissions`, NE PŘES ROLI
--
-- Napsal jsem to nejdřív tak, že scénář založil roli a přidal jí
-- řádky do `role_permissions`. NEFUNGOVALO TO A NIC NESPADLO — jen
-- `has_access` vracelo false a kontrola hlásila, že přípravkář nesmí
-- ani to, co smět má.
--
-- Důvod: `app.has_access` se od převodu na zařazení
-- (docs/zarazeni-misto-roli.md) na `role_permissions` NEPTÁ. Čte
-- `employee_permissions` (výjimka u konkrétního člověka) a když tam
-- nic není, `position_permissions` (práva zařazení). `role_permissions`
-- je pozůstatek, který v tabulce zůstal a nic neřídí.
--
-- Je to tu napsané proto, že to je past, na kterou se dá naletět
-- znovu: tabulka existuje, insert projde, a teprve autorizace mlčky
-- řekne ne.
--
-- ---------------------------------------------------------------------
-- PŘÍPRAVKÁŘ SE VYRÁBÍ TADY, NE V SEEDU
--
-- V seedu není nikdo, kdo má `marketing.manage` a NEMÁ
-- `marketing.publish` — provozní má obě. Takový člověk je přitom celý
-- smysl téhle kontroly: připravit příspěvek smí, poslat ho ven ne.
-- Dělá se z Danuše dvěma výjimkami a na konci se vrací zpátky.
--
-- ČÍŠNÍK BY NEFUNGOVAL, I KDYŽ TO TAK VYPADÁ. V seedu je sice na Černé
-- Perle a má rozsah na pobočku, jenže jeho členství nemá v
-- `membership_branches` ani jednu pobočku — takže nedosáhne nikam.
-- Scénář by pak procházel z jiného důvodu, než tvrdí: ne „nesmí
-- publikovat", ale „nesmí vůbec nic". Danuše pobočku má.

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

select user_id as provozni from public.profiles where email = 'provozni@foodtab.cz' \gset
select user_id as danuse   from public.profiles where email = 'danuse@foodtab.cz'   \gset
select id as e_provozni from public.employees where user_id = :'provozni' and deleted_at is null \gset

insert into public.tenant_modules (tenant_id, module_key) values (:'tenant', 'marketing')
on conflict do nothing;

-- --------------------------------------------------------------------
-- PŘÍPRAVKÁŘ: smí připravit, nesmí poslat ven
-- --------------------------------------------------------------------

select id as e_danuse from public.employees
 where user_id = :'danuse' and tenant_id = :'tenant' and deleted_at is null \gset

/*
  Dvě výjimky, ne role. `marketing.publish` se schválně NEDÁVÁ —
  zařazení Servis ho nemá, takže stačí mlčet.

  Kontrola, že tím přípravkář opravdu vznikl, je hned za tím. Bez ní
  by celý scénář mohl procházet proto, že ten člověk nemá žádné právo
  — a „nesmí posunout úlohu" by platilo z úplně jiného důvodu, než
  scénář tvrdí. Přesně tahle past je popsaná v CLAUDE.md
  („kontrola procházela, protože se testovaná cesta nikdy nespustila").
*/
insert into public.employee_permissions (tenant_id, employee_id, permission_key, granted)
values (:'tenant', :'e_danuse', 'marketing.read', true),
       (:'tenant', :'e_danuse', 'marketing.manage', true)
on conflict (employee_id, permission_key) do update set granted = excluded.granted;

set role authenticated;
select set_config('test.user_id', :'danuse', false);

select pg_temp.check('přípravkář opravdu SMÍ připravovat marketing',
  app.has_access(:'tenant'::uuid, 'marketing.manage', :'perla'::uuid));

select pg_temp.check('a opravdu NESMÍ publikovat',
  not app.has_access(:'tenant'::uuid, 'marketing.publish', :'perla'::uuid));

reset role;

-- --------------------------------------------------------------------
-- PŘÍSPĚVEK, SCHVÁLENÁ VERZE A NAPLÁNOVANÁ PUBLIKACE
-- --------------------------------------------------------------------

insert into public.marketing_prispevky (tenant_id, branch_id, nazev, vytvoril, planovano_na)
values (:'tenant', :'perla', 'Pozvánka na zabijačku', :'e_provozni', now() + interval '3 days')
returning id as prispevek \gset

insert into public.marketing_verze (tenant_id, prispevek_id, cislo, otisk, vytvoril)
values (:'tenant', :'prispevek', 1, 'otisk-K', :'e_provozni')
returning id as verze \gset

insert into public.marketing_schvaleni (tenant_id, prispevek_id, verze_id, otisk_verze, zadal)
values (:'tenant', :'prispevek', :'verze', 'otisk-K', :'e_provozni')
returning id as zadost \gset

-- Schvaluje majitel: o vlastní žádost nerozhoduje ten, kdo ji podal.
select user_id as majitel from public.profiles where email = 'majitel@foodtab.cz' \gset
set role authenticated;
select set_config('test.user_id', :'majitel', false);
update public.marketing_schvaleni set stav = 'schvaleno' where id = :'zadost';
reset role;

insert into public.marketing_publikace_ulohy
  (tenant_id, prispevek_id, verze_id, otisk_verze, schvaleni_id,
   kanal, format, poskytovatel, rezim, planovano_na, idempotencni_klic, vytvoril)
values (:'tenant', :'prispevek', :'verze', 'otisk-K', :'zadost',
        'instagram', 'prispevek', 'mock', 'demo',
        now() + interval '3 days', 'kalendar-presun-1', :'e_provozni')
returning id as uloha \gset

select planovano_na as puvodni_uloha from public.marketing_publikace_ulohy where id = :'uloha' \gset
select planovano_na as puvodni_prispevek from public.marketing_prispevky where id = :'prispevek' \gset

select set_config('test.tenant', :'tenant', false);
select set_config('test.uloha', :'uloha', false);
select set_config('test.prispevek', :'prispevek', false);


\echo ''
\echo '== 1. Kdo nesmí publikovat, termín neposune ================='

/*
  RLS `update` bez práva NEVYHODÍ CHYBU — TICHO ZAHODÍ ŘÁDEK.

  Politika `marketing_publikace_ulohy_write` se uplatní v `using`,
  takže řádek prostě není vidět a `update` změní nula řádků. Kdyby se
  tady čekala výjimka, kontrola by spadla a vypadalo by to, že politika
  nefunguje — přitom by fungovala až moc tiše.

  Právě proto se to měří POČTEM ZMĚNĚNÝCH ŘÁDKŮ a ověřuje se potom
  hodnota v tabulce. Kontrola „nespadlo to" by tady neznamenala nic.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

do $$
declare v_zmeneno integer;
begin
  update public.marketing_publikace_ulohy
     set planovano_na = now() + interval '26 hours'
   where id = current_setting('test.uloha')::uuid;
  get diagnostics v_zmeneno = row_count;

  if v_zmeneno <> 0 then
    raise exception 'SELHALO: přípravkář posunul publikační úlohu (% řádků)', v_zmeneno;
  end if;
  raise notice '  OK    přípravkář publikační úlohu neposunul';
end $$;

reset role;

select pg_temp.check('a v tabulce zůstal původní čas',
  (select planovano_na from public.marketing_publikace_ulohy where id = :'uloha')
    = :'puvodni_uloha'::timestamptz);

/*
  A TEĎ TO PODSTATNÉ: PŘÍSPĚVEK POSUNOUT SMÍ.

  `marketing_prispevky_write` stojí na `marketing.manage` — přípravkář
  ho tedy přepsat může. Kdyby aplikace posouvala jen příspěvek a na
  úlohu zapomněla, projde to i jemu: v kalendáři by byl nový den
  a fronta by poslala v ten starý. Že se úloha posune taky, nehlídá
  databáze — hlídá to `scripts/marketing-kalendar.test.mjs`.

  Je to tu napsané schválně, aby si někdo nemyslel, že tenhle scénář
  dokazuje víc, než dokazuje.
*/
set role authenticated;
select set_config('test.user_id', :'danuse', false);

do $$
declare v_zmeneno integer;
begin
  update public.marketing_prispevky
     set planovano_na = now() + interval '26 hours'
   where id = current_setting('test.prispevek')::uuid;
  get diagnostics v_zmeneno = row_count;

  if v_zmeneno <> 1 then
    raise exception 'SELHALO: přípravkář nemohl posunout ani příspěvek (% řádků)', v_zmeneno;
  end if;
  raise notice '  OK    příspěvek posunout smí — proto na úloze záleží';
end $$;

reset role;

select pg_temp.check('a rozešlo se to: příspěvek má jiný den než fronta',
  (select planovano_na::date from public.marketing_prispevky where id = :'prispevek')
  <> (select planovano_na::date from public.marketing_publikace_ulohy where id = :'uloha'));

-- Uklidí se to zpátky, ať další kontroly měří na srovnaném.
reset role;
update public.marketing_prispevky set planovano_na = :'puvodni_prispevek'::timestamptz
 where id = :'prispevek';


\echo ''
\echo '== 2. Kdo publikovat smí, posune obojí ======================'

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_uloh integer; v_prisp integer;
begin
  update public.marketing_publikace_ulohy
     set planovano_na = now() + interval '26 hours'
   where prispevek_id = current_setting('test.prispevek')::uuid
     and stav in ('naplanovano', 'selhalo');
  get diagnostics v_uloh = row_count;

  update public.marketing_prispevky
     set planovano_na = now() + interval '26 hours'
   where id = current_setting('test.prispevek')::uuid;
  get diagnostics v_prisp = row_count;

  if v_uloh <> 1 or v_prisp <> 1 then
    raise exception 'SELHALO: provozní neposunul obojí (úlohy %, příspěvky %)', v_uloh, v_prisp;
  end if;
  raise notice '  OK    provozní posunul úlohu i příspěvek';
end $$;

reset role;

select pg_temp.check('a obojí sedí na tentýž den',
  (select planovano_na::date from public.marketing_prispevky where id = :'prispevek')
   = (select planovano_na::date from public.marketing_publikace_ulohy where id = :'uloha'));

/*
  Posun je o 26 hodin, takže je to jiný kalendářní den VŽDYCKY — i ve
  23:50. Kdyby tu stálo 20, platila by tahle kontrola jen do osmi večer.
*/
select pg_temp.check('a je to opravdu jiný den než původní',
  (select planovano_na::date from public.marketing_publikace_ulohy where id = :'uloha')
   <> (:'puvodni_uloha'::timestamptz)::date);


\echo ''
\echo '== 3. Co je venku, se nepřesouvá ============================'

/*
  Akce posouvá jen úlohy ve stavu `naplanovano` a `selhalo`. Tady se
  ověřuje, že ten výběr dává smysl i v datech: zveřejněná úloha se do
  něj nechytí, takže se historie nepřepíše.
*/
reset role;
update public.marketing_publikace_ulohy
   set stav = 'zverejneno', zverejneno_kdy = now(), externi_id = 'ig-123'
 where id = :'uloha';

select planovano_na as cas_po_zverejneni from public.marketing_publikace_ulohy where id = :'uloha' \gset

set role authenticated;
select set_config('test.user_id', :'provozni', false);

do $$
declare v_zmeneno integer;
begin
  update public.marketing_publikace_ulohy
     set planovano_na = now() + interval '26 hours'
   where prispevek_id = current_setting('test.prispevek')::uuid
     and stav in ('naplanovano', 'selhalo');
  get diagnostics v_zmeneno = row_count;

  if v_zmeneno <> 0 then
    raise exception 'SELHALO: posunula se i zveřejněná úloha (% řádků)', v_zmeneno;
  end if;
  raise notice '  OK    zveřejněná úloha se výběrem nechytí';
end $$;

reset role;

select pg_temp.check('a čas zveřejněné úlohy se nezměnil',
  (select planovano_na from public.marketing_publikace_ulohy where id = :'uloha')
    = :'cas_po_zverejneni'::timestamptz);


\echo ''
\echo '== 4. Přesun je v auditu ===================================='

/*
  Zadání chce u přesunu auditní záznam. Nepíše ho aplikace — píše ho
  spoušť `trg_audit_marketing_publikace_ulohy`. Ověřuje se proto, že
  změna času opravdu skončila v `audit_log`; kdyby spoušť někdo
  z tabulky sundal, nikde jinde by to nespadlo.
*/
/*
  HLEDÁ SE ZMĚNA TERMÍNU, NE JAKÝKOLI ZÁPIS.

  Napsal jsem to nejdřív jako „existuje řádek s action = 'update'".
  Bylo to špatně dvakrát. Za prvé se `action` jmenuje
  `marketing_publikace_uloha.update`, ne `update` — a to scénář
  poctivě shodil. Za druhé, i kdyby to sedělo, prošlo by to nad
  JAKOUKOLI změnou úlohy: třeba nad tou ze třetí části, kde se
  nastavoval stav `zverejneno`. Kontrola by pak byla zelená, i kdyby
  se přesun do auditu nikdy nedostal.

  Porovnává se proto `before` a `after` a hledá se řádek, ve kterém se
  změnil právě `planovano_na`.
*/
select pg_temp.check('změna termínu úlohy je v auditu',
  exists (select 1 from public.audit_log a
           where a.tenant_id = :'tenant'
             and a.entity_type = 'marketing_publikace_uloha'
             and a.entity_id = :'uloha'
             and a.before ->> 'planovano_na' is distinct from a.after ->> 'planovano_na'));

select pg_temp.check('a změna termínu příspěvku taky',
  exists (select 1 from public.audit_log a
           where a.tenant_id = :'tenant'
             and a.entity_type = 'marketing_prispevek'
             and a.entity_id = :'prispevek'
             and a.before ->> 'planovano_na' is distinct from a.after ->> 'planovano_na'));

/*
  A KDO TO BYL. Auditní záznam bez původce je k ničemu — „někdo to
  posunul" se nedá dohledat. `actor_id` je uživatelský účet, pod
  kterým zápis proběhl.
*/
select pg_temp.check('a je u toho vidět, kdo posouval',
  exists (select 1 from public.audit_log a
           where a.tenant_id = :'tenant'
             and a.entity_type = 'marketing_publikace_uloha'
             and a.entity_id = :'uloha'
             and a.before ->> 'planovano_na' is distinct from a.after ->> 'planovano_na'
             and a.actor_id = :'provozni'));


\echo ''
\echo '== Úklid po sobě ============================================'

reset role;
delete from public.marketing_publikace_ulohy where tenant_id = :'tenant';
delete from public.marketing_schvaleni where tenant_id = :'tenant';
update public.marketing_prispevky set aktualni_verze_id = null, schvalena_verze_id = null
 where tenant_id = :'tenant';
delete from public.marketing_verze where tenant_id = :'tenant';
delete from public.marketing_prispevky where tenant_id = :'tenant';

delete from public.employee_permissions
 where employee_id = :'e_danuse' and permission_key in ('marketing.read', 'marketing.manage');
delete from public.tenant_modules where tenant_id = :'tenant' and module_key = 'marketing';

select pg_temp.check('scénář po sobě uklidil',
  (select count(*) from public.marketing_prispevky where tenant_id = :'tenant') = 0
  and (select count(*) from public.marketing_publikace_ulohy where tenant_id = :'tenant') = 0
  and (select count(*) from public.employee_permissions
        where employee_id = :'e_danuse' and permission_key like 'marketing%') = 0);


\echo ''
\echo '=========================================================='
\echo ' MARKETING 11 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
