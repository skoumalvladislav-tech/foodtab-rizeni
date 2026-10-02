-- =====================================================================
-- Foodtab — katalog surovin, historie nákupních cen, náklad receptury
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 7 ("Gastro:
-- receptury, sklad, foodcost") — PRVNÍ ČÁST. Audit
-- (docs/finance-marketing-audit.md, oddíl 4) zjistil, že dnes neexistuje
-- vůbec žádný katalog surovin, nákupní ceny ani výpočet foodcostu —
-- `recipe_ingredients.name` je volný text a `cost_haleru` prázdné pole
-- s komentářem "naplní se z modulu Objednávky, až bude".
--
-- Tahle migrace zakládá katalog surovin + historii cen + výpočet nákladu
-- receptury — teoretický foodcost (nákupní cena × platná receptura).
--
-- ROZHODNUTÍ ŠÉFÍKA (2. 10. 2026): sklad (skladové pohyby, fyzické
-- inventury) se ve Foodtabu NEBUDE stavět — ty už dělá pokladní systém
-- (Dotykačka). Skutečná spotřeba (ne jen teoretická z receptury) tedy
-- půjde v budoucnu přes adaptér na Dotykačku, ne přes vlastní tabulky
-- skladových pohybů. Tahle migrace na tom rozhodnutí nic nemění —
-- katalog surovin a historie cen jsou potřeba i tak (nákupní cena
-- nejde číst z pokladny, ta prodej neviděla za co se koupilo).
--
-- Oprávnění: `purchasing.read` / `purchasing.manage` už existují
-- v katalogu (20260823120100_catalog.sql, modul `objednavky`) a dosud
-- nejsou použité nikde v kódu — žádné nové oprávnění se nezakládá.
--
-- Vzor RLS je beze změny okopírovaný z `recipes`/`recipe_ingredients`
-- (20260823130000_provoz.sql:543-559): `app.can_read_scoped` pro čtení,
-- `app.has_access` pro zápis. Obě funkce jsou definované v
-- 20260823120200_authz.sql a tahle migrace je jen volá.
-- =====================================================================


-- ---------------------------------------------------------------------
-- SUROVINY — katalog, sdílený napříč pobočkami firmy (stejný vzor jako
-- recipes: branch_id neexistuje vůbec = vždy sdílené na úrovni firmy,
-- stejně jako `can_read_scoped(tenant_id, 'purchasing.read', null)`
-- u recipes dělá branch_id IS NULL).
-- ---------------------------------------------------------------------

create table public.ingredients (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  name             text not null check (length(btrim(name)) > 0),
  -- Základní jednotka, ve které se surovina váží/měří/počítá. Hmotnost (g) a
  -- objem (ml) se NESMÍ automaticky míchat bez podkladu (zadání, §7) — proto
  -- density_g_per_ml je explicitní volitelný údaj, ne odhad.
  base_unit        text not null check (base_unit in ('g', 'ml', 'ks')),
  density_g_per_ml numeric(10,4) check (density_g_per_ml is null or density_g_per_ml > 0),
  weight_g_per_ks  numeric(10,3) check (weight_g_per_ks is null or weight_g_per_ks > 0),
  active           boolean not null default true,
  created_by       uuid references public.profiles(user_id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

comment on column public.ingredients.density_g_per_ml is
  'Jen pokud se tahle surovina NĚKDY musí převádět mezi hmotností a objemem. '
  'Prázdné = appka převod mezi g a ml u týhle suroviny odmítne, ne odhadne.';

create index ingredients_tenant on public.ingredients (tenant_id) where deleted_at is null;

-- OPRAVA (krok69/70, ověřovací fáze): `unique (tenant_id, lower(name))` jako
-- TABULKOVÉ omezení je neplatná syntaxe — PostgreSQL u table-level UNIQUE
-- přijímá jen sloupce, ne výrazy jako `lower(...)`. Migrace s tím selhávala
-- už na `create table` (42601, syntax error at or near "(") — nedala se
-- nasadit vůbec, natožpak spustit scénář nad ní. Vzor pro normalizovaný
-- unikát na jméno v rámci firmy je `employees_tenant_jmeno`
-- (20260830230000_rozpoznavaci_klice.sql:93-95): částečný INDEX, ne
-- constraint, a jen mezi nesmazanými — smazaná surovina jméno neblokuje.
create unique index ingredients_tenant_nazev
  on public.ingredients (tenant_id, lower(btrim(name)))
  where deleted_at is null;

comment on index public.ingredients_tenant_nazev is
  'Rozpoznávací klíč suroviny v rámci firmy. Jen mezi nesmazanými — '
  'smazaná surovina jméno neblokuje, stejně jako u zaměstnanců.';

alter table public.ingredients enable row level security;

-- Dvě obranné linie (foodtab-db-security): výchozí práva Supabase by
-- `anon`/`authenticated` na novou tabulku daly samy od sebe, i kdyby se
-- granty níže vynechaly (incident `marketing_tajemstvi`, 13. 9. 2026).
-- Novější migrace proto grant/revoke vypisují výslovně místo spoléhání
-- na to, že je nikdo nedal — `recipes` sama tohle ještě nedělala (je
-- z 23. 8.), ale `marketing_menu`, `notification_preferences` a další
-- zářijové migrace ano. Řídím se aktuální (bezpečnější) konvencí.
-- TRUNCATE se RLS neřídí (vysypal by katalog všech firem) a výchozí práva
-- Supabase ho `authenticated` dávají samy — musí se odebrat výslovně
-- (20260917000000_granty_provoz_uklid.sql; hlídá scripts/provoz-granty.test.mjs).
revoke all on public.ingredients from anon;
revoke truncate, references, trigger on public.ingredients from authenticated;
grant select, insert, update, delete on public.ingredients to authenticated;

create policy ingredients_read on public.ingredients for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', null));
create policy ingredients_write on public.ingredients for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', null))
  with check (app.has_access(tenant_id, 'purchasing.manage', null));


-- ---------------------------------------------------------------------
-- HISTORIE NÁKUPNÍCH CEN — jen INSERT (stejný vzor jako employee_rates:
-- žádný update, nová cena = nový řádek s novým valid_from). Platná cena
-- KE DNI se vybírá funkcí (app.ingredient_price_at), ne "poslední řádek
-- podle created_at".
-- ---------------------------------------------------------------------

create table public.ingredient_purchase_prices (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  ingredient_id        uuid not null references public.ingredients(id) on delete cascade,
  supplier_name        text not null default '',
  package_description  text not null default '',
  -- Množství balení PŘEPOČTENÉ na base_unit suroviny (ne na "kusy balení").
  package_amount       numeric(14,3) not null check (package_amount > 0),
  package_price_haleru integer not null check (package_price_haleru >= 0),
  unit_price_haleru    numeric(18,6) generated always as
                         (package_price_haleru::numeric / package_amount) stored,
  -- Zdroj ceny — dnes vždy 'rucni'. Modul Faktury BĚŽÍ v appce
  -- (app/[rozsah]/finance/faktury), ale má svou vlastní, oddělenou
  -- databázi (Supabase projekt ctqtwahlzhyjerqulqyn, žádné sdílené
  -- připojení s FoodTab DB spekntcsuroqhehmjssv) — viz
  -- docs/hlaseni/faktury-tenant-izolace-2026-10-02.md. source_invoice_id
  -- je proto VOLNÁ textová vazba na fakturu v týhle oddělené DB, bez FK,
  -- připravená na budoucí napojení.
  source               text not null default 'rucni' check (source in ('rucni', 'faktura')),
  source_invoice_id    text,
  valid_from           date not null default current_date,
  created_by           uuid references public.profiles(user_id) on delete set null,
  created_at           timestamptz not null default now()
);

comment on table public.ingredient_purchase_prices is
  'Historie nákupních cen surovin. Nikdy se needituje (pravidlo '
  'ingredient_purchase_prices_no_update níže) — nová cena je vždy nový '
  'řádek s novým valid_from, stejně jako employee_rates.';

create index ingredient_purchase_prices_lookup
  on public.ingredient_purchase_prices (ingredient_id, valid_from desc);

-- DRUHÁ LINIE (krok70, ověřovací fáze; vzor 20260925120000_prava_firma_radku.sql,
-- `app.hlida_firmu_zamestnance`/`app.hlida_firmu_zarazeni`): RLS níže hlídá
-- jen `tenant_id` ŘÁDKU, ne to, že `ingredient_id` patří TÉŽE firmě. Bez
-- týhle spouště by správce firmy B (purchasing.manage ve firmě B) zapsal
-- cenovou historii s `tenant_id = B` a `ingredient_id` ukazujícím na
-- surovinu firmy A — řádek by prošel politikou (tenant_id je přece B)
-- a firma A by měla ve své historii cizí zápis, aniž by o tom RLS věděla.
-- Přesně tahle díra byla u employee_permissions/position_permissions
-- před 25. 9. 2026 (krok58, oddíl 7) — surovin se netýkala jen proto,
-- že tabulka vznikla až teď.
create function app.hlida_firmu_suroviny()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ingredients i
    where i.id = new.ingredient_id
      and i.tenant_id = new.tenant_id
  ) then
    raise exception 'Surovina nepatří této firmě.'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

comment on function app.hlida_firmu_suroviny() is
  'Spoušť: tenant_id řádku musí být firma suroviny (ingredient_id). '
  'Bez toho si firma B zapsala cenu k surovině firmy A.';

revoke all on function app.hlida_firmu_suroviny() from public, anon, authenticated;

create trigger trg_firma_cena_suroviny
  before insert or update of tenant_id, ingredient_id on public.ingredient_purchase_prices
  for each row execute function app.hlida_firmu_suroviny();

-- Historie se nikdy nepřepisuje — stejné pravidlo a stejná reálná
-- podoba jako `employee_rates_no_update`
-- (20260831010000_mzdy_sazby.sql:58-59): ŽÁDNÉ pravidlo na DELETE.
-- Ten soubor to zdůvodňuje výslovně (řádky 61-67) — "do instead
-- nothing" na DELETE by rozbilo kaskádu cizího klíče: smazání suroviny
-- (`on delete cascade`) by spadlo na "referential integrity query gave
-- unexpected result". Zadání této migrace mluvilo o pravidlu proti
-- update I delete, ale skutečný okopírovaný vzor v repozitáři delete
-- záměrně NEBLOKUJE rulem — řídím se tím, co je opravdu v
-- mzdy_sazby.sql, ne jeho shrnutím.
create rule ingredient_purchase_prices_no_update as
  on update to public.ingredient_purchase_prices do instead nothing;

alter table public.ingredient_purchase_prices enable row level security;

-- OPRAVA (krok70, ověřovací fáze): bez téhle opravy měl `authenticated`
-- výslovný `grant ... delete ...` a politika `..._write` je `for all`
-- (select/insert/update/delete) s podmínkou jen na `purchasing.manage` —
-- kdokoli s tímhle oprávněním směl historii cen RUČNĚ smazat, přestože
-- komentář tabulky výše slibuje "nikdy se nepřepisuje". `employee_rates`
-- (vzor, který tahle migrace cituje) jde dál než jen rule na UPDATE:
-- `authenticated` na něj nemá grant VŮBEC (mzdy_sazby.sql:69-71,
-- "authenticated na sazby nedosáhne vůbec... Zmizí jen s tím, komu
-- patřila") — DELETE je tak odepřený úplně, a kaskádu z nadřazené
-- tabulky to nerozbíjí, protože RI cascade běží mimo granty volajícího
-- (ověřeno v krok70_scenar.sql, oddíl o smazání suroviny). Řádek proto
-- NEgrantuje `delete` — stejná dvojí linie (chybějící grant + RLS), ne
-- jen RLS samotná, kterou by šlo obejít budoucí přidanou politikou.
--
-- DOPLNĚNO 2. 10. 2026 (osobní kontrola po workflow): samotné nevypsání
-- DELETE do `grant` NESTAČÍ. Výchozí práva Supabase (`alter default
-- privileges … grant all on tables to anon, authenticated`) dávají
-- `authenticated` DELETE i TRUNCATE na každou novou tabulku, ať migrace
-- píše cokoli — lokální PGlite je nemá, proto to scénář krok70 nechytil
-- (stejná past jako marketing_tajemstvi, foodtab-db-security). Nejdřív
-- se proto odebere VŠE obou rolím (jako u employee_rates) a teprve
-- potom se vypíše, co smí `authenticated` doopravdy. Pořadí je důležité:
-- grant před revoke by práva zase smazal.
revoke all on public.ingredient_purchase_prices from anon, authenticated;
grant select, insert, update on public.ingredient_purchase_prices to authenticated;

create policy ingredient_purchase_prices_read on public.ingredient_purchase_prices for select to authenticated
  using (app.can_read_scoped(tenant_id, 'purchasing.read', null));
create policy ingredient_purchase_prices_write on public.ingredient_purchase_prices for all to authenticated
  using (app.has_access(tenant_id, 'purchasing.manage', null))
  with check (app.has_access(tenant_id, 'purchasing.manage', null));


-- ---------------------------------------------------------------------
-- NAPOJENÍ NA RECEPTURY — aditivní sloupec, NEPOVINNÝ (staré řádky s
-- volným textem v recipe_ingredients.name dál fungují beze změny).
-- recipe_ingredients má v 20260823130000_provoz.sql tabulkový (ne
-- sloupcový) grant pro authenticated, takže nový sloupec grant
-- nepotřebuje zvlášť — na rozdíl od `employees`/`branches`
-- (foodtab-db-security, "Sloupcové granty").
-- ---------------------------------------------------------------------

alter table public.recipe_ingredients
  add column ingredient_id uuid references public.ingredients(id) on delete set null;

comment on column public.recipe_ingredients.ingredient_id is
  'Volitelná vazba na katalog surovin. NULL = položka zůstává volný text '
  '(name/unit), jako dřív — nic nerozbíjí u existujících receptur.';


-- ---------------------------------------------------------------------
-- NÁKLAD RECEPTURY NA PORCI — funkce, NE sloupec (cena se nesmí "zamrznout"
-- špatně; při změně ceny suroviny nebo receptury ukazuje VŽDY aktuální
-- přepočet, historické reporty řeší ukládání výsledku jinde, až budou).
--
-- Vrátí NULL u položek bez ingredient_id nebo bez jakékoli platné ceny
-- KE DNI — podle zadání (§4): "Chybějící data zobraz jako chybějící, ne
-- jako nulu." Výsledek nese i seznam položek, které chybí, aby UI mohlo
-- napsat "neúplné: chybí cena u X" místo tichého podhodnocení.
-- ---------------------------------------------------------------------

create or replace function app.ingredient_price_at(
  p_ingredient uuid,
  p_den date default current_date
)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select unit_price_haleru
  from public.ingredient_purchase_prices
  where ingredient_id = p_ingredient
    and valid_from <= p_den
  order by valid_from desc
  limit 1
$$;

comment on function app.ingredient_price_at is
  'SECURITY INVOKER záměrně — podléhá RLS volajícího nad '
  'ingredient_purchase_prices, nic neobchází.';

create or replace function app.recipe_cost_per_portion(
  p_recipe uuid,
  p_den date default current_date
)
returns table (
  cost_haleru_per_portion numeric,
  neuplne boolean,
  chybejici_polozky text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_portions smallint;
  v_total numeric := 0;
  v_neuplne boolean := false;
  v_chybejici text[] := '{}';
  v_radek record;
  v_cena numeric;
begin
  select portions into v_portions from public.recipes where id = p_recipe;
  if v_portions is null then
    return query select null::numeric, true, array['receptura nenalezena'];
    return;
  end if;

  for v_radek in
    select ri.id, ri.name, ri.amount, ri.unit, ri.ingredient_id, i.base_unit
    from public.recipe_ingredients ri
    left join public.ingredients i on i.id = ri.ingredient_id
    where ri.recipe_id = p_recipe
  loop
    if v_radek.ingredient_id is null then
      v_neuplne := true;
      v_chybejici := array_append(v_chybejici, v_radek.name || ' (nenapojeno na katalog surovin)');
      continue;
    end if;

    /*
      NÁLEZ A (kontrola 2. 10. 2026): `recipe_ingredients.unit` je volný
      text bez vazby na `ingredients.base_unit` — bez tyhle kontroly by
      receptura v "kg" a surovina v základní jednotce "g" vrátila číslo
      TISÍCKRÁT podhodnocené a TVÁŘÍCÍ SE JAKO ÚPLNÉ (neuplne=false),
      protože násobení `v_cena * amount` proběhne bez chyby. To je horší
      než chybějící cena — ta se aspoň pozná. Dokud appka neumí bezpečně
      převádět mezi jednotkami (g↔kg, ml↔l, natožpak g↔ml přes
      density_g_per_ml), nesouhlasná jednotka se řeší stejně jako
      chybějící napojení: nahlásí se jako neúplná položka, nepočítá se
      s ní tiše.
    */
    if v_radek.unit is distinct from v_radek.base_unit then
      v_neuplne := true;
      v_chybejici := array_append(
        v_chybejici,
        v_radek.name || ' (jednotka receptury "' || v_radek.unit ||
          '" neodpovídá základní jednotce suroviny "' || v_radek.base_unit || '")'
      );
      continue;
    end if;

    v_cena := app.ingredient_price_at(v_radek.ingredient_id, p_den);
    if v_cena is null then
      v_neuplne := true;
      v_chybejici := array_append(v_chybejici, v_radek.name || ' (chybí platná nákupní cena)');
      continue;
    end if;

    v_total := v_total + (v_cena * v_radek.amount);
  end loop;

  if v_neuplne then
    return query select null::numeric, true, v_chybejici;
  else
    -- NÁLEZ B (kontrola 2. 10. 2026): zaokrouhlení na celé haléře, ne na
    -- setiny haléře — stejná konvence jako `vydelano_haleru`
    -- (20260831011000_mzdy_vypocet.sql) a `vydelky_prehled`
    -- (20260924140000_vydelky_prehled.sql). Setina haléře v Kč neexistuje.
    return query select round(v_total / v_portions), false, v_chybejici;
  end if;
end;
$$;

comment on function app.recipe_cost_per_portion is
  'SECURITY INVOKER — nenahrazuje RLS, jen čte přes recipe_ingredients/'
  'ingredients/ingredient_purchase_prices, který volající smí vidět. '
  'Vrací NULL cenu a neuplne=true, pokud JAKÁKOLI položka nemá napojenou '
  'surovinu nebo platnou cenu — žádný "částečný" odhad tvářící se jako úplný.';

grant execute on function app.ingredient_price_at(uuid, date) to authenticated;
grant execute on function app.recipe_cost_per_portion(uuid, date) to authenticated;
