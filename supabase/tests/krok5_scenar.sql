-- Scénář pro krok 5 — osobní údaje, vydání rozpisu, ruční docházka.
--
-- Navazuje na etapa0_scenar.sql až krok4_scenar.sql: firma, dvě pobočky
-- a lidé už existují (majitel@foodtab.cz, provozni@, cisnik@, kuchar@,
-- cizi@jinafirma.cz).
--
-- Tyhle tři migrace se dosud ověřovaly jen v PGlite. Tam se běží jako
-- superuživatel a role `authenticated` neexistuje, takže se RLS ani
-- práva ke sloupcům neuplatní — kontrola „kolega telefon nevidí“ tam
-- projde i tehdy, když ho ve skutečnosti vidí každý. Proto se všechno,
-- co stojí na oprávněních, musí ověřit tady, proti opravdovému
-- PostgreSQL a pod rolí `authenticated`.
--
-- Kontroly míří na to, co NEMÁ jít.

\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_name text, p_ok boolean)
returns void language plpgsql as $$
begin
  if p_ok then raise notice '  OK    %', p_name;
  else raise exception 'SELHALO: %', p_name; end if;
end $$;

reset role;

-- Kdo je kdo. Bereme z databáze, ne z hlavy — ale musí se to načíst
-- TEĎ, pod superuživatelem. Kdyby se `profiles` četly až pod rolí
-- `authenticated`, vrátí politika cizí řádek prázdný, do `test.user_id`
-- se uloží NULL a scénář by pak tiše zkoušel nepřihlášeného člověka.
create temporary table lide as
  select email, user_id from public.profiles where email is not null;
grant select on lide to authenticated;

create or replace function pg_temp.uid(p_email text)
returns uuid language sql stable as $$
  select user_id from lide where email = p_email
$$;


\echo ''
\echo '== Osobní údaje — kontakt, souhlas, vzetí na vědomí ======='

-- Telefon a e-mail se z tabulky nepřečtou ani majiteli --------------
do $$
declare v_ok boolean; v_phone text;
begin
  perform set_config('test.user_id', pg_temp.uid('majitel@foodtab.cz')::text, false);
  set local role authenticated;
  begin
    select e.phone into v_phone from public.employees e limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('telefon se z tabulky nepřečte ani majiteli', v_ok);

  begin
    select e.email into v_phone from public.employees e limit 1;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('e-mail se z tabulky nepřečte ani majiteli', v_ok);
end $$;

reset role;

-- Vlastní kontakt si člověk opraví sám, cizí ne --------------------
do $$
declare
  v_tenant uuid;
  v_marek  uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_pocet  integer;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  perform set_config('test.user_id', v_marek::text, false);
  set local role authenticated;

  perform public.set_my_contact(v_tenant, '+420601222333', 'marek@zkouska.cz');

  select count(*) into v_pocet
  from public.employee_contacts(v_tenant) c
  where c.phone = '+420601222333' and c.email = 'marek@zkouska.cz' and c.duvod = 'moje';
  perform pg_temp.check('svůj kontakt si člověk zapíše a vidí ho', v_pocet = 1);

  -- Zápis se týká právě jednoho řádku — vlastního.
  select count(*) into v_pocet
  from public.employee_contacts(v_tenant) c
  where c.phone = '+420601222333';
  perform pg_temp.check('zápisem se nezměnil cizí řádek', v_pocet = 1);

  begin
    perform public.set_my_contact(v_tenant, 'nesmysl', null);
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('telefon v cizím tvaru se odmítne', v_ok);
end $$;

reset role;

