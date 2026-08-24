-- =====================================================================
-- Foodtab — Etapa 0, krok 1: autorizace a Row Level Security
--
-- Jedno místo, jedna pravda. Stejné funkce používá aplikace i politiky
-- databáze, takže se kontrola oprávnění nemůže na dvou místech rozejít.
--
-- Přístup platí, jen když jsou splněné VŠECHNY podmínky:
--   modul je aktivní ∧ role má oprávnění ∧ rozsah pokrývá pobočku
--   ∧ členství je aktivní
-- =====================================================================

-- Všechny pomocné funkce jsou SECURITY DEFINER, aby při čtení členství
-- nespouštěly znovu RLS a nevznikla nekonečná rekurze v politikách.


-- ---------------------------------------------------------------------
-- ZÁKLADNÍ DOTAZY
-- ---------------------------------------------------------------------

create or replace function app.is_member(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
  );
$$;


create or replace function app.is_owner(p_tenant uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r on r.id = m.role_id
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and r.is_owner
  );
$$;


-- Vrací pobočky, na které přihlášený uživatel vidí.
-- Rozsah 'tenant' znamená všechny pobočky firmy.
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
    and m.scope = 'tenant'
    and b.deleted_at is null
  union
  select mb.branch_id
  from public.memberships m
  join public.membership_branches mb on mb.membership_id = m.id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active';
$$;


-- ---------------------------------------------------------------------
-- HLAVNÍ KONTROLA
-- ---------------------------------------------------------------------

-- Má uživatel dané oprávnění kdekoli v této firmě?
-- Používá se tam, kde rozsah řeší až samotná politika (typicky u čtení
-- obsahu zveřejněného na firemní úrovni).
create or replace function app.has_permission(p_tenant uuid, p_permission text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r            on r.id = m.role_id
    join public.permissions p      on p.key = p_permission
    join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                  and tm.module_key = p.module_key
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
      and (
        -- Majitel dostává vše, co spadá do aktivních modulů. Jinak by
        -- ho šlo odebráním oprávnění zamknout z vlastní firmy ven.
        r.is_owner
        or exists (
          select 1 from public.role_permissions rp
          where rp.role_id = r.id and rp.permission_key = p_permission
        )
      )
  );
$$;


-- Plná kontrola včetně rozsahu.
--   p_branch = konkrétní pobočka → musí být v rozsahu členství
--   p_branch = NULL (firemní úroveň) → vyžaduje rozsah 'tenant'
create or replace function app.has_access(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid default null
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.roles r            on r.id = m.role_id
    join public.permissions p      on p.key = p_permission
    join public.tenant_modules tm  on tm.tenant_id = m.tenant_id
                                  and tm.module_key = p.module_key
    where m.user_id = (select auth.uid())
      and m.tenant_id = p_tenant
      and m.status = 'active'
      and tm.status in ('active', 'trial')
      and (tm.valid_until is null or tm.valid_until > now())
      and (
        r.is_owner
        or exists (
          select 1 from public.role_permissions rp
          where rp.role_id = r.id and rp.permission_key = p_permission
        )
      )
      and (
        m.scope = 'tenant'
        or (
          p_branch is not null
          and exists (
            select 1 from public.membership_branches mb
            where mb.membership_id = m.id and mb.branch_id = p_branch
          )
        )
      )
  );
$$;

comment on function app.has_access(uuid, text, uuid) is
  'Jediné místo, kde se rozhoduje o přístupu. Volá ji aplikace i RLS.';


