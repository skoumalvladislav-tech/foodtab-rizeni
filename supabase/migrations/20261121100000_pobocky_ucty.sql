-- =====================================================================
-- Finance Fáze 0, krok 3: pobočky a platební účty
-- =====================================================================
--
-- Co se mění (scénář supabase/tests/krok113_scenar.sql):
--
--   1. JEDNA definice „pobočka bez účtu" pro všechny stránky Financí
--      (Přehled, Platby, Cashflow, Rozpočty, Platby bez faktury):
--      public.pobocky_bez_aktivniho_uctu(firma, pobočka). Počítá se jen
--      AKTIVNÍ platební účet — vypnutý účet je totéž co žádný. Dřív si to
--      každá stránka zjišťovala sama a Rozpočty s KPI počítaly i vypnuté
--      účty (pobočka s jediným vypnutým účtem tak „měla účet", ale součty
--      zůstatků — app.aktualni_zustatky_uctu — ho nepočítaly).
--      SECURITY INVOKER: čte přes RLS jako volající, nic neobchází.
--      Kdo nemá finance.read (za celou firmu, nebo na té pobočce), dostane
--      42501 — ne prázdný seznam, který by se tvářil jako „všechny
--      pobočky mají účet".
--
--   2. ÚPRAVU platebního účtu (pobočka, číslo účtu / IBAN, název,
--      aktivní) smí jen ten, kdo má „Správa financí" ZA CELOU FIRMU.
--      Dřív politika platebni_ucty_write (`for all`) pustila k úpravě
--      i správce jedné pobočky — účet své pobočky si mohl přejmenovat,
--      vypnout nebo přepsat mu číslo, a tím i to, co párování pozná
--      jako účet firmy. Teď:
--        * platebni_ucty_insert  — beze změny (správce pobočky smí založit
--          účet své pobočky; firemní účet jen správce celé firmy);
--        * platebni_ucty_update  — jen finance.manage za celou firmu;
--        * platebni_ucty_spravce_cte — čtení se správou, jak ho dávala
--          stará `for all` politika (nikdo o čtení nepřijde);
--        * mazání dál nikdo (grant DELETE odebrán v 20261006120000).
--      Sloupcový grant: měnit jde jen nazev, branch_id, cislo_uctu,
--      aktivni. Firmu (tenant_id) hlídá i spoušť z kroku 1, typ, měnu
--      a počáteční zůstatek appka měnit nenabízí — kdyby to někdy bylo
--      potřeba: `grant update (sloupec) on public.platebni_ucty to
--      authenticated;`.
--
--   3. Účet, na který míří živé připojení banky, nejde vypnout (spoušť
--      app.hlida_vypnuti_platebniho_uctu) — synchronizace by do něj
--      zapisovala dál a součty by ty pohyby nepočítaly.
--
-- Co se záměrně NEDĚLÁ:
--   * Žádný účet se nikomu nepřiřazuje (otázka 98) a nic se nepřepisuje.
--     Ostrá data se nemění: jen funkce, politiky a granty.
--   * Účet na smazané, vypnuté nebo cizí pobočce se nepřesouvá sám —
--     stránka Platby (Celá firma) ho najde a nabídne opravu člověku.
--   * Spoušť z kroku 1 (app.hlida_firmu_platebniho_uctu) se nemění: cizí
--     pobočku odmítá dál (krok111), smazanou nebo vypnutou nehlídá —
--     přesun NA vypnutou pobočku odmítá až appka (lib/finance-platby-pobocka.ts).

-- ---------------------------------------------------------------------
-- 1. Pobočky bez aktivního platebního účtu
-- ---------------------------------------------------------------------

