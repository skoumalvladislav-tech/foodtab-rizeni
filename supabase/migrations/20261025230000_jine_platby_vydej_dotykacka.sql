-- Jiné platby: výdej ze skladu v Dotykačce — příprava zápisu (25. 10. 2026).
--
-- Proč: Šéfík 25. 10. 2026: „AI najde v pokladně odpovídající položky
-- a ty odečte ze skladu, respektive množství uvedené na účtence či
-- papíře.“ Návrh je v docs/jine-platby-vydej-dotykacka.md (průzkum
-- dokumentace Dotykačky, doporučená POS akce s Odpisem, kde potvrzuje
-- člověk). Zápis do pokladny tahle migrace NEZAPÍNÁ — ten je odebraný
-- v kódu (lib/pokladna-dotykacka-zapis.ts, prázdný seznam provozoven).
--
-- Co přidává:
--
--   1. RECEPTURY V KATALOGU (`pos_katalog.suroviny`). Dotykačka posílá
--      recepturu jako `product-ingredients` (pokrm → surovina, množství,
--      jednotka). Katalog je nově načítá s produkty. `ma_recepturu` pak
--      odvozuje databáze z `suroviny` (jeden zdroj pravdy): pole surovin
--      = známá receptura (prázdné = bez receptury), NULL = pokladna
--      recepturu neprozradila (bez práva na čtení receptur) — jako dřív.
--
--   2. KONKRÉTNÍ VAROVÁNÍ „SUROVINA POKRMU VE STEJNÉM VÝDEJI“
--      (`app.jp_sestavit_vydej`). Když jsou receptury pokrmů ve výdeji
--      známé, náhled pozná, že položka výdeje je surovinou jiné položky
--      téhož výdeje (smetana ke svíčkové, rum ke koktejlu), a řekne to
--      jménem. Obecné varování „pokrm i kusové zboží“ zůstává BEZE ZMĚNY
--      vedle něj: receptura v katalogu je jen opis z posledního načtení
--      (v pokladně ji mezitím mohli změnit) a vnořené receptury se
--      nerozbalují — konkrétní varování přidává, nic nenahrazuje
--      (nezávislá kontrola 25. 10.). Schválení s varováním dál chce
--      p_bez_surovin (beze změny v jine_platby_rozhodnout_vydej). OTISK
--      ani `zmena` se nemění — varování do nich nikdy nepatřilo.
--
--   3. PROVOZOVNA POŽADAVKU (`app.jp_provozovna_vydeje`,
--      `pos_operace_zahajit`). U pokladny připojené k POBOČCE záznam
--      provozovnu nenese (jine_platby_zalozit ji ukládá jen u pokladny
--      celé firmy) a operace by neměla kam jít — to byla poslední věc,
--      kterou docs/jine-platby-pos-operace.md vedl jako „chybí před
--      zapnutím“. Zabrání ji teď doplní z AKTUÁLNÍHO přiřazení provozoven
--      k pobočce a odmítne, když jich je nula nebo víc. U uložené
--      provozovny ověří, že ji přiřazení pořád dává pobočce záznamu
--      (přeřazení v Integracích mezi schválením a odesláním).
--
--   4. ZÁZNAM POKUSŮ O PŘIŘAZENÍ PŘES AI (`jine_platby_ai_parovani`)
--      s denním stropem (10 na záznam, 100 na firmu) — vzor
--      `jine_platby_zahajit_rozpoznani`. Pokus se zapíše PŘED voláním AI
--      (strop se jinak dá přejít souběžným klikáním). Funkce jen pro
--      service_role: volá je serverová akce po ověření práva upravit.
--
-- Co se schválně NEDĚLÁ:
--   * žádná nová práva (přiřazení přes AI chce jine_platby.upravit,
--     stejně jako ruční přiřazení; výdej dál jine_platby.vydej_pos);
--   * OTISK výdeje se nemění — schválené a předané výdeje platí dál;
--   * `jine_platby_rozhodnout_vydej` se nemění (varování už umí);
--   * pokusy o přiřazení nemají audit: jsou samy záznamem (jako
--     jine_platby_rozpoznani) a zapisuje je jen server.
--
-- Scénář: supabase/tests/krok103_scenar.sql.

