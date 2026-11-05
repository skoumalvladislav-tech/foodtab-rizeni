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
--     (Choice `preferArea`). Patří zdroji. Dokud rezervace z Choice
--     stoly neměly, přání se doplnilo do prázdného `prostor` — a tam
--     zůstane (patří Foodtabu, zdroj ho nepřepíše). Podle tohohle
--     sloupce appka pozná, že „Patro" v prostoru je přání, a vedle
--     přidělených stolů („Terasa: L7") ho neukáže (kontrola kódu 4. 11.,
--     2. kolo). Nic se tím v `prostor` nemaže.
--   * `app.rezervace_zapsat_radky` znovu (kopie z 20261027100000 se
--     záplatami, nic jiného se nemění): nové klíče řádku `misto_zdroje`,
--     `cislo_zdroje` a `prani_zdroje`. Klíč CHYBÍ = zdroj údaj tentokrát nezná a uložená
--     hodnota zůstane (příjmové API, Choice, když se seznam stolů
--     nenačetl). Prázdný text = „žádné stoly" a uložené se smaže. Klíče
--     se berou JEN od napojeného systému (`p_zdroj = 'externi'`) — import
--     ze souboru (`rezervace_importovat_csv`) volá člověk z prohlížeče
--     a jeho klíče se nečtou, ať soubor nevydává stoly za Choice.
--
-- Bezpečnost: tabulka se dál píše jen přes funkce (`revoke all`, zpátky
-- jen `select` — 20261027100000), nové sloupce jsou tím čitelné pro
-- `authenticated` pod stejnou RLS jako zbytek řádku. Ruční uložení
-- (`rezervace_ulozit`) bere jen vyjmenované klíče, nové sloupce
-- nezmění. Stoly ani číslo nejsou osobní údaj hosta.
--
-- Upozornění: změna stolů ze zdroje upozornění NEPOŠLE, ani u akce.
-- Spoušť `trg_rezervace_upozornit_zmena` (20261106100000) hlídá `prostor`
-- (co zapíše obsluha), ne `misto_zdroje`, a tahle migrace ji schválně
-- nemění: přesazení v Choice by jinak poslalo upozornění vybraným lidem
-- při každém přeskupení stolů. Jestli to u akcí chtít, je otázka 87
-- (docs/hlaseni/otazky.md).
--
-- Pořadí s kódem: Vercel nasadí kód dřív, než proběhne db push. Appka
-- proto sloupce čte s náhradou (chybí-li, ukáže se bez stolů) a do
-- staré funkce posílané klíče navíc nevadí (jsonb, nečtou se).
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
  'Patří zdroji. Stejný text v prostor appka vedle přidělených stolů neukazuje.';


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
    v_zmeneno  := app.rezervace_okamzik_zdroje(v_radek ->> 'zmeneno_kdy', 'změněno');

    select * into v_r from public.rezervace
     where tenant_id = p_tenant and branch_id = p_branch
       and poskytovatel = p_poskytovatel and externi_id = v_ext
       for update;

    if not found then
      insert into public.rezervace (
        tenant_id, branch_id, druh, stav, stav_zdroje, jmeno_hosta, zacatek, konec, den, pocet_osob,
        prostor, poznamka_zdroje, zdroj, poskytovatel, pripojeni_id, externi_id,
        externi_zmeneno_kdy, importovano_kdy, misto_zdroje, cislo_zdroje, prani_zdroje
      ) values (
        p_tenant, p_branch, 'rezervace', v_stav, v_stav_zdr, v_jmeno, v_zacatek, v_konec,
        app.business_date(p_branch, v_zacatek), v_pocet,
        v_prostor, v_poznamka, p_zdroj, p_poskytovatel, p_pripojeni, v_ext,
        v_zmeneno, now(), v_misto, v_cislo, v_prani
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

    if (v_r.stav, v_r.stav_zdroje, v_r.zacatek, v_r.konec, v_r.pocet_osob, v_r.jmeno_hosta, v_r.poznamka_zdroje)
         is not distinct from (v_stav, v_stav_zdr, v_zacatek, v_konec, v_pocet, v_jmeno, v_poznamka)
       and (coalesce(v_k.telefon, ''), coalesce(v_k.email, '')) = (v_telefon, v_email)
       and not (v_r.prostor = '' and v_prostor <> '')
       and (not v_ma_misto or v_r.misto_zdroje = v_misto)
       and (not v_ma_cislo or v_r.cislo_zdroje = v_cislo)
       and (not v_ma_prani or v_r.prani_zdroje = v_prani)
       and v_r.zdroj = p_zdroj then
      v_beze_zmeny := v_beze_zmeny + 1;
      continue;
    end if;

    -- Údaje zdroje se přepíšou; to, co patří Foodtabu (druh, název, typ
    -- akce, menu, záloha, poznámky, přílohy), se nedotkne. Prostor jen
    -- doplní, když ho ve Foodtabu nikdo nevyplnil. Stoly a číslo ze zdroje
    -- přepíše, jen když je řádek nese.
    update public.rezervace set
      stav                = v_stav,
      stav_zdroje         = v_stav_zdr,
      zacatek             = v_zacatek,
      konec               = v_konec,
      pocet_osob          = v_pocet,
      jmeno_hosta         = v_jmeno,
      poznamka_zdroje     = v_poznamka,
      prostor             = case when prostor = '' then v_prostor else prostor end,
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
