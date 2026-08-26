-- =====================================================================
-- Foodtab — barva pobočky a úplný seznam modulů v kontextu
--
-- Dvě věci, které si vyžádalo rozhraní.
--
-- 1. BARVA POBOČKY
--
-- Když člověk přepíná mezi provozovnami, musí na první pohled poznat,
-- kde právě je. Špatně odeslaná zpráva nebo směna zadaná na cizí pobočku
-- se hledá těžko, a stojí za tím vždycky ten samý omyl.
--
-- Barva je vlastnost pobočky, tedy DATA. Do kódu nepatří — poboček může
-- být neomezeně a zákazník si je pojmenuje i obarví sám.
--
-- Ukládá se ale KLÍČ z pevné palety, ne hodnota v hexu. Důvody dva:
-- odstíny pak drží pohromadě se zbytkem rozhraní a nikdo si nenastaví
-- svítivě žlutou na bílém pozadí, kterou nikdo nepřečte.
--
-- 2. VYPNUTÉ MODULY V KONTEXTU
--
-- Rozcestník má ukazovat i moduly, které firma nemá — zašedlé, aby bylo
-- vidět, co si lze přikoupit. Kontext proto vrací všechny čtyři a u
-- každého příznak, jestli je aktivní. Na přístup to nemá vliv: rozhoduje
-- pořád app.has_access, která vypnutý modul odmítne i při přímém volání.
-- =====================================================================


-- Sloupec je schválně bez NOT NULL DEFAULT: jinak by nešlo rozeznat
-- „barvu nikdo nezadal" od „zákazník si vybral zrovna tuhle".
-- Prázdnou hodnotu doplní trigger níž, takže po vložení je vždycky
-- vyplněná.
alter table public.branches
  add column if not exists color text
    check (color in ('slate', 'indigo', 'violet', 'sky',
                     'teal', 'emerald', 'amber', 'rose'));

comment on column public.branches.color is
  'Klíč z palety rozhraní, ne hodnota barvy. Odstín určuje aplikace, '
  'aby zůstal čitelný ve světlém i tmavém režimu.';


-- Nová pobočka dostane barvu, kterou firma ještě nemá. Až se paleta
-- vyčerpá, začne se točit dokola — u osmi poboček už barva stejně
-- neslouží k rozeznání, ale jen k orientaci.
create or replace function app.assign_branch_color()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  c_paleta constant text[] := array['indigo', 'amber', 'emerald', 'rose',
                                    'sky', 'violet', 'teal', 'slate'];
  v_volna  text;
  v_poradi int;
begin
  if new.color is not null then
    return new;
  end if;

  -- Nejdřív barva, kterou firma nepoužívá.
  select b into v_volna
  from unnest(c_paleta) with ordinality as p(b, i)
  where not exists (
    select 1 from public.branches x
    where x.tenant_id = new.tenant_id
      and x.deleted_at is null
      and x.color = p.b
  )
  order by p.i
  limit 1;

  if v_volna is null then
    select count(*) into v_poradi
    from public.branches x where x.tenant_id = new.tenant_id;
    v_volna := c_paleta[(v_poradi % array_length(c_paleta, 1)) + 1];
  end if;

  new.color := v_volna;
  return new;
end;
$$;

create trigger trg_branch_color
  before insert on public.branches
  for each row execute function app.assign_branch_color();


-- Doplnění pobočkám, které vznikly dřív než tenhle sloupec.
with poradi as (
  select b.id,
         (row_number() over (partition by b.tenant_id order by b.created_at) - 1) as poz
  from public.branches b
  where b.color is null
), paleta as (
  select array['indigo', 'amber', 'emerald', 'rose',
               'sky', 'violet', 'teal', 'slate']::text[] as barvy
)
update public.branches b
   set color = p.barvy[(poradi.poz % array_length(p.barvy, 1)) + 1]
  from poradi, paleta p
 where b.id = poradi.id;


-- ---------------------------------------------------------------------
-- Kontext pro vykreslení — doplněná barva a všechny moduly
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
  join public.roles   r on r.id = m.role_id
  where m.user_id = (select auth.uid())
    and m.tenant_id = p_tenant
    and m.status = 'active'
    and t.deleted_at is null;
$$;