-- Kolega telefon nevidí, dokud to ten člověk nepovolí --------------
do $$
declare
  v_tenant uuid;
  v_marek  uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_kuchar uuid := pg_temp.uid('kuchar@foodtab.cz');
  v_pocet  integer;
  v_email  text;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  -- Bez souhlasu
  perform set_config('test.user_id', v_kuchar::text, false);
  set local role authenticated;
  select count(*) into v_pocet
  from public.employee_contacts(v_tenant) c
  where c.employee_id in (select id from public.employees where user_id = v_marek);
  perform pg_temp.check('kolega bez souhlasu kontakt nevidí vůbec', v_pocet = 0);

  -- Souhlas uděluje ten člověk sám
  perform set_config('test.user_id', v_marek::text, false);
  insert into public.consents (tenant_id, user_id, kind, granted)
  values (v_tenant, v_marek, 'kontakt_kolegum', true)
  on conflict (tenant_id, user_id, kind) do update set granted = true;

  -- Po souhlasu: telefon ano, e-mail ne
  perform set_config('test.user_id', v_kuchar::text, false);
  select count(*), max(c.email) into v_pocet, v_email
  from public.employee_contacts(v_tenant) c
  where c.phone = '+420601222333';
  perform pg_temp.check('po souhlasu kolega telefon vidí', v_pocet = 1);
  perform pg_temp.check('e-mail nevidí ani se souhlasem', v_email is null);

  -- Odvolání opravdu něco udělá
  perform set_config('test.user_id', v_marek::text, false);
  update public.consents set granted = false
   where tenant_id = v_tenant and user_id = v_marek and kind = 'kontakt_kolegum';

  perform set_config('test.user_id', v_kuchar::text, false);
  select count(*) into v_pocet
  from public.employee_contacts(v_tenant) c
  where c.phone = '+420601222333';
  perform pg_temp.check('po odvolání kolega telefon zase nevidí', v_pocet = 0);

  -- Souhlas za někoho jiného nejde udělit
  begin
    insert into public.consents (tenant_id, user_id, kind, granted)
    values (v_tenant, v_marek, 'kontakt_kolegum', true);
    v_ok := false;
  exception when others then v_ok := true;
  end;
  perform pg_temp.check('souhlas za kolegu nikdo neudělí', v_ok);
end $$;

reset role;

-- Vzetí na vědomí se nepřepisuje ani nemaže ------------------------
do $$
declare
  v_tenant uuid;
  v_marek  uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_notice uuid;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_notice from public.privacy_notices
   where tenant_id = v_tenant order by verze desc limit 1;
  perform pg_temp.check('firma má informační text (zakládá ho spoušť)', v_notice is not null);

  perform set_config('test.user_id', v_marek::text, false);
  set local role authenticated;

  insert into public.privacy_acknowledgements (tenant_id, user_id, notice_id)
  values (v_tenant, v_marek, v_notice)
  on conflict do nothing;

  begin
    update public.privacy_acknowledgements set user_id = user_id
     where tenant_id = v_tenant;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('vzetí na vědomí se nedá přepsat', v_ok);

  begin
    delete from public.privacy_acknowledgements where tenant_id = v_tenant;
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('vzetí na vědomí se nedá smazat', v_ok);
end $$;

reset role;

-- Cizí firma se přes průzor nedostane nikam ------------------------
do $$
declare v_tenant uuid; v_pocet integer;
begin
  select id into v_tenant from public.tenants limit 1;
  perform set_config('test.user_id', pg_temp.uid('cizi@jinafirma.cz')::text, false);
  set local role authenticated;
  select count(*) into v_pocet from public.employee_contacts(v_tenant);
  perform pg_temp.check('cizí firma přes průzor nedostane žádný kontakt', v_pocet = 0);
end $$;

reset role;


\echo ''
\echo '== Vydání rozpisu a upozornění ============================'

do $$
declare
  v_tenant  uuid;
  v_branch  uuid;
  v_marek_e uuid;
  v_marek   uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_shift   uuid;
  v_zprav   integer;
  v_pocet   integer;
  v_ok      boolean;
