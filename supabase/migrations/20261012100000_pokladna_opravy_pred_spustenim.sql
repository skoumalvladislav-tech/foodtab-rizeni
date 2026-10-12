-- =====================================================================
-- Foodtab — Pokladny: opravy před prvním ostrým připojením Dotykačky
--
-- 12. 10. 2026 přišly od Dotykačky přístupové údaje (Client ID a Secret).
-- Před prvním ostrým připojením prošla napojení pokladen kontrola kódu
-- (5 pohledů, ověřeno dalším agentem). Tahle migrace řeší databázovou část:
--
--   1. `pokladna_nahradit_prodeje` u firemního připojení (pokladna
--      s tokenem) nově chce PROVOZOVNU pokladny a zapíše jen do pobočky,
--      ke které je přiřazená PRÁVĚ TAHLE provozovna. Dřív stačilo, že
--      k pobočce byla přiřazená jakákoli provozovna — běh synchronizace
--      se starým přiřazením v paměti tak mohl po přeřazení zapsat prodeje
--      Perly do pobočky, která mezitím patřila Bernardu.
--      Navíc odmítne tržbu produktu za den mimo rozsah sloupce (integer)
--      srozumitelnou chybou, ne „integer out of range".
--   2. `pokladna_ulozit_postup` — kurzory synchronizace (`dohnano_od`,
--      `souvisle_do`) se slučují v databázi, atomicky, jen u provozoven,
--      jejichž přiřazení se mezitím nezměnilo. Dřív běh na konci zapsal
--      celé `externi_ucet` ze stavu na svém začátku a přiřazení uložené
--      během běhu tiše vrátil.
--   3. Receptura se k prodeji dosadí i dodatečně: když receptura vznikne
--      (nebo se přejmenuje, aktivuje) až po stažení prodejů. Dřív se
--      párovalo jen při zápisu prodeje — historie stažená v den připojení
--      by zůstala „bez nákladu" navždy. Jednorázově se dopárují i řádky,
--      které už v databázi jsou (CSV z doby před 11. 10.).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ZÁPIS PRODEJŮ — provozovna u firemního připojení
-- ---------------------------------------------------------------------

drop function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb);

create function public.pokladna_nahradit_prodeje(
  p_pripojeni   uuid,
  p_branch      uuid,
  p_dny         date[],
  p_radky       jsonb, -- [{datum, produkt_nazev, mnozstvi, trzba_haleru}]
  p_provozovna  text default null -- id provozovny U POSKYTOVATELE; povinné u firemního připojení
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
    -- Připojení pro pobočku (příjmové API): jen vlastní pobočka.
    if p_branch is not null and p_branch <> v_branch then
      raise exception 'Tohle připojení patří jiné pobočce.' using errcode = 'check_violation';
    end if;
  -- Bez provozovny (p_provozovna null) shoda nevznikne nikdy — odmítne to tatáž podmínka.
  elsif p_branch is null or not exists (
    select 1
      from jsonb_array_elements(coalesce(v_ucet -> 'provozovny', '[]'::jsonb)) as e
     where e ->> 'id' = p_provozovna
       and e ->> 'branch_id' = p_branch::text
  ) then
    raise exception 'K téhle pobočce není přiřazená tahle provozovna pokladny.' using errcode = 'check_violation';
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
  -- Součet za produkt a den musí se vejít do sloupce (integer) — jinak by
  -- spadl celý zápis s nesrozumitelnou chybou a pokladna by ho opakovala.
  if exists (
    select 1
      from jsonb_to_recordset(coalesce(p_radky, '[]'::jsonb)) as r(datum date, produkt_nazev text, trzba_haleru bigint)
     group by r.datum, btrim(r.produkt_nazev)
    having sum(r.trzba_haleru) > 2147483647 or sum(r.trzba_haleru) < 0
  ) then
    raise exception 'Tržba produktu za den je mimo rozsah (nejvýš 21 474 836,47 Kč) — nejspíš haléře místo korun.' using errcode = 'numeric_value_out_of_range';
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

comment on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text) is
  'Zápis prodejů z napojené pokladny: přepíše zadané dny jedné pobočky '
  'z téhle pokladny (storno zmizí, nic se nezdvojí). Pobočku hlídá '
  'připojení: vlastní pobočka, nebo u firemního připojení pobočka, ke '
  'které je přiřazená PRÁVĚ zadaná provozovna. Jen service_role.';

revoke all on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text) from public, anon, authenticated;
grant execute on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text) to service_role;