-- ---------------------------------------------------------------------
-- 1. Receptury v katalogu
-- ---------------------------------------------------------------------

alter table public.pos_katalog
  add column suroviny jsonb
  check (suroviny is null or (jsonb_typeof(suroviny) = 'array' and jsonb_array_length(suroviny) <= 200));

comment on column public.pos_katalog.suroviny is
  'Receptura z pokladny: [{produkt, mnozstvi, jednotka}] (produkt = externi_id suroviny). NULL = pokladna recepturu neprozradila, [] = produkt recepturu nemá.';

-- Stejné jako v 20261016100000, navíc `suroviny`. Co v novém načtení
-- chybí, se dál jen označí smazané.
create or replace function public.pos_katalog_nahradit(p_pripojeni uuid, p_produkty jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_pocet   integer := 0;
  v_e       jsonb;
  v_ids     text[] := '{}';
  v_sur     jsonb;
begin
  select tenant_id into v_tenant from public.integrace_pripojeni
   where id = p_pripojeni and oblast = 'pokladna' and odpojeno_kdy is null;
  if v_tenant is null then
    raise exception 'Pokladna nenalezena nebo je odpojená.' using errcode = 'P0002';
  end if;
  if jsonb_typeof(coalesce(p_produkty, 'null'::jsonb)) <> 'array' then
    raise exception 'Katalog nemá platný tvar.' using errcode = 'check_violation';
  end if;
  for v_e in select value from jsonb_array_elements(p_produkty) loop
    if nullif(btrim(coalesce(v_e ->> 'externi_id', '')), '') is null or nullif(btrim(coalesce(v_e ->> 'nazev', '')), '') is null then
      continue;
    end if;
    -- Receptura: jen z pole (jiný tvar = „neví se“). Surovina bez produktu
    -- se vynechá, množství mimo tvar čísla zůstane prázdné (nic se nedomýšlí).
    v_sur := null;
    if jsonb_typeof(v_e -> 'suroviny') = 'array' then
      select coalesce(jsonb_agg(jsonb_build_object(
               'produkt', left(btrim(s.v ->> 'produkt'), 100),
               'mnozstvi', case when (s.v ->> 'mnozstvi') ~ '^[0-9]{1,9}(\.[0-9]{1,6})?$' then s.v ->> 'mnozstvi' end,
               'jednotka', left(nullif(btrim(coalesce(s.v ->> 'jednotka', '')), ''), 40))), '[]'::jsonb)
        into v_sur
        from (select x.v from jsonb_array_elements(v_e -> 'suroviny') as x(v)
               where jsonb_typeof(x.v) = 'object' and nullif(btrim(coalesce(x.v ->> 'produkt', '')), '') is not null
               limit 200) s;
    end if;
    insert into public.pos_katalog (tenant_id, pripojeni_id, externi_id, nazev, jednotka, mira, odecita_sklad, ma_recepturu,
                                    suroviny, plu, ean, smazano, aktualizovano)
    values (v_tenant, p_pripojeni, left(btrim(v_e ->> 'externi_id'), 100), left(btrim(v_e ->> 'nazev'), 300),
            left(nullif(v_e ->> 'jednotka', ''), 40),
            case when (v_e ->> 'mira') ~ '^[0-9]+(\.[0-9]+)?$' and (v_e ->> 'mira')::numeric > 0 then (v_e ->> 'mira')::numeric(12, 4) end,
            (v_e ->> 'odecita_sklad')::boolean,
            -- Známá receptura rozhoduje; bez ní jen to, co adaptér o receptuře řekl.
            case when v_sur is not null then jsonb_array_length(v_sur) > 0 else (v_e ->> 'ma_recepturu')::boolean end,
            v_sur,
            coalesce(array(select jsonb_array_elements_text(coalesce(v_e -> 'plu', '[]'::jsonb))), '{}'),
            coalesce(array(select jsonb_array_elements_text(coalesce(v_e -> 'ean', '[]'::jsonb))), '{}'),
            coalesce((v_e ->> 'smazano')::boolean, false), now())
    on conflict (pripojeni_id, externi_id) do update
      set nazev = excluded.nazev, jednotka = excluded.jednotka, mira = excluded.mira,
          odecita_sklad = excluded.odecita_sklad, ma_recepturu = excluded.ma_recepturu, suroviny = excluded.suroviny,
          plu = excluded.plu, ean = excluded.ean, smazano = excluded.smazano, aktualizovano = now();
    v_ids := v_ids || left(btrim(v_e ->> 'externi_id'), 100);
    v_pocet := v_pocet + 1;
  end loop;
  update public.pos_katalog set smazano = true, aktualizovano = now()
   where pripojeni_id = p_pripojeni and not (externi_id = any (v_ids)) and not smazano;
  return v_pocet;
end $$;

revoke all on function public.pos_katalog_nahradit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pos_katalog_nahradit(uuid, jsonb) to service_role;


-- ---------------------------------------------------------------------
-- 2. Náhled výdeje s recepturami
-- ---------------------------------------------------------------------

-- Tělo z 20261016100000 beze změny až na varování (viz hlavička, bod 2).
-- Obsah, otisk, zmena i blokace se počítají stejně.
create or replace function app.jp_sestavit_vydej(p_zaznam uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_z        public.jine_platby;
  v_p        record;
  v_polozky  jsonb := '[]'::jsonb;
  v_blokace  jsonb := '[]'::jsonb;
  v_pocet    integer := 0;
  v_obsah    jsonb;
  v_podstata jsonb;
  v_otisk    text;
  v_varovani jsonb := '[]'::jsonb;
  v_ma_pokrm boolean := false;
  v_ma_zbozi boolean := false;
  v_receptury jsonb := '[]'::jsonb;
begin
  select * into v_z from public.jine_platby where id = p_zaznam;
  if not found then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;

  if v_z.pripojeni_id is null then
    v_blokace := v_blokace || jsonb_build_object('poradi', null, 'nazev', null,
      'duvod', 'Provozovna nemá u záznamu připojenou pokladnu — výdej v appce nejde připravit.');
  elsif not app.jp_pokladna_obsluhuje(v_z) then
    v_blokace := v_blokace || jsonb_build_object('poradi', null, 'nazev', null,
      'duvod', 'Pokladna nebo její provozovna už tuhle pobočku neobsluhuje (změna v Integracích) — výdej přes ni nejde připravit.');
  end if;

  for v_p in
    select p.*,
           k.odecita_sklad as k_odecita, k.ma_recepturu as k_receptura, k.nazev as k_nazev,
           k.externi_id as k_id, k.smazano as k_smazano, k.suroviny as k_suroviny
      from public.jine_platby_polozky p
      left join public.pos_katalog k
             on k.pripojeni_id = v_z.pripojeni_id and k.externi_id = p.pos_produkt_id and k.tenant_id = v_z.tenant_id
     where p.zaznam_id = v_z.id
     order by p.poradi
  loop
    v_pocet := v_pocet + 1;
    if v_p.vyzaduje_kontrolu then
      v_blokace := v_blokace || jsonb_build_object('poradi', v_p.poradi, 'nazev', v_p.nazev, 'duvod', 'Položka čeká na kontrolu.');
    end if;
    if v_p.druh = 'nezarazeno' then
      v_blokace := v_blokace || jsonb_build_object('poradi', v_p.poradi, 'nazev', v_p.nazev,
        'duvod', 'Položka není zařazená (pokrm, nápoj, zboží, služba…).');
    elsif v_p.druh in ('pokrm', 'rozlevany_napoj', 'kusove_zbozi') then
      if v_p.mapovani <> 'overeno' then
        v_blokace := v_blokace || jsonb_build_object('poradi', v_p.poradi, 'nazev', v_p.nazev,
          'duvod', 'Položka nemá ověřené přiřazení k produktu v pokladně.');
      elsif v_p.pos_mnozstvi is null then
        v_blokace := v_blokace || jsonb_build_object('poradi', v_p.poradi, 'nazev', v_p.nazev,
          'duvod', 'Chybí množství v jednotkách pokladny.');
      elsif v_p.k_id is null or v_p.k_smazano then
        -- Bez katalogu (nebo s produktem, který pokladna zrušila) nejde
        -- ověřit, co se odepíše — id a název by šly z prohlížeče (kontrola 19. 10.).
        v_blokace := v_blokace || jsonb_build_object('poradi', v_p.poradi, 'nazev', v_p.nazev,
          'duvod', 'Produkt v katalogu pokladny není (katalog není načtený, nebo produkt v pokladně zrušili) — přiřazení nejde ověřit.');
      elsif v_p.k_odecita is false and v_p.k_receptura is false then
        -- Pokladna VÝSLOVNĚ říká „neodečítá a nemá recepturu" → do výdeje
        -- nepatří. Když o receptuře neví (`ma_recepturu` null), položka
        -- v návrhu zůstane: pokrm s recepturou má v Dotykačce „Odečítat ze
        -- skladu" vypnuté a suroviny odečte až podle receptury.
        null;
      else
        if v_p.druh = 'pokrm' then v_ma_pokrm := true; elsif v_p.druh = 'kusove_zbozi' then v_ma_zbozi := true; end if;
        if v_p.k_suroviny is not null and jsonb_array_length(v_p.k_suroviny) > 0 then
          v_receptury := v_receptury || jsonb_build_object('pos_produkt_id', v_p.pos_produkt_id,
            'nazev', coalesce(v_p.k_nazev, v_p.pos_produkt_nazev, v_p.nazev), 'suroviny', v_p.k_suroviny);
        end if;
        v_polozky := v_polozky || jsonb_build_object(
          'poradi', v_p.poradi,
          'pos_produkt_id', v_p.pos_produkt_id,
          'nazev', coalesce(v_p.k_nazev, v_p.pos_produkt_nazev, v_p.nazev),
          'druh', v_p.druh,
          'mnozstvi', v_p.pos_mnozstvi);
      end if;
    end if;
  end loop;

  if v_pocet = 0 then
    v_blokace := v_blokace || jsonb_build_object('poradi', null, 'nazev', null, 'duvod', 'Záznam nemá žádné položky.');
  end if;

  -- Pokrm s recepturou odečte pokladna i se surovinami. Když je položka
  -- výdeje surovinou jiné položky téhož výdeje (smetana ke svíčkové),
  -- odečetla by se dvakrát — jednou sama a jednou podle receptury.
  -- Známe-li recepturu, řekne to varování jménem (25. 10.).
  select v_varovani || coalesce(jsonb_agg(to_jsonb(format(
           '„%s“ je surovinou „%s“ ve stejném výdeji — pokladna ji odečte i podle receptury. Zkontrolujte, že se má odepsat ještě navíc.',
           x.surovina, x.pokrm)) order by x.surovina, x.pokrm), '[]'::jsonb)
    into v_varovani
    from (select distinct a ->> 'nazev' as surovina, b ->> 'nazev' as pokrm
            from jsonb_array_elements(v_polozky) a
            join jsonb_array_elements(v_receptury) b on b ->> 'pos_produkt_id' <> a ->> 'pos_produkt_id'
           where exists (select 1 from jsonb_array_elements(b -> 'suroviny') s where s ->> 'produkt' = a ->> 'pos_produkt_id')) x;
  -- Obecné varování jako od 20. 10., i když recepturu známe: opis receptury
  -- v katalogu může být starý a vnořené receptury se nerozbalují.
  if v_ma_pokrm and v_ma_zbozi then
    v_varovani := v_varovani || to_jsonb('Výdej obsahuje pokrm i kusové zboží. Zkontrolujte, že zboží není surovina toho pokrmu — suroviny pokrmu odečte pokladna podle receptury sama.'::text);
  end if;

  v_obsah := jsonb_build_object(
    'branch_id', v_z.branch_id,
    'pripojeni_id', v_z.pripojeni_id,
    'pos_provozovna', v_z.pos_provozovna,
    'polozky', v_polozky);

  select coalesce(jsonb_agg(jsonb_build_object('pos_produkt_id', s.produkt, 'mnozstvi', s.mnozstvi) order by s.produkt), '[]'::jsonb)
    into v_podstata
    from (select e ->> 'pos_produkt_id' as produkt, sum((e ->> 'mnozstvi')::numeric) as mnozstvi
            from jsonb_array_elements(v_polozky) e
           group by e ->> 'pos_produkt_id') s;

  v_otisk := encode(sha256(convert_to(jsonb_build_object(
    'pripojeni_id', v_z.pripojeni_id, 'pos_provozovna', v_z.pos_provozovna, 'polozky', v_podstata)::text, 'UTF8')), 'hex');

  return jsonb_build_object(
    'obsah', v_obsah,
    'otisk', v_otisk,
    'zmena', encode(sha256(convert_to(v_otisk || v_blokace::text, 'UTF8')), 'hex'),
    'polozek', jsonb_array_length(v_polozky),
    'blokace', v_blokace,
    'varovani', v_varovani);
end $$;

revoke all on function app.jp_sestavit_vydej(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3. Provozovna požadavku do pokladny
-- ---------------------------------------------------------------------

-- Provozovna pokladny, do které smí jít výdej záznamu: uložená u záznamu,
-- jen když ji aktuální přiřazení pořád dává pobočce záznamu; jinak jediná
-- provozovna přiřazená pobočce. Nula nebo víc = NULL (výdej se neodešle).
-- Pokladna musí být připojená a téže firmy; u pokladny pobočky jen té
-- pobočky (stejné podmínky jako app.jp_pokladna_obsluhuje).
create function app.jp_provozovna_vydeje(p_z public.jine_platby)
returns text
language sql stable security definer set search_path = ''
as $$
  select case when count(distinct e ->> 'id') = 1 then min(e ->> 'id') end
    from public.integrace_pripojeni p
    cross join lateral jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) e
   where p.id = p_z.pripojeni_id
     and p.tenant_id = p_z.tenant_id
     and p.oblast = 'pokladna'
     and p.odpojeno_kdy is null
     and (p.branch_id is null or p.branch_id = p_z.branch_id)
     and e ->> 'branch_id' = p_z.branch_id::text
     and nullif(e ->> 'id', '') is not null
     and (p_z.pos_provozovna is null or e ->> 'id' = p_z.pos_provozovna)
$$;

revoke all on function app.jp_provozovna_vydeje(public.jine_platby) from public, anon, authenticated;

-- Tělo z 20261021100000, navíc provozovna požadavku (hlavička, bod 3).
create or replace function public.pos_operace_zahajit(p_operace uuid, p_platnost_do timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_op      public.pos_operace;
  v_z       public.jine_platby;
  v_zaznam  uuid;
  v_prov    text;
begin
  select zaznam_id into v_zaznam from public.pos_operace where id = p_operace;
  if v_zaznam is null then
    return jsonb_build_object('stav', 'nelze', 'duvod', 'Operace neexistuje.');
  end if;
  -- Pořadí zámků jako všude jinde: záznam, pak operace (jinak hrozí
  -- vzájemné zablokování s ručním doložením). Zámek záznamu ale
  -- nečeká: souběžné druhé volání se dozví 'obsazeno'.
  select * into v_z from public.jine_platby where id = v_zaznam for update skip locked;
  if not found then
    return jsonb_build_object('stav', 'obsazeno');
  end if;
  select * into v_op from public.pos_operace where id = p_operace for update skip locked;
  if not found then
    return jsonb_build_object('stav', 'obsazeno');
  end if;
  if v_op.stav <> 'pripraveno' then
    return jsonb_build_object('stav', 'nelze', 'duvod', 'Operace je ve stavu ' || v_op.stav || '.');
  end if;
  if not app.jp_kontrola_plati(v_z.kontrola_skladu, v_z.verze, 15) or v_z.kontrola_skladu ->> 'vysledek' <> 'neodecteno' then
    return jsonb_build_object('stav', 'nelze', 'duvod', 'Kontrola výdeje v pokladně je stará nebo neprošla — zopakujte ji.');
  end if;
  -- Pokladna už spotřebu odečetla (konkrétní nález drží i po nové kontrole, ověření 21. 10.).
  if app.jp_nalez_pokladny(v_z.pokladna_skladu, 'sklad') then
    return jsonb_build_object('stav', 'nelze', 'duvod', 'Pokladna při kontrole našla, že spotřebu už odečetla — požadavek se neposílá.');
  end if;
  if p_platnost_do is null or p_platnost_do <= now() then
    return jsonb_build_object('stav', 'nelze', 'duvod', 'Platnost požadavku musí být v budoucnu.');
  end if;
  -- Kam požadavek půjde: z aktuálního přiřazení provozoven (25. 10.).
  -- Operace s provozovnou (z pokusu, který už odešel) ji drží — když ji
  -- přiřazení mezitím dalo jinam, neposílá se nic.
  v_prov := app.jp_provozovna_vydeje(v_z);
  if v_prov is null then
    return jsonb_build_object('stav', 'nelze', 'duvod',
      'Pokladna nemá pro tuhle pobočku právě jednu provozovnu (Integrace → Pokladní systémy), nebo ji už neobsluhuje — požadavek se neposílá.');
  end if;
  if v_op.externi_provozovna is not null and v_op.externi_provozovna <> v_prov then
    return jsonb_build_object('stav', 'nelze', 'duvod',
      'Provozovna pokladny se od schválení výdeje změnila — požadavek se neposílá. Zrušte schválení a výdej schvalte znovu.');
  end if;

  update public.pos_operace
     set stav = 'odesila_se', pokusu = pokusu + 1, platnost_do = p_platnost_do, odeslano = now(), externi_provozovna = v_prov
   where id = v_op.id
   returning * into v_op;
  update public.jine_platby set stav_skladu = 'zpracovava_se', zmeneno = now() where id = v_z.id;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, 'vydej_odesila_se',
          jsonb_build_object('operace', v_op.id, 'pokus', v_op.pokusu, 'provozovna', v_prov));

  return jsonb_build_object('stav', 'ok', 'operace', jsonb_build_object(
    'id', v_op.id, 'klic', v_op.idempotencni_klic, 'stav', v_op.stav, 'pokusu', v_op.pokusu,
    'platnostDo', v_op.platnost_do, 'externiProvozovna', v_op.externi_provozovna,
    'polozky', v_op.polozky, 'poznamka', v_op.poznamka));
end $$;

revoke all on function public.pos_operace_zahajit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pos_operace_zahajit(uuid, timestamptz) to service_role;


-- ---------------------------------------------------------------------
-- 4. Pokusy o přiřazení položek přes AI
-- ---------------------------------------------------------------------

create table public.jine_platby_ai_parovani (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  branch_id      uuid not null references public.branches(id) on delete restrict,
  zaznam_id      uuid not null references public.jine_platby(id) on delete restrict,
  verze_zaznamu  integer not null,
  stav           text not null check (stav in ('bezi', 'ok', 'chyba', 'bez_klice')),
  polozek        smallint not null check (polozek between 0 and 200),
  navrzeno       smallint check (navrzeno is null or navrzeno between 0 and 200),
  model          text check (model is null or char_length(model) <= 100),
  verze_zadani   text check (verze_zadani is null or char_length(verze_zadani) <= 50),
  duvod          text check (duvod is null or char_length(duvod) <= 2000),
  spustil        uuid,
  vytvoreno      timestamptz not null default now(),
  dokonceno      timestamptz
);
create index jine_platby_ai_parovani_den on public.jine_platby_ai_parovani (tenant_id, vytvoreno);
create index jine_platby_ai_parovani_zaznam on public.jine_platby_ai_parovani (zaznam_id, vytvoreno desc);

revoke all on public.jine_platby_ai_parovani from public, anon, authenticated;
grant select on public.jine_platby_ai_parovani to authenticated, service_role;
alter table public.jine_platby_ai_parovani enable row level security;
create policy jine_platby_ai_parovani_select on public.jine_platby_ai_parovani for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create trigger trg_firma_jine_platby_ai_parovani before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_ai_parovani for each row execute function app.jp_hlida_dite_zaznamu();

create function public.jine_platby_zahajit_parovani(p_zaznam uuid, p_spustil uuid, p_verze integer, p_polozek integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_dnes   integer;
  v_id     uuid;
begin
  select * into v_z from public.jine_platby where id = p_zaznam for update;
  if not found then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;
  -- Levné kontroly PŘED placeným voláním: návrh, který by uložení stejně
  -- odmítlo (jiná verze, zamčené skladové položky), se AI neposílá.
  if p_verze is distinct from v_z.verze then
    raise exception 'Záznam mezitím upravil někdo jiný, načtěte ho znovu.' using errcode = 'serialization_failure';
  end if;
  if v_z.stav_skladu in ('schvaleno', 'nepodporovano', 'zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos',
                         'jiz_odecteno', 'rucne_dolozeno', 'opraveno') then
    raise exception 'Výdej je schválený nebo provedený — přiřazení položek se teď měnit nedá.' using errcode = 'check_violation';
  end if;
  if p_polozek is null or p_polozek < 1 or p_polozek > 200 then
    raise exception 'Přiřazení přes AI potřebuje 1 až 200 položek.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.jine_platby_ai_parovani
              where zaznam_id = v_z.id and stav = 'bezi' and vytvoreno > now() - interval '2 minutes') then
    raise exception 'Přiřazení přes AI u tohohle dokladu už běží.' using errcode = 'check_violation';
  end if;
  -- Strop na záznam a na firmu (den podle Prahy). Zámek na firmu, jinak by
  -- souběžné pokusy na různých záznamech strop přešly (vzor rozpoznání).
  perform pg_advisory_xact_lock(hashtextextended('jine_platby_ai_parovani:' || v_z.tenant_id::text, 0));
  select count(*) into v_dnes from public.jine_platby_ai_parovani
   where zaznam_id = v_z.id
     and vytvoreno >= (date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague');
  if v_dnes >= 10 then
    raise exception 'Dnešní strop přiřazení přes AI u tohohle dokladu (10) je vyčerpaný — přiřaďte zbylé položky ručně.' using errcode = 'check_violation';
  end if;
  select count(*) into v_dnes from public.jine_platby_ai_parovani
   where tenant_id = v_z.tenant_id
     and vytvoreno >= (date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague');
  if v_dnes >= 100 then
    raise exception 'Dnešní strop přiřazení přes AI (100 za firmu) je vyčerpaný — přiřaďte položky ručně.' using errcode = 'check_violation';
  end if;
  insert into public.jine_platby_ai_parovani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav, polozek, spustil)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_z.verze, 'bezi', p_polozek, p_spustil)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.jine_platby_zahajit_parovani(uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.jine_platby_zahajit_parovani(uuid, uuid, integer, integer) to service_role;

create function public.jine_platby_dokoncit_parovani(
  p_pokus uuid, p_stav text, p_model text, p_verze_zadani text, p_navrzeno integer, p_duvod text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r  public.jine_platby_ai_parovani;
  v_z  public.jine_platby;
begin
  select * into v_r from public.jine_platby_ai_parovani where id = p_pokus for update;
  if not found or v_r.stav <> 'bezi' then
    raise exception 'Přiřazení přes AI neběží.' using errcode = 'check_violation';
  end if;
  if p_stav is null or p_stav not in ('ok', 'chyba', 'bez_klice') then
    raise exception 'Neznámý výsledek přiřazení.' using errcode = 'check_violation';
  end if;
  if p_navrzeno is not null and (p_navrzeno < 0 or p_navrzeno > v_r.polozek) then
    raise exception 'Počet navržených přiřazení je mimo rozsah.' using errcode = 'check_violation';
  end if;
  update public.jine_platby_ai_parovani
     set stav = p_stav, model = left(p_model, 100), verze_zadani = left(p_verze_zadani, 50),
         navrzeno = case when p_stav = 'ok' then coalesce(p_navrzeno, 0) end,
         duvod = left(p_duvod, 2000), dokonceno = now()
   where id = v_r.id;
  select * into v_z from public.jine_platby where id = v_r.zaznam_id;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_r.spustil, 'prirazeni_ai',
          jsonb_build_object('stav', p_stav, 'model', p_model, 'polozek', v_r.polozek,
                             'navrzeno', case when p_stav = 'ok' then coalesce(p_navrzeno, 0) end));
end $$;

revoke all on function public.jine_platby_dokoncit_parovani(uuid, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.jine_platby_dokoncit_parovani(uuid, text, text, text, integer, text) to service_role;
