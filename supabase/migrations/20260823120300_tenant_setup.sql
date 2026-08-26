-- =====================================================================
-- Foodtab — Etapa 0, krok 1: založení firmy a pozvánky
--
-- Řeší dnešní stav, kdy se na prázdné databázi do aplikace nedostane
-- nikdo. Registrace první firmy je řádná funkce aplikace, ne ruční
-- zásah do databáze.
-- =====================================================================

-- Záměrně bez pgcrypto. Otisk počítá vestavěná sha256() a token skládáme
-- z gen_random_uuid(), obojí je v pg_catalog. Kdybychom sáhli po pgcrypto,
-- museli bychom hádat, ve kterém schématu leží — Supabase ho dává do
-- `extensions`, lokální Postgres do `public` — a funkce se search_path = ''
-- by pak spadly na jednom z těch dvou prostředí.


-- ---------------------------------------------------------------------
-- PROFIL PŘI REGISTRACI
-- Vzniká automaticky, ale k žádné firmě zatím nepatří. Členství vzniká
-- až založením firmy nebo přijetím pozvánky.
-- ---------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := nullif(btrim(lower(new.email)), '');
  v_phone text   := nullif(btrim(new.phone), '');
  v_name  text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    split_part(coalesce(v_email, ''), '@', 1),
    ''
  );

  if v_email is null and v_phone is null then
    return new;
  end if;

  insert into public.profiles (user_id, email, phone, full_name)
  values (new.id, v_email, v_phone, v_name)
  on conflict (user_id) do update
    set email     = coalesce(excluded.email, public.profiles.email),
        phone     = coalesce(excluded.phone, public.profiles.phone),
        full_name = case
                      when btrim(public.profiles.full_name) = ''
                        then excluded.full_name
                      else public.profiles.full_name
                    end;
  return new;
end;
$$;

revoke all on function app.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_foodtab on auth.users;
create trigger on_auth_user_created_foodtab
  after insert on auth.users
  for each row execute function app.handle_new_user();


-- ---------------------------------------------------------------------
-- ZALOŽENÍ FIRMY
--
-- Jedna transakce: firma → základní modul → role ze šablon →
-- členství zakladatele v roli Majitel → jeho zaměstnanecký záznam.
-- Buď proběhne celé, nebo vůbec.
-- ---------------------------------------------------------------------

create or replace function app.create_tenant(
  p_name     text,
  p_ico      text default null,
  p_dic      text default null,
  p_currency char(3) default 'CZK',
  p_timezone text default 'Europe/Prague'
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_tenant   uuid;
  v_owner    uuid;
  v_name     text;
  t          record;
begin
  if v_user is null then
    raise exception 'Založit firmu může jen přihlášený uživatel.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.profiles where user_id = v_user) then
    raise exception 'Účet nemá profil. Dokončete prosím registraci.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'Název firmy je povinný.' using errcode = 'check_violation';
  end if;

  insert into public.tenants (name, legal_name, ico, dic, currency, timezone, created_by)
  values (btrim(p_name), btrim(p_name), nullif(btrim(p_ico), ''),
          nullif(btrim(p_dic), ''), p_currency, p_timezone, v_user)
  returning id into v_tenant;

  -- Základní modul. Ostatní si firma zapne sama.
  insert into public.tenant_modules (tenant_id, module_key, status)
  select v_tenant, m.key, 'active' from public.modules m where m.is_base;

  -- Role vznikají jako kopie šablon. Od téhle chvíle jsou to data firmy
  -- a majitel je může měnit, přejmenovat i smazat.
  for t in
    select rt.key, rt.label, rt.is_owner from app.role_templates rt order by rt.sort_order
  loop
    insert into public.roles (tenant_id, key, label, is_owner, system_template)
    values (v_tenant, t.key, t.label, t.is_owner, t.key);
  end loop;

  insert into public.role_permissions (role_id, permission_key)
  select r.id, rtp.permission_key
  from public.roles r
  join app.role_template_permissions rtp on rtp.template_key = r.system_template
  where r.tenant_id = v_tenant;

  select id into v_owner from public.roles
  where tenant_id = v_tenant and is_owner;

  insert into public.memberships (tenant_id, user_id, role_id, status, scope)
  values (v_tenant, v_user, v_owner, 'active', 'tenant');

  select coalesce(nullif(btrim(full_name), ''), email::text, phone)
    into v_name from public.profiles where user_id = v_user;

  insert into public.employees (tenant_id, user_id, full_name, employment_type)
  values (v_tenant, v_user, coalesce(v_name, 'Majitel'), 'ico');

  perform app.audit(v_tenant, 'tenant.create', 'tenant', v_tenant::text,
                    null, null, jsonb_build_object('name', btrim(p_name)));

  return v_tenant;
end;
$$;

grant execute on function app.create_tenant(text, text, text, char, text) to authenticated;


-- ---------------------------------------------------------------------
-- POZVÁNKY
--
-- Token se vrátí volajícímu právě jednou. V databázi je jen jeho otisk,
-- takže z ní nejde pozvánku zneužít ani při úniku zálohy.
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

grant execute on function
  app.create_invitation(uuid, uuid, text, text, text, uuid[], uuid, int) to authenticated;


-- Přijetí pozvánky. Běží jako SECURITY DEFINER, protože v tu chvíli
-- uživatel ještě k firmě nepatří a politiky by ho nepustily.
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
    set role_id = excluded.role_id,
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

grant execute on function app.accept_invitation(text) to authenticated;
