-- =====================================================================
-- Foodtab — Pokladny: univerzální napojení (API token / příjmové API)
--
-- Šéfík 11. 10. 2026: „potřebuji dokončit napojení POS… přes API…
-- univerzální formu připojení — je spoustu POS… okénko, kam se vloží
-- API token a POS se připojí."
--
-- Do 11. 10. uměla appka pokladní prodeje jen z CSV. `zdroj` měl pevný
-- výčet ('dotykacka_api', 'csv'), který nic nepsalo. Tahle migrace
-- připravuje databázi na LIBOVOLNOU pokladnu, ne jen na Dotykačku:
--
--   1. `zdroj` = obecný tvar `<poskytovatel>_api` místo výčtu — další
--      pokladna nepotřebuje migraci, jen adaptér v kódu.
--   2. `integrace_pripojeni_id` — které připojení řádek zapsalo
--      (dohledatelnost, a druhá linie obrany i na tenhle odkaz).
--   3. `public.pokladna_nahradit_prodeje` — JEDINÁ zapisovací cesta pro
--      API (stahování z pokladny i příjem od pokladny): přepíše celé
--      dny, takže storno v pokladně zmizí i tady a opakovaný zápis
--      nezdvojí nic. Zapíše jen do pobočky, ke které je provozovna
--      pokladny v appce PŘIŘAZENÁ. Volá ji jen `service_role`.
--   4. Receptura k prodeji podle názvu — dosud ji nedosazoval nikdo
--      (ani CSV import), takže foodcost viděl všechny tržby „bez
--      nákladu". Dosadí se jen při přesné shodě názvu (bez ohledu na
--      velikost písmen), nic podobného se nehádá.
--   5. Foodcost nesčítá CSV a API za týž den dvakrát: má-li pobočka
--      v daný den data z napojené pokladny, CSV řádky téhož dne se
--      nepočítají (typicky starší ruční import, který API pak dohnalo).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ZDROJ — obecný tvar místo výčtu
-- ---------------------------------------------------------------------

alter table public.pokladna_prodeje_denni drop constraint pokladna_prodeje_denni_zdroj_check;
alter table public.pokladna_prodeje_denni add constraint pokladna_prodeje_denni_zdroj_check
  check (zdroj ~ '^[a-z][a-z0-9_]{1,39}$');

comment on column public.pokladna_prodeje_denni.zdroj is
  '`csv` = ruční import souboru; `<poskytovatel>_api` = napojená pokladna '
  '(`dotykacka_api`, `obecne_api` = příjmové API Foodtabu). Unikátní '
  'klíč dne/produktu ho obsahuje, takže CSV a API téhož dne jsou dva '
  'řádky — foodcost je nesčítá (viz app.foodcost_beverage_prehled).';


-- ---------------------------------------------------------------------
-- 2. KTERÉ PŘIPOJENÍ ŘÁDEK ZAPSALO
-- ---------------------------------------------------------------------

alter table public.pokladna_prodeje_denni
  add column integrace_pripojeni_id uuid references public.integrace_pripojeni(id) on delete set null;

create index pokladna_prodeje_pripojeni on public.pokladna_prodeje_denni (integrace_pripojeni_id)
  where integrace_pripojeni_id is not null;

comment on column public.pokladna_prodeje_denni.integrace_pripojeni_id is
  'Připojení pokladny, které řádek zapsalo (jen API). CSV import ho nechává prázdné.';


-- ---------------------------------------------------------------------
-- 3. DRUHÁ LINIE OBRANY — rozšířená o připojení a recepturu
--
-- Původní funkce (20261003240000) hlídala pobočku a importní dávku.
-- Nově i `integrace_pripojeni_id` (musí být pokladní připojení TÉŽE
-- firmy) a `recipe_id` — ten dosud nehlídal nikdo: kdo smí zapisovat
-- prodeje, mohl k řádku přiřadit recepturu cizí firmy (uhodnutím id).
-- Škoda by byla malá (foodcost je security invoker, cizí recepturu by
-- nepřečetl), ale kontrola stojí jeden řádek.
-- ---------------------------------------------------------------------

