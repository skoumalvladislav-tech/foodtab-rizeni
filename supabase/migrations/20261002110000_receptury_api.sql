-- =====================================================================
-- Foodtab — Receptury: průzor pro TypeScript a bezpečná úprava naráz
--
-- `app.recipe_cost_per_portion` (20261002100000_sklad_suroviny_zaklad.sql)
-- žije ve schématu `app`, které PostgREST nevidí (supabase/config.toml,
-- `schemas = ["public", "graphql_public"]`) — appka se ho tedy nemohla
-- zeptat přes `supabase.rpc(...)` vůbec, přesně jako dřív `app.business_date`
-- (20260825140000_business_date_api.sql). Tahle migrace otvírá stejný
-- typ průzoru, ne nový vzor.
--
-- Na rozdíl od `public.business_date` je tenhle průzor SECURITY INVOKER,
-- ne DEFINER: `public.recipes` i `app.recipe_cost_per_portion` samy
-- podléhají RLS volajícího (recipes_read, 20260823130000_provoz.sql),
-- takže žádná vlastní autorizace není potřeba — cizí nebo nedostupná
-- receptura vrátí prázdno, ne data. `business_date` potřebovalo DEFINER
-- kvůli širšímu pravidlu (kterákoli pobočka VLASTNÍ firmy, ne jen ty,
-- na které je volající přímo zařazený) — tady o nic takového nejde.
--
-- Úprava receptury (`public.upravit_recepturu`) je DEFINER, protože
-- maže a znovu vkládá celý seznam surovin v jedné transakci (zadání,
-- oddíl 2, bod 3: "NEJJEDNODUŠŠÍ bezpečná cesta je smazat všechny staré
-- řádky a vložit nové v JEDNÉ transakci") — dvě samostatná volání
-- supabase-js (DELETE + INSERT) by tuhle atomicitu nezaručila. Vzor je
-- `public.upravit_sablonu_checklistu` (20260923160000_checklisty_rpc.sql):
-- tam se kvůli historii běhů stará položka jen VYŘADÍ (active=false),
-- tady se smí smazat doopravdy — recipe_ingredients.id nemá historii
-- běhů ani cizí klíč odjinud (ověřeno `grep -rn "references public\.recipe_ingredients"`
-- přes celý repozitář: žádný výsledek).
-- =====================================================================


create or replace function public.recipe_cost_per_portion(
  p_recipe uuid,
  p_den    date default current_date
)
returns table (
  cost_haleru_per_portion numeric,
  neuplne boolean,
  chybejici_polozky text[]
)
language sql stable security invoker set search_path = ''
as $$
  select c.cost_haleru_per_portion, c.neuplne, c.chybejici_polozky
  from public.recipes r
  cross join lateral app.recipe_cost_per_portion(r.id, p_den) c
  where r.id = p_recipe;
$$;

comment on function public.recipe_cost_per_portion(uuid, date) is
  'Průzor do schématu app (zvenčí zavřené) pro náklad receptury na '
  'porci. SECURITY INVOKER záměrně: žádná vlastní autorizace tu není '
  'potřeba, recipes i app.recipe_cost_per_portion podléhají RLS '
  'volajícího samy.';

revoke all on function public.recipe_cost_per_portion(uuid, date) from public, anon;
grant execute on function public.recipe_cost_per_portion(uuid, date) to authenticated;


-- ---------------------------------------------------------------------
-- DRUHÁ LINIE PRO recipe_ingredients.ingredient_id
--
-- recipe_ingredients nemá vlastní tenant_id (jen recipe_id) — vazba na
-- katalog surovin (ingredient_id) přibyla teprve teď a nemá spoušť,
-- která by hlídala, že surovina patří TÉŽE firmě jako receptura. Bez
-- ní by uživatel s recipes.manage ve firmě B napojil svoji recepturu
-- na ingredient_id patřící firmě A — stejná díra, kterou
-- `app.hlida_firmu_suroviny` řeší u ingredient_purchase_prices
-- (20261002100000_sklad_suroviny_zaklad.sql) a kterou měly
-- employee_permissions/position_permissions před 25. 9. 2026.
-- ---------------------------------------------------------------------

create function app.hlida_recepturu_surovina()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.ingredient_id is not null and not exists (
    select 1
    from public.ingredients i
    join public.recipes r on r.tenant_id = i.tenant_id
    where i.id = new.ingredient_id
      and r.id = new.recipe_id
  ) then
    raise exception 'Surovina nepatří firmě této receptury.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_recepturu_surovina() is
  'Spoušť: ingredient_id musí patřit firmě receptury (recipe_id) — '
  'stejná díra a stejná oprava jako app.hlida_firmu_suroviny u '
  'ingredient_purchase_prices.';

revoke all on function app.hlida_recepturu_surovina() from public, anon, authenticated;

create trigger trg_receptura_surovina_firma
  before insert or update of recipe_id, ingredient_id on public.recipe_ingredients
  for each row execute function app.hlida_recepturu_surovina();


-- ---------------------------------------------------------------------
-- ÚPRAVA RECEPTURY NARÁZ (recepty + celý seznam surovin)
-- ---------------------------------------------------------------------

create or replace function public.upravit_recepturu(
  p_tenant    uuid,
  p_recept    uuid,
  p_nazev     text,
  p_kategorie text     default '',
  p_porce     smallint default 1,
  p_instrukce text     default '',
  p_aktivni   boolean  default true,
  p_polozky   jsonb    default '[]'::jsonb
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_item   jsonb;
begin
  select r.tenant_id, r.branch_id into v_tenant, v_branch
    from public.recipes r
   where r.id = p_recept and r.tenant_id = p_tenant;

  if v_tenant is null then
    raise exception 'Ta receptura neexistuje.' using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, 'recipes.manage', v_branch) then
    raise exception 'Upravovat tuhle recepturu nemůžete.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(btrim(coalesce(p_nazev, ''))) = 0 then
    raise exception 'Název receptury je povinný.' using errcode = 'check_violation';
  end if;

  update public.recipes
     set name         = left(btrim(p_nazev), 200),
         category     = left(btrim(coalesce(p_kategorie, '')), 100),
         portions     = greatest(1, coalesce(p_porce, 1)),
         instructions = left(coalesce(p_instrukce, ''), 5000),
         active       = coalesce(p_aktivni, true),
         updated_at   = now()
   where id = p_recept;

  -- Bezpečné smazat a znovu vložit celý seznam naráz (hlava souboru
  -- vysvětluje proč) — recipe_ingredients.id nemá historii ani cizí
  -- klíč odjinud.
  delete from public.recipe_ingredients where recipe_id = p_recept;

  for v_item in select * from jsonb_array_elements(p_polozky)
  loop
    if length(btrim(coalesce(v_item->>'name', ''))) = 0 then
      continue;
    end if;

    insert into public.recipe_ingredients
      (recipe_id, position, name, ingredient_id, amount, unit, note)
    values (
      p_recept,
      coalesce((v_item->>'position')::smallint, 0),
      left(btrim(v_item->>'name'), 200),
      nullif(v_item->>'ingredient_id', '')::uuid,
      greatest(0, coalesce((v_item->>'amount')::numeric, 0)),
      coalesce(nullif(v_item->>'unit', ''), 'g'),
      left(coalesce(v_item->>'note', ''), 500)
    );
  end loop;

  return p_recept;
end;
$$;

comment on function public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb) is
  'Upraví recepturu a nahradí celý seznam surovin naráz, v jedné '
  'transakci (smazat staré, vložit nové ze formuláře). Bezpečné jen '
  'proto, že recipe_ingredients.id nemá historii běhů ani cizí klíč '
  'odjinud — jinak by se musel vyřazovat jako u checklist_items '
  '(upravit_sablonu_checklistu), ne mazat.';

revoke all on function public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb) from public, anon;
grant execute on function public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb) to authenticated;
