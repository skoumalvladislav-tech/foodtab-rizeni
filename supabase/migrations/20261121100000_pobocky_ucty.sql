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
--      Sloupcový grant i na ZALOŽENÍ: jen tenant_id, branch_id, nazev,
--      typ, cislo_uctu — přesně to, co posílá formulář nového účtu
--      (zalozitPlatebniUcet, app/[rozsah]/finance/platby/akce.ts). Dřív
--      měl přihlášený INSERT na celou tabulku: správce jedné pobočky si
--      přímým zápisem přes REST založil účet své pobočky s libovolným
--      počátečním zůstatkem (app.aktualni_zustatky_uctu ho přičte do
--      zůstatku pobočky i celé firmy, a opravit ho pak nejde), měnou,
--      vypnutý nebo s vlastním id. Ostatní sloupce dostanou výchozí
--      hodnotu; služba (service_role) má svá práva.
--      ROZHODNOUT: (otázka 157) kdo a jak smí zapsat počáteční zůstatek
--      a měnu účtu — appka to dnes nenabízí; až bude, pak RPC jen pro
--      Správu financí za celou firmu, ne grant sloupce všem přihlášeným.
--
--   3. Vypnutý účet a živé připojení banky se nesejdou (spouště
--      app.hlida_vypnuti_platebniho_uctu a app.hlida_pripojeni_vypnuteho_uctu)
--      — z obou stran: účet se živým připojením nejde vypnout a k vypnutému
--      účtu nejde připojení založit, přesměrovat ho na něj ani vrátit
--      odpojené do živého stavu. Synchronizace by do něj zapisovala
--      dál a součty (zůstatky, „pobočky bez účtu") by ty pohyby
--      nepočítaly. Jedna definice „živého připojení": app.pripojeni_je_zive.
--
--   4. Na vypnutý účet přihlášený platbu nezapíše (spoušť
--      app.hlida_zapis_na_vypnuty_ucet). Appka to hlídá u ruční platby
--      i importu výpisu, ale přímý zápis přes REST (POST /rest/v1/transakce)
--      a volání importovat_vypis / importovat_transakce by to obešly —
--      a pohyb na vypnutém účtu ze zůstatků zmizí (app.aktualni_zustatky_uctu
--      počítá jen aktivní účty). Synchronizace banky (služba) zapisuje dál:
--      staré živé připojení na vypnutém účtu nesmí přestat stahovat.
--      ROZHODNOUT: (otázka 159) smí se na vypnutý účet dopsat platba
--      (doplnění historie zavřeného účtu)? Teď ne — nejdřív účet zapnout.
--
--   5. Společný firemní účet (rozhodnutí Šéfíka 25. 11. 2026, otázky 98
--      a 114 — dodatek 3d): obě pobočky platí přes JEDEN firemní účet bez
--      pobočky. Pobočka bez vlastního účtu proto u firmy s aktivním
--      firemním účtem není chyba — stránky místo varování vysvětlí, že
--      její platby jsou v přehledu za celou firmu. Appka k tomu potřebuje
--      jen ANO/NE, i na pobočce, kde firemní účet přes RLS vidět není:
--      public.firma_ma_firemni_ucet(firma). Vrací JEN boolean.
--
-- Co se záměrně NEDĚLÁ:
--   * Žádný účet se nikomu nepřiřazuje (otázka 98) a nic se nepřepisuje.
--     Platby firemního účtu se žádné pobočce nepřipisují — to je budoucí
--     funkce (otázka 280), ne tahle migrace.
--     Ostrá data se nemění: jen funkce, politiky, granty a spouště.
--     Vypnutý účet, na který už dnes míří živé připojení, migrace jen
--     ohlásí (raise warning s počtem) — neodpojuje ho ani účet nezapíná.
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
-- 1b. Má firma aktivní firemní účet? Jen ANO/NE (dodatek 3d)
--
-- Rozhodnutí Šéfíka 25. 11. 2026 (otázky 98 a 114): Bernard Bar Tábor
-- i Restaurace Černá Perla platí přes JEDEN společný firemní účet. Účet
-- zůstává bez pobočky a jeho platby se žádné pobočce nepřipisují
-- (připsání pobočce = budoucí funkce, otázka 280). Stránky podle téhle
-- odpovědi rozhodnou, jestli pobočku bez vlastního účtu VAROVÁNÍM
-- jmenují (firma nemá žádný aktivní účet bez pobočky), nebo jen klidně
-- vysvětlí, že platí přes firemní účet.
--
-- Firemní účet = bez pobočky (branch_id null) a AKTIVNÍ: vypnutý je totéž
-- co žádný, stejně jako v pobocky_bez_aktivniho_uctu. Smazaný účet
-- neexistuje — účty se nemažou (grant DELETE odebrán v 20261006120000)
-- a sloupec pro označení smazání tabulka nemá.
--
-- ROZHODNOUT: (otázka 281) počítá se KAŽDÝ typ účtu bez pobočky (banka,
-- pokladna, karta), jak zadání definuje firemní účet. Kdyby za firemní
-- účet měl platit jen bankovní účet (typ = 'banka'), přibude podmínka
-- u.typ = 'banka' a firma s jedinou firemní pokladnou dostane zase
-- varování. Čísla se tím nemění — jen to, co stránky říkají.
--
-- SECURITY DEFINER schválně: kdo má finance.read jen na pobočce, firemní
-- účet přes RLS nevidí (platebni_ucty_read) a vidět ho nemá — appka mu
-- přesto má říct „platby pobočky můžou chodit přes firemní účet, který
-- tady nevidíte", ne „pobočka nemá účet". Proto:
--   * vrací JEN ano/ne — nic o čísle, názvu ani zůstatku;
--   * právo si kontroluje sama: finance.read na JAKÉKOLI úrovni v té
--     firmě (app.has_permission — za celou firmu i na pobočce), jinak
--     42501 jako pobocky_bez_aktivniho_uctu (ne „ne", které by se tvářilo
--     jako odpověď);
--   * uvnitř definer RLS neplatí — firmu filtruje dotaz sám, jednou.
-- ---------------------------------------------------------------------

create function public.firma_ma_firemni_ucet(p_tenant uuid)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(app.has_permission(p_tenant, 'finance.read'), false) then
    raise exception 'Nemáte oprávnění vidět finance této firmy.' using errcode = '42501';
  end if;

  return exists (
    select 1
      from public.platebni_ucty u
     where u.tenant_id = p_tenant
       and u.branch_id is null
       and u.aktivni
  );
end $$;

comment on function public.firma_ma_firemni_ucet(uuid) is
  'Má firma AKTIVNÍ platební účet bez pobočky (firemní účet)? Jen ano/ne — '
  'i pro toho, kdo má finance.read jen na pobočce a firemní účet přes RLS '
  'nevidí. 42501 bez finance.read v té firmě. Dodatek 3d (otázky 98, 114).';

revoke all on function public.firma_ma_firemni_ucet(uuid) from public, anon;
grant execute on function public.firma_ma_firemni_ucet(uuid) to authenticated;


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

-- Založení jen se sloupci formuláře nového účtu (zalozitPlatebniUcet).
-- Počáteční zůstatek, měna, aktivní, id a čas založení = výchozí hodnoty.
revoke insert on public.platebni_ucty from authenticated;
grant insert (tenant_id, branch_id, nazev, typ, cislo_uctu) on public.platebni_ucty to authenticated;


-- ---------------------------------------------------------------------
-- 3. Vypnutý účet a živé připojení banky se nesejdou
--
-- Synchronizace banky na `aktivni` účtu nehledí (lib/banka/konektor.ts):
-- pohyby by do vypnutého účtu chodily dál, ale součty (zůstatky, „pobočky
-- bez účtu") by ho už nepočítaly — peníze by tiše zmizely z čísel. Proto
-- z OBOU stran:
--   a) účet, na který míří živé připojení, nejde vypnout (nejdřív odpojit,
--      pak vypnout — stejný vzor jako přesun účtu od připojení pobočky,
--      spoušť z kroku 1);
--   b) k vypnutému účtu nejde připojení založit, přesměrovat na něj živé
--      připojení ani vrátit odpojené do živého stavu (nejdřív účet zapnout).
-- Obě spouště jsou SECURITY DEFINER: musí vidět VŠECHNA připojení účtu
-- a účet sám, i když je volající přes RLS nevidí (správce integrací bez
-- finance.read). Podle role nerozhodují, firmu si filtrují samy.
--
-- Souběh: spoušť b) zamkne řádek účtu (`for share`). Vypnutí účtu drží
-- zámek řádku účtu, takže založení připojení počká, až vypnutí skončí,
-- a uvidí účet už vypnutý; a vypnutí počká na založené připojení a jeho
-- dotaz na připojení ho uvidí. Bez zámku by dvě souběžné transakce prošly
-- obě.
--
-- ROZHODNOUT: (otázka 152) smí se vypnout účet se živým připojením (a pohyby
-- z banky pak brát jako „mimo součty")? Teď opatrněji ne.
-- ---------------------------------------------------------------------

-- Jedna definice „živého" připojení pro obě spouště: neodpojené (bez
-- času odpojení), nebo se stavem jiným než odpojeno — i když jen jedno
-- z toho, synchronizace by ho mohla brát jako běžící.
create function app.pripojeni_je_zive(p_stav text, p_odpojeno_kdy timestamptz)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_odpojeno_kdy is null or p_stav is distinct from 'odpojeno'
$$;

