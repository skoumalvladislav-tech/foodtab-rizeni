-- =====================================================================
-- Foodtab — nikdo nepřidělí víc, než má sám
--
-- Zadání: docs/pravidlo-neprideluj-vic.md
--
-- `memberships_write` žádala `people.manage`. Kdo zakládá lidi, mohl
-- komukoli — i sobě — přidělit roli Majitel a získat všechno včetně
-- mezd. Zpřísnit to na `settings.manage` nejde: přidělovat role je
-- součást správy lidí a vedoucí přijímající brigádníka mu roli dát
-- musí. Řešením není jiné právo, ale strop.
--
-- Kdo přiděluje roli, musí sám mít všechno, co ta role obsahuje,
-- v rozsahu, který přiděluje.
--
-- Tahle migrace zavírá troje dveře, ne jedny:
--
--   memberships          přidělení role účtu (insert i update)
--   membership_branches  rozšíření rozsahu už přiděleného členství
--   app.create_invitation pozvánka nese roli, jinak je to obchvat
--
-- Na obrazovce je čtvrtá, ale ta je jen pohodlí (pravidlo 3): nabídne
-- se jen to, co projde tady.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SMÍM PŘIDĚLIT TUHLE ROLI?
--
-- Dvě části podle zadání:
--
--   1. Roli s `is_owner` smí přidělit jen vlastník. Majitel obchází
--      katalog oprávnění (dostává všechno z aktivních modulů), takže
--      se nedá porovnávat po položkách.
--
--   2. U ostatních musí být oprávnění přidělované role podmnožinou
--      oprávnění toho, kdo ji přiděluje — ve stejném rozsahu.
--
-- Rozsah je na tom to podstatné. `app.has_access(t, právo, null)`
-- znamená „mám to na firemní úrovni“; s pobočkou „mám to tam“. Vedoucí
-- Bernardu tedy nikomu nedá právo, které sám nemá, ani na Perle.
--
-- Prázdný seznam poboček neprojde omylem: u rozsahu 'branch' se
-- členství samo o sobě nic nedává, dokud se do membership_branches
-- nepřidá pobočka — a tam se ptáme znovu.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- ŽIVÁ PRÁVA ROLE
--
-- Role si nosí i práva z modulů, které firma nemá. Šablona Účetní má
-- třeba `finance.read`, ale bez modulu Finance to nikomu nic neotevře —
-- `app.has_access` takové právo odmítne úplně všem, majitele nevyjímaje.
--
-- Kdyby se strop počítal i z nich, nešla by role Účetní přidělit ani
-- vlastníkovi firmy: chtělo by se po něm právo, které v jeho firmě
-- nikdo mít nemůže. Porovnávají se proto jen práva, která opravdu něco
-- dávají.
--
-- Až firma modul dokoupí, právo obživne — a od té chvíle se do stropu
-- počítá. To je správně: v tu chvíli už něco otevírá.
-- ---------------------------------------------------------------------

create or replace function app.ziva_prava_role(p_tenant uuid, p_role uuid)
returns setof text
language sql stable security definer set search_path = ''
as $$
  select rp.permission_key
  from public.role_permissions rp
  join public.permissions p     on p.key = rp.permission_key
  join public.tenant_modules tm on tm.tenant_id = p_tenant
                               and tm.module_key = p.module_key
  where rp.role_id = p_role
    and tm.status in ('active', 'trial')
    and (tm.valid_until is null or tm.valid_until > now());
$$;

comment on function app.ziva_prava_role(uuid, uuid) is
  'Práva role, která ve firmě opravdu něco otevírají. Práva z modulů, '
  'které firma nemá, se nepočítají — nedávají nikomu nic.';

revoke all on function app.ziva_prava_role(uuid, uuid) from public, anon;
grant execute on function app.ziva_prava_role(uuid, uuid) to authenticated;


