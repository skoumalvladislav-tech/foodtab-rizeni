-- =====================================================================
-- Tržby z pokladen v přehledech + platby podle způsobu
--
-- Do 12. 10. 2026 četla prodeje z pokladen jen stránka Finance →
-- Integrace → Prodeje (posledních N dní) a teoretický foodcost. Karta
-- „Tržby" na Přehledu brala PŘÍJMY Z PLATEB (`transakce`) — u firmy
-- bez nahraných výpisů nulu, i když z Dotykačky ležel v databázi celý
-- rok prodejů. Šéfík 12. 10.: „potřebuju rozdělit přehled po
-- provozovnách a platbách, firmě jako celku, dále po dnech, měsících
-- a rocích" — platbami myslí ZPŮSOB PLATBY (hotovost, karta, stravenky…)
-- a k tomu srovnání s příjmy z banky.
--
--   1. `pokladna_platby_denni` — denní součet po způsobu platby
--      a pobočce. Dotykačka ho posílá v tomtéž „Base Sales Report",
--      ze kterého se už berou prodeje (`revenue.paymentTypeInfo`) —
--      appka ho dosud zahazovala.
--   2. `pokladna_nahradit_prodeje` + `p_platby`: platby se přepisují
--      v TÉŽE transakci jako prodeje téhož dne. `p_platby = null` =
--      pokladna platby neposílá (příjmové API) → platby se nemění.
--   3. `pokladna_odebrat_prodeje` maže i platby připojení.
--   4. `pokladna_prehled_trzeb` — jeden dotaz pro přehledy: tržby,
--      platby po druhu, rozpad po způsobu a příjmy na bankovní účty,
--      po dnech / měsících / rocích a po pobočkách. Vrací JSON (jeden
--      řádek), takže ho nemůže potichu useknout strop řádků PostgRESTu.
--   5. `pokladna_ulozit_postup` slučuje i kurzor plateb `platby_dohnano_od`
--      a kurzory historie necouvají — synchronizace podle něj dožene
--      historii znovu, tentokrát s platbami. Migrace žádný kurzor nemaže,
--      takže na pořadí nasazení kódu a migrace nezáleží (kód bez migrace
--      zapisuje bez plateb a přehled hlásí „čeká na aktualizaci databáze";
--      starý kód s migrací platby jen nestahuje).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PLATBY PO ZPŮSOBU A DNI
-- ---------------------------------------------------------------------

