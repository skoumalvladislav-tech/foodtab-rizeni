-- =====================================================================
-- Foodtab — surovina použitá v receptuře (jen průzor pro mazání)
--
-- Nález při stavbě obrazovky Suroviny (app/[rozsah]/suroviny): smazání
-- suroviny se má odmítnout, pokud na ni odkazuje nějaký
-- recipe_ingredients.ingredient_id. Přímý SELECT nad recipe_ingredients
-- ale podléhá RLS (20260823130000_provoz.sql:549-552), která vidí jen
-- přes `recipes.read` dané receptury — kdo smí mazat suroviny
-- (`purchasing.manage`), ale nemá `recipes.read`, by takový SELECT
-- dostal prázdný beze chyby a appka by si spočítala "nepoužitá", i
-- kdyby receptura surovinu doopravdy odkazovala. Kontrola v akci by tím
-- tiše prošla nad přesně tím případem, který má zachytit.
--
-- Tenhle průzor je SECURITY DEFINER a obchází RLS JEN pro odpověď
-- ano/ne o existenci vazby, nic víc nevrací. Nenahrazuje `purchasing.manage`
-- — tu kontrolu dělá appka (app/[rozsah]/suroviny/akce.ts) před voláním.
-- Bezpečné proti cizí firmě: `p_tenant` musí sedět na tenant_id OBOU
-- stran (receptury i suroviny), takže zkoušení cizích UUID vrátí vždy ne.
-- =====================================================================

create or replace function app.surovina_pouzita_v_receptu(
  p_tenant     uuid,
  p_ingredient uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.recipe_ingredients ri
    join public.recipes r     on r.id = ri.recipe_id
    join public.ingredients i on i.id = ri.ingredient_id
    where ri.ingredient_id = p_ingredient
      and r.tenant_id = p_tenant
      and i.tenant_id = p_tenant
  );
$$;

comment on function app.surovina_pouzita_v_receptu(uuid, uuid) is
  'Jen ano/ne, jestli recipe_ingredients odkazuje na tuhle surovinu — '
  'SECURITY DEFINER proto, že recipe_ingredients_read vidí jen přes '
  'recipes.read a purchasing.manage ho nemusí mít. Nerozhoduje o právu '
  'smazat, to kontroluje volající.';

revoke all on function app.surovina_pouzita_v_receptu(uuid, uuid) from public, anon;
grant execute on function app.surovina_pouzita_v_receptu(uuid, uuid) to authenticated;