create or replace function app.smi_pridelit(
  p_tenant   uuid,
  p_role     uuid,
  p_scope    text,
  p_branches uuid[] default '{}'
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when (select r.is_owner from public.roles r
          where r.id = p_role and r.tenant_id = p_tenant)
    then exists (
      select 1 from public.memberships m
      join public.roles r on r.id = m.role_id
      where m.user_id = (select auth.uid())
        and m.tenant_id = p_tenant
        and m.status = 'active'
        and r.is_owner
    )
    -- Firemní rozsah — a taky rozsah bez vyjmenovaných poboček. Kdo
    -- neřekne kam, žádá o všude: ptáme se proto na firemní úroveň.
    --
    -- Prázdný seznam tu dřív procházel bez jediné otázky. Vypadalo to
    -- neškodně, protože členství bez poboček nikomu nic neotevře — jenže
    -- app.create_invitation posílá 'branch' a '{}' jako VÝCHOZÍ hodnoty,
    -- takže pozvánkou šla přidělit role, kterou přes memberships
    -- přidělit nešlo. Přesně ten obchvat, kvůli kterému je kontrola
    -- v pozvánce.
    when p_scope = 'tenant' or coalesce(array_length(p_branches, 1), 0) = 0
    then not exists (
      select 1 from app.ziva_prava_role(p_tenant, p_role) k
      where not app.has_access(p_tenant, k, null)
    )
    else not exists (
      select 1
      from app.ziva_prava_role(p_tenant, p_role) k
      cross join unnest(p_branches) as b(id)
      where not app.has_access(p_tenant, k, b.id)
    )
  end;
$$;

comment on function app.smi_pridelit(uuid, uuid, text, uuid[]) is
  'Smí přihlášený přidělit tuhle roli v tomhle rozsahu? Strop podle '
  'docs/pravidlo-neprideluj-vic.md: nikdo nepřidělí víc, než má sám.';

revoke all on function app.smi_pridelit(uuid, uuid, text, uuid[]) from public, anon;
grant execute on function app.smi_pridelit(uuid, uuid, text, uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- ČLENSTVÍ
--
-- Politika `for all` se rozpadá na tři. Mazání zůstává na people.manage
-- (odebrat přístup nikoho nepovýší), zakládání a úprava dostávají strop.
--
-- Vlastní členství se neupravuje vůbec — ani vlastníkem. Povyšovat se
-- nemá nikdo a vlastník to nepotřebuje; kdo se chce přeřadit, požádá
-- někoho jiného. Je to jednodušší a bezpečnější než hlídat, o kolik se
-- kdo povýšil.
-- ---------------------------------------------------------------------

drop policy if exists memberships_write on public.memberships;

create policy memberships_insert on public.memberships for insert to authenticated
  with check (
    app.has_access(tenant_id, 'people.manage')
    and app.smi_pridelit(tenant_id, role_id, scope)
  );

create policy memberships_update on public.memberships for update to authenticated
  using (
    app.has_access(tenant_id, 'people.manage')
    and user_id <> (select auth.uid())
    and app.smi_pridelit(tenant_id, role_id, scope)
  )
  with check (
    app.has_access(tenant_id, 'people.manage')
    and user_id <> (select auth.uid())
    and app.smi_pridelit(tenant_id, role_id, scope)
  );

create policy memberships_delete on public.memberships for delete to authenticated
  using (app.has_access(tenant_id, 'people.manage'));


-- ---------------------------------------------------------------------
-- ROZSAH ČLENSTVÍ
--
-- Rozšíření rozsahu už existujícího členství. Ptáme se znovu, tentokrát
-- na tu konkrétní pobočku: kdo roli přidělil se ctí na firemní úrovni,
-- nemusí ji mít i na pobočce, která se doplňuje až teď.
--
-- Dřív tu stálo, že se sem chodí obejít prázdný seznam poboček. Ten
-- obchvat je teď zavřený už v app.smi_pridelit — kdo neřekne kam, žádá
-- o všude. Kontrola tady zůstává jako druhá závora, ne jako jediná.
-- ---------------------------------------------------------------------

drop policy if exists membership_branches_write on public.membership_branches;

create policy membership_branches_write on public.membership_branches for all to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and app.has_access(m.tenant_id, 'people.manage')
        and app.smi_pridelit(m.tenant_id, m.role_id, 'branch', array[branch_id])
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = membership_id
        and app.has_access(m.tenant_id, 'people.manage')
        and app.smi_pridelit(m.tenant_id, m.role_id, 'branch', array[branch_id])
    )
  );


