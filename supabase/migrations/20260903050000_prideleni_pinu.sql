-- =====================================================================
-- Foodtab — přidělení PINu a shoda PINů na pobočce
--
-- Zadání: docs/pin-prideleni-zadani.md.
--
-- ---------------------------------------------------------------------
-- NEJDŘÍV TA CHYBA, KTERÁ TU BYLA UŽ PŘEDTÍM
--
-- Na kiosku se zadává JEN PIN, žádné jméno. PIN tedy člověka
-- IDENTIFIKUJE. `nastavit_pin` dosud hlídal formát a triviálnost, ale
-- ne to, jestli týž PIN už na pobočce někdo nemá.
--
-- Ověřeno spuštěním, ne přečtením: dva lidé si nastavili 4713 a oba
-- zápisy prošly. `app.pin_overit` pak v pěti pokusech z pěti vrátila
-- TUTÉŽ osobu — druhá se nepíchne nikdy a její docházka padá na cizí
-- jméno. Není to teoretická úvaha: u dvanácti lidí a čtyř číslic je
-- pravděpodobnost shody kolem sedmi promile.
--
-- ---------------------------------------------------------------------
-- PROČ SE MNOŽINA LIDÍ VYTAHUJE DO FUNKCE
--
-- Kontrola shody musí koukat PŘESNĚ NA TU MNOŽINU, ve které se pak
-- rozhoduje, kdo píchl. Kdyby `pin_overit` hledala v jedné množině
-- a kontrola shody v jiné, ověřovala by se jiná věc než ta, která
-- padá — a dvě kopie téhož pravidla se vždycky rozejdou.
--
-- Proto `app.pin_lide_pobocky` a obě funkce ji používají.
--
-- ---------------------------------------------------------------------
-- CO ZŮSTÁVÁ
--
-- Otisk se solí, pravidlo 7. Žádné čitelné uložení, žádný průzor
-- „platí/neplatí“, zamykání po nezdarech beze změny, audit ze spouště.
-- =====================================================================


-- ---------------------------------------------------------------------
-- KDO SE NA TÉHLE POBOČCE PÍCHÁ
--
-- Domovští lidé pobočky PLUS ti, kdo tu mají směnu v okně kolem dneška
-- — tedy přesně ti, které kiosek pozná. Zaskakující brigádník musí jít
-- píchnout, a proto se s ním musí počítat i při hlídání shody.
-- ---------------------------------------------------------------------

create or replace function app.pin_lide_pobocky(p_tenant uuid, p_branch uuid)
returns table (employee_id uuid)
language sql stable security definer set search_path = ''
as $$
  select e.id
  from public.employees e
  where e.tenant_id = p_tenant
    and e.deleted_at is null
    and (
      e.branch_id = p_branch
      or exists (
        select 1 from public.shifts s
        where s.employee_id = e.id
          and s.branch_id = p_branch
          and s.shift_date between current_date - 1 and current_date + 1
          and s.status <> 'cancelled'
      )
    );
$$;

comment on function app.pin_lide_pobocky(uuid, uuid) is
  'Koho kiosek téhle pobočky pozná podle PINu. Táž množina se hlídá '
  'proti shodě PINů — jinak by se kontrolovalo něco jiného, než co padá.';

