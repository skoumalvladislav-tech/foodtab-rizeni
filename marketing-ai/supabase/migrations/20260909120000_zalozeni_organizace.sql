-- =====================================================================
-- ZALOŽENÍ ORGANIZACE JEN NA POZVÁNKU
--
-- Do teď směl `marketing.create_organization` zavolat každý přihlášený
-- uživatel. V aplikaci na to nikde tlačítko není, jenže u Supabase se
-- funkce dá zavolat i přímo přes PostgREST — stačí platný token
-- kteréhokoli účtu. Kdokoli by si tak v ostré databázi mohl založit
-- vlastní firmu a být v ní vlastníkem.
--
-- Nově platí:
--   * PRVNÍ organizaci na prázdné databázi lze založit bez pozvánky
--     (jinak by nešlo systém vůbec rozjet),
--   * každou další jen s platnou pozvánkou vystavenou na e-mail
--     zakladatele,
--   * pozvánka se ukládá jako OTISK, čitelný token existuje jen
--     v okamžiku vystavení,
--   * pozvánky vystavuje servisní role, ne přihlášený uživatel.
-- =====================================================================

create table marketing.founder_invitations (
  id          uuid primary key default gen_random_uuid(),
  -- Malými písmeny; porovnává se přesně, proto podmínka na sloupci.
  email       text not null check (email = lower(email)),
  -- sha256 hex. Čitelný token se nikdy neukládá.
  token_hash  text not null unique,
  note        text not null default '',
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references marketing.profiles(user_id),
  created_by  uuid references marketing.profiles(user_id),
  created_at  timestamptz not null default now()
);

create index founder_invitations_email_idx on marketing.founder_invitations (email) where used_at is null;

-- Pro `authenticated` NIC — stejně jako u integration_secrets. Sahá se
-- na ni jen funkcemi níž, které běží jako vlastník schématu.
alter table marketing.founder_invitations enable row level security;
grant all on marketing.founder_invitations to service_role;


-- ---------------------------------------------------------------------
-- Vystavení pozvánky. Vrací čitelný token — POPRVÉ A NAPOSLED.
-- ---------------------------------------------------------------------

create function marketing.create_founder_invitation(p_email text, p_note text default '', p_days integer default 14)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  if p_email is null or position('@' in p_email) = 0 then
    raise exception 'Pozvánka potřebuje e-mail' using errcode = 'invalid_parameter_value';
  end if;
  -- Dvě uuid místo gen_random_bytes: rozšíření pgcrypto tu záměrně není.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into marketing.founder_invitations (email, token_hash, note, expires_at, created_by)
  values (lower(btrim(p_email)),
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
          coalesce(p_note, ''),
          now() + make_interval(days => greatest(1, coalesce(p_days, 14))),
          (select auth.uid()));
  return v_token;
end $$;

revoke all on function marketing.create_founder_invitation(text, text, integer) from public;
grant execute on function marketing.create_founder_invitation(text, text, integer) to service_role;


-- ---------------------------------------------------------------------
-- Založení organizace. Stará dvouparametrová podoba se ruší, aby po ní
-- nezůstala otevřená cesta.
-- ---------------------------------------------------------------------

drop function if exists marketing.create_organization(text, text);

create function marketing.create_organization(p_name text, p_slug text, p_invitation_token text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_email    text;
  v_prvni    boolean;
  v_pozvanka uuid;
  v_org      uuid;
  v_role     uuid;
  t          record;
begin
  if v_uid is null then
    raise exception 'Založit organizaci může jen přihlášený uživatel' using errcode = 'insufficient_privilege';
  end if;

  -- Profil musí být dřív než cokoli, co se na něj odkazuje (i zápis
  -- „pozvánku použil tenhle člověk“).
  insert into marketing.profiles (user_id) values (v_uid) on conflict (user_id) do nothing;

  select not exists (select 1 from marketing.organizations) into v_prvni;

  if not v_prvni then
    select lower(btrim(u.email)) into v_email from auth.users u where u.id = v_uid;
    if v_email is null then
      select lower(btrim(p.email)) into v_email from marketing.profiles p where p.user_id = v_uid;
    end if;
    if v_email is null then
      raise exception 'Účet nemá e-mail, na který by pozvánka mohla znít' using errcode = 'insufficient_privilege';
    end if;

    select i.id into v_pozvanka
      from marketing.founder_invitations i
     where i.token_hash = encode(sha256(convert_to(coalesce(p_invitation_token, ''), 'UTF8')), 'hex')
       and i.used_at is null
       and i.expires_at > now()
       and i.email = v_email
     limit 1;

    if v_pozvanka is null then
      raise exception 'Novou organizaci lze založit jen na platnou pozvánku vystavenou na váš e-mail'
        using errcode = 'insufficient_privilege';
    end if;

    update marketing.founder_invitations set used_at = now(), used_by = v_uid where id = v_pozvanka;
  end if;

  insert into marketing.organizations (name, slug) values (p_name, p_slug) returning id into v_org;

  for t in select * from marketing.role_templates order by sort_order loop
    insert into marketing.roles (organization_id, key, name, description, is_owner, sort_order)
    values (v_org, t.key, t.name, t.description, t.is_owner, t.sort_order)
    returning id into v_role;
    insert into marketing.role_permissions (role_id, permission_key)
    select v_role, unnest(t.permissions);
  end loop;

  insert into marketing.memberships (organization_id, user_id, role_id, scope, status)
  select v_org, v_uid, r.id, 'organization', 'active'
  from marketing.roles r where r.organization_id = v_org and r.is_owner;

  perform marketing.audit(v_org, null, 'organization.created', 'organization', v_org::text,
                          jsonb_build_object('name', p_name, 'na_pozvanku', not v_prvni));
  return v_org;
end $$;

grant execute on function marketing.create_organization(text, text, text) to authenticated, service_role;