-- ---------------------------------------------------------------------
-- POZVÁNKA
--
-- Na tuhle se zapomíná: kdo nemůže přidělit roli přímo, pošle pozvánku
-- s tou rolí a je ve stejném bodě. Kontrola sedí hned vedle té na
-- people.manage, ať se nedá jedna přidat bez druhé.
--
-- Zbytek funkce se nemění; přepisuje se celá, protože Postgres neumí
-- do těla funkce přidat řádek jinak.
-- ---------------------------------------------------------------------

create or replace function app.create_invitation(
  p_tenant     uuid,
  p_role       uuid,
  p_channel    text,
  p_contact    text,
  p_scope      text default 'branch',
  p_branches   uuid[] default '{}',
  p_employee   uuid default null,
  p_valid_days int default 7
)
returns table (invitation_id uuid, token text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_token     text;
  v_id        uuid;
  v_email     text;
  v_phone     text;
  v_sensitive boolean;
begin
  if not app.has_access(p_tenant, 'people.manage') then
    raise exception 'Zvát zaměstnance může jen správce lidí.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.roles where id = p_role and tenant_id = p_tenant) then
    raise exception 'Role nepatří této firmě.' using errcode = 'foreign_key_violation';
  end if;

  -- Strop podle docs/pravidlo-neprideluj-vic.md. Bez tohohle by se
  -- politika na memberships obešla jednou pozvánkou.
  if not app.smi_pridelit(p_tenant, p_role, p_scope, p_branches) then
    raise exception
      'Tuhle roli nemůžete přidělit — obsahuje oprávnění, která sami nemáte.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_channel = 'email' then
    v_email := nullif(btrim(lower(p_contact)), '');
    if v_email is null or position('@' in v_email) = 0 then
      raise exception 'Neplatná e-mailová adresa.' using errcode = 'check_violation';
    end if;
  elsif p_channel = 'sms' then
    v_phone := nullif(btrim(p_contact), '');
    if v_phone is null or v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      raise exception 'Telefon zadejte v mezinárodním tvaru, například +420601234567.'
        using errcode = 'check_violation';
    end if;

    -- Role s citlivým oprávněním nesmí být přístupná jen přes SMS.
    -- Přenesení čísla na cizí SIM je reálný útok a telefon navíc koluje
    -- po provozovně. Viz §7.1 specifikace.
    select exists (
      select 1 from public.role_permissions rp
      join public.permissions p on p.key = rp.permission_key
      where rp.role_id = p_role and p.sensitive
    ) or exists (select 1 from public.roles where id = p_role and is_owner)
    into v_sensitive;

    if v_sensitive then
      raise exception
        'Role s citlivým oprávněním nejde pozvat přes SMS. Použijte e-mail.'
        using errcode = 'insufficient_privilege';
    end if;
  else
    raise exception 'Neznámý způsob pozvánky: %', p_channel using errcode = 'check_violation';
  end if;

  -- Pobočky musí patřit této firmě, jinak by šlo pozvánkou obejít rozsah.
  if array_length(p_branches, 1) is not null and exists (
    select 1 from unnest(p_branches) bid
    where not exists (select 1 from public.branches b
                      where b.id = bid and b.tenant_id = p_tenant)
  ) then
    raise exception 'Některá z poboček nepatří této firmě.'
      using errcode = 'foreign_key_violation';
  end if;

  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.invitations (
    tenant_id, role_id, employee_id, channel, email, phone,
    scope, branch_ids, token_hash, expires_at, invited_by
  ) values (
    p_tenant, p_role, p_employee, p_channel, v_email, v_phone,
    p_scope, coalesce(p_branches, '{}'),
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    now() + make_interval(days => greatest(p_valid_days, 1)),
    (select auth.uid())
  ) returning id into v_id;

  perform app.audit(p_tenant, 'invitation.create', 'invitation', v_id::text, null, null,
                    jsonb_build_object('channel', p_channel, 'role_id', p_role));

  return query select v_id, v_token;
end;
$$;
