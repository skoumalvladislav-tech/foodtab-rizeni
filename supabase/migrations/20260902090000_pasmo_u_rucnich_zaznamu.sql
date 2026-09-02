-- =====================================================================
-- Foodtab — ruční záznam se ukládá v pásmu pobočky
--
-- Nález: docs/nesedi-hodiny-po-rucnim-odchodu.md a odpověď
-- docs/odpoved-na-nalez-casu-2026-09-02.md.
--
-- ---------------------------------------------------------------------
-- CO SE DĚLO
--
-- Ruční zápis posílal `new Date('2026-08-31T22:00').toISOString()`.
-- Ten řetězec nemá pásmo, takže ho JavaScript přečetl v pásmu SERVERU
-- — a na Vercelu je server v UTC. Z „22:00 pražského času“ se uložilo
-- 22:00 UTC, tedy PŮLNOC pražského času.
--
-- Zobrazení mělo tutéž chybu obráceně (`getHours()` v pásmu serveru),
-- takže se to na obrazovce vyrušilo: co se zadalo jako 22:00, se jako
-- 22:00 i ukázalo. Nikdo nic nepoznal — ale minuty i hranice provozního
-- dne se počítaly z instantu, který ležel o dvě hodiny jinde.
--
-- Praktický dopad: každá směna s PÍCHNUTÝM příchodem a RUČNÍM odchodem
-- byla v létě o dvě hodiny delší, než byla. V zimě o hodinu. Chyba šla
-- ve prospěch zaměstnance, takže si nikdo nestěžoval.
--
-- ---------------------------------------------------------------------
-- PROČ SE TO PŘEVÁDÍ TADY, A NE V PROHLÍŽEČI
--
-- Převod „hodiny na zdi“ na okamžik potřebuje pravidla letního času
-- pro to konkrétní datum. Postgres je má a umí `at time zone` správně
-- i na hranici přechodu; v prohlížeči by se to skládalo z `Intl`
-- a offsetů ručně. Navíc pásmo pobočky už databáze zná — a `business_date`
-- se z něj počítá odjakživa. Kdyby se převádělo jinde, byly by to dvě
-- kopie téhož pravidla a rozešly by se.
--
-- Píchnutých záznamů se to netýká vůbec: ty vznikají z `now()`, a to je
-- okamžik, ne hodina na zdi.
-- =====================================================================


-- ---------------------------------------------------------------------
-- PÁSMO POBOČKY NA JEDNOM MÍSTĚ
--
-- Řetězec „pobočka → firma → Europe/Prague“ byl dosud vepsaný uvnitř
-- `app.business_date`. Teď ho potřebují dvě místa, takže má vlastní
-- funkci — jinak se ta druhá kopie dřív nebo později rozejde.
-- ---------------------------------------------------------------------