begin
  select id into v_tenant from public.tenants limit 1;
  select id, branch_id into v_marek_e, v_branch
  from public.employees where user_id = v_marek;

  -- Čistý stav: tenhle scénář si směnu i upozornění zakládá sám.
  delete from public.notifications where user_id = v_marek;
  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
  values (v_tenant, v_branch, v_marek_e, date '2026-12-01', time '07:30', time '14:00')
  returning id into v_shift;

  -- Kdo nemá shifts.manage, rozpis nevydá
  perform set_config('test.user_id', v_marek::text, false);
  set local role authenticated;
  begin
    perform public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('bez shifts.manage rozpis nevydá ani přímým voláním', v_ok);

  -- Majitel vydá
  perform set_config('test.user_id', pg_temp.uid('majitel@foodtab.cz')::text, false);
  select public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01')
    into v_zprav;
  perform pg_temp.check('vydání nové směny pošle jednu zprávu', v_zprav = 1);

  -- Druhé vydání beze změn nerozešle nic
  select public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01')
    into v_zprav;
  perform pg_temp.check('vydání beze změn nerozešle nic', v_zprav = 0);

  -- Změna času se ohlásí jako změna, ne jako nová směna
  reset role;
  update public.shifts set ends_at = time '22:00' where id = v_shift;
  perform set_config('test.user_id', pg_temp.uid('majitel@foodtab.cz')::text, false);
  set local role authenticated;
  select public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01')
    into v_zprav;
  perform pg_temp.check('změna času pošle zprávu', v_zprav = 1);

  -- Do cizích upozornění se kouká zpod superuživatele: pod rolí
  -- `authenticated` je politika schová i majiteli, a to je správně.
  reset role;
  select count(*) into v_pocet
  from public.notifications n
  where n.user_id = v_marek
    and n.telo -> 'zmeny' @> '[{"zmena": "cas"}]'::jsonb;
  perform pg_temp.check('a hlásí se jako změna času, ne jako nová směna', v_pocet = 1);

  -- Zrušená směna se hlásí jednou, ne při každém dalším vydání
  update public.shifts set status = 'cancelled' where id = v_shift;
  perform set_config('test.user_id', pg_temp.uid('majitel@foodtab.cz')::text, false);
  set local role authenticated;
  select public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01')
    into v_zprav;
  perform pg_temp.check('zrušení směny se ohlásí', v_zprav = 1);

  reset role;
  select count(*) into v_pocet
  from public.notifications n
  where n.user_id = v_marek
    and n.telo -> 'zmeny' @> '[{"zmena": "zrusena"}]'::jsonb;
  perform pg_temp.check('a je označená jako zrušená, ne že zmizí', v_pocet = 1);

  perform set_config('test.user_id', pg_temp.uid('majitel@foodtab.cz')::text, false);
  set local role authenticated;
  select public.vydat_rozpis(v_tenant, v_branch, date '2026-12-01', date '2026-12-01')
    into v_zprav;
  perform pg_temp.check('zrušení se podruhé nehlásí', v_zprav = 0);

  /*
    Tomu, kdo vydává, nechodí nic — ale ptáme se JEN na upozornění
    o rozpisu. Od migrace 20260902030000 chodí upozornění i o přidělení
    členství a oprávnění, takže majitel jich pár má z dřívějších kroků
    a kontrola „nemá žádné" by od té chvíle padala na nesouvisející
    zprávě.
  */
  reset role;
  select count(*) into v_pocet
  from public.notifications n
  where n.user_id = pg_temp.uid('majitel@foodtab.cz')
    and n.druh = 'rozpis.vydan';
  perform pg_temp.check('kdo vydává, upozornění o rozpisu nedostane', v_pocet = 0);
end $$;

reset role;

-- Upozornění je osobní: cizí se nepřečte ani nezaloží --------------
do $$
declare
  v_tenant uuid;
  v_pocet  integer;
  v_ok     boolean;
begin
  select id into v_tenant from public.tenants limit 1;

  perform set_config('test.user_id', pg_temp.uid('provozni@foodtab.cz')::text, false);
  set local role authenticated;

  /*
    Ptáme se na CIZÍ upozornění, ne na všechna. Od migrace
    20260902030000 má i provozní vlastní zprávy (o přidělení oprávnění),
    takže „nevidí žádné" by padalo na tom, že vidí správně ta svoje.
    Vlastnost, o kterou jde, je: nevidí ani jedno cizí.
  */
  select count(*) into v_pocet from public.notifications n
   where n.user_id <> pg_temp.uid('provozni@foodtab.cz');
  perform pg_temp.check('cizí upozornění nepřečte ani provozní', v_pocet = 0);

  begin
    insert into public.notifications (tenant_id, user_id, druh, telo)
    values (v_tenant, pg_temp.uid('cisnik@foodtab.cz'), 'rozpis.vydan', '{}'::jsonb);
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('upozornění si nikdo nevyrobí ručně', v_ok);
end $$;

