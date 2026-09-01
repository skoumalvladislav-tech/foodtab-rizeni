-- =====================================================================
-- Foodtab — pozvánka bez oprávnění
--
-- Zadání: docs/pozvanky-zadani.md, oddíl 6 bod 1.
--
-- Dnes nejde pozvat nikdo. Formulář posílá `p_role: null`, protože se
-- oprávnění na obrazovce zatím nevybírá, a `app.create_invitation` roli
-- vyžaduje — takže požadavek spadne na 23503 dřív, než cokoli udělá.
--
-- Šéfíkovo pořadí je správné a je i bezpečnější než dnešní: nejdřív
-- pozvat, oprávnění až potom. Vede totiž k tomu, že nový člověk
-- nedostane nic, dokud mu to někdo vědomě nepřidělí — místo aby se
-- oprávnění vybíralo dopředu, poslepu, u někoho, kdo možná pozvánku
-- ani nepřijme.
--
-- Oprávnění v pozvánce se NERUŠÍ, jen přestává být povinné. Kdo ví
-- dopředu, koho zve a na co, vybere ho rovnou.
--
-- ---------------------------------------------------------------------
-- CO TO ZNAMENÁ PRO PŘÍSTUP
--
-- Vzniká nový stav: člen firmy BEZ role. Zadání je na to úzkostlivé
-- schválně — „ověřit, ne předpokládat“ — tak co se stane:
--
--   app.has_access      false pro každé právo. Vnitřní `join roles`
--   app.has_permission  na prázdném role_id nevrátí řádek. Nic se
--   app.is_owner        neupravuje, chová se to tak samo.
--
--   app.visible_branch_ids  UPRAVUJE SE. Rozsah je něco jiného než
--     oprávnění: členství se scope = 'tenant' by bez téhle změny
--     vracelo všechny pobočky firmy, takže by člověk bez jediného
--     práva viděl v `branches_select` jejich seznam s adresami. Kdo
--     nemá roli, nemá ani rozsah.
--
--   app.is_member       ZŮSTÁVÁ. Na něm stojí to, co takový člověk
--     mít MÁ: jméno firmy, vlastní údaje, souhlasy, informace
--     o zpracování. Bez toho by po přihlášení nebylo co ukázat.
--
-- Hranice je tedy: „patřím do firmy“ ano, „smím cokoli“ ne.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SLOUPCE SMĚJÍ BÝT PRÁZDNÉ
-- ---------------------------------------------------------------------

alter table public.invitations alter column role_id drop not null;
alter table public.memberships alter column role_id drop not null;

comment on column public.invitations.role_id is
  'Prázdné = pozvánka bez oprávnění. Přidělí se až tomu, kdo pozvánku '
  'opravdu přijme.';

comment on column public.memberships.role_id is
  'Prázdné = člen čeká na přidělení oprávnění. Do aplikace se nedostane: '
  'app.has_access mu vrací nepravdu pro každé právo.';


-- ---------------------------------------------------------------------
-- ROZSAH BEZ ROLE NENÍ ROZSAH
--
-- Mění se jen podmínka `m.role_id is not null` v obou polovinách.
-- Zbytek je původní znění — Postgres neumí do těla funkce přidat řádek
-- jinak než přepsáním celé.
-- ---------------------------------------------------------------------

create or replace function app.visible_branch_ids(p_tenant uuid)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select b.id
  from public.memberships m
  join public.branches b on b.tenant_id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and m.role_id is not null
    and m.scope = 'tenant'
    and b.deleted_at is null
  union
  select mb.branch_id
  from public.memberships m
  join public.membership_branches mb on mb.membership_id = m.id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and m.role_id is not null;
$$;

comment on function app.visible_branch_ids(uuid) is
  'Pobočky, na které přihlášený vidí. Členství bez role nevrací nic — '
  'kdo nemá oprávnění, nemá ani rozsah.';


-- ---------------------------------------------------------------------
-- SEZNAM FIREM
--
-- `join roles` se mění na `left join`: firma se v rozcestníku ukázat
-- MUSÍ, jinak by se člověk po přijetí pozvánky díval na hlášku „účet
-- zatím nepatří k žádné firmě“ a nechápal, co se stalo.
--
-- Klíč a název role jsou prázdný řetězec, ne NULL. Vykreslení je
-- dostane v podobě, kterou umí — a text „čeká na přidělení“ patří na
-- obrazovku, ne do SQL.
-- ---------------------------------------------------------------------