create or replace function app.zona_pobocky(p_branch uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(b.timezone, t.timezone, 'Europe/Prague')
  from public.branches b
  join public.tenants t on t.id = b.tenant_id
  where b.id = p_branch;
$$;

comment on function app.zona_pobocky(uuid) is
  'Časové pásmo pobočky. Pobočka, jinak firma, jinak Europe/Prague.';

revoke all on function app.zona_pobocky(uuid) from public, anon;
grant execute on function app.zona_pobocky(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- RUČNÍ ZÁZNAM
--
-- `p_kdy` je `timestamp` BEZ pásma schválně: je to hodina na zdi, jak
-- ji člověk napsal do políčka. Pásmo k ní dodá pobočka, ne prohlížeč
-- a ne server.
--
-- Aplikace do `attendance_events` zapisovala přímo. Teď jde přes průzor,
-- aby převod byl na jednom místě a nedal se obejít — a aby bylo kam
-- příště dát odmítnutí odchodu, ke kterému není co zavřít (bod B).
--
-- `source = 'manual'` se nebere z parametru. Kdyby šlo poslat 'app',
-- ruční zápis by se schoval mezi píchnutí.
-- ---------------------------------------------------------------------

create or replace function public.zapsat_rucni_dochazku(
  p_tenant   uuid,
  p_branch   uuid,
  p_employee uuid,
  p_druh     text,
  p_kdy      timestamp,
  p_duvod    text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id   uuid;
  v_zona text;
  v_kdy  timestamptz;
begin
  if not app.has_access(p_tenant, 'attendance.manage', p_branch) then
    raise exception 'Zapisovat docházku ručně smí jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_druh not in ('in', 'out', 'break_start', 'break_end') then
    raise exception 'Neznámý druh záznamu: %', p_druh using errcode = 'check_violation';
  end if;

  if p_kdy is null then
    raise exception 'Vyplňte, kdy se to stalo.' using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) < 3 then
    raise exception 'Napište prosím, proč se záznam zadává ručně. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  v_zona := app.zona_pobocky(p_branch);
  if v_zona is null then
    raise exception 'Pobočka neexistuje.' using errcode = 'no_data_found';
  end if;

  /*
    Tady se z hodiny na zdi stává okamžik. `at time zone` bere pravidla
    letního času pro TO KONKRÉTNÍ DATUM, takže záznam z ledna vyjde
    jinak než záznam z července — a přesně proto se to nesmí dělat
    paušálním posunem.
  */
  v_kdy := p_kdy at time zone v_zona;

  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, source, occurred_at, note)
  values (p_tenant, p_branch, p_employee, p_druh, 'manual', v_kdy, btrim(p_duvod))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text) is
  'Ruční záznam docházky. `p_kdy` je hodina na zdi; pásmo k ní dodá '
  'pobočka. Nikdy ne prohlížeč — ten neví, kde pobočka stojí.';

revoke all on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text)
  from public, anon;
grant execute on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text)
  to authenticated;


-- ---------------------------------------------------------------------
-- OBRAZOVKA MUSÍ VĚDĚT, V JAKÉM PÁSMU TO UKÁZAT
--
-- Dosud dostávala jen pásmo firmy. Časy se ale ukazují u POBOČKY —
-- a firma může mít pobočky ve dvou pásmech dřív, než by se čekalo.
-- ---------------------------------------------------------------------

create or replace function public.my_context(p_tenant uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object(
      'id',       t.id,
      'name',     t.name,
      'currency', t.currency,
      'timezone', t.timezone
    ),
    'membership', jsonb_build_object(
      'scope',  m.scope,
      'status', m.status
    ),
    'role', case when r.id is null then null::jsonb else jsonb_build_object(
      'id',      r.id,
      'key',     r.key,
      'label',   r.label,
      'isOwner', r.is_owner
    ) end,
    -- Všechny moduly, které Foodtab má, s příznakem aktivity. Vypnutý
    -- se v rozcestníku ukáže zašedlý; dovnitř ho stejně nepustí
    -- app.has_access. (Pravidlo č. 5)
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key',    mo.key,
               'label',  mo.label,
               'isBase', mo.is_base,
               'active', tm.tenant_id is not null
             ) order by mo.sort_order)
      from public.modules mo
      left join public.tenant_modules tm
             on tm.module_key = mo.key
            and tm.tenant_id  = t.id
            and tm.status in ('active', 'trial')
            and (tm.valid_until is null or tm.valid_until > now())
    ), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',       b.id,
               'name',     b.name,
               'slug',     b.slug,
               'color',    b.color,
               -- Nově: v čem se u téhle pobočky ukazují časy.
               'timezone', coalesce(b.timezone, t.timezone, 'Europe/Prague')
             ) order by b.name)
      from public.branches b
      where b.tenant_id = t.id
        and b.deleted_at is null
        and b.active
        and b.id in (select app.visible_branch_ids(t.id))
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(p.key order by p.sort_order)
      from public.permissions p
      where app.has_permission(t.id, p.key)
    ), '[]'::jsonb)
  )
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  left join public.roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and t.deleted_at is null;
$$;

revoke all on function public.my_context(uuid) from public, anon;
grant execute on function public.my_context(uuid) to authenticated;
