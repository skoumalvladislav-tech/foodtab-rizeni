-- =====================================================================
-- Foodtab — Finance: cross-branch přehled skutečných peněžních pohybů
--
-- Zadání: docs/Foodtab_Claude_Code_nocni_zadani.md, oddíl 4 ("Jasně
-- rozliš skutečnost, plán a odhad."). Plán: proud-scribbling-glade.md,
-- migrace 6.
--
-- Vzor je `public.ranni_prehled` (20260901230000_ranni_prehled.sql) —
-- LEFT JOIN LATERAL přes `branches`, čísla po pobočce, `security definer`
-- s kontrolou oprávnění UVNITŘ dotazu (žádná vlastní autorizace navíc).
--
-- Vrací JEN SKUTEČNOST (ze `transakce`) — plán (z `predpisy_plateb`,
-- opakující se položky rozpočítané po dnech/týdnech/měsících) se
-- NEPOČÍTÁ v SQL. Rekurzivní rozpad period uvnitř stabilní SQL funkce
-- by byl zbytečně složitý a málo čitelný; `lib/finance-prehled.ts` čte
-- `predpisy_plateb` přímo a rozpočítává periody v TS, kde je to vidět
-- a snadno se to testuje. Appka skutečnost a plán na obrazovce ukazuje
-- ODDĚLENĚ, nikdy sloučené do jednoho čísla.
--
-- Vnitřní převody (smer = prevod_dovnitr/prevod_ven) se do příjmů/výdajů
-- NEPOČÍTAJÍ — zadání §5: "Převody mezi účty se v konsolidovaném
-- cashflow nesmí započítat jako příjem/výdaj firmy."
--
-- FIREMNÍ (BEZ POBOČKY) ÚČTY SE DO ŽÁDNÉ POBOČKY NEPOČÍTAJÍ. Zkoušené
-- a zahozené řešení: `coalesce(u.branch_id, b.id) = b.id` — vypadá
-- rozumně, ale u firemního účtu (branch_id null) by `coalesce(null,
-- b.id)` vyšlo `b.id` PRO KAŽDOU POBOČKU ZVLÁŠŤ, takže by se firemní
-- pohyb sečetl tolikrát, kolik má firma poboček. Pobočkový řádek proto
-- vidí jen `u.branch_id = b.id` (striktně); firemní účty vrací
-- samostatně `app.cashflow_prehled_firma` níž, a `lib/finance-prehled.ts`
-- je ukazuje jako zvláštní řádek "celá firma", nikdy sloučené do
-- pobočkového součtu.
-- =====================================================================


create or replace function app.cashflow_prehled(p_tenant uuid, p_od date, p_do date)
returns table (
  branch_id      uuid,
  pobocka        text,
  prijmy_haleru  integer,
  vydaje_haleru  integer
)
language sql stable security definer set search_path = ''
as $$
  select
    b.id,
    b.name,
    coalesce(t.prijmy, 0),
    coalesce(t.vydaje, 0)
  from public.branches b
  left join lateral (
    select
      sum(x.castka_haleru) filter (where x.smer = 'prijem')::integer as prijmy,
      sum(x.castka_haleru) filter (where x.smer = 'vydaj')::integer as vydaje
    from public.transakce x
    join public.platebni_ucty u on u.id = x.ucet_id
    where u.branch_id = b.id
      and u.tenant_id = p_tenant
      and x.datum between p_od and p_do
  ) t on true
  where b.tenant_id = p_tenant
    and b.deleted_at is null
    and b.active
    and app.has_access(p_tenant, 'finance.read')
  order by b.name;
$$;

comment on function app.cashflow_prehled(uuid, date, date) is
  'Skutečné příjmy/výdaje po pobočkách za dané období, ze `transakce`. '
  'Jen účty SE SVOU pobočkou (platebni_ucty.branch_id = té pobočky) — '
  'firemní účty (branch_id is null) vrací app.cashflow_prehled_firma, '
  'ne tahle funkce, aby se nesečetly do každé pobočky zvlášť. Plán je '
  'samostatný výpočet v `lib/finance-prehled.ts` z `predpisy_plateb` — '
  'tahle funkce o budoucnu nic neví.';

revoke all on function app.cashflow_prehled(uuid, date, date) from public, anon;
grant execute on function app.cashflow_prehled(uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- FIREMNÍ (BEZ POBOČKY) ÚČTY — samostatně, jedno číslo za celou firmu.
-- ---------------------------------------------------------------------

create or replace function app.cashflow_prehled_firma(p_tenant uuid, p_od date, p_do date)
returns table (
  prijmy_haleru integer,
  vydaje_haleru integer
)
language sql stable security definer set search_path = ''
as $$
  select
    coalesce(sum(x.castka_haleru) filter (where x.smer = 'prijem'), 0)::integer,
    coalesce(sum(x.castka_haleru) filter (where x.smer = 'vydaj'), 0)::integer
  from public.transakce x
  join public.platebni_ucty u on u.id = x.ucet_id
  where u.branch_id is null
    and u.tenant_id = p_tenant
    and x.datum between p_od and p_do
    and app.has_access(p_tenant, 'finance.read')
$$;

comment on function app.cashflow_prehled_firma(uuid, date, date) is
  'Skutečné příjmy/výdaje z firemních (bez pobočky) platebních účtů — '
  'doplňuje app.cashflow_prehled, nikdy se s ním nesčítá do jednoho '
  'pobočkového řádku.';

revoke all on function app.cashflow_prehled_firma(uuid, date, date) from public, anon;
grant execute on function app.cashflow_prehled_firma(uuid, date, date) to authenticated;
