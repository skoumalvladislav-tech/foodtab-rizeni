-- =====================================================================
-- Foodtab — Foodcost % a beverage cost % (zadání, oddíl 7, řádek 144):
--
--   "KPI: foodcost %, beverage cost %, náklady práce %, prime cost % =
--   (srovnatelná spotřeba F&B + náklady práce) / čisté tržby."
--
-- Appka dosud měla jen JEDNO sloučené číslo (lib/finance-kpi.ts,
-- `foodcostProcento` z `app.vysledovka` kategorie 'suroviny') — peněžní
-- výdaj za suroviny / tržby, bez rozlišení jídlo/nápoj. Zadání (ř. 139)
-- chce DVĖ samostatná čísla, každé vůči odpovídající tržbě, a POČÍTANÁ
-- Z TEORETICKÉ SPOTŘEBY (ř. 140: "prodané množství × platná receptura"),
-- ne z peněžního výdeje za nákup (ten může být z jiného měsíce, než kdy
-- se surovina skutečně prodala).
--
-- CHYBĖJÍCÍ ROZLIŠENÍ: nikde v appce nešlo poznat, jestli je receptura
-- jídlo nebo nápoj — `recipes.category` je volný text ("Hlavní jídlo",
-- "Předkrm", cokoli), appka ho nikdy nepoužívala k výpočtu. Tahle
-- migrace přidává STRUKTUROVANÝ sloupec `druh`, na kterém se dá počítat.
--
-- MANTINEL (beze změny, Šéfík 2. 10. 2026): fyzický sklad/inventury se
-- nestaví. Zadání (ř. 142) u nápojů navíc počítá se sudy/čepováním a
-- ztrátami — to je fyzický skladový jev a ZŮSTÁVÁ MIMO ROZSAH. Appka
-- počítá jen teoretickou spotřebu (recept × prodané množství), ne
-- skutečnou fyzickou spotřebu/ztráty.
-- =====================================================================

alter table public.recipes
  add column druh text not null default 'jidlo' check (druh in ('jidlo', 'napoj'));

comment on column public.recipes.druh is
  'Jídlo nebo nápoj — na tomhle appka rozlišuje foodcost % od beverage '
  'cost % (zadání, oddíl 7). Výchozí "jidlo" u existujících receptur je '
  'odhad, ne zjištěný fakt — nápojové receptury je potřeba ručně '
  'přepnout v úpravě receptury.';


-- ---------------------------------------------------------------------
-- ÚPRAVA RECEPTURY — rozšíření `public.upravit_recepturu` o `p_druh`.
-- Stará 8parametrová podoba se musí smazat, ne jen "or replace" —
-- přidání parametru je nová signatura, ne přepis téže funkce.
-- ---------------------------------------------------------------------

drop function if exists public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb);

create or replace function public.upravit_recepturu(
  p_tenant    uuid,
  p_recept    uuid,
  p_nazev     text,
  p_kategorie text     default '',
  p_porce     smallint default 1,
  p_instrukce text     default '',
  p_aktivni   boolean  default true,
  p_polozky   jsonb    default '[]'::jsonb,
  p_druh      text     default 'jidlo'
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

  if coalesce(p_druh, '') not in ('jidlo', 'napoj') then
    raise exception 'Druh receptury musí být jídlo nebo nápoj.' using errcode = 'check_violation';
  end if;

  update public.recipes
     set name         = left(btrim(p_nazev), 200),
         category     = left(btrim(coalesce(p_kategorie, '')), 100),
         portions     = greatest(1, coalesce(p_porce, 1)),
         instructions = left(coalesce(p_instrukce, ''), 5000),
         active       = coalesce(p_aktivni, true),
         druh         = p_druh,
         updated_at   = now()
   where id = p_recept;

  -- Bezpečné smazat a znovu vložit celý seznam naráz (hlava souboru
  -- 20261002110000_receptury_api.sql vysvětluje proč) — recipe_ingredients.id
  -- nemá historii ani cizí klíč odjinud.
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
  uuid, uuid, text, text, smallint, text, boolean, jsonb, text) is
  'Upraví recepturu (vč. druhu jídlo/nápoj) a nahradí celý seznam '
  'surovin naráz, v jedné transakci.';

