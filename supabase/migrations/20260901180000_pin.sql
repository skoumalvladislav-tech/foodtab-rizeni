-- =====================================================================
-- Foodtab — PIN ke kiosku
--
-- Zadání: docs/kiosek-pin-zalohy-zadani.md, oddíl 4, bod 2 pořadí.
--
-- PIN JE KLÍČ OD KIOSKU, NE PŘIHLÁŠENÍ DO APLIKACE. Kdo zná PIN, může
-- na registrovaném tabletu píchnout a potvrdit zálohu. Nedostane se tím
-- do aplikace, k rozpisu ani ke mzdám.
--
-- To je podstatné, protože čtyři číslice jsou slabé tajemství: je jich
-- deset tisíc a kolega vidí přes rameno, co ťukáte. Samotný PIN proto
-- nesmí stačit k ničemu — teprve PIN NA TOM SPRÁVNÉM TABLETU něco
-- znamená. Ověřování je schválně jen uvnitř kioskových funkcí; žádný
-- průzor, který by na PIN odpověděl „platí/neplatí“, tu není.
--
-- POZNÁMKA K SÍLE OTISKU: sůl a opakovaná sha256. Pořádná odvozovací
-- funkce (bcrypt, argon2) by znamenala rozšíření Postgresu, a ta
-- CLAUDE.md zakazuje. Opakování zvedne cenu hádání tisíckrát, ale
-- proti někomu, kdo má zálohu databáze, je čtyřmístný PIN slabý pořád.
-- Drží to hlavně vazba na registrované zařízení a zamykání po
-- nezdarech. Je to otázka do ranní zprávy, ne mlčky přijaté řešení.
-- =====================================================================