-- Pomůcka pro čtení obsahu, který může viset na firemní i pobočkové
-- úrovni: firemní (branch_id IS NULL) vidí každý, kdo má oprávnění,
-- pobočkový jen ten, kdo na tu pobočku vidí.
create or replace function app.can_read_scoped(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.has_permission(p_tenant, p_permission)
     and (p_branch is null or p_branch in (select app.visible_branch_ids(p_tenant)));
$$;


-- ---------------------------------------------------------------------
-- AUDIT
-- Zápis jde výhradně přes tuto funkci. Přímý insert je odepřený, změna
-- a mazání jsou zakázané pravidly na tabulce.
-- ---------------------------------------------------------------------

create or replace function app.audit(
  p_tenant      uuid,
  p_action      text,
  p_entity_type text default null,
  p_entity_id   text default null,
  p_branch      uuid default null,
  p_before      jsonb default null,
  p_after       jsonb default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_label text;
begin
  select coalesce(nullif(btrim(pr.full_name), ''), pr.email::text, pr.phone)
    into v_label
  from public.profiles pr where pr.user_id = v_user;

  insert into public.audit_log (
    tenant_id, actor_type, actor_id, actor_label, action,
    entity_type, entity_id, branch_id, before, after
  ) values (
    p_tenant,
    case when v_user is null then 'system' else 'user' end,
    v_user::text, v_label, p_action,
    p_entity_type, p_entity_id, p_branch, p_before, p_after
  );
end;
$$;

grant execute on function
  app.is_member(uuid),
  app.is_owner(uuid),
  app.visible_branch_ids(uuid),
  app.has_permission(uuid, text),
  app.has_access(uuid, text, uuid),
  app.can_read_scoped(uuid, text, uuid)
to authenticated;

revoke all on function app.audit(uuid, text, text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;


-- =====================================================================
-- ROW LEVEL SECURITY
--
-- Druhá obranná linie. I kdyby se v aplikaci udělala chyba v kontrole
-- oprávnění, databáze cizí data nevydá.
-- =====================================================================

alter table public.tenants             enable row level security;
alter table public.branches            enable row level security;
alter table public.positions           enable row level security;
alter table public.modules             enable row level security;
alter table public.tenant_modules      enable row level security;
alter table public.permissions         enable row level security;
alter table public.roles               enable row level security;
alter table public.role_permissions    enable row level security;
alter table public.profiles            enable row level security;
alter table public.memberships         enable row level security;
alter table public.membership_branches enable row level security;
alter table public.employees           enable row level security;
alter table public.invitations         enable row level security;
alter table public.audit_log           enable row level security;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;


-- --- Firma -----------------------------------------------------------

create policy tenants_select on public.tenants for select to authenticated
  using (app.is_member(id));

create policy tenants_update on public.tenants for update to authenticated
  using (app.has_access(id, 'settings.manage'))
  with check (app.has_access(id, 'settings.manage'));


-- --- Pobočky ---------------------------------------------------------

create policy branches_select on public.branches for select to authenticated
  using (id in (select app.visible_branch_ids(tenant_id)));

create policy branches_insert on public.branches for insert to authenticated
  with check (app.has_access(tenant_id, 'settings.manage'));

create policy branches_update on public.branches for update to authenticated
  using (app.has_access(tenant_id, 'settings.manage'))
  with check (app.has_access(tenant_id, 'settings.manage'));


-- --- Pozice ----------------------------------------------------------

create policy positions_select on public.positions for select to authenticated
  using (app.is_member(tenant_id));

create policy positions_write on public.positions for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage'))
  with check (app.has_access(tenant_id, 'settings.manage'));


-- --- Katalogy (jen ke čtení) -----------------------------------------

create policy modules_select on public.modules for select to authenticated using (true);
create policy permissions_select on public.permissions for select to authenticated using (true);


-- --- Moduly firmy ----------------------------------------------------

create policy tenant_modules_select on public.tenant_modules for select to authenticated
  using (app.is_member(tenant_id));

create policy tenant_modules_write on public.tenant_modules for all to authenticated
  using (app.has_access(tenant_id, 'settings.manage'))
  with check (app.has_access(tenant_id, 'settings.manage'));


-- --- Role ------------------------------------------------------------

create policy roles_select on public.roles for select to authenticated
  using (app.is_member(tenant_id));

create policy roles_write on public.roles for all to authenticated
  using (app.has_access(tenant_id, 'people.manage'))
  with check (app.has_access(tenant_id, 'people.manage'));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using (exists (select 1 from public.roles r
                 where r.id = role_id and app.is_member(r.tenant_id)));

create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r
                 where r.id = role_id and app.has_access(r.tenant_id, 'people.manage')))
  with check (exists (select 1 from public.roles r
                      where r.id = role_id and app.has_access(r.tenant_id, 'people.manage')));


-- --- Profily ---------------------------------------------------------
-- Vlastní profil vždy. Cizí jen v rámci firmy, kde jsme oba členy —
-- aplikace potřebuje zobrazovat jména kolegů u směn a zpráv.

create policy profiles_select_self on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy profiles_select_colleagues on public.profiles for select to authenticated
  using (exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    where mine.user_id = (select auth.uid())
      and mine.status = 'active'
      and theirs.user_id = public.profiles.user_id
      and theirs.status = 'active'
  ));

create policy profiles_update_self on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));


-- --- Členství --------------------------------------------------------

create policy memberships_select on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or app.has_access(tenant_id, 'people.manage'));

create policy memberships_write on public.memberships for all to authenticated
  using (app.has_access(tenant_id, 'people.manage'))
  with check (app.has_access(tenant_id, 'people.manage'));

create policy membership_branches_select on public.membership_branches for select to authenticated
  using (exists (select 1 from public.memberships m
                 where m.id = membership_id
                   and (m.user_id = (select auth.uid())
                        or app.has_access(m.tenant_id, 'people.manage'))));

create policy membership_branches_write on public.membership_branches for all to authenticated
  using (exists (select 1 from public.memberships m
                 where m.id = membership_id and app.has_access(m.tenant_id, 'people.manage')))
  with check (exists (select 1 from public.memberships m
                      where m.id = membership_id and app.has_access(m.tenant_id, 'people.manage')));


-- --- Zaměstnanci -----------------------------------------------------

create policy employees_select on public.employees for select to authenticated
  using (
    user_id = (select auth.uid())
    or app.can_read_scoped(tenant_id, 'shifts.read', branch_id)
    or app.has_access(tenant_id, 'people.manage')
  );

create policy employees_write on public.employees for all to authenticated
  using (app.has_access(tenant_id, 'people.manage'))
  with check (app.has_access(tenant_id, 'people.manage'));


-- --- Pozvánky --------------------------------------------------------
-- Otisk tokenu se nikdy nečte přes API. Přijetí řeší SECURITY DEFINER
-- funkce app.accept_invitation(), která běží mimo tyto politiky.

create policy invitations_manage on public.invitations for all to authenticated
  using (app.has_access(tenant_id, 'people.manage'))
  with check (app.has_access(tenant_id, 'people.manage'));


-- --- Audit -----------------------------------------------------------

create policy audit_select on public.audit_log for select to authenticated
  using (app.has_access(tenant_id, 'settings.manage')
      or app.has_access(tenant_id, 'agents.manage'));

-- Zapisuje jen app.audit(). Přímý zápis z aplikace není povolený.
revoke insert, update, delete on public.audit_log from authenticated;