revoke all on function app.pin_lide_pobocky(uuid, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- MÁ TENHLE PIN NA POBOČCE UŽ NĚKDO?
--
-- Otisky jsou solené KAŽDÝ ZVLÁŠŤ, takže se shoda nedá poznat
-- porovnáním otisků. Kandidát se musí přehashovat solí každého člověka
-- zvlášť. U dvanácti lidí je to nic.
--
-- Vrací se jen ano/ne, nikdy čí — hláška nesmí prozradit, komu PIN
-- patří.
-- ---------------------------------------------------------------------

create or replace function app.pin_obsazeny(
  p_tenant   uuid,
  p_branch   uuid,
  p_pin      text,
  p_krome    uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_pins p
    join app.pin_lide_pobocky(p_tenant, p_branch) l on l.employee_id = p.employee_id
    where p.tenant_id = p_tenant
      and (p_krome is null or p.employee_id <> p_krome)
      and p.otisk = app.pin_otisk(p.sul, p_pin)
  );
$$;

comment on function app.pin_obsazeny(uuid, uuid, text, uuid) is
  'Má tenhle PIN na pobočce už někdo? Ano/ne, nikdy čí.';

revoke all on function app.pin_obsazeny(uuid, uuid, text, uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- ROZPOZNÁNÍ NA KIOSKU — beze změny chování, jen sdílená množina
--
-- Přibyla jediná věc: když by PIN seděl dvěma lidem, funkce vrátí
-- `null` a nepíchne NIKOHO. Dřív vracela toho, na kterého narazila
-- naposled, což je náhoda podle pořadí řádků.
--
-- Nastat by to nemělo — nastavení shodu odmítne —, ale zůstat to může
-- ze starých dat nebo když někomu přibude směna na pobočce, kde už
-- někdo týž PIN má. Tichý zápis na cizí jméno je horší než odmítnutí.
-- ---------------------------------------------------------------------

create or replace function app.pin_overit(p_tenant uuid, p_branch uuid, p_pin text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_radek record;
  v_najit uuid := null;
  v_kolik integer := 0;
begin
  for v_radek in
    select p.employee_id, p.sul, p.otisk, p.chyb, p.zamceno_do
    from public.employee_pins p
    join app.pin_lide_pobocky(p_tenant, p_branch) l on l.employee_id = p.employee_id
    where p.tenant_id = p_tenant
  loop
    if v_radek.otisk = app.pin_otisk(v_radek.sul, p_pin) then
      -- Zamčený člověk neprojde ani se správným PINem.
      if v_radek.zamceno_do is not null and v_radek.zamceno_do > now() then
        return null;
      end if;
      v_najit := v_radek.employee_id;
      v_kolik := v_kolik + 1;
    end if;
  end loop;

  /*
    Dva lidé s týmž PINem. Nedá se poznat, kdo u tabletu stojí, takže
    se nepíchne nikdo a je to v auditu — někdo to musí spravit.
  */
  if v_kolik > 1 then
    perform app.audit(p_tenant, 'pin.shoda', 'branch', p_branch::text, p_branch, null, null);
    return null;
  end if;

  if v_najit is not null then
    update public.employee_pins
       set chyb = 0, zamceno_do = null
     where employee_id = v_najit;
    return v_najit;
  end if;

  /*
    Nesedl nikomu. Počítadlo se zvedne VŠEM na té pobočce, protože se
    neví, komu ten pokus patřil — a to je správně: hádající nesmí
    z chování poznat, jestli se aspoň trefil do existujícího PINu.
  */
  update public.employee_pins p
     set chyb = p.chyb + 1,
         zamceno_do = case when p.chyb + 1 >= 5 then now() + interval '5 minutes' else p.zamceno_do end
   from public.employees e
  where e.id = p.employee_id
    and p.tenant_id = p_tenant
    and e.branch_id = p_branch;

  perform app.audit(p_tenant, 'pin.nezdar', 'branch', p_branch::text, p_branch, null, null);

  return null;
end;
$$;

revoke all on function app.pin_overit(uuid, uuid, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- ZAMĚSTNANEC SI PIN ZVOLÍ SÁM — nově s kontrolou shody
-- ---------------------------------------------------------------------

create or replace function public.nastavit_pin(p_tenant uuid, p_pin text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pin    text := btrim(coalesce(p_pin, ''));
  v_emp    uuid;
  v_branch uuid;
  v_sul    text;
begin
  if not app.is_member(p_tenant) then
    raise exception 'K téhle firmě nepatříte.' using errcode = 'insufficient_privilege';
  end if;

  if v_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN musí být 4 až 6 číslic.' using errcode = 'check_violation';
  end if;

  if app.pin_je_trivialni(v_pin) then
    raise exception 'Takový PIN se dá uhodnout. Zvolte jiný než samé stejné číslice nebo řadu.'
      using errcode = 'check_violation';
  end if;

  select e.id, e.branch_id into v_emp, v_branch
  from public.employees e
  where e.tenant_id = p_tenant and e.user_id = (select auth.uid()) and e.deleted_at is null;

  if v_emp is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
  end if;

  -- Hláška NEPROZRAZUJE ČÍ. Kdo hádá, se z ní nesmí dozvědět víc,
  -- než že tenhle PIN nemá volit.
  if v_branch is not null and app.pin_obsazeny(p_tenant, v_branch, v_pin, v_emp) then
    raise exception 'Tenhle PIN už na téhle pobočce někdo má. Zvolte jiný.'
      using errcode = 'unique_violation';
  end if;

  v_sul := replace(gen_random_uuid()::text, '-', '');

  insert into public.employee_pins (employee_id, tenant_id, sul, otisk, chyb, zamceno_do)
  values (v_emp, p_tenant, v_sul, app.pin_otisk(v_sul, v_pin), 0, null)
  on conflict (employee_id) do update
    set sul = excluded.sul,
        otisk = excluded.otisk,
        nastaven_kdy = now(),
        chyb = 0,
        zamceno_do = null;
end;
$$;

revoke all on function public.nastavit_pin(uuid, text) from public, anon;
grant execute on function public.nastavit_pin(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- MAJITEL PŘIDĚLÍ
--
-- Jediná cesta, jak dát PIN BRIGÁDNÍKOVI BEZ ÚČTU — a těch je dnes
-- v aplikaci většina, takže je to ta důležitější půlka.
--
-- Vrací PIN, aby ho obrazovka mohla ukázat JEDNOU. Podruhé už ho
-- nikdo nepřečte: v databázi je jen otisk.
--
-- `p_pin = null` znamená „vygeneruj“. Generuje se tak dlouho, dokud
-- nevyjde volný a netriviální.
-- ---------------------------------------------------------------------

create or replace function public.pridelit_pin(
  p_tenant   uuid,
  p_employee uuid,
  p_pin      text default null
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pin    text := nullif(btrim(coalesce(p_pin, '')), '');
  v_branch uuid;
  v_ucet   uuid;
  v_jmeno  text;
  v_sul    text;
  v_pokus  integer := 0;
  v_meli   boolean;
begin
  select e.branch_id, e.user_id, e.full_name into v_branch, v_ucet, v_jmeno
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  -- Podle práva, ne podle názvu role (pravidlo 2).
  if not app.has_access(p_tenant, 'attendance.manage', v_branch) then
    raise exception 'Přidělit PIN smí jen ten, kdo spravuje docházku téhle pobočky.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_pin is not null then
    if v_pin !~ '^[0-9]{4,6}$' then
      raise exception 'PIN musí být 4 až 6 číslic.' using errcode = 'check_violation';
    end if;
    if app.pin_je_trivialni(v_pin) then
      raise exception 'Takový PIN se dá uhodnout. Zvolte jiný než samé stejné číslice nebo řadu.'
        using errcode = 'check_violation';
    end if;
    if v_branch is not null and app.pin_obsazeny(p_tenant, v_branch, v_pin, p_employee) then
      raise exception 'Tenhle PIN už na téhle pobočce někdo má. Zvolte jiný.'
        using errcode = 'unique_violation';
    end if;
  else
    /*
      Vygenerovat volný. Deset tisíc možností proti hrstce lidí, takže
      se to trefí hned; sto pokusů je pojistka, ne očekávání.
    */
    loop
      v_pokus := v_pokus + 1;
      v_pin := lpad((floor(random() * 10000))::integer::text, 4, '0');
      exit when not app.pin_je_trivialni(v_pin)
            and (v_branch is null or not app.pin_obsazeny(p_tenant, v_branch, v_pin, p_employee));
      if v_pokus > 100 then
        raise exception 'Nepodařilo se vygenerovat volný PIN. Zadejte ho prosím ručně.'
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;

  select exists (select 1 from public.employee_pins where employee_id = p_employee)
    into v_meli;

  v_sul := replace(gen_random_uuid()::text, '-', '');

  insert into public.employee_pins (employee_id, tenant_id, sul, otisk, chyb, zamceno_do)
  values (p_employee, p_tenant, v_sul, app.pin_otisk(v_sul, v_pin), 0, null)
  on conflict (employee_id) do update
    set sul = excluded.sul,
        otisk = excluded.otisk,
        nastaven_kdy = now(),
        chyb = 0,
        zamceno_do = null;

  /*
    Zaměstnanec se to MUSÍ dozvědět. Bez toho by šlo cizí PIN
    přenastavit a tiše používat — a přesně tomu se celé tohle řešení
    vyhýbá (zadání, oddíl 2).

    Posílá se jen tomu, kdo má účet, a jen když si PIN nepřenastavuje
    sám sobě. Brigádník bez účtu upozornění dostat nemůže; jemu ho
    předá vedoucí i s PINem.
  */
  if v_ucet is not null and v_ucet is distinct from (select auth.uid()) then
    insert into public.notifications (tenant_id, user_id, branch_id, druh, telo)
    values (
      p_tenant, v_ucet, v_branch, 'pin.prenastaven',
      jsonb_build_object('jmeno', v_jmeno, 'mel_drive', v_meli)
    );
  end if;

  -- Do auditu jde KDO to udělal, ne jaký PIN to je — o to se stará
  -- spoušť trg_audit_pinu nad tabulkou.
  return v_pin;
end;
$$;

comment on function public.pridelit_pin(uuid, uuid, text) is
  'Majitel přidělí PIN. Vrací ho, aby se ukázal JEDNOU — podruhé už ho '
  'nikdo nepřečte. Prázdný PIN znamená vygenerovat volný.';

revoke all on function public.pridelit_pin(uuid, uuid, text) from public, anon;
grant execute on function public.pridelit_pin(uuid, uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- NÁVRH PINU PRO FORMULÁŘ
--
-- Obrazovka nabídne vygenerovaný PIN, který jde přepsat vlastním.
-- Vrací se NOVÝ náhodný, nikdy ničí existující — z odpovědi se o cizím
-- PINu nedá zjistit nic.
-- ---------------------------------------------------------------------

create or replace function public.navrh_pinu(p_tenant uuid, p_employee uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_pin    text;
  v_pokus  integer := 0;
begin
  select e.branch_id into v_branch
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant and e.deleted_at is null;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'attendance.manage', v_branch) then
    raise exception 'Přidělit PIN smí jen ten, kdo spravuje docházku téhle pobočky.'
      using errcode = 'insufficient_privilege';
  end if;

  loop
    v_pokus := v_pokus + 1;
    v_pin := lpad((floor(random() * 10000))::integer::text, 4, '0');
    exit when not app.pin_je_trivialni(v_pin)
          and (v_branch is null or not app.pin_obsazeny(p_tenant, v_branch, v_pin, p_employee));
    if v_pokus > 100 then
      return null;
    end if;
  end loop;

  return v_pin;
end;
$$;

comment on function public.navrh_pinu(uuid, uuid) is
  'Volný netriviální PIN do formuláře. Nový náhodný, nikdy ničí stávající.';

revoke all on function public.navrh_pinu(uuid, uuid) from public, anon;
grant execute on function public.navrh_pinu(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- ZRUŠENÍ — nově i vlastního
--
-- Dosud směl PIN zrušit jen správce docházky. Jenže obrazovka Mých
-- údajů nabízí „PIN máte nastavený · Změnit · Zrušit“ (zadání, oddíl 2)
-- a zaměstnanec bez attendance.manage by na to tlačítko klikal marně.
--
-- Zrušit vlastní PIN je neškodné: je to jeho vlastní klíč a stejně si
-- ho může kdykoli přenastavit. Cizí zůstává na attendance.manage.
-- ---------------------------------------------------------------------

create or replace function public.zrusit_pin(p_tenant uuid, p_employee uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_branch uuid;
  v_ucet   uuid;
begin
  select e.branch_id, e.user_id into v_branch, v_ucet
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  if v_ucet is distinct from (select auth.uid())
     and not app.has_access(p_tenant, 'attendance.manage', v_branch) then
    raise exception 'Zrušit cizí PIN smí jen správce docházky.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.employee_pins where employee_id = p_employee;

  perform app.audit(p_tenant, 'pin.zruseno', 'employee', p_employee::text, v_branch, null, null);
end;
$$;

revoke all on function public.zrusit_pin(uuid, uuid) from public, anon;
grant execute on function public.zrusit_pin(uuid, uuid) to authenticated;