create or replace function app.hlida_firmu_pokladna_prodeje()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.branches b
    where b.id = new.branch_id and b.tenant_id = new.tenant_id
  ) then
    raise exception 'Pobočka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.import_davka_id is not null and not exists (
    select 1 from public.import_davky d
    where d.id = new.import_davka_id and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Importní dávka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.integrace_pripojeni_id is not null and not exists (
    select 1 from public.integrace_pripojeni c
    where c.id = new.integrace_pripojeni_id and c.tenant_id = new.tenant_id and c.oblast = 'pokladna'
  ) then
    raise exception 'Připojení pokladny nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.recipe_id is not null and not exists (
    select 1 from public.recipes r
    where r.id = new.recipe_id and r.tenant_id = new.tenant_id
  ) then
    raise exception 'Receptura nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger trg_firma_pokladna_prodeje on public.pokladna_prodeje_denni;
create trigger trg_firma_pokladna_prodeje
  before insert or update of tenant_id, branch_id, import_davka_id, integrace_pripojeni_id, recipe_id
  on public.pokladna_prodeje_denni
  for each row execute function app.hlida_firmu_pokladna_prodeje();


-- ---------------------------------------------------------------------
-- 4. RECEPTURA PODLE NÁZVU PRODUKTU
--
-- Hlavička 20261003240000 to slibovala („appka ho zkusí dohledat podle
-- názvu při importu"), ale nedělal to nikdo. Pravidlo: stejný název
-- (bez ohledu na velikost písmen a okrajové mezery), aktivní receptura
-- té firmy, platná pro celou firmu nebo pro tuhle pobočku. Víc shod být
-- nemůže — název receptury je ve firmě jedinečný stejným výrazem
-- (index recipes_tenant_nazev, 20260830230000). Bez shody zůstane prodej
-- bez receptury a foodcost ho ukáže jako „bez nákladu"; appka nehádá
-- podle podobnosti.
--
-- SECURITY DEFINER: CSV importuje i člověk, který receptury číst nesmí
-- — shoda nesmí záviset na tom, kdo zrovna importuje. Funkce si firmu
-- filtruje sama (`new.tenant_id`, ověřenou politikou zápisu a triggerem
-- výš) a do řádku zapíše jen id receptury TÉŽE firmy.
-- Triggery BEFORE běží podle abecedy: `trg_firma_…` (kontrola) před
-- `trg_receptura_…` (dosazení) — dosazená receptura je z téže firmy
-- z konstrukce dotazu.
-- ---------------------------------------------------------------------

create function app.prodej_najdi_recepturu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Přejmenovaný produkt (update) dostane recepturu znovu podle nového
  -- názvu — stará patřila jinému jménu.
  if tg_op = 'UPDATE'
     and new.produkt_nazev is distinct from old.produkt_nazev
     and new.recipe_id is not distinct from old.recipe_id then
    new.recipe_id := null;
  end if;

  if new.recipe_id is not null then
    return new;
  end if;

  select r.id into new.recipe_id
    from public.recipes r
   where r.tenant_id = new.tenant_id
     and r.active
     and (r.branch_id is null or r.branch_id = new.branch_id)
     and lower(btrim(r.name)) = lower(btrim(new.produkt_nazev));
  return new;
end $$;

revoke all on function app.prodej_najdi_recepturu() from public, anon, authenticated;

create trigger trg_receptura_pokladna_prodeje
  before insert or update of produkt_nazev on public.pokladna_prodeje_denni
  for each row execute function app.prodej_najdi_recepturu();


-- ---------------------------------------------------------------------
-- 5. ZÁPIS Z NAPOJENÉ POKLADNY — přepis celých dnů
--
-- Pokladna (nebo appka, když se jí ptá) pošle CELÝ den. Appka u téhle
-- pobočky a téhle pokladny smaže, co v těch dnech měla, a zapíše nové:
--   * storno v pokladně zmizí i tady (upsert by starý produkt nechal),
--   * opakovaný zápis téhož dne nic nezdvojí,
--   * stejný název dvakrát v jednom dni se sečte (unikátní klíč dne
--     a produktu by druhý řádek odmítl a shodil celý den).
--
-- KAM SE SMÍ ZAPSAT rozhoduje připojení, ne volající:
--   * připojení PRO POBOČKU (příjmové API — jeden klíč, jedna pobočka):
--     jen do své pobočky; jinou `p_branch` funkce odmítne;
--   * připojení PRO FIRMU (pokladna s tokenem, víc provozoven pod jedním
--     účtem — Šéfík 11. 10.: „provozovna šla přiřadit ke konkrétnímu
--     profilu zde v appce"): jen do pobočky, ke které člověk v Integracích
--     přiřadil některou provozovnu pokladny
--     (`externi_ucet.provozovny[].branch_id`).
-- Zdroj je vždy `<poskytovatel>_api` z připojení — pokladna se nemůže
-- vydávat za jinou.
--
-- Jen `service_role` (naplánovaná úloha, příjmová adresa po ověření
-- klíče, ruční „Synchronizovat teď" po `integrace.manage`). Přihlášený
-- uživatel ji volat nesmí — zapisuje za pokladnu, ne za sebe.
-- ---------------------------------------------------------------------

create function public.pokladna_nahradit_prodeje(
  p_pripojeni uuid,
  p_branch    uuid,
  p_dny       date[],
  p_radky     jsonb -- [{datum, produkt_nazev, mnozstvi, trzba_haleru}]
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_zdroj  text;
  v_ucet   jsonb;
  v_pocet  integer;
begin
  select c.tenant_id, c.branch_id, c.poskytovatel || '_api', c.externi_ucet
    into v_tenant, v_branch, v_zdroj, v_ucet
    from public.integrace_pripojeni c
   where c.id = p_pripojeni
     and c.oblast = 'pokladna'
     and c.odpojeno_kdy is null;

  if v_tenant is null then
    raise exception 'Připojení pokladny neexistuje nebo je odpojené.' using errcode = 'no_data_found';
  end if;

  if v_branch is not null then
    if p_branch is not null and p_branch <> v_branch then
      raise exception 'Tohle připojení patří jiné pobočce.' using errcode = 'check_violation';
    end if;
  elsif p_branch is null or not exists (
    select 1
      from jsonb_array_elements(coalesce(v_ucet -> 'provozovny', '[]'::jsonb)) as e
     where e ->> 'branch_id' = p_branch::text
  ) then
    raise exception 'K téhle pobočce není přiřazená žádná provozovna pokladny.' using errcode = 'check_violation';
  else
    v_branch := p_branch;
  end if;

  if p_dny is null or cardinality(p_dny) = 0 then
    raise exception 'Chybí dny, které se mají přepsat.' using errcode = 'invalid_parameter_value';
  end if;
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_radky, '[]'::jsonb)) as r(datum date)
     where r.datum is null or not (r.datum = any (p_dny))
  ) then
    raise exception 'Řádek prodeje patří ke dni, který se nepřepisuje.' using errcode = 'invalid_parameter_value';
  end if;

  -- Dva zápisy téže pobočky z téže pokladny (dvě dávky z příjmového API,
  -- úloha a ruční tlačítko) jdou za sebou, ne přes sebe.
  perform pg_advisory_xact_lock(hashtextextended('pokladna:' || v_branch::text || ':' || v_zdroj, 0));

  delete from public.pokladna_prodeje_denni p
   where p.tenant_id = v_tenant
     and p.branch_id = v_branch
     and p.zdroj = v_zdroj
     and p.datum = any (p_dny);

  insert into public.pokladna_prodeje_denni
    (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, integrace_pripojeni_id)
  select v_tenant, v_branch, r.datum, btrim(r.produkt_nazev), sum(r.mnozstvi), sum(r.trzba_haleru), v_zdroj, p_pripojeni
    from jsonb_to_recordset(coalesce(p_radky, '[]'::jsonb))
         as r(datum date, produkt_nazev text, mnozstvi numeric, trzba_haleru bigint)
   group by r.datum, btrim(r.produkt_nazev);

  get diagnostics v_pocet = row_count;
  return v_pocet;
end $$;

comment on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb) is
  'Zápis prodejů z napojené pokladny: přepíše zadané dny jedné pobočky '
  'z téhle pokladny (storno zmizí, nic se nezdvojí). Pobočku hlídá '
  'připojení (vlastní pobočka, nebo přiřazení provozoven). Jen service_role.';