create table public.pokladna_platby_denni (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  branch_id              uuid not null references public.branches(id) on delete cascade,
  datum                  date not null,
  -- Klíč způsobu U POSKYTOVATELE (Dotykačka: id platební metody, např.
  -- 900000001) — appka ho nevykládá, jen podle něj sčítá a páruje.
  zpusob                 text not null check (zpusob ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  nazev                  text not null check (length(btrim(nazev)) between 1 and 120),
  -- Skupina pro přehled — tu rozhoduje adaptér (lib/pokladna-platby.ts).
  druh                   text not null check (druh in
                           ('hotovost', 'karta', 'stravenky', 'poukaz', 'prevod',
                            'online', 'rozvoz', 'odpis', 'jine')),
  pocet                  integer not null default 0 check (pocet >= 0),
  -- Může být záporné: vratky převážily platby téhož způsobu.
  castka_haleru          integer not null,
  zdroj                  text not null check (zdroj ~ '^[a-z][a-z0-9_]{1,39}$'),
  integrace_pripojeni_id uuid references public.integrace_pripojeni(id) on delete set null,
  created_at             timestamptz not null default now()
);

comment on table public.pokladna_platby_denni is
  'Denní součet plateb po způsobu (hotovost, karta, stravenky…) a pobočce '
  'z napojené pokladny. Píše jen pokladna_nahradit_prodeje (service_role), '
  'čte se přes RLS finance.read v pobočce.';

create unique index pokladna_platby_den_zpusob on public.pokladna_platby_denni
  (tenant_id, branch_id, datum, zpusob, zdroj);

create index pokladna_platby_pripojeni on public.pokladna_platby_denni (integrace_pripojeni_id)
  where integrace_pripojeni_id is not null;

alter table public.pokladna_platby_denni enable row level security;

-- Výslovně i service_role: výchozí práva Supabase by jí daly i UPDATE
-- a TRUNCATE, které zápis přes funkci nepotřebuje.
revoke all on public.pokladna_platby_denni from anon, authenticated, service_role;
grant select on public.pokladna_platby_denni to authenticated;
grant select, insert, delete on public.pokladna_platby_denni to service_role;

create policy pokladna_platby_read on public.pokladna_platby_denni for select to authenticated
  using (app.can_read_scoped(tenant_id, 'finance.read', branch_id));

-- Druhá linie: pobočka i připojení patří firmě řádku (stejný tvar jako
-- app.hlida_firmu_pokladna_prodeje).
create function app.hlida_firmu_pokladna_platby()
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
  if new.integrace_pripojeni_id is not null and not exists (
    select 1 from public.integrace_pripojeni c
    where c.id = new.integrace_pripojeni_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Připojení pokladny nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_pokladna_platby() from public, anon, authenticated;

create trigger trg_firma_pokladna_platby
  before insert or update of tenant_id, branch_id, integrace_pripojeni_id on public.pokladna_platby_denni
  for each row execute function app.hlida_firmu_pokladna_platby();


-- ---------------------------------------------------------------------
-- 2. ZÁPIS PRODEJŮ I PLATEB — jedna transakce na den
--
-- Beze změny proti 20261012100000 kromě `p_platby` (na konci, s výchozí
-- hodnotou — volání s pěti parametry funguje dál). Platby z ODPOJENÉHO
-- jiného API zdroje téže pobočky a dne ustupují stejně jako jeho
-- prodeje, i když živá pokladna platby neposílá.
-- ---------------------------------------------------------------------

drop function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text);

create function public.pokladna_nahradit_prodeje(
  p_pripojeni   uuid,
  p_branch      uuid,
  p_dny         date[],
  p_radky       jsonb, -- [{datum, produkt_nazev, mnozstvi, trzba_haleru}]
  p_provozovna  text default null, -- id provozovny U POSKYTOVATELE; povinné u firemního připojení
  p_platby      jsonb default null -- [{datum, zpusob, nazev, druh, pocet, castka_haleru}]; null = platby nepřepisovat
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
  -- FOR SHARE: odpojení / přeřazení (UPDATE téhož řádku) počká, až tenhle
  -- zápis doběhne; úklid, který po nich přijde, pak jeho řádky už vidí.
  select c.tenant_id, c.branch_id, c.poskytovatel || '_api', c.externi_ucet
    into v_tenant, v_branch, v_zdroj, v_ucet
    from public.integrace_pripojeni c
   where c.id = p_pripojeni
     and c.oblast = 'pokladna'
     and c.odpojeno_kdy is null
     for share;

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

  if p_platby is not null then
    if jsonb_typeof(p_platby) <> 'array' then
      raise exception 'Platby musí být seznam.' using errcode = 'invalid_parameter_value';
    end if;
    if exists (
      select 1
        from jsonb_to_recordset(p_platby) as r(datum date)
       where r.datum is null or not (r.datum = any (p_dny))
    ) then
      raise exception 'Platba patří ke dni, který se nepřepisuje.' using errcode = 'invalid_parameter_value';
    end if;
    if exists (
      select 1
        from jsonb_to_recordset(p_platby) as r(datum date, zpusob text, castka_haleru bigint, pocet bigint)
       group by r.datum, r.zpusob
      having abs(sum(r.castka_haleru)) > 2147483647 or sum(r.pocet) > 2147483647
    ) then
      raise exception 'Součet plateb jednoho způsobu za den je mimo rozsah (nejvýš 21 474 836,47 Kč).' using errcode = 'numeric_value_out_of_range';
    end if;
  end if;

  -- Dva zápisy téže pobočky z téže pokladny (dvě dávky z příjmového API,
  -- úloha a ruční tlačítko) jdou za sebou, ne přes sebe.
  perform pg_advisory_xact_lock(hashtextextended('pokladna:' || v_branch::text || ':' || v_zdroj, 0));

  delete from public.pokladna_prodeje_denni p
   where p.tenant_id = v_tenant
     and p.branch_id = v_branch
     and p.zdroj = v_zdroj
     and p.datum = any (p_dny);

  -- Jiný API zdroj téže pobočky a dne, který zapsalo ODPOJENÉ připojení
  -- (přechod z příjmového API na Dotykačku a zpět): ustoupí živému — dvě
  -- API se ve foodcostu nesčítají jen tehdy, když jedno z nich zmizí.
  -- CSV zůstává (foodcost ho za den s API sám nepočítá).
  delete from public.pokladna_prodeje_denni p
   where p.tenant_id = v_tenant
     and p.branch_id = v_branch
     and p.datum = any (p_dny)
     and p.zdroj <> 'csv'
     and p.zdroj <> v_zdroj
     and (p.integrace_pripojeni_id is null
          or exists (select 1 from public.integrace_pripojeni o
                      where o.id = p.integrace_pripojeni_id and o.odpojeno_kdy is not null));

  -- Totéž pro platby: jejich prodeje právě zmizely, nesmí po nich zůstat.
  delete from public.pokladna_platby_denni z
   where z.tenant_id = v_tenant
     and z.branch_id = v_branch
     and z.datum = any (p_dny)
     and z.zdroj <> v_zdroj
     and (z.integrace_pripojeni_id is null
          or exists (select 1 from public.integrace_pripojeni o
                      where o.id = z.integrace_pripojeni_id and o.odpojeno_kdy is not null));

  insert into public.pokladna_prodeje_denni
    (tenant_id, branch_id, datum, produkt_nazev, mnozstvi, trzba_haleru, zdroj, integrace_pripojeni_id)
  select v_tenant, v_branch, r.datum, btrim(r.produkt_nazev), sum(r.mnozstvi), sum(r.trzba_haleru), v_zdroj, p_pripojeni
    from jsonb_to_recordset(coalesce(p_radky, '[]'::jsonb))
         as r(datum date, produkt_nazev text, mnozstvi numeric, trzba_haleru bigint)
   group by r.datum, btrim(r.produkt_nazev);

  get diagnostics v_pocet = row_count;

  if p_platby is not null then
    delete from public.pokladna_platby_denni z
     where z.tenant_id = v_tenant
       and z.branch_id = v_branch
       and z.zdroj = v_zdroj
       and z.datum = any (p_dny);

    insert into public.pokladna_platby_denni
      (tenant_id, branch_id, datum, zpusob, nazev, druh, pocet, castka_haleru, zdroj, integrace_pripojeni_id)
    select v_tenant, v_branch, r.datum, r.zpusob, max(btrim(r.nazev)), max(r.druh),
           coalesce(sum(r.pocet), 0), sum(r.castka_haleru), v_zdroj, p_pripojeni
      from jsonb_to_recordset(p_platby)
           as r(datum date, zpusob text, nazev text, druh text, pocet bigint, castka_haleru bigint)
     group by r.datum, r.zpusob;
  end if;

  return v_pocet;
end $$;

comment on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb) is
  'Zápis prodejů (a plateb po způsobu, je-li p_platby) z napojené pokladny: '
  'přepíše zadané dny jedné pobočky z téhle pokladny (storno zmizí, nic se '
  'nezdvojí). Pobočku hlídá připojení: vlastní pobočka, nebo u firemního '
  'připojení pobočka, ke které je přiřazená PRÁVĚ zadaná provozovna. '
  'Vrací počet zapsaných řádků prodeje. Jen service_role.';

revoke all on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.pokladna_nahradit_prodeje(uuid, uuid, date[], jsonb, text, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 3. ÚKLID — i platby
-- ---------------------------------------------------------------------

create or replace function public.pokladna_odebrat_prodeje(p_pripojeni uuid, p_branch uuid)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pocet integer;
begin
  delete from public.pokladna_platby_denni z
   where z.integrace_pripojeni_id = p_pripojeni
     and (p_branch is null or z.branch_id = p_branch);

  delete from public.pokladna_prodeje_denni p
   where p.integrace_pripojeni_id = p_pripojeni
     and (p_branch is null or p.branch_id = p_branch);
  get diagnostics v_pocet = row_count;
  return v_pocet;
end $$;

revoke all on function public.pokladna_odebrat_prodeje(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pokladna_odebrat_prodeje(uuid, uuid) to service_role;


-- ---------------------------------------------------------------------
-- 4. PŘEHLED TRŽEB — dny / měsíce / roky, pobočky, platby, banka
--
-- `obdobi` = první den dne/měsíce/roku. Tržby: stejné pravidlo jako
-- souhrn a foodcost — CSV dne a pobočky s daty z napojené pokladny se
-- nepočítá. `dnu` = dní s prodeji, `dnu_s_platbami` = z nich dní, kdy
-- pokladna poslala i platby (historie před 12. 10. je nemá, dokud ji
-- synchronizace znovu nedožene) — přehled podle toho pozná, že součet
-- plateb pokrývá jen část tržeb.
--
-- `banka` = příjmy (`transakce.smer = 'prijem'`) v CZK na účty typu
-- banka; `branch_id` null = firemní účet bez pobočky. Jen CZK: tržby
-- z pokladen jsou v korunách a eurocenty by se k haléřům sečetly.
--
-- SECURITY DEFINER s právy ověřenými JEDNOU na začátku. Jako SECURITY
-- INVOKER (RLS volajícího) stála kontrola práv ~0,1 ms na každý řádek:
-- 32 tis. řádků prodejů = 3,2 s pod rolí authenticated (změřeno 13. 10.
-- nad ostrými daty, jen tržní část) a s každým dalším rokem by přehled
-- rostl k 8s stropu dotazu. Výsledek je STEJNÝ jako přes RLS:
--   * prodeje a platby: politika `app.can_read_scoped(tenant,
--     'finance.read', branch_id)` = `app.has_permission(tenant,
--     'finance.read')` a pobočka ve `app.visible_branch_ids(tenant)` —
--     tady `v_smi` a `branch_id = any (v_pobocky)`;
--   * transakce: `can_read_scoped(tenant, 'finance.read', null)` =
--     `v_smi`; platební účet: pobočka null, nebo ve `v_pobocky`.
-- Definer nemá druhou linii (RLS) — firma se proto filtruje v KAŽDÉM
-- dotazu výslovně a bez práva vrací funkce prázdný přehled.
-- ---------------------------------------------------------------------

create function public.pokladna_prehled_trzeb(
  p_tenant  uuid,
  p_od      date,
  p_do      date,
  p_cleneni text default 'den' -- 'den' | 'mesic' | 'rok'
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_jednotka text;
  v_smi      boolean;
  v_pobocky  uuid[];
  v_trzby    jsonb;
  v_platby   jsonb;
  v_zpusoby  jsonb;
  v_banka    jsonb;
begin
  v_jednotka := case p_cleneni when 'den' then 'day' when 'mesic' then 'month' when 'rok' then 'year' end;
  if v_jednotka is null then
    raise exception 'Členění musí být den, mesic nebo rok.' using errcode = 'invalid_parameter_value';
  end if;
  if p_od is null or p_do is null or p_od > p_do then
    raise exception 'Neplatné období.' using errcode = 'invalid_parameter_value';
  end if;
  if p_cleneni = 'den' and p_do - p_od > 400 then
    raise exception 'Po dnech jde nejvýš 401 dní najednou.' using errcode = 'invalid_parameter_value';
  end if;
  if p_do - p_od > 366 * 30 then
    raise exception 'Období je delší než 30 let.' using errcode = 'invalid_parameter_value';
  end if;

  -- Práva jednou, ne po řádcích — přesně to, co by RLS spočítala u každého řádku.
  v_smi := coalesce(app.has_permission(p_tenant, 'finance.read'), false);
  if not v_smi then
    return jsonb_build_object('trzby', '[]'::jsonb, 'platby', '[]'::jsonb, 'zpusoby', '[]'::jsonb, 'banka', '[]'::jsonb);
  end if;
  v_pobocky := array(select app.visible_branch_ids(p_tenant));

  with dny as (
    select p.branch_id, p.datum, sum(p.trzba_haleru)::bigint as trzba, count(*)::bigint as polozek
      from public.pokladna_prodeje_denni p
     where p.tenant_id = p_tenant
       and p.branch_id = any (v_pobocky)
       and p.datum between p_od and p_do
       and (p.zdroj <> 'csv'
            or not exists (select 1 from public.pokladna_prodeje_denni a
                            where a.tenant_id = p.tenant_id and a.branch_id = p.branch_id
                              and a.datum = p.datum and a.zdroj <> 'csv'))
     group by p.branch_id, p.datum
  ),
  dny_plateb as (
    select distinct z.branch_id, z.datum
      from public.pokladna_platby_denni z
     where z.tenant_id = p_tenant
       and z.branch_id = any (v_pobocky)
       and z.datum between p_od and p_do
  ),
  souhrn as (
    select date_trunc(v_jednotka, d.datum::timestamp)::date as obdobi, d.branch_id,
           sum(d.trzba)::bigint as trzba, sum(d.polozek)::bigint as polozek,
           count(*)::bigint as dnu, count(dp.datum)::bigint as dnu_s_platbami
      from dny d
      left join dny_plateb dp on dp.branch_id = d.branch_id and dp.datum = d.datum
     group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'obdobi', s.obdobi, 'branch_id', s.branch_id, 'trzba_haleru', s.trzba,
           'polozek', s.polozek, 'dnu', s.dnu, 'dnu_s_platbami', s.dnu_s_platbami)
           order by s.obdobi, s.branch_id), '[]'::jsonb)
    into v_trzby
    from souhrn s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'obdobi', x.obdobi, 'branch_id', x.branch_id, 'druh', x.druh,
           'castka_haleru', x.castka, 'pocet', x.pocet)
           order by x.obdobi, x.branch_id, x.druh), '[]'::jsonb)
    into v_platby
    from (select date_trunc(v_jednotka, z.datum::timestamp)::date as obdobi, z.branch_id, z.druh,
                 sum(z.castka_haleru)::bigint as castka, sum(z.pocet)::bigint as pocet
            from public.pokladna_platby_denni z
           where z.tenant_id = p_tenant
             and z.branch_id = any (v_pobocky)
             and z.datum between p_od and p_do
           group by 1, 2, 3) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'branch_id', x.branch_id, 'zpusob', x.zpusob, 'nazev', x.nazev, 'druh', x.druh,
           'castka_haleru', x.castka, 'pocet', x.pocet)
           order by x.branch_id, x.castka desc, x.zpusob), '[]'::jsonb)
    into v_zpusoby
    from (select z.branch_id, z.zpusob, max(z.nazev) as nazev, max(z.druh) as druh,
                 sum(z.castka_haleru)::bigint as castka, sum(z.pocet)::bigint as pocet
            from public.pokladna_platby_denni z
           where z.tenant_id = p_tenant
             and z.branch_id = any (v_pobocky)
             and z.datum between p_od and p_do
           group by z.branch_id, z.zpusob) x;

  select coalesce(jsonb_agg(jsonb_build_object(
           'obdobi', x.obdobi, 'branch_id', x.branch_id, 'prijmy_haleru', x.prijmy)
           order by x.obdobi, x.branch_id nulls first), '[]'::jsonb)
    into v_banka
    from (select date_trunc(v_jednotka, t.datum::timestamp)::date as obdobi, u.branch_id,
                 sum(t.castka_haleru)::bigint as prijmy
            from public.transakce t
            join public.platebni_ucty u on u.id = t.ucet_id
           where t.tenant_id = p_tenant
             and u.tenant_id = p_tenant
             and (u.branch_id is null or u.branch_id = any (v_pobocky))
             and u.typ = 'banka'
             and t.smer = 'prijem'
             and t.mena = 'CZK'
             and t.datum between p_od and p_do
           group by 1, 2) x;

  return jsonb_build_object('trzby', v_trzby, 'platby', v_platby, 'zpusoby', v_zpusoby, 'banka', v_banka);