create or replace function public.my_tenants()
returns table (
  tenant_id uuid,
  name      text,
  role_key  text,
  role_label text,
  is_owner  boolean,
  scope     text
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.name,
         coalesce(r.key, ''), coalesce(r.label, ''),
         coalesce(r.is_owner, false), m.scope
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  left join public.roles r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.deleted_at is null
  order by t.name;
$$;

revoke all on function public.my_tenants() from public, anon;
grant execute on function public.my_tenants() to authenticated;


-- ---------------------------------------------------------------------
-- KONTEXT PRO VYKRESLENÍ
--
-- Zase jen `left join` — a `role` je pak prázdné. Ne prázdný objekt
-- s prázdnými řetězci: vykreslení musí poznat rozdíl mezi „role je
-- Číšník“ a „role zatím žádná“, protože ve druhém případě má místo
-- rozcestníku ukázat vysvětlení.
--
-- `permissions` vyjde prázdné samo (app.has_permission), `branches`
-- taky (app.visible_branch_ids výš). Nespoléhá se na to, že si to
-- obrazovka pohlídá.
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
               'id',    b.id,
               'name',  b.name,
               'slug',  b.slug,
               'color', b.color
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


-- ---------------------------------------------------------------------
-- POZVÁNKA
--
-- Podpis se nemění, jen se `p_role` smí poslat prázdné. Nemůže dostat
-- výchozí hodnotu — je druhý v pořadí a `p_channel` s `p_contact` za
-- ním žádnou nemají. Volající proto posílá null výslovně, což je i tak
-- srozumitelnější než vynechaný parametr.
--
-- Co zůstává beze změny, když role zadaná JE:
--   * musí patřit téhle firmě,
--   * platí na ni strop z docs/pravidlo-neprideluj-vic.md,
--   * s citlivým oprávněním nejde poslat přes SMS.
--
-- Pozvánka bez role neotevírá nic, takže ani jedna z těch tří kontrol
-- nemá co kontrolovat. Přeskakují se, ne obcházejí.
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

  if p_role is not null then
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
    --
    -- Pozvánka bez role tímhle neprojde jinak: nenese žádné oprávnění,
    -- takže SMS nedoručí nic citlivého. Citlivé právo se přidělí až
    -- potom, a to už přes memberships, kde platí strop.
    select p_role is not null and (exists (
      select 1 from public.role_permissions rp
      join public.permissions p on p.key = rp.permission_key
      where rp.role_id = p_role and p.sensitive
    ) or exists (select 1 from public.roles where id = p_role and is_owner))
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


-- ---------------------------------------------------------------------
-- PŘIJETÍ POZVÁNKY
--
-- Členství vzniká i bez role. Jediná změna v těle je `coalesce`
-- u konfliktu.
--
-- Bez něj by pozvánka bez role SMAZALA roli, kterou už člověk ve firmě
-- má: `on conflict do update set role_id = excluded.role_id` dosadí
-- prázdno. Vedoucí, který omylem pošle druhou pozvánku kolegovi, který
-- už uvnitř je, by ho tím vyřadil z aplikace — a nikde by nestálo proč.
--
-- Pozvánka s rolí roli pořád přepíše. To je její smysl.
-- ---------------------------------------------------------------------

create or replace function app.accept_invitation(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user   uuid := (select auth.uid());
  v_inv    public.invitations%rowtype;
  v_prof   public.profiles%rowtype;
  v_member uuid;
  v_bid    uuid;
begin
  if v_user is null then
    raise exception 'Nejdřív se přihlaste.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_prof from public.profiles where user_id = v_user;
  if not found then
    raise exception 'Účet nemá profil.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_inv from public.invitations
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');

  if not found then
    raise exception 'Pozvánka neplatí.' using errcode = 'invalid_parameter_value';
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'Pozvánka byla zrušena.' using errcode = 'invalid_parameter_value';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Pozvánka už byla použita.' using errcode = 'invalid_parameter_value';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Pozvánce vypršela platnost. Požádejte o novou.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Pozvánku nelze použít pod jiným kontaktem, než na jaký byla vystavena.
  if v_inv.channel = 'email' and v_prof.email is distinct from v_inv.email then
    raise exception 'Pozvánka byla vystavena na jinou e-mailovou adresu.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_inv.channel = 'sms' and v_prof.phone is distinct from v_inv.phone then
    raise exception 'Pozvánka byla vystavena na jiné telefonní číslo.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (v_inv.tenant_id, v_user, v_inv.role_id, 'active', v_inv.scope)
  on conflict (tenant_id, user_id) do update
    set role_id = coalesce(excluded.role_id, public.memberships.role_id),
        status  = 'active',
        scope   = excluded.scope
  returning id into v_member;

  delete from public.membership_branches where membership_id = v_member;
  foreach v_bid in array coalesce(v_inv.branch_ids, '{}') loop
    insert into public.membership_branches (membership_id, branch_id)
    values (v_member, v_bid) on conflict do nothing;
  end loop;

  -- Zaměstnanecký záznam už mohl existovat bez účtu (brigádník, kterého
  -- se nakonec rozhodli pustit do aplikace). Teď se propojí.
  if v_inv.employee_id is not null then
    update public.employees
      set user_id = v_user
      where id = v_inv.employee_id and tenant_id = v_inv.tenant_id and user_id is null;
  end if;

  update public.invitations
    set accepted_at = now(), accepted_by = v_user
    where id = v_inv.id;

  perform app.audit(v_inv.tenant_id, 'invitation.accept', 'membership', v_member::text);

  return v_inv.tenant_id;
end;
$$;