create table if not exists public.employee_pins (
  employee_id   uuid primary key references public.employees(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sul           text not null,
  otisk         text not null,
  nastaven_kdy  timestamptz not null default now(),
  chyb          integer not null default 0,
  zamceno_do    timestamptz
);

comment on table public.employee_pins is
  'Otisk PINu se solí. Nikdo ho nepřečte, ani majitel — jde ho jen '
  'zneplatnit. Zapomenutý PIN se neposílá, ruší.';

-- Ani otisk, ani sůl se ven nevrací. Aplikace potřebuje vědět jediné:
-- jestli PIN existuje a jestli není zamčeno.
grant select (employee_id, tenant_id, nastaven_kdy, zamceno_do)
  on public.employee_pins to authenticated;

alter table public.employee_pins enable row level security;

-- Vlastní řádek vidí člověk sám (kvůli „PIN máte nastavený“), cizí jen
-- ten, kdo spravuje docházku — musí umět PIN zrušit.
drop policy if exists employee_pins_select on public.employee_pins;
create policy employee_pins_select on public.employee_pins for select to authenticated
  using (
    employee_id in (select e.id from public.employees e where e.user_id = (select auth.uid()))
    or app.has_access(tenant_id, 'attendance.manage')
  );

-- Zapisuje se jedině průzorem. Kdyby šel přímý zápis, dal by se nastavit
-- cizí PIN a s ním potvrdit cizí záloha.
revoke insert, update, delete on public.employee_pins from authenticated;

drop trigger if exists trg_audit_pinu on public.employee_pins;
create trigger trg_audit_pinu
  after insert or update or delete on public.employee_pins
  for each row execute function app.audit_zmenu('pin');


-- ---------------------------------------------------------------------
-- OTISK
--
-- Opakovaná sha256 nad solí a PINem. Počet opakování je pojmenovaný,
-- ať je vidět, že je to volba, a ne náhoda.
-- ---------------------------------------------------------------------

create or replace function app.pin_otisk(p_sul text, p_pin text)
returns text
language plpgsql immutable security definer set search_path = ''
as $$
declare
  v_x text := p_sul || ':' || p_pin;
  i   integer;
begin
  for i in 1..1000 loop
    v_x := encode(sha256(convert_to(v_x, 'UTF8')), 'hex');
  end loop;
  return v_x;
end;
$$;

revoke all on function app.pin_otisk(text, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- CO SE ODMÍTNE
--
-- Zadání jmenuje 1234, 0000 a šest stejných číslic. Zobecňuje se to na
-- „všechny stejné“ a „posloupnost nahoru i dolů“ — 2345 je stejně
-- špatný PIN jako 1234 a odmítnout jen ten jeden by byla formalita.
-- ---------------------------------------------------------------------

create or replace function app.pin_je_trivialni(p_pin text)
returns boolean
language plpgsql immutable security definer set search_path = ''
as $$
declare
  i         integer;
  v_nahoru  boolean := true;
  v_dolu    boolean := true;
  v_stejne  boolean := true;
begin
  for i in 2..length(p_pin) loop
    if substr(p_pin, i, 1) <> substr(p_pin, i - 1, 1) then
      v_stejne := false;
    end if;
    if ascii(substr(p_pin, i, 1)) <> ascii(substr(p_pin, i - 1, 1)) + 1 then
      v_nahoru := false;
    end if;
    if ascii(substr(p_pin, i, 1)) <> ascii(substr(p_pin, i - 1, 1)) - 1 then
      v_dolu := false;
    end if;
  end loop;
  return v_stejne or v_nahoru or v_dolu;
end;
$$;

revoke all on function app.pin_je_trivialni(text) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- VOLBA PINU
--
-- Volí si ho zaměstnanec SÁM. Nikdo mu ho nepřiděluje a nikdo mu ho
-- nesděluje — proto tahle funkce nebere id člověka a vždycky pracuje
-- s přihlášeným.
-- ---------------------------------------------------------------------

create or replace function public.nastavit_pin(p_tenant uuid, p_pin text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pin text := btrim(coalesce(p_pin, ''));
  v_emp uuid;
  v_sul text;
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

  select e.id into v_emp
  from public.employees e
  where e.tenant_id = p_tenant and e.user_id = (select auth.uid()) and e.deleted_at is null;

  if v_emp is null then
    raise exception 'K vašemu účtu není v téhle firmě zaměstnanecký záznam.'
      using errcode = 'no_data_found';
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
-- ZRUŠENÍ PINU
--
-- Zapomenutý PIN se NEPOSÍLÁ, jen ruší. Nový si člověk zadá sám.
-- Kdyby šel PIN nastavit za někoho jiného, dal by se „ztratit“
-- a nastavit cizí — a tím potvrdit cizí zálohu.
-- ---------------------------------------------------------------------

create or replace function public.zrusit_pin(p_tenant uuid, p_employee uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_branch uuid;
begin
  select e.branch_id into v_branch
  from public.employees e
  where e.id = p_employee and e.tenant_id = p_tenant;

  if not found then
    raise exception 'Zaměstnanec nepatří téhle firmě.' using errcode = 'no_data_found';
  end if;

  if not app.has_access(p_tenant, 'attendance.manage', v_branch) then
    raise exception 'Zrušit PIN smí jen správce docházky.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.employee_pins where employee_id = p_employee;

  perform app.audit(p_tenant, 'pin.zruseno', 'employee', p_employee::text, v_branch, null, null);
end;
$$;

revoke all on function public.zrusit_pin(uuid, uuid) from public, anon;
grant execute on function public.zrusit_pin(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- OVĚŘENÍ
--
-- Jen pro kioskové funkce (schéma `app`, nikomu nepřidělené). Vrací
-- employee_id, nebo null.
--
-- Pět chyb = zámek na pár minut a záznam v auditu. Bez toho se čtyři
-- číslice uhádnou za odpoledne.
--
-- Hledá se JEN mezi lidmi té pobočky — cizí PIN nesmí píchnout za
-- jiného člověka na jiné provozovně.
-- ---------------------------------------------------------------------

create or replace function app.pin_overit(p_tenant uuid, p_branch uuid, p_pin text)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_radek record;
  v_najit uuid := null;
begin
  for v_radek in
    select p.employee_id, p.sul, p.otisk, p.chyb, p.zamceno_do
    from public.employee_pins p
    join public.employees e on e.id = p.employee_id
    where p.tenant_id = p_tenant
      and e.deleted_at is null
      and (
        e.branch_id = p_branch
        or exists (
          select 1 from public.shifts s
          where s.employee_id = e.id and s.branch_id = p_branch
            and s.shift_date between current_date - 1 and current_date + 1
            and s.status <> 'cancelled'
        )
      )
  loop
    if v_radek.otisk = app.pin_otisk(v_radek.sul, p_pin) then
      -- Zamčený člověk neprojde ani se správným PINem.
      if v_radek.zamceno_do is not null and v_radek.zamceno_do > now() then
        return null;
      end if;
      update public.employee_pins
         set chyb = 0, zamceno_do = null
       where employee_id = v_radek.employee_id;
      v_najit := v_radek.employee_id;
    end if;
  end loop;

  if v_najit is not null then
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
