-- =====================================================================
-- Foodtab — rozhraní autorizace pro aplikaci
--
-- Aplikace se ptá databáze na oprávnění přes PostgREST. Ten ale vidí
-- jen schéma `public`, kdežto rozhodovací funkce žijí v `app` a to
-- schéma je zvenčí zavřené (a zavřené zůstane — je v něm i app.audit,
-- app.create_tenant a další věci, které z prohlížeče volat nikdo nemá).
--
-- Otevíráme proto jen tenhle úzký, výhradně čtecí průzor:
--
--   public.has_access(firma, oprávnění, pobočka)  — jediná pravda
--   public.my_context(firma)                      — podklad pro vykreslení
--   public.my_tenants()                           — kam uživatel patří
--
-- Žádná z nich nic nemění a všechny odpovídají výhradně o přihlášeném
-- uživateli. Rozhodnutí samo počítá pořád app.has_access — tady se jen
-- přeposílá, aby nevznikla druhá verze pravidel. (Pravidlo č. 2)
-- =====================================================================


-- ---------------------------------------------------------------------
-- ROZHODNUTÍ O PŘÍSTUPU
--
-- Tenhle obal nic nepřidává ani neubírá. Kdyby se sem někdy začala psát
-- podmínka navíc, znamená to, že patří do app.has_access — ne sem.
-- ---------------------------------------------------------------------

create or replace function public.has_access(
  p_tenant     uuid,
  p_permission text,
  p_branch     uuid default null
)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select app.has_access(p_tenant, p_permission, p_branch);
$$;

comment on function public.has_access(uuid, text, uuid) is
  'Průzor pro aplikaci. Rozhoduje app.has_access, tady se jen přeposílá.';

revoke all on function public.has_access(uuid, text, uuid) from public, anon;
grant execute on function public.has_access(uuid, text, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- KAM UŽIVATEL PATŘÍ
--
-- Po přihlášení aplikace neví nic — ani do jaké firmy člověk patří.
-- Většina lidí bude mít firmu jednu, ale účetní nebo majitel dvou
-- podniků jich může mít víc, tak vracíme seznam.
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
  select t.id, t.name, r.key, r.label, r.is_owner, m.scope
  from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  join public.roles   r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and t.deleted_at is null
  order by t.name;
$$;

revoke all on function public.my_tenants() from public, anon;
grant execute on function public.my_tenants() to authenticated;


-- ---------------------------------------------------------------------
-- PODKLAD PRO VYKRESLENÍ
--
-- Jedním dotazem to, co potřebuje hlavička a navigace: jméno firmy,
-- role, aktivní moduly, pobočky, na které uživatel vidí, a oprávnění,
-- která má někde ve firmě.
--
-- POZOR: seznam `permissions` je pro to, co se má NAKRESLIT — schovat
-- položku v menu, zašedit tlačítko. Vpustit někoho na data se podle něj
-- nesmí: nezná pobočku a nezná pořadí kroků. K tomu je has_access.
--
-- Nic z toho nespoléhá na to, že si aplikace řekne o správnou firmu:
-- kdo do ní nepatří, dostane prázdnou odpověď.
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
    'role', jsonb_build_object(
      'id',      r.id,
      'key',     r.key,
      'label',   r.label,
      'isOwner', r.is_owner
    ),
    -- Aktivní moduly. Vypnutý modul se v navigaci vůbec neobjeví —
    -- a jeho rozhraní stejně odmítne i přímé volání. (Pravidlo č. 5)
    'modules', coalesce((
      select jsonb_agg(jsonb_build_object('key', mo.key, 'label', mo.label)
                       order by mo.sort_order)
      from public.tenant_modules tm
      join public.modules mo on mo.key = tm.module_key
      where tm.tenant_id = t.id
        and tm.status in ('active', 'trial')
        and (tm.valid_until is null or tm.valid_until > now())
    ), '[]'::jsonb),
    -- Pobočky, na které uživatel vidí. Tohle je zdroj pro přepínač
    -- v hlavičce — a zároveň seznam, proti kterému se ověřuje pobočka
    -- z adresy. (Pravidlo č. 4)
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug)
                       order by b.name)
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
  join public.roles   r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and t.deleted_at is null;
$$;

comment on function public.my_context(uuid) is
  'Podklad pro vykreslení hlavičky a navigace. O přístupu k datům '
  'nerozhoduje — od toho je has_access.';

revoke all on function public.my_context(uuid) from public, anon;
grant execute on function public.my_context(uuid) to authenticated;