end $$;

comment on function public.pokladna_prehled_trzeb(uuid, date, date, text) is
  'Přehled tržeb z pokladen po dnech/měsících/rocích a pobočkách: tržby, '
  'platby po druhu, rozpad po způsobu za celé období a příjmy v CZK na '
  'bankovní účty. Jeden JSON (žádný strop řádků). SECURITY DEFINER s právy '
  'ověřenými jednou (finance.read + viditelné pobočky) — stejný výsledek '
  'jako RLS, bez kontroly po řádcích.';

revoke all on function public.pokladna_prehled_trzeb(uuid, date, date, text) from public, anon;
grant execute on function public.pokladna_prehled_trzeb(uuid, date, date, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. KURZOR PLATEB A KURZORY, KTERÉ NECOUVAJÍ
--
-- Historie stažená před 12. 10. platby nemá. Synchronizace ji v režimu
-- plateb dožene znovu podle VLASTNÍHO kurzoru `platby_dohnano_od`
-- (`lib/pokladna-beh.ts`, `kurzorHistorie`). Migrace žádný kurzor nemaže:
-- dřívější verze tu `dohnano_od` smazala, jenže běh, který zrovna
-- probíhal (nebo starý kód před nasazením), by ho na konci zapsal zpátky
-- a platby by se k historii už nikdy nedoplnily. Kurzor plateb starý ani
-- souběžný běh nezná, takže ho vrátit nemůže.
--
-- Beze změny proti 20261012100000 kromě:
--   * slučuje i `platby_dohnano_od`;
--   * `dohnano_od` i `platby_dohnano_od` berou MENŠÍ z uloženého
--     a poslaného — dohánění jde vždy dozadu, kurzor nikdy necouvá
--     (běh v režimu plateb začíná od dneška a kurzor prodejů, který už
--     je u 1. 1., nesmí posunout dopředu).
-- ---------------------------------------------------------------------

create or replace function public.pokladna_ulozit_postup(
  p_pripojeni   uuid,
  p_postup      jsonb, -- [{id, branch_id, dohnano_od, souvisle_do, uvazl, platby_dohnano_od}]
  p_historie_od date default null
)
returns void
-- SECURITY DEFINER: dopárování čte receptury a mění `recipe_id`, na což
-- service_role práva nemá (a nemá je dostat plošně). Volat ji smí jen
-- service_role (grant níž); firmu si funkce hlídá sama — jen řádky
-- TOHOTO připojení a jen receptury téže firmy jako řádek.
language plpgsql security definer set search_path = ''
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
                           -- `uvazl` je vždy celý stav z běhu: null = den se mezitím povedl.
                           else (e - 'uvazl')
                                || jsonb_strip_nulls(jsonb_build_object(
                                     -- ISO data (RRRR-MM-DD) se dají porovnat jako text.
                                     'dohnano_od', case when nullif(e ->> 'dohnano_od', '') is null then n.dohnano_od
                                                        else least(e ->> 'dohnano_od', n.dohnano_od) end,
                                     'platby_dohnano_od', case when nullif(e ->> 'platby_dohnano_od', '') is null then n.platby_dohnano_od
                                                               else least(e ->> 'platby_dohnano_od', n.platby_dohnano_od) end,
                                     'souvisle_do', n.souvisle_do))
                                || case when n.uvazl is null or jsonb_typeof(n.uvazl) = 'null' then '{}'::jsonb
                                        else jsonb_build_object('uvazl', n.uvazl) end
                      end
                      order by x.poradi)
               from jsonb_array_elements(coalesce(c.externi_ucet -> 'provozovny', '[]'::jsonb)) with ordinality as x(e, poradi)
               left join jsonb_to_recordset(coalesce(p_postup, '[]'::jsonb))
                    as n(id text, branch_id text, dohnano_od text, souvisle_do text, uvazl jsonb, platby_dohnano_od text)
                 on n.id = x.e ->> 'id'
                and n.branch_id = x.e ->> 'branch_id'
           ), '[]'::jsonb))
   where c.id = p_pripojeni
     and c.oblast = 'pokladna'
     and c.odpojeno_kdy is null;

  -- Receptura k prodejům tohoto připojení, kde chybí — totéž pravidlo jako
  -- trigger na recepturách (20261012100000, část 3). Prodej zapsaný SOUBĚŽNĚ
  -- se založením receptury by ji jinak nedostal nikdy.
  update public.pokladna_prodeje_denni p
     set recipe_id = r.id
    from public.recipes r
   where p.integrace_pripojeni_id = p_pripojeni
     and p.recipe_id is null
     and r.tenant_id = p.tenant_id
     and r.active
     and (r.branch_id is null or r.branch_id = p.branch_id)
     and lower(btrim(r.name)) = lower(btrim(p.produkt_nazev));
end $$;

comment on function public.pokladna_ulozit_postup(uuid, jsonb, date) is
  'Kurzory synchronizace pokladny (dohnano_od, platby_dohnano_od, souvisle_do, '
  'uvazl) — sloučí jen provozovnám se stejným id i pobočkou, přiřazení nemění; '
  'kurzory historie necouvají (bere se menší datum). Dopáruje receptury '
  'k prodejům připojení. Jen service_role.';

revoke all on function public.pokladna_ulozit_postup(uuid, jsonb, date) from public, anon, authenticated;
grant execute on function public.pokladna_ulozit_postup(uuid, jsonb, date) to service_role;