comment on function app.pripojeni_je_zive(text, timestamptz) is
  'Živé připojení = bez času odpojení, nebo se stavem jiným než odpojeno. '
  'Jedna definice pro spouště vypnutého účtu (krok 3).';

revoke all on function app.pripojeni_je_zive(text, timestamptz) from public, anon, authenticated;

create function app.hlida_vypnuti_platebniho_uctu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.aktivni and not new.aktivni and exists (
    select 1 from public.integrace_pripojeni c
     where c.platebni_ucet_id = new.id
       and app.pripojeni_je_zive(c.stav, c.odpojeno_kdy)
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


-- b) Živé připojení jen k zapnutému účtu.
--
-- Hlídá jen PŘECHOD do „živé připojení k vypnutému účtu": založení,
-- přesměrování na jiný účet, návrat odpojeného do živého stavu. Připojení,
-- které už živé na tomtéž účtu je (stará data z doby před touhle
-- spouští), se nehlídá znovu — synchronizace (service_role) mu mění stav
-- mezi pripojeno, chyba a vyzaduje_pozornost a nesmí kvůli tomu spadnout.
create function app.hlida_pripojeni_vypnuteho_uctu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_aktivni boolean;
begin
  if new.platebni_ucet_id is null or not app.pripojeni_je_zive(new.stav, new.odpojeno_kdy) then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.platebni_ucet_id is not distinct from new.platebni_ucet_id
     and app.pripojeni_je_zive(old.stav, old.odpojeno_kdy) then
    return new;
  end if;

  -- Účet téže firmy (definer: RLS tu neplatí, firmu filtruje dotaz sám;
  -- účet cizí firmy odmítá spoušť z kroku 1). Zámek viz Souběh nahoře.
  select u.aktivni into v_aktivni
    from public.platebni_ucty u
   where u.id = new.platebni_ucet_id
     and u.tenant_id = new.tenant_id
     for share;
  if v_aktivni is false then
    raise exception 'Platební účet je vypnutý — nejdřív ho v Platbách zapněte, pak k němu připojte banku.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function app.hlida_pripojeni_vypnuteho_uctu() is
  'Spoušť: živé připojení banky nejde založit, přesměrovat ani obnovit k vypnutému '
  'platebnímu účtu (pohyby by chodily do účtu, který součty nepočítají).';