revoke all on function public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb, text) from public, anon;
grant execute on function public.upravit_recepturu(
  uuid, uuid, text, text, smallint, text, boolean, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- FOODCOST % / BEVERAGE COST % — teoretická spotřeba (prodané množství
-- × platná receptura), ne peněžní výdej za nákup.
--
-- SECURITY INVOKER záměrně (stejná úvaha jako `public.recipe_cost_per_portion`,
-- 20261002110000_receptury_api.sql): `pokladna_prodeje_denni` i `recipes`
-- podléhají RLS volajícího samy, žádná vlastní autorizace tu není
-- potřeba — cizí nebo nedostupná data vrátí prázdno, ne chybu.
--
-- Prodej BEZ napojené receptury (`recipe_id is null`) nebo s NEÚPLNÝM
-- nákladem (chybí cena některé suroviny) se nezapočítá do `naklady_haleru`
-- — appka nesmí domýšlet neznámý náklad jako nulu, to by foodcost %
-- tiše podhodnotilo. Taková tržba se místo toho sečte do
-- `trzby_bez_nakladu_haleru`, aby šlo v UI upřímně ukázat, jak velká
-- část tržeb zůstává bez spočítaného nákladu.
-- ---------------------------------------------------------------------

create or replace function app.foodcost_beverage_prehled(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  druh                     text,
  trzby_haleru             bigint,
  naklady_haleru           bigint,
  trzby_bez_nakladu_haleru bigint
)
language sql stable security invoker set search_path = ''
as $$
  with prodeje as (
    select p.recipe_id, r.druh, p.mnozstvi, p.trzba_haleru, p.datum
    from public.pokladna_prodeje_denni p
    left join public.recipes r on r.id = p.recipe_id
    where p.tenant_id = p_tenant
      and (p_branch is null or p.branch_id = p_branch)
      and p.datum between p_od and p_do
  ),
  s_naklady as (
    select pr.druh, pr.mnozstvi, pr.trzba_haleru, c.cost_haleru_per_portion, c.neuplne
    from prodeje pr
    left join lateral app.recipe_cost_per_portion(pr.recipe_id, pr.datum) c on true
  )
  select
    coalesce(druh, 'nezarazeno'),
    sum(trzba_haleru)::bigint,
    sum(case when neuplne is false then round(cost_haleru_per_portion * mnozstvi) else 0 end)::bigint,
    sum(case when neuplne is distinct from false then trzba_haleru else 0 end)::bigint
  from s_naklady
  group by coalesce(druh, 'nezarazeno');
$$;

comment on function app.foodcost_beverage_prehled(uuid, uuid, date, date) is
  'Teoretický foodcost/beverage cost (prodané množství × platná '
  'receptura v den prodeje), skupina po `recipes.druh`. Prodej bez '
  'napojené nebo neúplné receptury se nezapočítá do naklady_haleru '
  '(appka nesmí domýšlet), jen do trzby_bez_nakladu_haleru.';

-- SECURITY INVOKER zřetězení (stejně jako recipe_cost_per_portion):
-- `public.*` obal volá `app.*` se stejnou rolí volajícího, takže
-- `authenticated` potřebuje EXECUTE na OBOU úrovních, ne jen na public.
revoke all on function app.foodcost_beverage_prehled(uuid, uuid, date, date) from public, anon;
grant execute on function app.foodcost_beverage_prehled(uuid, uuid, date, date) to authenticated;

create or replace function public.foodcost_beverage_prehled(
  p_tenant uuid,
  p_branch uuid,
  p_od     date,
  p_do     date
)
returns table (
  druh                     text,
  trzby_haleru             bigint,
  naklady_haleru           bigint,
  trzby_bez_nakladu_haleru bigint
)
language sql stable security invoker set search_path = ''
as $$
  select * from app.foodcost_beverage_prehled(p_tenant, p_branch, p_od, p_do);
$$;

comment on function public.foodcost_beverage_prehled(uuid, uuid, date, date) is
  'Průzor do schématu app (zvenčí zavřené) pro foodcost/beverage cost přehled.';

revoke all on function public.foodcost_beverage_prehled(uuid, uuid, date, date) from public, anon;
grant execute on function public.foodcost_beverage_prehled(uuid, uuid, date, date) to authenticated;