reset role;


\echo ''
\echo '== Ruční zadání docházky =================================='

do $$
declare
  v_tenant  uuid;
  v_branch  uuid;
  v_marek_e uuid;
  v_marek   uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_majitel uuid := pg_temp.uid('majitel@foodtab.cz');
  v_id      uuid;
  v_kdo     uuid;
  v_ok      boolean;
  v_pocet   integer;
begin
  select id into v_tenant from public.tenants limit 1;
  select id, branch_id into v_marek_e, v_branch
  from public.employees where user_id = v_marek;

  -- Zaměstnanec si ruční záznam sám nezadá
  perform set_config('test.user_id', v_marek::text, false);
  set local role authenticated;
  begin
    insert into public.attendance_events
      (tenant_id, branch_id, employee_id, kind, business_date, source, note)
    values (v_tenant, v_branch, v_marek_e, 'in', current_date, 'manual', 'zapomněl telefon');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('zaměstnanec si ruční záznam sám nezadá', v_ok);

  -- Ruční záznam bez důvodu neprojde
  perform set_config('test.user_id', v_majitel::text, false);
  begin
    insert into public.attendance_events
      (tenant_id, branch_id, employee_id, kind, business_date, source, note)
    values (v_tenant, v_branch, v_marek_e, 'in', current_date, 'manual', '');
    v_ok := false;
  exception when check_violation then v_ok := true;
  end;
  perform pg_temp.check('ruční záznam bez důvodu neprojde', v_ok);

  -- Kdo ho zadal, se nedá podvrhnout
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, business_date, source, note, entered_by)
  values (v_tenant, v_branch, v_marek_e, 'in', current_date, 'manual',
          'zapomněl telefon', v_marek)
  returning id, entered_by into v_id, v_kdo;
  perform pg_temp.check('zadavatel se přepíše z přihlášeného účtu, ne z požadavku',
                        v_kdo = v_majitel);

  -- Ruční záznam je rozeznatelný a je v auditu
  select count(*) into v_pocet from public.attendance_events e
   where e.id = v_id and e.source = 'manual' and length(btrim(e.note)) >= 3;
  perform pg_temp.check('ruční záznam je v datech rozeznatelný', v_pocet = 1);

  reset role;
  select count(*) into v_pocet from public.audit_log a
   where a.action = 'attendance.manual' and a.entity_id = v_id::text;
  perform pg_temp.check('ruční záznam je v auditu', v_pocet = 1);

  /*
    Přímý zápis píchnutí za sebe sama.

    Do 1. 9. tudy vedla díra: zaměstnanec si přímým voláním rozhraní
    založil příchod s libovolným časem, neoznačený, a šel rovnou do
    výpočtu mzdy. Migrace 20260901190000 to zavřela — píchnutí smí
    vzniknout jen platným kódem kiosku nebo PINem na registrovaném
    zařízení.

    Kontrola proto od té chvíle ověřuje opak než dřív: že to NEJDE.
  */
  perform set_config('test.user_id', v_marek::text, false);
  set local role authenticated;
  begin
    insert into public.attendance_events
      (tenant_id, branch_id, employee_id, kind, business_date, source)
    values (v_tenant, v_branch, v_marek_e, 'out', current_date, 'app');
    v_ok := false;
  exception when insufficient_privilege then v_ok := true;
  end;
  perform pg_temp.check('zaměstnanec si píchnutí přímým zápisem nezaloží', v_ok);

  -- Že u píchnutí zůstane zadavatel prázdný, se ověří na záznamu
  -- založeném zpod superuživatele — jako by přišel z kiosku.
  reset role;
  -- Čas se zadává výslovně. Všechno v jedné transakci má stejné now(),
  -- takže by příchod a odchod měly totožný okamžik a nešly by spárovat —
  -- kontrola nedokončené docházky níž by pak našla o jeden záznam víc.
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, occurred_at, business_date, source)
  values (v_tenant, v_branch, v_marek_e, 'out',
          now() + interval '1 minute', current_date, 'app')
  returning id, entered_by into v_id, v_kdo;
  perform pg_temp.check('u píchnutí zůstane zadavatel prázdný', v_kdo is null);

  reset role;
  select count(*) into v_pocet from public.audit_log a where a.entity_id = v_id::text;
  perform pg_temp.check('píchnutí se neaudituje (jinak by audit zaplavily)', v_pocet = 0);