-- ---------------------------------------------------------------------
-- 2. POSTUP SYNCHRONIZACE — sloučit kurzory, nepřepsat přiřazení
--
-- `p_postup` = [{id, branch_id, dohnano_od, souvisle_do}] z jednoho běhu.
-- Kurzor se zapíše jen provozovně se STEJNÝM id i pobočkou, jakou běh
-- používal — přeřazená provozovna (nová pobočka začíná od nuly) ani nově
-- přidaná nic z běhu nedostane. Ostatní klíče `externi_ucet` (Cloud ID,
-- přiřazení, název) zůstávají, jak jsou v databázi TEĎ. `historie_od`
-- se doplní, jen když chybí. Jeden UPDATE = zámek řádku, žádné okno mezi
-- čtením a zápisem.
-- ---------------------------------------------------------------------

create function public.pokladna_ulozit_postup(
  p_pripojeni   uuid,
  p_postup      jsonb,
  p_historie_od date default null
)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  update public.integrace_pripojeni c
     set externi_ucet = jsonb_set(
           coalesce(c.externi_ucet, '{}'::jsonb)
             || case when p_historie_od is null or coalesce(c.externi_ucet, '{}'::jsonb) ? 'historie_od'
                     then '{}'::jsonb
                     else jsonb_build_object('historie_od', p_historie_od) end,
           '{provozovny}',
           coalesce((
             select jsonb_agg(
                      case when n.id is null then e
                           else e || jsonb_strip_nulls(jsonb_build_object('dohnano_od', n.dohnano_od, 'souvisle_do', n.souvisle_do))
                      end
                      order by x.poradi)
               from jsonb_array_elements(coalesce(c.externi_ucet -> 'provozovny', '[]'::jsonb)) with ordinality as x(e, poradi)
               left join jsonb_to_recordset(coalesce(p_postup, '[]'::jsonb))
                    as n(id text, branch_id text, dohnano_od text, souvisle_do text)
                 on n.id = x.e ->> 'id'
                and n.branch_id = x.e ->> 'branch_id'
           ), '[]'::jsonb))
   where c.id = p_pripojeni
     and c.oblast = 'pokladna'
     and c.odpojeno_kdy is null;
end $$;

comment on function public.pokladna_ulozit_postup(uuid, jsonb, date) is
  'Kurzory synchronizace pokladny (dohnano_od, souvisle_do) — sloučí jen '
  'provozovnám se stejným id i pobočkou, přiřazení nemění. Jen service_role.';

revoke all on function public.pokladna_ulozit_postup(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function public.pokladna_ulozit_postup(uuid, jsonb, date) to service_role;


-- ---------------------------------------------------------------------
-- 3. RECEPTURA K PRODEJI I DODATEČNĚ
--
-- Stejné pravidlo jako `app.prodej_najdi_recepturu` (20261011100000):
-- přesná shoda názvu bez ohledu na velikost písmen a okrajové mezery,
-- aktivní receptura té firmy, pro celou firmu nebo pro pobočku prodeje.
-- Doplňuje se JEN tam, kde receptura chybí — dřív dosazenou shodu
-- nic nepřepisuje. SECURITY DEFINER: recepturu upravuje i člověk, který
-- prodeje číst nesmí; funkce sahá jen na řádky téže firmy (`new.tenant_id`).
-- ---------------------------------------------------------------------

create function app.receptura_doparovat_prodeje()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.active then
    return null;
  end if;

  update public.pokladna_prodeje_denni p
     set recipe_id = new.id
   where p.tenant_id = new.tenant_id
     and p.recipe_id is null
     and (new.branch_id is null or p.branch_id = new.branch_id)
     and lower(btrim(p.produkt_nazev)) = lower(btrim(new.name));
  return null;
end $$;

revoke all on function app.receptura_doparovat_prodeje() from public, anon, authenticated;

create trigger trg_receptura_doparovat_prodeje
  after insert or update of name, active, branch_id on public.recipes
  for each row execute function app.receptura_doparovat_prodeje();

-- Jednorázově: prodeje, které už v databázi jsou a recepturu nemají.
update public.pokladna_prodeje_denni p
   set recipe_id = r.id
  from public.recipes r
 where p.recipe_id is null
   and r.tenant_id = p.tenant_id
   and r.active
   and (r.branch_id is null or r.branch_id = p.branch_id)
   and lower(btrim(r.name)) = lower(btrim(p.produkt_nazev));