create function public.pobocky_bez_aktivniho_uctu(p_tenant uuid, p_branch uuid default null)
returns table (pobocka_id uuid, nazev text)
language plpgsql stable security invoker set search_path = ''
as $$
begin
  -- Bez práva NE prázdný seznam: prázdný = „každá pobočka má účet".
  if p_tenant is null or not app.has_access(p_tenant, 'finance.read', p_branch) then
    raise exception 'Nemáte oprávnění vidět finance této firmy nebo pobočky.' using errcode = '42501';
  end if;

  return query
    select b.id, b.name
      from public.branches b
     where b.tenant_id = p_tenant
       and b.deleted_at is null
       -- Bez pobočky: všechny AKTIVNÍ pobočky firmy. S pobočkou: jen ta
       -- (i vypnutá — stránka pobočky se ptá na sebe).
       and (case when p_branch is null then b.active else b.id = p_branch end)
       and not exists (
         select 1
           from public.platebni_ucty u
          where u.tenant_id = p_tenant
            and u.branch_id = b.id
            and u.aktivni
       )
     order by b.name, b.id;
end $$;

comment on function public.pobocky_bez_aktivniho_uctu(uuid, uuid) is
  'Pobočky firmy (bez p_branch: aktivní; s ní: jen ta), které nemají žádný '
  'AKTIVNÍ platební účet — jejich platby nejsou v pobočkových součtech. '
  'Jediná definice pro všechny stránky Financí (krok 3). 42501 bez finance.read.';

revoke all on function public.pobocky_bez_aktivniho_uctu(uuid, uuid) from public, anon;
grant execute on function public.pobocky_bez_aktivniho_uctu(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Úprava účtu jen se Správou financí za celou firmu
-- ---------------------------------------------------------------------

drop policy platebni_ucty_write on public.platebni_ucty;

-- Čtení, které dávala stará `for all` politika správci (i bez finance.read).
create policy platebni_ucty_spravce_cte on public.platebni_ucty for select to authenticated
  using (app.has_access(tenant_id, 'finance.manage', branch_id));

-- Založení: beze změny proti staré politice.
create policy platebni_ucty_insert on public.platebni_ucty for insert to authenticated
  with check (app.has_access(tenant_id, 'finance.manage', branch_id));

-- Úprava: jen za celou firmu (p_branch null = jen členství s rozsahem
-- celé firmy). Správce pobočky dostane 0 změněných řádků.
create policy platebni_ucty_update on public.platebni_ucty for update to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

revoke update on public.platebni_ucty from authenticated;
grant update (nazev, branch_id, cislo_uctu, aktivni) on public.platebni_ucty to authenticated;


-- ---------------------------------------------------------------------
-- 3. Účet, na který míří živé připojení banky, nejde vypnout
--
-- Synchronizace banky na `aktivni` účtu nehledí (lib/banka/konektor.ts):
-- pohyby by do vypnutého účtu chodily dál, ale součty (zůstatky, „pobočky
-- bez účtu") by ho už nepočítaly — peníze by tiše zmizely z čísel. Stejný
-- vzor jako přesun účtu od připojení pobočky (spoušť z kroku 1): nejdřív
-- odpojit, pak vypnout. SECURITY DEFINER, protože musí vidět VŠECHNA
-- připojení účtu, i ta, která volající přes RLS nevidí.
--
-- ROZHODNOUT: (otázka 152) smí se vypnout účet se živým připojením (a pohyby
-- z banky pak brát jako „mimo součty")? Teď opatrněji ne.
-- ---------------------------------------------------------------------

create function app.hlida_vypnuti_platebniho_uctu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.aktivni and not new.aktivni and exists (
    select 1 from public.integrace_pripojeni c
     where c.platebni_ucet_id = new.id
       and (c.odpojeno_kdy is null or c.stav <> 'odpojeno')
  ) then
    raise exception 'Na účet míří živé připojení banky — nejdřív ho v Integracích odpojte, pak účet vypněte.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function app.hlida_vypnuti_platebniho_uctu() is
  'Spoušť: platební účet, na který míří neodpojené připojení banky, nejde vypnout '
  '(pohyby by chodily dál, ale součty by je nepočítaly).';

revoke all on function app.hlida_vypnuti_platebniho_uctu() from public, anon, authenticated;

create trigger trg_vypnuti_platebniho_uctu
  before update of aktivni on public.platebni_ucty
  for each row execute function app.hlida_vypnuti_platebniho_uctu();