revoke all on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb) from public, anon, authenticated;
grant execute on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb) to service_role;


/*
  ÚKLID PO ZMĚNĚ PŘIŘAZENÍ. Když člověk provozovnu pokladny přiřadí
  jiné pobočce (opravuje omyl), prodeje, které appka podle starého
  přiřazení zapsala do staré pobočky, tam být nemají — smažou se a nová
  pobočka je dostane při příští synchronizaci znovu z pokladny. Maže
  jen řádky TOHOTO připojení (`integrace_pripojeni_id`), nikdy CSV ani
  jinou pokladnu. Jen service_role — volá ji akce po `integrace.manage`
  a po ověření, že připojení patří firmě.
*/
create function public.pokladna_odebrat_prodeje(p_pripojeni uuid, p_branch uuid)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pocet integer;
begin
  delete from public.pokladna_prodeje_denni p
   where p.integrace_pripojeni_id = p_pripojeni
     and p.branch_id = p_branch;
  get diagnostics v_pocet = row_count;
  return v_pocet;
end $$;

revoke all on function public.pokladna_odebrat_prodeje(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pokladna_odebrat_prodeje(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------
-- 6. FOODCOST — CSV a API téhož dne se nesčítají
--
-- Beze změny proti 20261004200000 kromě podmínky v `prodeje`: řádek
-- z CSV se nepočítá, když má TÁŽ pobočka v TENTÝŽ den data z napojené
-- pokladny. Typicky: v září se ručně nahrálo CSV, v říjnu se připojila
-- Dotykačka a dohnala historii — bez téhle podmínky by září bylo
-- dvakrát. Rozhoduje se po dnech a pobočkách, ne celkově: den, který
-- API nemá, se dál počítá z CSV.
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
      and (
        p.zdroj <> 'csv'
        or not exists (
          select 1 from public.pokladna_prodeje_denni a
           where a.tenant_id = p.tenant_id
             and a.branch_id = p.branch_id
             and a.datum = p.datum
             and a.zdroj <> 'csv'
        )
      )
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
  '(appka nesmí domýšlet), jen do trzby_bez_nakladu_haleru. CSV řádky '
  'dne, pro který má pobočka data z napojené pokladny, se nepočítají.';


-- ---------------------------------------------------------------------
-- 7. SERVICE_ROLE GRANTY — stejný důvod jako 20261004100000 (banka),
--    oddíl 6: úloha `pokladna-synchronizace`, příjmová adresa
--    `/api/pokladna/prodeje` a úklid po změně přiřazení běží BEZ
--    přihlášeného uživatele. Výslovný grant, ne spoléhání na výchozí
--    práva Supabase — funkčnost nesmí záviset na tom, co nikdo nenapsal.
--    `integrace_pripojeni` (select, update), `integrace_tajemstvi`
--    (select) a `synchronizace_behy` už service_role má z banky.
-- ---------------------------------------------------------------------

grant select, insert, delete on public.pokladna_prodeje_denni to service_role;
grant select on public.branches to service_role;
grant select on public.tenants to service_role;