end $$;


\echo ''
\echo '== Opravy po kontrole 1. 9. ==============================='
-- docs/opravy-po-kontrole-2026-09-01.md
--
-- Bod 1: nabídka ručního zápisu vznikla dvakrát ze špatného zdroje —
-- poprvé z dnešních událostí, podruhé z domovské pobočky. Kdo na
-- pobočce jen zaskakuje a zapomene telefon, je nejpravděpodobnější
-- případ ze všech, a v nabídce nebyl.
--
-- Bod 2: příchod bez odchodu se do mzdy nezapočítá (to je správně,
-- z vymyšleného času odchodu by se počítala mzda), ale nebylo to nikde
-- vidět. Tichá nula je horší než chyba.

do $$
declare
  v_tenant   uuid;
  v_domovska uuid;
  v_cizi     uuid;
  v_zaskok   uuid;
  v_majitel  uuid := pg_temp.uid('majitel@foodtab.cz');
  v_marek    uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_marek_e  uuid;
  v_pocet    integer;
  v_jmena    text;
begin
  select id into v_tenant from public.tenants limit 1;
  select id into v_domovska from public.branches where slug = 'cerna-perla';
  select id into v_cizi     from public.branches where slug = 'bernard-bar';
  select id into v_marek_e  from public.employees where user_id = v_marek;

  -- Člověk s domovskou pobočkou Perla, který má směnu na Bernardu.
  insert into public.employees (tenant_id, branch_id, full_name)
  values (v_tenant, v_domovska, 'Zaskakující Zkouška')
  returning id into v_zaskok;

  insert into public.shifts (tenant_id, branch_id, employee_id, shift_date, starts_at, ends_at)
  values (v_tenant, v_cizi, v_zaskok, current_date, '14:00', '22:00');

  perform set_config('test.user_id', v_majitel::text, false);
  set local role authenticated;

  -- 1. Kdo má na pobočce směnu, je v nabídce ručního zápisu, i když tam
  -- nemá domovskou pobočku.
  select string_agg(l.jmeno, ', ' order by l.jmeno) into v_jmena
  from public.lide_pro_pobocku(
    v_tenant, v_cizi, current_date - 7, current_date + 7) l;

  if v_jmena is null or position('Zaskakující Zkouška' in v_jmena) = 0 then
    raise exception
      'SELHALO: kdo má na pobočce směnu, není v nabídce ručního zápisu (%)', v_jmena;
  end if;
  raise notice '  OK    kdo má na pobočce směnu, je v nabídce ručního zápisu';

  -- A je poznat, že tam jen zaskakuje.
  select count(*) into v_pocet
  from public.lide_pro_pobocku(v_tenant, v_cizi, current_date - 7, current_date + 7) l
  where l.jmeno = 'Zaskakující Zkouška' and not l.domovska;
  if v_pocet <> 1 then
    raise exception 'SELHALO: zaskakující se tváří jako domovský';
  end if;
  raise notice '  OK    a je poznat, že tam jen zaskakuje';

  -- Mimo okno se směna nepočítá — nabídka není seznam všech lidí firmy.
  select count(*) into v_pocet
  from public.lide_pro_pobocku(v_tenant, v_cizi, current_date + 60, current_date + 67) l
  where l.jmeno = 'Zaskakující Zkouška';
  if v_pocet <> 0 then
    raise exception 'SELHALO: směna mimo okno se do nabídky počítá';
  end if;
  raise notice '  OK    směna mimo okno se do nabídky nepočítá';

  reset role;
  delete from public.shifts where employee_id = v_zaskok;
  delete from public.employees where id = v_zaskok;
end $$;

-- 2. Otevřený příchod je vidět.
do $$
declare
  v_tenant  uuid;
  v_branch  uuid;
  v_marek   uuid := pg_temp.uid('cisnik@foodtab.cz');
  v_majitel uuid := pg_temp.uid('majitel@foodtab.cz');
  v_marek_e uuid;
  v_pocet   integer;