revoke all on function app.hlida_pripojeni_vypnuteho_uctu() from public, anon, authenticated;

create trigger trg_pripojeni_vypnuteho_uctu
  before insert or update of platebni_ucet_id, stav, odpojeno_kdy on public.integrace_pripojeni
  for each row execute function app.hlida_pripojeni_vypnuteho_uctu();


-- ---------------------------------------------------------------------
-- 4. Na vypnutý účet přihlášený platbu nezapíše
--
-- SECURITY INVOKER schválně (vzor app.hlida_zdroj_transakce): rozhoduje
-- role, která zapisuje (current_user), ne vlastník funkce. Přihlášený
-- (přímý zápis přes REST, importovat_vypis i importovat_transakce — obě
-- běží s právy volajícího) na vypnutý účet nezapíše. Služba a SECURITY
-- DEFINER funkce (current_user = vlastník) ano: synchronizace banky staré
-- živé připojení na vypnutém účtu dál stahuje (oddíl 3b).
--
-- Účet se čte přes RLS jako přihlášený. Nenajde-li ho (není vidět, nebo
-- je jiné firmy), spoušť nerozhoduje — takový zápis odmítne politika
-- transakce_insert (finance.manage za celou firmu vidí všechny účty
-- firmy) a spoušť firmy app.hlida_firmu_transakce. Firma se tu proto
-- nefiltruje podruhé.
--
-- Hlídá jen INSERT: přihlášený transakci měnit nemůže (bez grantu UPDATE
-- a pravidlo transakce_no_update), staré platby na vypnutém účtu zůstávají.
-- ---------------------------------------------------------------------

create function app.hlida_zapis_na_vypnuty_ucet()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_aktivni boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  select u.aktivni into v_aktivni
    from public.platebni_ucty u
   where u.id = new.ucet_id;
  if v_aktivni is false then
    raise exception 'Platební účet je vypnutý — platbu na něj zapsat nejde. Zapněte ho v pohledu Celá firma → Platby → Platební účty, nebo platbu zapište na jiný účet.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function app.hlida_zapis_na_vypnuty_ucet() is
  'Spoušť: přihlášený (přímý zápis i import výpisu) nezapíše platbu na vypnutý '
  'platební účet — součty ho nepočítají. Služba zapisuje dál (synchronizace banky).';

revoke all on function app.hlida_zapis_na_vypnuty_ucet() from public, anon, authenticated;

create trigger trg_zapis_na_vypnuty_ucet
  before insert on public.transakce
  for each row execute function app.hlida_zapis_na_vypnuty_ucet();


-- Stará data: vypnutý účet, na který už živé připojení míří, se jen
-- ohlásí — nic se neodpojuje ani nezapíná (ostrá data se nemění).
do $$
declare
  n integer;
begin
  select count(*) into n
    from public.platebni_ucty u
    join public.integrace_pripojeni c on c.platebni_ucet_id = u.id and c.tenant_id = u.tenant_id
   where not u.aktivni
     and app.pripojeni_je_zive(c.stav, c.odpojeno_kdy);
  if n > 0 then
    raise warning 'Vypnutý platební účet s živým připojením banky: % — v Integracích odpojit, nebo účet v Platbách zapnout.', n;
  end if;
end $$;
