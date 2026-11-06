-- =====================================================================
-- Foodtab — Rezervace: stoly a číslo rezervace ze zdroje (Choice)
--
-- Šéfík 4. 11. 2026: „u načítání informací (rezervací) z choice nenačítá
-- všechny informace, chybí například umístění a obsazení stolů" (snímek
-- rezervace #105 v Choice: Patro, stoly S1–S12).
--
-- Choice u rezervace posílá přidělené stoly (`locationPoints`, id stolů)
-- a číslo rezervace (`num`). Appka id stolů převede na jména podle
-- seznamu míst v Choice (lib/rezervace-choice.ts) a pošle je sem jako
-- text, např. „Patro: S1–S12 · Terasa: L7".
--
-- CO SE TU DĚLÁ
--   * `rezervace.misto_zdroje` — stoly přidělené ve zdroji. Patří ZDROJI:
--     každé načtení, které je nese, je přepíše. Proto zvlášť od
--     `prostor` („Stůl nebo prostor" obsluhy), který patří Foodtabu
--     a zdroj ho jen doplní, když je prázdný — kdyby stoly šly tam,
--     první načtení by je zapsalo a změnu stolů v Choice by už Foodtab
--     nikdy neukázal.
--   * `rezervace.cislo_zdroje` — číslo rezervace, jak ho ukazuje zdroj
--     („#105"), ať se obsluha domluví s Choice. Patří zdroji.
--   * `rezervace.prani_zdroje` — část podniku, kterou si přál HOST
--     (Choice `preferArea`). Patří zdroji, přepisuje se pokaždé.
--   * `rezervace.prostor_ze_zdroje` — KDO napsal `prostor`: `true` =
--     zdroj (přání hosta, které zdroj doplnil do prázdného prostoru),
--     `false` = obsluha (nebo zdroj, který přání neposílá), `null` =
--     neví se (řádek z doby před tímhle sloupcem). Choice přání do
--     prázdného prostoru doplňuje jako dřív a tam zůstane; appka podle
--     příznaku pozná, že „Patro" v prostoru je přání, a vedle stolů
--     („Terasa: L7") ho neukáže — ani když se přání v Choice mezitím
--     změnilo. Text, který obsluha napíše, se neschová nikdy, i kdyby
--     zněl stejně jako přání (kontrola kódu 4. 11., 3. kolo: podle
--     shody textu se to poznat nedalo). Příznak shodí spoušť
--     `trg_rezervace_prostor_od_obsluhy`, kdykoli prostor změní kdokoli
--     jiný než zdroj — `rezervace_ulozit` se proto měnit nemusí.
--     Nic se tím v `prostor` nemaže. Řádkům z doby před sloupcem (`null`)
--     ho doplní první načtení, které pošle přání: je-li prostor stejný
--     jako přání, napsal ho zdroj (4. kolo kontroly — jinak by u všech
--     rezervací načtených před db push zůstal `null` navždy).
--   * `app.rezervace_zapsat_radky` znovu (kopie z 20261027100000 se
--     záplatami, nic jiného se nemění): nové klíče řádku `misto_zdroje`,
--     `cislo_zdroje` a `prani_zdroje`. Klíč CHYBÍ = zdroj údaj tentokrát nezná a uložená
--     hodnota zůstane (příjmové API, Choice, když se seznam stolů
--     nenačetl). Prázdný text = „žádné stoly" a uložené se smaže. Klíče
--     se berou JEN od napojeného systému (`p_zdroj = 'externi'`) — import
--     ze souboru (`rezervace_importovat_csv`) volá člověk z prohlížeče
--     a jeho klíče se nečtou, ať soubor nevydává stoly za Choice.
--     Prázdný prostor AKCE už načtení nedoplní (4. kolo): prostor akce
--     patří obsluze a doplnění by poslalo „změnil se prostor".
--   * `app.rezervace_souhrn_dne` znovu (kopie z 20261106100000): u akce
--     v ranním souhrnu i stoly a přání ze zdroje, ať souhrn ukazuje totéž
--     co kalendář (oddíl na konci souboru).
--
-- Bezpečnost: tabulka se dál píše jen přes funkce (`revoke all`, zpátky
-- jen `select` — 20261027100000), nové sloupce jsou tím čitelné pro
-- `authenticated` pod stejnou RLS jako zbytek řádku. Ruční uložení
-- (`rezervace_ulozit`) bere jen vyjmenované klíče: stoly, číslo ani
-- přání nezmění, `prostor_ze_zdroje` jen shodí (spouští), když obsluha
-- prostor přepíše. Stoly ani číslo nejsou osobní údaj hosta.
--
-- Upozornění: změna stolů ze zdroje upozornění NEPOŠLE, ani u akce.
-- Spoušť `trg_rezervace_upozornit_zmena` (20261106100000) hlídá `prostor`
-- (co zapíše obsluha), ne `misto_zdroje`, a tahle migrace ji schválně
-- nemění: přesazení v Choice by jinak poslalo upozornění vybraným lidem
-- při každém přeskupení stolů. Jestli to u akcí chtít, je otázka 87
-- (docs/hlaseni/otazky.md). Proto Choice přání do prostoru doplňuje
-- hned při prvním načtení, i u rezervace se stoly: kdyby čekal, až stoly
-- nebudou, doplnil by ho ve chvíli, kdy je Choice odebere — a u akce by
-- to jako změna prostoru upozornění poslalo (3. kolo kontroly). Akce
-- vzniká z rezervace až v rukou obsluhy, takže prostor, který zdroj
-- doplnil ještě u rezervace, si nese dál; nový už nedostane.
--
-- POŘADÍ S KÓDEM: db push AŽ PO TOM, CO JE NASAZENÍ NA VERCELU „Ready".
-- Starý kód (main před sloučením) přání neposílá — kdyby po db push
-- načetl novou rezervaci, doplnil by přání do prostoru jako text obsluhy
-- (`prostor_ze_zdroje = false`) a vedle stolů by se pak ukazovalo navždy
-- (4. kolo kontroly). Opačně to nevadí: stará funkce nové klíče nečte
-- (jsonb), stoly, číslo ani přání se do db push neuloží, ale přání se
-- doplní do prostoru jako dřív, takže kalendář ukáže aspoň část podniku.
-- Appka nové sloupce čte s náhradou (chybí-li, ukáže se jako dřív).
-- Rezervace, které v té mezeře odejdou z okna načítání (36 h zpátky),
-- stoly už nedostanou — db push proto brzy po nasazení.
-- =====================================================================

alter table public.rezervace
  add column misto_zdroje text not null default '' check (char_length(misto_zdroje) <= 300),
  add column cislo_zdroje text not null default '' check (char_length(cislo_zdroje) <= 40),
  add column prani_zdroje text not null default '' check (char_length(prani_zdroje) <= 120);

comment on column public.rezervace.misto_zdroje is
  'Stoly přidělené v rezervačním systému („Patro: S1–S12"). Patří zdroji — '
  'každé načtení, které je nese, je přepíše. Stůl od obsluhy je v prostor.';
comment on column public.rezervace.cislo_zdroje is
  'Číslo rezervace, jak ho ukazuje rezervační systém (Choice „#105"). Patří zdroji.';
comment on column public.rezervace.prani_zdroje is
  'Část podniku, kterou si host přál v rezervačním systému (Choice preferArea). '
  'Patří zdroji — každé načtení, které ho nese, ho přepíše.';

-- Kdo napsal `prostor`. Řádky z doby před sloupcem zůstanou `null`
-- (neví se — appka je posoudí podle shody s přáním jako 2. kolo), nové
-- dostanou `false`, pokud je nevyplní zdroj.
alter table public.rezervace
  add column prostor_ze_zdroje boolean,
  add constraint rezervace_prostor_ze_zdroje_neprazdny check (prostor_ze_zdroje is not true or prostor <> '');
alter table public.rezervace alter column prostor_ze_zdroje set default false;

comment on column public.rezervace.prostor_ze_zdroje is
  'true = prostor vyplnil zdroj (přání hosta, Choice preferArea), false = obsluha, '
  'null = neví se (řádek starší než sloupec). Vedle stolů ze zdroje appka '
  'prostor od zdroje neukazuje. Shodí ho spoušť, když prostor změní kdokoli jiný.';

-- Prostor změnil někdo jiný než zdroj (zdroj si příznak při doplnění
-- nastaví sám, ve stejném UPDATE) → patří obsluze. Jen tady, ne
-- v `rezervace_ulozit`: každý zápis prostoru mimo import tím projde.
create function app.rezervace_prostor_od_obsluhy()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.prostor_ze_zdroje := false;
  return new;
end $$;

revoke all on function app.rezervace_prostor_od_obsluhy() from public, anon, authenticated;

create trigger trg_rezervace_prostor_od_obsluhy
  before update on public.rezervace
  for each row
  when (old.prostor is distinct from new.prostor
        and old.prostor_ze_zdroje is not distinct from new.prostor_ze_zdroje)
  execute function app.rezervace_prostor_od_obsluhy();


create or replace function app.rezervace_zapsat_radky(
  p_tenant       uuid,
  p_branch       uuid,
  p_zdroj        text,
  p_poskytovatel text,
  p_pripojeni    uuid,
  p_radky        jsonb
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_radek      jsonb;
  v_r          public.rezervace;
  v_k          public.rezervace_kontakty;
  v_ext        text;
  v_stav       text;
  v_stav_zdr   text;
  v_zacatek    timestamptz;
  v_konec      timestamptz;
  v_datum      date;
  v_od         time;
  v_do         time;
  v_pocet      integer;
  v_jmeno      text;
  v_telefon    text;
  v_email      text;
  v_poznamka   text;
  v_prostor    text;
  v_ma_misto   boolean;
  v_misto      text;
  v_ma_cislo   boolean;
  v_cislo      text;
  v_ma_prani   boolean;
  v_prani      text;
  v_prostor_je_prani boolean;
  v_doplnit_prostor  boolean;
  v_vyresit_priznak  boolean;
  v_zmeneno    timestamptz;
  v_id         uuid;
  v_nove       integer := 0;
  v_zmenene    integer := 0;
  v_beze_zmeny integer := 0;
  v_zastarale  integer := 0;
begin
  if p_radky is null or jsonb_typeof(p_radky) <> 'array' then
    raise exception 'Import nemá žádné řádky.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_radky) > 2000 then
    raise exception 'Jedna dávka smí mít nejvýš 2000 rezervací.' using errcode = 'check_violation';
  end if;

  for v_radek in select * from jsonb_array_elements(p_radky)
  loop
    v_ext := btrim(coalesce(v_radek ->> 'externi_id', ''));
    if v_ext = '' then
      raise exception 'Rezervace bez čísla ze zdroje se importovat nedá.' using errcode = 'check_violation';
    end if;

    v_stav := coalesce(nullif(btrim(v_radek ->> 'stav'), ''), 'potvrzeno');
    v_stav_zdr := left(coalesce(btrim(v_radek ->> 'stav_zdroje'), ''), 60);

    if v_radek ? 'zacatek' then
      v_zacatek := app.rezervace_okamzik_zdroje(v_radek ->> 'zacatek', 'začátek');
      v_konec   := app.rezervace_okamzik_zdroje(v_radek ->> 'konec', 'konec');
    else
      v_datum := app.rezervace_datum(v_radek ->> 'datum');
      v_od    := app.rezervace_hodina(v_radek ->> 'od');
      v_do    := app.rezervace_hodina(v_radek ->> 'do');
      if v_datum is null or v_od is null then
        raise exception 'Rezervace % nemá datum a čas.', v_ext using errcode = 'check_violation';
      end if;
      v_zacatek := app.rezervace_okamzik(p_branch, v_datum, v_od);
      v_konec   := case when v_do is null then null
                        else app.rezervace_okamzik(p_branch, v_datum + case when v_do <= v_od then 1 else 0 end, v_do) end;
    end if;
    if v_zacatek is null then
      raise exception 'Rezervace % nemá začátek.', v_ext using errcode = 'check_violation';
    end if;

    v_pocet    := app.rezervace_cele_cislo(v_radek ->> 'pocet_osob', 'počet osob');
    v_jmeno    := left(coalesce(btrim(v_radek ->> 'jmeno_hosta'), ''), 120);
    v_telefon  := left(coalesce(btrim(v_radek ->> 'telefon'), ''), 40);
    v_email    := left(lower(coalesce(btrim(v_radek ->> 'email'), '')), 254);
    v_poznamka := left(coalesce(btrim(v_radek ->> 'poznamka'), ''), 4000);
    v_prostor  := left(coalesce(btrim(v_radek ->> 'prostor'), ''), 120);
    -- Stoly a číslo rezervace ze zdroje (20261107100000). Klíč v řádku
    -- chybí = zdroj je tentokrát nezná (příjmové API, Choice bez seznamu
    -- stolů) a uložená hodnota zůstane. Prázdný text = zdroj říká
    -- „žádné" a uložená hodnota se smaže. Bere se jen od napojeného
    -- systému: soubor (CSV) posílá člověk z prohlížeče a nesmí si vydávat
    -- svoje stoly za stoly z Choice — klíč od něj se nečte.
    v_ma_misto := p_zdroj = 'externi' and v_radek ? 'misto_zdroje';
    v_misto    := case when v_ma_misto then left(coalesce(btrim(v_radek ->> 'misto_zdroje'), ''), 300) else '' end;
    v_ma_cislo := p_zdroj = 'externi' and v_radek ? 'cislo_zdroje';
    v_cislo    := case when v_ma_cislo then left(coalesce(btrim(v_radek ->> 'cislo_zdroje'), ''), 40) else '' end;
    v_ma_prani := p_zdroj = 'externi' and v_radek ? 'prani_zdroje';
    v_prani    := case when v_ma_prani then left(coalesce(btrim(v_radek ->> 'prani_zdroje'), ''), 120) else '' end;
    -- Prostor, který zdroj posílá, je přání hosta (Choice posílá oboje
    -- stejně) — doplní-li ho, poznamená si to (`prostor_ze_zdroje`).
    -- Zdroj bez přání (soubor, příjmové API) ho doplní jako text obsluhy.
    v_prostor_je_prani := v_ma_prani and v_prostor <> '' and v_prostor = v_prani;
    v_zmeneno  := app.rezervace_okamzik_zdroje(v_radek ->> 'zmeneno_kdy', 'změněno');

    select * into v_r from public.rezervace
     where tenant_id = p_tenant and branch_id = p_branch
       and poskytovatel = p_poskytovatel and externi_id = v_ext
       for update;

    if not found then
      insert into public.rezervace (
        tenant_id, branch_id, druh, stav, stav_zdroje, jmeno_hosta, zacatek, konec, den, pocet_osob,
        prostor, poznamka_zdroje, zdroj, poskytovatel, pripojeni_id, externi_id,
        externi_zmeneno_kdy, importovano_kdy, misto_zdroje, cislo_zdroje, prani_zdroje, prostor_ze_zdroje
      ) values (
        p_tenant, p_branch, 'rezervace', v_stav, v_stav_zdr, v_jmeno, v_zacatek, v_konec,
        app.business_date(p_branch, v_zacatek), v_pocet,
        v_prostor, v_poznamka, p_zdroj, p_poskytovatel, p_pripojeni, v_ext,
        v_zmeneno, now(), v_misto, v_cislo, v_prani, v_prostor_je_prani
      )
      returning id into v_id;

      if v_telefon <> '' or v_email <> '' then
        insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon, email)
        values (v_id, p_tenant, p_branch, v_telefon, v_email);
      end if;
      v_nove := v_nove + 1;
      continue;
    end if;

    -- Pozdě doručená starší verze nepřebije novější.
    if v_zmeneno is not null and v_r.externi_zmeneno_kdy is not null
       and v_zmeneno < v_r.externi_zmeneno_kdy then
      v_zastarale := v_zastarale + 1;
      continue;
    end if;

    select * into v_k from public.rezervace_kontakty where rezervace_id = v_r.id;

    -- Prázdný prostor zdroj doplní — u akce ne: akce má prostor od
    -- obsluhy a doplnění přání, které host v Choice přidal až později
    -- (nebo po tom, co obsluha prostor smazala), by poslalo upozornění
    -- „změnil se prostor" (spoušť `trg_rezervace_upozornit_zmena`,
    -- 20261106100000; kontrola kódu 4. 11., 4. kolo). Přání zůstane
    -- v `prani_zdroje` a kalendář ho u akce bez prostoru ukáže.
    v_doplnit_prostor := v_r.prostor = '' and v_prostor <> '' and v_r.druh <> 'akce';
    -- Řádek z doby před příznakem (`null`), jehož prostor je stejný jako
    -- přání, které zdroj právě posílá: ten prostor doplnil zdroj (do téhle
    -- migrace doplňoval přání do prázdného prostoru i Choice). Poznamená se
    -- to — jinak by se po změně přání v Choice staré přání ukázalo jako
    -- text obsluhy, a to u všech rezervací načtených před db push (4. kolo).
    -- Prostor se nemění. Obsluha, která napsala přesně přání hosta, se tu
    -- od zdroje rozeznat nedá — u starých řádků se bere jako zdroj.
    v_vyresit_priznak := v_r.prostor_ze_zdroje is null and v_ma_prani
                         and v_r.prostor <> '' and v_r.prostor = v_prani;

    if (v_r.stav, v_r.stav_zdroje, v_r.zacatek, v_r.konec, v_r.pocet_osob, v_r.jmeno_hosta, v_r.poznamka_zdroje)
         is not distinct from (v_stav, v_stav_zdr, v_zacatek, v_konec, v_pocet, v_jmeno, v_poznamka)
       and (coalesce(v_k.telefon, ''), coalesce(v_k.email, '')) = (v_telefon, v_email)
       and not v_doplnit_prostor
       and not v_vyresit_priznak
       and (not v_ma_misto or v_r.misto_zdroje = v_misto)
       and (not v_ma_cislo or v_r.cislo_zdroje = v_cislo)
       and (not v_ma_prani or v_r.prani_zdroje = v_prani)
       and v_r.zdroj = p_zdroj then
      v_beze_zmeny := v_beze_zmeny + 1;
      continue;
    end if;

    -- Údaje zdroje se přepíšou; to, co patří Foodtabu (druh, název, typ
    -- akce, menu, záloha, poznámky, přílohy), se nedotkne. Prostor jen
    -- doplní, když ho ve Foodtabu nikdo nevyplnil — a příznak, kdo ho
    -- napsal, nastaví ve stejném UPDATE (spoušť
    -- `trg_rezervace_prostor_od_obsluhy` ho pak nechá). Stoly, číslo
    -- a přání ze zdroje přepíše, jen když je řádek nese.
    update public.rezervace set
      stav                = v_stav,
      stav_zdroje         = v_stav_zdr,
      zacatek             = v_zacatek,
      konec               = v_konec,
      pocet_osob          = v_pocet,
      jmeno_hosta         = v_jmeno,
      poznamka_zdroje     = v_poznamka,
      prostor             = case when v_doplnit_prostor then v_prostor else prostor end,
      prostor_ze_zdroje   = case when v_doplnit_prostor then v_prostor_je_prani
                                 when v_vyresit_priznak then true
                                 else prostor_ze_zdroje end,
      misto_zdroje        = case when v_ma_misto then v_misto else misto_zdroje end,
      cislo_zdroje        = case when v_ma_cislo then v_cislo else cislo_zdroje end,
      prani_zdroje        = case when v_ma_prani then v_prani else prani_zdroje end,
      zdroj               = p_zdroj,
      pripojeni_id        = coalesce(p_pripojeni, pripojeni_id),
      externi_zmeneno_kdy = coalesce(v_zmeneno, externi_zmeneno_kdy),
      importovano_kdy     = now()
     where id = v_r.id;

    if v_telefon = '' and v_email = '' then
      delete from public.rezervace_kontakty where rezervace_id = v_r.id;
    else
      insert into public.rezervace_kontakty (rezervace_id, tenant_id, branch_id, telefon, email)
      values (v_r.id, p_tenant, p_branch, v_telefon, v_email)
      on conflict (rezervace_id) do update
        set telefon = excluded.telefon, email = excluded.email, zmeneno_kdy = now();
    end if;
    v_zmenene := v_zmenene + 1;
  end loop;

  return jsonb_build_object('nove', v_nove, 'zmenene', v_zmenene,
                            'beze_zmeny', v_beze_zmeny, 'zastarale', v_zastarale);
end $$;

revoke all on function app.rezervace_zapsat_radky(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- RANNÍ SOUHRN — u akce i stoly ze zdroje
--
-- PŘEPISUJE app.rezervace_souhrn_dne (20261106100000). Opsané beze změny
-- až na tři klíče u každé akce: `stoly` (misto_zdroje), `prani`
-- (prani_zdroje) a `prostor_ze_zdroje`. Souhrn dosud vypisoval holý
-- `prostor` — u akce z Choice tedy přání hosta, které se do prostoru
-- doplnilo při prvním načtení, i když ji Choice mezitím posadil jinam
-- a kalendář ukazuje stoly (kontrola kódu 4. 11., 4. kolo). Text místa
-- skládá appka (lib/upozorneni-text.ts → lib/rezervace-misto.ts), stejně
-- jako kalendář; stará appka nové klíče přeskočí a vypíše prostor jako
-- dřív. Do push jde jen nadpis (čísla a časy), stoly ne.
-- ---------------------------------------------------------------------

create or replace function app.rezervace_souhrn_dne(
  p_ted    timestamptz default now(),
  p_tenant uuid        default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  c_od         constant time := time '08:00';
  c_do         constant time := time '16:00';
  -- Kolik akcí jedné pobočky jde do těla upozornění (počet `akci` je vždy celý).
  c_akci_max   constant integer := 20;
  v_t          record;
  v_b          record;
  v_u          record;
  v_zona       text;
  v_den        date;
  v_pobocka    jsonb;
  v_pobocky    jsonb;
  v_souhrn     jsonb;
  v_id         uuid;
  v_pob_firmy  integer;
  v_upo_firmy  integer;
  v_pobocek    integer := 0;
  v_upozorneni integer := 0;
  v_chyb       integer := 0;
begin
  delete from public.rezervace_souhrn_dne s
   where s.den < (p_ted at time zone 'UTC')::date - 90;

  for v_t in
    select t.id from public.tenants t
     where t.deleted_at is null
       and (p_tenant is null or t.id = p_tenant)
     order by t.id
  loop
    begin
      -- Pobočky téhle firmy, kterým právě začal čas souhrnu, a jejich čísla:
      -- { "<branch_id>": { pobocka, slug, den, rezervaci, hostu, bez_poctu, akci, akce[] } }
      v_pobocky := '{}'::jsonb;
      v_pob_firmy := 0;
      v_upo_firmy := 0;

      for v_b in
        select b.id, b.name, b.slug
          from public.branches b
         where b.tenant_id = v_t.id
           and b.active
           and b.deleted_at is null
         order by b.name, b.id
      loop
        v_zona := app.zona_pobocky(v_b.id);
        v_den  := app.business_date(v_b.id, p_ted);

        -- Hodina na zdi pobočky v JEJÍM provozním dni (CLAUDE.md, pravidla
        -- 10–11). Ve 2:00 po půlnoci je provozní den ještě včerejší a jeho
        -- okno skončilo v 16:00 — nic. Den, který začíná později než v osm,
        -- se pošle od svého začátku: do té doby je provozní den včerejší.
        if p_ted <  (v_den + c_od) at time zone v_zona
           or p_ted >= (v_den + c_do) at time zone v_zona then
          continue;
        end if;

        select jsonb_build_object(
                 'pobocka',   v_b.name,
                 'slug',      v_b.slug,
                 'den',       v_den,
                 -- Stejně jako souhrnDne (lib/rezervace-kalendar.ts) v kalendáři
                 -- a okénko hostů v Rozpisu: hosté rezervací I akcí.
                 'rezervaci', count(*) filter (where r.druh = 'rezervace'),
                 'akci',      count(*) filter (where r.druh = 'akce'),
                 'hostu',     coalesce(sum(r.pocet_osob), 0),
                 'bez_poctu', count(*) filter (where r.pocet_osob is null),
                 'akce',      coalesce((
                    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                             'cas',     to_char(a.zacatek at time zone v_zona, 'HH24:MI'),
                             'nazev',   coalesce(nullif(btrim(a.nazev), ''), nullif(btrim(a.typ_akce), ''), 'Akce'),
                             'osob',    a.pocet_osob,
                             'prostor', nullif(btrim(a.prostor), ''),
                             -- Stoly a přání hosta ze zdroje a kdo napsal prostor
                             -- (20261107100000). Místo do řádku skládá appka stejně
                             -- jako kalendář (lib/rezervace-misto.ts, popisSouhrnuDne).
                             'stoly',   nullif(btrim(a.misto_zdroje), ''),
                             'prani',   nullif(btrim(a.prani_zdroje), ''),
                             'prostor_ze_zdroje', a.prostor_ze_zdroje
                           )) order by a.zacatek, a.id)
                      from (
                        select x.zacatek, x.id, x.nazev, x.typ_akce, x.pocet_osob, x.prostor,
                               x.misto_zdroje, x.prani_zdroje, x.prostor_ze_zdroje
                          from public.rezervace x
                         where x.branch_id = v_b.id
                           and x.den       = v_den
                           and x.druh      = 'akce'
                           and x.stav not in ('zrusena', 'nedostavil_se')
                         order by x.zacatek, x.id
                         limit c_akci_max
                      ) a
                  ), '[]'::jsonb)
               )
          into v_pobocka
          from public.rezervace r
         where r.branch_id = v_b.id
           and r.den       = v_den
           -- pocitaSeDoHostu (lib/rezervace-typy.ts): zrušení a nedorazivší
           -- nepřijdou. Shodu hlídá scripts/upozorneni.test.mjs.
           and r.stav not in ('zrusena', 'nedostavil_se');

        insert into public.rezervace_souhrn_dne (tenant_id, branch_id, den, rezervaci, hostu, akci)
        values (v_t.id, v_b.id, v_den,
                (v_pobocka->>'rezervaci')::integer,
                (v_pobocka->>'hostu')::integer,
                (v_pobocka->>'akci')::integer)
        on conflict (branch_id, den) do nothing;

        -- Už vyhodnoceno dřívějším (nebo souběžným) během.
        if not found then
          continue;
        end if;

        v_pobocky := v_pobocky || jsonb_build_object(v_b.id::text, v_pobocka);
        v_pob_firmy := v_pob_firmy + 1;
      end loop;

      if v_pob_firmy > 0 then
        -- Komu z těch poboček souhrn chodí: vybraní (Rezervace → Upozornění),
        -- a kde nikdo vybraný není, všichni, kdo rezervace pobočky vidí.
        for v_u in
          select k.user_id, array_agg(distinct p.key order by p.key) as pobocky
            from jsonb_each(v_pobocky) p
           cross join lateral app.rezervace_prijemci(v_t.id, p.key::uuid, 'souhrn') k
           group by k.user_id
        loop
          select jsonb_agg(v_pobocky -> s.klic order by v_pobocky -> s.klic ->> 'pobocka', s.klic)
            into v_souhrn
            from unnest(v_u.pobocky) as s(klic);

          -- Na žádné z jeho poboček nic není → nic se neposílá (hlavička).
          if not exists (
            select 1 from jsonb_array_elements(v_souhrn) e
             where (e->>'rezervaci')::integer > 0 or (e->>'akci')::integer > 0
          ) then
            continue;
          end if;

          v_id := app.notifikovat(
            v_t.id,
            v_u.user_id,
            'rezervace.souhrn_dne',
            jsonb_build_object('den', v_souhrn -> 0 ->> 'den', 'souhrn', v_souhrn),
            'normal',
            case when cardinality(v_u.pobocky) = 1 then v_u.pobocky[1]::uuid end,
            null,
            'rezervace_souhrn',
            null,
            -- Klíč podle SADY poboček, bez dne: dnešní souhrn nahradí
            -- včerejší nepřečtený (a zruší jeho čekající push), ale souhrn
            -- pobočky v jiném pásmu, který přijde o hodinu později, ten
            -- první nesmaže.
            'rezervace.souhrn_dne:' || md5(array_to_string(v_u.pobocky, ','))
          );

          if v_id is not null then
            v_upo_firmy := v_upo_firmy + 1;
          end if;
        end loop;
      end if;

      v_pobocek := v_pobocek + v_pob_firmy;
      v_upozorneni := v_upozorneni + v_upo_firmy;
    exception when others then
      v_chyb := v_chyb + 1;
      raise warning 'Ranní souhrn rezervací firmy % selhal: % %', v_t.id, sqlstate, sqlerrm;
    end;
  end loop;

  return jsonb_build_object('pobocek', v_pobocek, 'upozorneni', v_upozorneni, 'chyb', v_chyb);
end $$;

revoke all on function app.rezervace_souhrn_dne(timestamptz, uuid) from public, anon, authenticated, service_role;