begin
  select id into v_tenant from public.tenants limit 1;
  select id, branch_id into v_marek_e, v_branch
  from public.employees where user_id = v_marek;

  -- Příchod bez odchodu, přesně jako nález z kontroly.
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, occurred_at, business_date)
  values (v_tenant, v_branch, v_marek_e, 'in',
          now() - interval '10 hours', current_date - 1);

  perform set_config('test.user_id', v_majitel::text, false);
  set local role authenticated;
  select count(*) into v_pocet
  from public.nedokoncena_dochazka(v_tenant, current_date - 7, current_date, v_branch) n
  where n.employee_id = v_marek_e
    -- Jen ten, který tenhle test právě založil. Krok 4 nechává schválně
    -- otevřený příchod na 2026-09-02/03 kvůli výdělku a ten se sem
    -- plete: dokud se datum shodovalo s current_date - 1, splynuly do
    -- jednoho řádku a kontrola vycházela náhodou. 5. 9. se rozešly.
    and n.business_date = current_date - 1;
  if v_pocet <> 1 then
    raise exception 'SELHALO: otevřený příchod se nehlásí (%)', v_pocet;
  end if;
  raise notice '  OK    otevřený příchod je vidět vedoucímu';

  -- Vlastní ho člověk vidí i bez attendance.read.
  perform set_config('test.user_id', v_marek::text, false);
  select count(*) into v_pocet
  from public.nedokoncena_dochazka(v_tenant, current_date - 7, current_date, null) n
  where n.employee_id = v_marek_e and n.moje
    -- Zase jen ten dnešní; viz poznámku výš.
    and n.business_date = current_date - 1;
  if v_pocet <> 1 then
    raise exception 'SELHALO: člověk nevidí vlastní nedokončenou docházku';
  end if;
  raise notice '  OK    a člověk vidí i tu svoji';

  -- Dopsaný odchod ho přestane hlásit. Aplikace ho sama nedopisuje —
  -- z vymyšleného času odchodu by se počítala mzda.
  reset role;
  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, occurred_at, business_date, source, note)
  values (v_tenant, v_branch, v_marek_e, 'out',
          now() - interval '2 hours', current_date - 1, 'manual', 'dopsáno vedoucím');

  perform set_config('test.user_id', v_majitel::text, false);
  set local role authenticated;
  select count(*) into v_pocet
  from public.nedokoncena_dochazka(v_tenant, current_date - 7, current_date, v_branch) n
  where n.employee_id = v_marek_e
    -- Zase jen ten dnešní; viz poznámku výš.
    and n.business_date = current_date - 1;
  if v_pocet <> 0 then
    raise exception 'SELHALO: po dopsání odchodu se hlásí dál';
  end if;
  raise notice '  OK    po dopsání odchodu se přestane hlásit';

  reset role;
  delete from public.attendance_events
  where employee_id = v_marek_e and business_date = current_date - 1;
end $$;

-- 3. Jméno se nebere z e-mailu.
do $$
declare v_pocet integer;
begin
  select count(*) into v_pocet from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app' and p.proname = 'create_tenant' and p.pronargs = 5;
  if v_pocet <> 0 then
    raise exception 'SELHALO: stará podoba create_tenant bez jména pořád existuje';
  end if;
  raise notice '  OK    create_tenant bez jména už neexistuje';

  /*
    Poznámky se musí odstranit, jinak kontrola spadne sama na sobě:
    v těle funkce stojí komentář „Žádný split_part(email, '@', 1)"
    a pg_get_functiondef vrací tělo i s komentáři. Hledá se volání,
    ne zmínka.
  */
  if regexp_replace(
       pg_get_functiondef(
         (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'app' and p.proname = 'handle_new_user')
       ), '--[^\n]*', '', 'g'
     ) like '%split_part%' then
    raise exception 'SELHALO: profil se pořád pojmenovává z e-mailu';
  end if;
  raise notice '  OK    profil se z e-mailu nepojmenovává';
end $$;

reset role;

\echo ''
\echo '=========================================================='
\echo ' KROK 5 — VŠECHNY KONTROLY PROŠLY'
\echo '=========================================================='
