-- Jiné platby — pojistky výsledku pokladny a úhrady (třetí ověření 21. 10.)
--
-- Opravná migrace k 20261016100000_jine_platby (ta je nasazená a měnit se
-- nesmí). Razítko je novější než 20261018100000 (Faktury, PR #147):
-- slučovat AŽ PO #147.
--
-- Co opravuje (zdroj: třetí nezávislé ověření, sondy T6–T8, S1–S3):
--   1. „Cesta B“: smazat číslo účtu nebo změnit položky a pustit novou
--      kontrolu v pokladně — slabší výsledek přepsal konkrétní nález
--      pokladny a šla druhá tržba / druhý odpis bez práva na opravy.
--      Konkrétní nález teď drží (app.jp_nalez_pokladny) a hlídá ho i zápis
--      nové tržby, schválení výdeje, opakování a zahájení požadavku.
--   2. Po zrušení požadavku s nejasným výsledkem stačilo ruční
--      „neodečteno“ a odešel druhý požadavek bez dohledání prvního.
--      Teď zůstane značka nedohledana_operace; vyřeší ji kontrola
--      v pokladně, ručně jen člověk s právem na opravy.
--   3. Pojistka „pravděpodobně“ bez detail.shoda (NULL v podmínce).
--   4. Falešná blokace po oprávněném přepisu výsledku pokladny (značka
--      „prepsano“).
--   5. Historie kontroly v pokladně nese celý výsledek (i id účtu).
--   6. Úhradu prokazuje jen platba z banky; storno platby po napárování
--      úhradu zruší.
--   7. Storno tržby ruší i id propojeného prodeje.
--
-- Podpisy funkcí se nemění (create or replace), práva zůstávají; revoke
-- a grant jsou zopakované jen pro čitelnost.

-- ---------------------------------------------------------------------
-- 1. Značka zrušeného požadavku s nejasným výsledkem
-- ---------------------------------------------------------------------
alter table public.jine_platby add column nedohledana_operace jsonb;

comment on column public.jine_platby.nedohledana_operace is
  'Zrušený požadavek výdeje do pokladny s nejasným výsledkem ({operace, klic, stav, kdy, kdo}). '
  'Dokud je vyplněná, ruční „neodečteno“ smí jen člověk s právem na opravy; '
  'vymaže ji kontrola skladu v pokladně s jasným výsledkem (dohledá i klíč zrušené operace).';

-- ---------------------------------------------------------------------
-- 2. Konkrétní nález pokladny
-- ---------------------------------------------------------------------
-- Výsledek dotazu do pokladny, který ukazuje na KONKRÉTNÍ prodej nebo odpis:
--   tržba — „nalezeno“, nebo „pravděpodobně“ z jiné shody než samotné
--           částky (shoda čísla účtu 'cislo_vice', i bez uvedené shody);
--   sklad — „už odečteno“.
-- Výsledek se značkou „prepsano“ (přepsal ho člověk, jine_platby_prohlasit)
-- konkrétní nález není. Bez NULL: chybějící klíč = false / konkrétní.
create function app.jp_nalez_pokladny(p_k jsonb, p_druh text)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    p_k ->> 'zdroj' = 'pos_api' and not (p_k ? 'prepsano')
    and case p_druh
          when 'trzba' then p_k ->> 'vysledek' = 'nalezeno'
                         or (p_k ->> 'vysledek' = 'pravdepodobne' and coalesce(p_k -> 'detail' ->> 'shoda', '') <> 'castka')
          when 'sklad' then p_k ->> 'vysledek' = 'jiz_odecteno'
          else false
        end,
    false)
$$;

revoke all on function app.jp_nalez_pokladny(jsonb, text) from public, anon, authenticated;

-- Který účet (odpis) nález ukazuje — ať značka přepisu platí jen pro tentýž.
create function app.jp_identita_nalezu(p_k jsonb)
returns text
language sql immutable set search_path = ''
as $$
  select coalesce(p_k -> 'detail' ->> 'pos_prodej_id', p_k -> 'detail' ->> 'externi_id',
                  p_k -> 'detail' ->> 'shoda', p_k -> 'detail' ->> 'zdroj_shody', '')
$$;

revoke all on function app.jp_identita_nalezu(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Funkce (create or replace, podpisy beze změny)
-- ---------------------------------------------------------------------
create or replace function public.jine_platby_zapsat_kontrolu(
  p_zaznam uuid, p_verze integer, p_druh text, p_vysledek text, p_detail jsonb, p_kdo uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z        public.jine_platby;
  v_k        jsonb;
  v_stara    jsonb;
  v_pokladna jsonb;
  v_ponechan boolean := false;
  v_dohledano boolean;
  v_hist     jsonb;
begin
  select * into v_z from public.jine_platby where id = p_zaznam for update;
  if not found then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  if p_verze is distinct from v_z.verze then
    raise exception 'Záznam se mezitím změnil — kontrolu zopakujte.' using errcode = 'serialization_failure';
  end if;
  if not app.jp_pokladna_obsluhuje(v_z) then
    raise exception 'Pokladna nebo její provozovna už tuhle pobočku neobsluhuje — kontrolu z ní nejde zapsat.' using errcode = 'check_violation';
  end if;
  -- Sjetina, otevřený účet nebo neurčený doklad můžou být tentýž prodej pod
  -- jiným číslem a jinou (dorostlou) částkou — „v pokladně není“ z dotazu
  -- neprokážou. Zbývá ruční prohlášení s důvodem (kontrola 20. 10.).
  if p_vysledek in ('nenalezeno', 'neodecteno') and v_z.typ_dokladu not in ('uzavreny_prodej', 'rucni_spotreba') then
    raise exception 'U dokladu typu „%“ dotaz do pokladny nepřítomnost prodeje neprokáže — jen ruční prohlášení s důvodem.', v_z.typ_dokladu
      using errcode = 'check_violation';
  end if;
  if (p_druh = 'trzba' and p_vysledek not in ('nalezeno', 'nenalezeno', 'pravdepodobne', 'nelze_overit'))
     or (p_druh = 'sklad' and p_vysledek not in ('neodecteno', 'jiz_odecteno', 'nelze_zjistit'))
     or p_druh not in ('trzba', 'sklad') then
    raise exception 'Neplatný výsledek kontroly.' using errcode = 'check_violation';
  end if;
  v_k := jsonb_build_object('vysledek', p_vysledek, 'zdroj', 'pos_api', 'verze', v_z.verze, 'kdy', now(), 'kdo', p_kdo,
                            'detail', coalesce(p_detail, '{}'::jsonb));
  -- Konkrétní nález pokladny (účet se stejným číslem, víc účtů s tím
  -- číslem, odečtená spotřeba) SLABŠÍ výsledek nepřepíše: jinak stačilo
  -- smazat číslo účtu nebo změnit položky, pustit novou kontrolu
  -- a nález by zmizel („cesta B“, ověření 21. 10.). Nález nahradí jen
  -- nový konkrétní nález, nebo ho přepíše člověk s právem na opravy
  -- (jine_platby_prohlasit, značka „prepsano“). Tentýž účet, o kterém
  -- už člověk s právem na opravy rozhodl, si značku nechá.
  v_stara := case when p_druh = 'trzba' then v_z.pokladna_trzby else v_z.pokladna_skladu end;
  if app.jp_nalez_pokladny(v_stara, p_druh) and not app.jp_nalez_pokladny(v_k, p_druh) then
    v_pokladna := v_stara;
    v_ponechan := true;
  elsif v_stara ? 'prepsano' and app.jp_nalez_pokladny(v_k, p_druh)
        and app.jp_identita_nalezu(v_k) = app.jp_identita_nalezu(v_stara) then
    v_pokladna := v_k || jsonb_build_object('prepsano', v_stara -> 'prepsano');
  else
    v_pokladna := v_k;
  end if;
  -- Kontrola skladu z pokladny dohledává klíče VŠECH operací záznamu, i
  -- zrušených (akce-pos.ts) — jasný výsledek tedy vyřeší i zrušený
  -- požadavek s nejasným výsledkem (nedohledana_operace).
  v_dohledano := p_druh = 'sklad' and p_vysledek in ('neodecteno', 'jiz_odecteno') and v_z.nedohledana_operace is not null;
  if p_druh = 'trzba' then
    update public.jine_platby set kontrola_trzby = v_k, pokladna_trzby = v_pokladna, zmeneno = now() where id = v_z.id;
  else
    update public.jine_platby
       set kontrola_skladu = v_k, pokladna_skladu = v_pokladna,
           nedohledana_operace = case when v_dohledano then null else nedohledana_operace end,
           zmeneno = now()
     where id = v_z.id;
  end if;
  -- Do historie CELÝ výsledek (i id účtu): návod slibuje, že výsledek
  -- z pokladny v historii zůstane (ověření 21. 10.).
  v_hist := jsonb_build_object('vysledek', p_vysledek, 'kontrola', v_k);
  if v_ponechan then
    v_hist := v_hist || jsonb_build_object('ponechany_nalez', v_stara);
  end if;
  if v_dohledano then
    v_hist := v_hist || jsonb_build_object('dohledana_operace', v_z.nedohledana_operace);
  end if;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, p_kdo, 'kontrola_pos_' || p_druh, v_hist);
end $$;

revoke all on function public.jine_platby_zapsat_kontrolu(uuid, integer, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.jine_platby_zapsat_kontrolu(uuid, integer, text, text, jsonb, uuid) to service_role;

create or replace function public.jine_platby_prohlasit(
  p_zaznam uuid, p_verze integer, p_druh text, p_vysledek text, p_duvod text, p_pos_prodej_id text default null,
  p_prepsat_pokladnu boolean default false
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_duvod  text;
  v_k      jsonb;
  v_stara  jsonb;
  v_prepis boolean;
  v_znacka jsonb;
  v_dohledano boolean := false;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_verze(v_z, p_verze);
  v_duvod := app.jp_duvod(p_duvod);

  if p_druh = 'trzba' then
    perform app.jp_vyzadovat(v_z, 'jine_platby.trzba', 'Prodej v pokladně smí doložit jen ten, kdo potvrzuje tržby.');
    if p_vysledek not in ('nalezeno', 'nenalezeno') then
      raise exception 'Ruční doložení tržby: prodej v pokladně je, nebo není.' using errcode = 'check_violation';
    end if;
  elsif p_druh = 'sklad' then
    perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Stav skladu smí doložit jen ten, kdo potvrzuje výdej do POS.');
    if p_vysledek not in ('neodecteno', 'jiz_odecteno') then
      raise exception 'Ruční doložení skladu: spotřeba odečtená je, nebo není.' using errcode = 'check_violation';
    end if;
  else
    raise exception 'Neznámý druh kontroly.' using errcode = 'check_violation';
  end if;

  -- Poslední výsledek dotazu do pokladny (pos_api) nepřepíše ruční
  -- prohlášení opačného znění — jinak by „není tam“ odemklo druhou tržbu
  -- nebo druhý odpis. Platí BEZ OHLEDU NA VERZI: uložení návrhu verzi zvedne
  -- i bez změny a pojistka by jinak padla prvním uložením (kontrola 20. 10.).
  -- Výsledek pokladny nahradí jen novější kontrola v pokladně.
  --   * „pravděpodobně“ ze shody jen částky: přepsat smí ten, kdo prohlašuje,
  --     s výslovným potvrzením p_prepsat_pokladnu (prodej v pokladně je jiný);
  --   * „nalezeno“, „pravděpodobně“ ze shody čísla účtu a „už odečteno“:
  --     jen s právem na opravy
  --     a s výslovným potvrzením.
  --   Pojistka čte pokladna_* (ne kontrola_*): ruční prohlášení stejného
  --   znění („je“, „už odečteno“) výsledek pokladny nevymaže.
  --   Výsledek, který už přepsal člověk s právem na opravy (nebo s potvrzením
  --   u shody částky), nese značku „prepsano“ a nebrání dál — jinak by po
  --   uložení návrhu (nová verze) šlo záznam dokončit jen s právem na opravy
  --   (ověření 21. 10.).
  v_stara := case when p_druh = 'trzba' then v_z.pokladna_trzby else v_z.pokladna_skladu end;
  v_prepis := v_stara ->> 'zdroj' = 'pos_api' and not (v_stara ? 'prepsano')
     and ((p_druh = 'trzba' and v_stara ->> 'vysledek' in ('nalezeno', 'pravdepodobne') and p_vysledek = 'nenalezeno')
          or (p_druh = 'sklad' and v_stara ->> 'vysledek' = 'jiz_odecteno' and p_vysledek = 'neodecteno'));
  if coalesce(v_prepis, false) then
    if not coalesce(p_prepsat_pokladnu, false) then
      raise exception 'Pokladna při kontrole tohle našla (výsledek: %). Ruční prohlášení opačného znění to bez výslovného potvrzení nepřepíše — zopakujte kontrolu v pokladně, nebo potvrďte, že prodej v pokladně je jiný.',
        v_stara ->> 'vysledek' using errcode = 'check_violation';
    end if;
    -- Bez práva na opravy jen „pravděpodobně“ ze shody SAMOTNÉ ČÁSTKY;
    -- „pravděpodobně“ ze shody čísla účtu (víc účtů s tím číslem) i bez
    -- uvedené shody je konkrétní stopa jako „nalezeno“ (app.jp_nalez_pokladny,
    -- bez NULL v podmínce — ověření 21. 10.).
    if app.jp_nalez_pokladny(v_stara, p_druh)
       and not app.has_access(v_z.tenant_id, 'jine_platby.oprava', v_z.branch_id) then
      raise exception 'Pokladna při kontrole tohle našla (výsledek: %) — konkrétní prodej nebo odpis přepsat smí jen člověk s právem na opravy.',
        v_stara ->> 'vysledek' using errcode = 'check_violation';
    end if;
  end if;

  -- Zrušený požadavek do pokladny s nejasným výsledkem (jine_platby_zrusit_schvaleni):
  -- „neodečteno“ bez jeho dohledání by poslalo druhý požadavek, i když
  -- pokladna mohla ten první provést (ověření 21. 10.). Dohledá ho kontrola
  -- v pokladně; ručně jen člověk s právem na opravy.
  if p_druh = 'sklad' and p_vysledek = 'neodecteno' and v_z.nedohledana_operace is not null then
    if not app.has_access(v_z.tenant_id, 'jine_platby.oprava', v_z.branch_id) then
      raise exception 'Zrušený požadavek do pokladny měl nejasný výsledek a nikdo ho nedohledal. Nejdřív zkontrolujte výdej v pokladně (dohledá i ten požadavek) — ručně „neodečteno“ smí doložit jen člověk s právem na opravy.'
        using errcode = 'check_violation';
    end if;
    v_dohledano := true;
  end if;

  if coalesce(v_prepis, false) then
    v_znacka := jsonb_build_object('kdo', auth.uid(), 'kdy', now(), 'vysledek', p_vysledek, 'duvod', v_duvod);
  end if;

  v_k := jsonb_build_object(
    'vysledek', p_vysledek, 'zdroj', 'rucni_prohlaseni', 'verze', v_z.verze,
    'kdy', now(), 'kdo', auth.uid(),
    'detail', jsonb_build_object('duvod', v_duvod, 'pos_prodej_id', left(nullif(btrim(coalesce(p_pos_prodej_id, '')), ''), 100)));

  if p_druh = 'trzba' then
    update public.jine_platby
       set kontrola_trzby = v_k,
           pokladna_trzby = case when v_znacka is null then pokladna_trzby else pokladna_trzby || jsonb_build_object('prepsano', v_znacka) end,
           zmeneno = now()
     where id = v_z.id;
  else
    update public.jine_platby
       set kontrola_skladu = v_k,
           pokladna_skladu = case when v_znacka is null then pokladna_skladu else pokladna_skladu || jsonb_build_object('prepsano', v_znacka) end,
           nedohledana_operace = case when v_dohledano then null else nedohledana_operace end,
           zmeneno = now()
     where id = v_z.id;
  end if;
  perform app.jp_historie(v_z, 'rucne_dolozeno_' || p_druh, jsonb_build_object('vysledek', p_vysledek, 'duvod', v_duvod,
    'prepsano_pokladny', case when coalesce(v_prepis, false) then v_stara ->> 'vysledek' end,
    'prepsany_vysledek', case when coalesce(v_prepis, false) then v_stara end,
    'nedohledana_operace', case when v_dohledano then v_z.nedohledana_operace end));
end $$;

revoke all on function public.jine_platby_prohlasit(uuid, integer, text, text, text, text, boolean) from public, anon;
grant execute on function public.jine_platby_prohlasit(uuid, integer, text, text, text, text, boolean) to authenticated;

create or replace function public.jine_platby_potvrdit_trzbu(p_zaznam uuid, p_verze integer, p_rezim text, p_duplicita_duvod text default null,
                                                  p_duvod_propojeni text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z         public.jine_platby;
  v_k         jsonb;
  v_vys       text;
  v_zapocitat boolean;
  v_prodej    text;
  v_dupl      uuid[];
  v_dupl_pobocky uuid[];
  v_jiny      uuid;
  v_jina_pobocka uuid;
  v_id        uuid;
  v_duvod     text;
  v_duvod_prop text;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.trzba', 'Tržbu smí potvrdit jen ten, kdo má právo evidovat tržby na této provozovně.');
  perform app.jp_verze(v_z, p_verze);
  if v_z.stav_kontroly <> 'zkontrolovano' then
    raise exception 'Nejdřív zkontrolujte údaje dokladu.' using errcode = 'check_violation';
  end if;
  if v_z.stav_trzby not in ('nezapsano', 'stornovano') then
    raise exception 'Tržba je už zapsaná nebo propojená.' using errcode = 'check_violation';
  end if;
  if v_z.castka_haleru is null or v_z.castka_haleru <= 0 or v_z.mena is null or v_z.datum_prodeje is null then
    raise exception 'Tržba potřebuje kladnou částku, měnu a datum prodeje.' using errcode = 'check_violation';
  end if;

  -- Dvě fotky téže sjetiny potvrzené ve stejnou chvíli: bez zámku by žádná
  -- transakce neviděla nepotvrzenou tržbu té druhé a obě by se zapsaly.
  -- Potvrzování tržeb jedné firmy jde proto za sebou (kontrola 19. 10.).
  perform pg_advisory_xact_lock(hashtextextended('jine_platby_trzba:' || v_z.tenant_id::text, 0));

  v_k := v_z.kontrola_trzby;
  if not app.jp_kontrola_plati(v_k, v_z.verze, 30) then
    raise exception 'Nejdřív zkontrolujte prodej v pokladně, nebo ho ručně doložte s důvodem. Kontrola platí 30 minut.' using errcode = 'check_violation';
  end if;
  v_vys := v_k ->> 'vysledek';

  if p_rezim = 'nova' then
    if v_vys <> 'nenalezeno' then
      raise exception 'Prodej v pokladně nebyl vyloučen (výsledek kontroly: %). Novou tržbu nejde zapsat — jen propojit, nebo nejdřív doložit, že v pokladně není.', v_vys
        using errcode = 'check_violation';
    end if;
    -- Konkrétní nález pokladny drží i po nové kontrole nad upraveným
    -- návrhem (jine_platby_zapsat_kontrolu): „nenalezeno“ po smazání
    -- čísla účtu nebo změně částky ho nevyloučí (ověření 21. 10.).
    if app.jp_nalez_pokladny(v_z.pokladna_trzby, 'trzba') then
      raise exception 'Pokladna při kontrole našla konkrétní prodej (výsledek: %, účet %) — novou tržbu nejde zapsat. Prodej jen propojte; když se pokladna mýlí, výsledek přepíše jen člověk s právem na opravy.',
        v_z.pokladna_trzby ->> 'vysledek', coalesce(v_z.pokladna_trzby -> 'detail' ->> 'pos_prodej_id', 'víc účtů s tím číslem') using errcode = 'check_violation';
    end if;
    -- Faktura vystavená V POKLADNĚ = účet uzavřený v pokladně, tržbu má
    -- pokladna. Nová Ostatní tržba by byla druhá (kontrola 17. 10.).
    if v_z.faktura_zdroj = 'pos' then
      raise exception 'K záznamu je propojená faktura z pokladny — tržbu má pokladna. Prodej jen propojte.' using errcode = 'check_violation';
    end if;
    v_zapocitat := true;
    v_prodej := null;
  elsif p_rezim = 'propojit' then
    if v_vys = 'nenalezeno' then
      raise exception 'Kontrola prodej v pokladně nenašla — není co propojit.' using errcode = 'check_violation';
    end if;
    v_zapocitat := false;
    v_prodej := left(nullif(btrim(coalesce(v_k -> 'detail' ->> 'pos_prodej_id', '')), ''), 100);
    if v_prodej is not null and v_z.pripojeni_id is null then
      v_prodej := null;
    end if;
    -- Propojení bez konkrétního prodeje (shoda jen částky, nejde ověřit…)
    -- by tržbu mimo pokladnu tiše vyřadilo ze všech součtů. Chce důvod;
    -- výjimkou je ruční prohlášení „prodej v pokladně je“, které důvod nese
    -- samo (kontrola 19. 10.).
    if v_prodej is null and not (v_k ->> 'zdroj' = 'rucni_prohlaseni' and v_vys = 'nalezeno') then
      if nullif(btrim(coalesce(p_duvod_propojeni, '')), '') is null then
        raise exception 'Kontrola nenašla konkrétní prodej v pokladně (výsledek: %). Propojit jde jen s důvodem, proč je prodej v pokladně — jinak se tržba nezapočítá nikde.',
          v_vys using errcode = 'check_violation';
      end if;
      v_duvod_prop := app.jp_duvod(p_duvod_propojeni);
    end if;
  else
    raise exception 'Neznámý způsob zápisu tržby.' using errcode = 'check_violation';
  end if;

  if v_prodej is not null then
    select t.zaznam_id, t.branch_id into v_jiny, v_jina_pobocka from public.ostatni_trzby t
     where t.tenant_id = v_z.tenant_id and t.pos_pripojeni_id = v_z.pripojeni_id
       and t.pos_prodej_id = v_prodej and t.stav = 'platna';
    if v_jiny is not null then
      raise exception 'Tenhle prodej z pokladny je už propojený %.',
        app.jp_popis_duplicit(v_z.tenant_id, array[v_jiny], array[v_jina_pobocka]) using errcode = 'unique_violation';
    end if;
  end if;

  -- Možné duplicity (app.jp_mozne_duplicity — stejné pravidlo jako u výdeje).
  select array_agg(d.zaznam_id), array_agg(d.branch_id) into v_dupl, v_dupl_pobocky
    from app.jp_mozne_duplicity(v_z, 'trzba') d;
  if v_dupl is not null then
    if nullif(btrim(coalesce(p_duplicita_duvod, '')), '') is null then
      raise exception 'Možná duplicita: podobný prodej je už zapsaný %. Zkontrolujte ho; když to duplicita není, napište důvod.',
        app.jp_popis_duplicit(v_z.tenant_id, v_dupl, v_dupl_pobocky) using errcode = 'check_violation';
    end if;
    v_duvod := app.jp_duvod(p_duplicita_duvod);
    update public.jine_platby
       set duplicita = jsonb_build_object('kdo', auth.uid(), 'kdy', now(), 'duvod', v_duvod, 'pocet', cardinality(v_dupl),
             'proti', (select coalesce(jsonb_agg(k.id), '[]'::jsonb) from unnest(v_dupl, v_dupl_pobocky) as k(id, branch_id)
                        where app.jine_platby_vidi(v_z.tenant_id, k.branch_id)))
     where id = v_z.id;
  end if;

  insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat,
                                    pos_pripojeni_id, pos_prodej_id, faktura_cislo, potvrdil)
  values (v_z.tenant_id, v_z.branch_id, v_z.datum_prodeje, v_z.castka_haleru, v_z.mena, 'jine_platby', v_z.id, v_zapocitat,
          case when v_prodej is null then null else v_z.pripojeni_id end, v_prodej, v_z.faktura_cislo, auth.uid())
  returning id into v_id;

  update public.jine_platby
     set stav_trzby = case when v_zapocitat then 'zapsano' else 'propojeno' end,
         pos_prodej_id = v_prodej,
         zmeneno = now()
   where id = v_z.id;

  perform app.jp_historie(v_z, case when v_zapocitat then 'trzba_zapsana' else 'trzba_propojena' end,
    jsonb_build_object('castka_haleru', v_z.castka_haleru, 'mena', v_z.mena, 'kontrola', v_vys,
                       'zdroj_kontroly', v_k ->> 'zdroj', 'pos_prodej_id', v_prodej, 'duvod_propojeni', v_duvod_prop));
  perform app.audit(v_z.tenant_id, 'finance.ostatni_trzba_potvrzena', 'ostatni_trzby', v_id::text, v_z.branch_id, null,
    jsonb_build_object('zaznam', v_z.id, 'zapocitat', v_zapocitat, 'castka_haleru', v_z.castka_haleru, 'mena', v_z.mena));
  return v_id;
end $$;

revoke all on function public.jine_platby_potvrdit_trzbu(uuid, integer, text, text, text) from public, anon;
grant execute on function public.jine_platby_potvrdit_trzbu(uuid, integer, text, text, text) to authenticated;

create or replace function public.jine_platby_rozhodnout_vydej(p_navrh uuid, p_otisk text, p_schvalit boolean, p_duvod text default null,
                                                    p_bez_surovin boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_zaznam  uuid;
  v_z       public.jine_platby;
  v_n       public.jine_platby_skladove_navrhy;
  v_v       jsonb;
  v_k       jsonb;
  v_duvod   text;
  v_op      uuid;
  v_dupl    uuid[];
  v_dupl_pobocky uuid[];
begin
  select zaznam_id into v_zaznam from public.jine_platby_skladove_navrhy where id = p_navrh;
  if v_zaznam is null then
    raise exception 'Návrh nenalezen.' using errcode = 'P0002';
  end if;
  -- Zámek ve stejném pořadí jako ulozit_navrh (záznam, pak návrh).
  v_z := app.jp_nacist(v_zaznam);
  select * into v_n from public.jine_platby_skladove_navrhy where id = p_navrh for update;
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Výdej do POS smí potvrdit jen oprávněná osoba pro tuto provozovnu.');

  if v_n.stav <> 'ceka_na_schvaleni' then
    raise exception 'Návrh už není ke schválení.' using errcode = 'check_violation';
  end if;
  if p_otisk is distinct from v_n.otisk then
    raise exception 'Návrh se mezitím změnil — zkontrolujte ho znovu.' using errcode = 'check_violation';
  end if;
  v_v := app.jp_sestavit_vydej(v_z.id);
  if v_v ->> 'otisk' is distinct from v_n.otisk then
    raise exception 'Položky se od odeslání změnily — návrh je potřeba odeslat znovu.' using errcode = 'check_violation';
  end if;

  if not coalesce(p_schvalit, false) then
    v_duvod := app.jp_duvod(p_duvod);
    update public.jine_platby_skladove_navrhy
       set stav = 'zamitnuto', zamitl = auth.uid(), zamitnuto = now(), duvod_zamitnuti = v_duvod
     where id = v_n.id;
    update public.jine_platby set stav_skladu = 'zamitnuto', zmeneno = now() where id = v_z.id;
    perform app.jp_historie(v_z, 'vydej_zamitnut', jsonb_build_object('navrh', v_n.id, 'duvod', v_duvod));
    return null;
  end if;

  v_k := v_z.kontrola_skladu;
  if not app.jp_kontrola_plati(v_k, v_z.verze, 15) then
    raise exception 'Těsně před schválením zkontrolujte výdej v pokladně, nebo ho ručně doložte s důvodem. Kontrola platí 15 minut.'
      using errcode = 'check_violation';
  end if;
  if v_k ->> 'vysledek' = 'jiz_odecteno' then
    raise exception 'Pokladna už spotřebu odečetla — výdej nevytvářejte, jen ho propojte.' using errcode = 'check_violation';
  end if;
  if v_k ->> 'vysledek' <> 'neodecteno' then
    raise exception 'Nelze zjistit, jestli pokladna spotřebu už neodečetla — nutná kontrola. Ověřte to v pokladně a doložte s důvodem.'
      using errcode = 'check_violation';
  end if;
  -- Pokladna už spotřebu odečetla (konkrétní nález drží i po nové kontrole, ověření 21. 10.).
  if app.jp_nalez_pokladny(v_z.pokladna_skladu, 'sklad') then
    raise exception 'Pokladna při kontrole našla, že spotřebu už odečetla (účet %) — výdej nevytvářejte, jen ho propojte. Když se pokladna mýlí, výsledek přepíše jen člověk s právem na opravy.',
      coalesce(v_z.pokladna_skladu -> 'detail' ->> 'externi_id', 'neuveden') using errcode = 'check_violation';
  end if;
  -- Kontrola 17. 10.: schvaluje se jen čistý návrh nad zkontrolovaným
  -- záznamem (nejasná skladová položka by se jinak neodečetla nikdy a
  -- záznam by tvrdil, že výdej je hotový).
  if v_z.stav_kontroly <> 'zkontrolovano' then
    raise exception 'Záznam se od odeslání změnil a není zkontrolovaný — nejdřív ho zkontrolujte.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_v -> 'blokace') > 0 then
    raise exception 'Návrh výdeje má nevyřešené položky: %', v_v -> 'blokace' -> 0 ->> 'duvod' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(coalesce(v_v -> 'varovani', '[]'::jsonb)) > 0 and not coalesce(p_bez_surovin, false) then
    raise exception 'Výdej obsahuje pokrm i kusové zboží — potvrďte, že zboží není surovina toho pokrmu (suroviny pokrmu odečte pokladna podle receptury sama).'
      using errcode = 'check_violation';
  end if;
  -- Opakovaná nebo jinak vyfocená sjetina nesmí vytvořit druhý výdej:
  -- možná duplicita (stejné pravidlo jako u tržby) chce důvod.
  select array_agg(d.zaznam_id), array_agg(d.branch_id) into v_dupl, v_dupl_pobocky
    from app.jp_mozne_duplicity(v_z, 'sklad') d;
  if v_dupl is not null then
    if nullif(btrim(coalesce(p_duvod, '')), '') is null then
      raise exception 'Možná duplicita výdeje: podobný výdej je už odeslaný nebo provedený %. Zkontrolujte ho; když to duplicita není, napište důvod.',
        app.jp_popis_duplicit(v_z.tenant_id, v_dupl, v_dupl_pobocky) using errcode = 'check_violation';
    end if;
    v_duvod := app.jp_duvod(p_duvod);
    v_k := v_k || jsonb_build_object('duplicita', jsonb_build_object('duvod', v_duvod, 'pocet', cardinality(v_dupl),
      'proti', (select coalesce(jsonb_agg(k.id), '[]'::jsonb) from unnest(v_dupl, v_dupl_pobocky) as k(id, branch_id)
                 where app.jine_platby_vidi(v_z.tenant_id, k.branch_id))));
  end if;

  update public.jine_platby_skladove_navrhy
     set stav = 'schvaleno', schvalil = auth.uid(), schvaleno = now(), kontrola_pri_schvaleni = v_k
   where id = v_n.id;

  insert into public.pos_operace (tenant_id, branch_id, pripojeni_id, zaznam_id, navrh_id, druh, idempotencni_klic,
                                  stav, externi_provozovna, polozky, poznamka, zahajil)
  values (v_z.tenant_id, v_z.branch_id, v_z.pripojeni_id, v_z.id, v_n.id, 'vydej',
          'ftjp' || replace(v_n.id::text, '-', ''), 'pripraveno', v_z.pos_provozovna,
          coalesce((select jsonb_agg(jsonb_build_object('produktId', e ->> 'pos_produkt_id', 'mnozstvi', e ->> 'mnozstvi'))
                      from jsonb_array_elements(v_n.obsah -> 'polozky') e), '[]'::jsonb),
          left('Foodtab Jiné platby ' || coalesce(nullif(v_z.oznaceni, ''), to_char(v_z.datum_prodeje, 'DD.MM.YYYY')), 200),
          auth.uid())
  returning id into v_op;

  update public.jine_platby set stav_skladu = 'schvaleno', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'vydej_schvalen', jsonb_build_object('navrh', v_n.id, 'operace', v_op,
    'kontrola', v_k ->> 'vysledek', 'zdroj_kontroly', v_k ->> 'zdroj', 'duplicita_duvod', v_k -> 'duplicita' ->> 'duvod',
    'bez_surovin_potvrzeno', case when jsonb_array_length(coalesce(v_v -> 'varovani', '[]'::jsonb)) > 0 then true end));
  perform app.audit(v_z.tenant_id, 'finance.vydej_pos_schvalen', 'jine_platby_skladove_navrhy', v_n.id::text, v_z.branch_id,
    null, jsonb_build_object('otisk', v_n.otisk, 'operace', v_op));
  return v_op;
end $$;

revoke all on function public.jine_platby_rozhodnout_vydej(uuid, text, boolean, text, boolean) from public, anon;
grant execute on function public.jine_platby_rozhodnout_vydej(uuid, text, boolean, text, boolean) to authenticated;

create or replace function public.jine_platby_vydej_znovu(p_zaznam uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_n      public.jine_platby_skladove_navrhy;
  v_posl   public.pos_operace;
  v_pocet  integer;
  v_op     uuid;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Výdej do POS smí zopakovat jen oprávněná osoba pro tuto provozovnu.');
  select * into v_n from public.jine_platby_skladove_navrhy where zaznam_id = v_z.id and stav = 'schvaleno' for update;
  if not found then
    raise exception 'Není schválený návrh výdeje.' using errcode = 'check_violation';
  end if;
  select * into v_posl from public.pos_operace where navrh_id = v_n.id and druh = 'vydej' order by zahajeno desc limit 1 for update;
  if v_posl.id is not null and v_posl.stav <> 'chyba' then
    raise exception 'Poslední požadavek do pokladny není prokazatelně neúspěšný (stav %). Nejdřív dohledejte jeho výsledek.', v_posl.stav
      using errcode = 'check_violation';
  end if;
  if not app.jp_kontrola_plati(v_z.kontrola_skladu, v_z.verze, 15) or v_z.kontrola_skladu ->> 'vysledek' <> 'neodecteno' then
    raise exception 'Před opakováním znovu zkontrolujte výdej v pokladně (platí 15 minut).' using errcode = 'check_violation';
  end if;
  -- Pokladna už spotřebu odečetla (konkrétní nález drží i po nové kontrole, ověření 21. 10.).
  if app.jp_nalez_pokladny(v_z.pokladna_skladu, 'sklad') then
    raise exception 'Pokladna při kontrole našla, že spotřebu už odečetla (účet %) — požadavek neopakujte, výdej jen propojte.',
      coalesce(v_z.pokladna_skladu -> 'detail' ->> 'externi_id', 'neuveden') using errcode = 'check_violation';
  end if;

  select count(*) into v_pocet from public.pos_operace where navrh_id = v_n.id and druh = 'vydej';
  insert into public.pos_operace (tenant_id, branch_id, pripojeni_id, zaznam_id, navrh_id, druh, idempotencni_klic,
                                  stav, externi_provozovna, polozky, poznamka, zahajil)
  select tenant_id, branch_id, pripojeni_id, zaznam_id, navrh_id, 'vydej',
         'ftjp' || replace(v_n.id::text, '-', '') || '-' || (v_pocet + 1),
         'pripraveno', externi_provozovna, polozky, poznamka, auth.uid()
    from public.pos_operace where id = v_posl.id
  returning id into v_op;
  if v_op is null then
    raise exception 'Chybí předchozí požadavek.' using errcode = 'check_violation';
  end if;

  update public.jine_platby set stav_skladu = 'schvaleno', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'vydej_znovu', jsonb_build_object('operace', v_op, 'pokus', v_pocet + 1));
  return v_op;
end $$;

revoke all on function public.jine_platby_vydej_znovu(uuid) from public, anon;
grant execute on function public.jine_platby_vydej_znovu(uuid) to authenticated;

create or replace function public.pos_operace_zahajit(p_operace uuid, p_platnost_do timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_op      public.pos_operace;
  v_z       public.jine_platby;
  v_zaznam  uuid;
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

  update public.pos_operace
     set stav = 'odesila_se', pokusu = pokusu + 1, platnost_do = p_platnost_do, odeslano = now()
   where id = v_op.id
   returning * into v_op;
  update public.jine_platby set stav_skladu = 'zpracovava_se', zmeneno = now() where id = v_z.id;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, 'vydej_odesila_se', jsonb_build_object('operace', v_op.id, 'pokus', v_op.pokusu));

  return jsonb_build_object('stav', 'ok', 'operace', jsonb_build_object(
    'id', v_op.id, 'klic', v_op.idempotencni_klic, 'stav', v_op.stav, 'pokusu', v_op.pokusu,
    'platnostDo', v_op.platnost_do, 'externiProvozovna', v_op.externi_provozovna,
    'polozky', v_op.polozky, 'poznamka', v_op.poznamka));
end $$;

revoke all on function public.pos_operace_zahajit(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pos_operace_zahajit(uuid, timestamptz) to service_role;

create or replace function public.jine_platby_zrusit_schvaleni(p_zaznam uuid, p_duvod text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_op     public.pos_operace;
  v_duvod  text;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Schválení výdeje smí zrušit jen oprávněná osoba pro tuto provozovnu.');
  v_duvod := app.jp_duvod(p_duvod);
  if v_z.stav_skladu not in ('schvaleno', 'nepodporovano', 'chyba', 'zpracovava_se', 'nejasny_vysledek') then
    raise exception 'Není co rušit — výdej není schválený, nebo už proběhl.' using errcode = 'check_violation';
  end if;
  select o.* into v_op from public.pos_operace o
    join public.jine_platby_skladove_navrhy n on n.id = o.navrh_id and n.stav = 'schvaleno'
   where o.zaznam_id = v_z.id and o.druh = 'vydej'
   order by o.zahajeno desc limit 1
   for update of o;
  if v_op.stav in ('odesila_se', 'nejasny_vysledek')
     and (v_op.platnost_do is null or v_op.platnost_do + interval '2 minutes' > now()) then
    raise exception 'Požadavek do pokladny má nejasný výsledek — nejdřív ho dohledejte. Zrušit schválení jde až po vypršení jeho platnosti.' using errcode = 'check_violation';
  end if;
  if v_op.stav in ('uspech', 'rucne_dolozeno') then
    raise exception 'Výdej už proběhl — místo zrušení použijte korekci.' using errcode = 'check_violation';
  end if;

  update public.pos_operace set stav = 'zruseno', dokonceno = now(), duvod = 'Schválení zrušeno: ' || v_duvod
   where zaznam_id = v_z.id and druh = 'vydej' and stav in ('pripraveno', 'nepodporovano', 'odesila_se', 'nejasny_vysledek');
  update public.jine_platby_skladove_navrhy set stav = 'nahrazeno'
   where zaznam_id = v_z.id and stav in ('ceka_na_schvaleni', 'schvaleno');
  -- Kontrola skladu z doby před (třeba nejasným) požadavkem přestává platit:
  -- nové schválení chce čerstvou kontrolu v pokladně, která dohledá i klíč
  -- zrušené operace (ověření 20. 10. — jinak šel výdej hned znovu schválit
  -- a odešel druhý požadavek bez dohledání prvního).
  -- Zrušený požadavek s NEJASNÝM výsledkem (odesílal se, nebo výsledek
  -- nejde dohledat) mohla pokladna provést. Značka nedohledana_operace
  -- zůstane, dokud ho nedohledá kontrola v pokladně (zapsat_kontrolu,
  -- klíče všech operací záznamu), nebo dokud „neodečteno“ ručně nedoloží
  -- člověk s právem na opravy (ověření 21. 10. — jinak stačilo ruční
  -- „neodečteno“ a odešel druhý požadavek bez dohledání prvního).
  update public.jine_platby
     set stav_skladu = 'bez_navrhu', kontrola_skladu = null,
         nedohledana_operace = case when v_op.stav in ('odesila_se', 'nejasny_vysledek')
                                    then jsonb_build_object('operace', v_op.id, 'klic', v_op.idempotencni_klic, 'stav', v_op.stav,
                                                            'kdy', now(), 'kdo', auth.uid())
                                    else nedohledana_operace end,
         zmeneno = now()
   where id = v_z.id;
  perform app.jp_historie(v_z, 'schvaleni_zruseno', jsonb_build_object('duvod', v_duvod, 'byl', v_z.stav_skladu,
    'nedohledana_operace', case when v_op.stav in ('odesila_se', 'nejasny_vysledek') then v_op.id end));
end $$;

revoke all on function public.jine_platby_zrusit_schvaleni(uuid, text) from public, anon;
grant execute on function public.jine_platby_zrusit_schvaleni(uuid, text) to authenticated;

create or replace function public.jine_platby_evidovat_uhradu(p_zaznam uuid, p_transakce uuid, p_castka_haleru integer)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z        public.jine_platby;
  v_t        record;
  v_jinde    bigint;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.faktura', 'Úhradu smí evidovat jen ten, kdo spravuje faktury Jiných plateb.');

  if p_transakce is null then
    update public.jine_platby set stav_uhrady = 'neovereno', uhrada_transakce_id = null, uhrada_castka_haleru = null, zmeneno = now()
     where id = v_z.id;
    perform app.jp_historie(v_z, 'uhrada_odpojena', '{}'::jsonb);
    return;
  end if;
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Záznam je zrušený — úhradu k němu napárovat nejde.' using errcode = 'check_violation';
  end if;
  -- Stejný zámek jako párování plateb s fakturami (app.potvrdit_alokaci_platby),
  -- ať jedna platba nezaplatí fakturu i Jinou platbu zároveň (kontrola 19. 10.).
  perform pg_advisory_xact_lock(hashtextextended(p_transakce::text, 0));

  -- Zámek platby (pořadí: záznam, pak platba): dvě souběžná párování téže
  -- platby by jinak obě prošla kontrolou součtu (kontrola 17. 10.).
  select t.id, t.castka_haleru, t.mena, t.smer, t.storno_of, t.zdroj, u.branch_id into v_t
    from public.transakce t join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = v_z.tenant_id
   for update of t;
  if not found then
    raise exception 'Platba nepatří této firmě.' using errcode = 'check_violation';
  end if;
  -- Bankovní data smí vidět jen ten, kdo má finanční přehled k tomu účtu:
  -- firemní účet (bez pobočky) jen finance.read ZA CELOU FIRMU, účet pobočky
  -- finance.read na té pobočce (stejné pravidlo jako brána Financí, otázka 48).
  if not app.has_access(v_z.tenant_id, 'finance.read', v_t.branch_id) then
    raise exception 'K téhle platbě nemáte přístup.' using errcode = 'insufficient_privilege';
  end if;
  if v_t.smer <> 'prijem' then
    raise exception 'Úhrada musí být příchozí platba.' using errcode = 'check_violation';
  end if;
  if v_t.storno_of is not null or exists (
       select 1 from public.transakce s where s.storno_of = p_transakce and s.tenant_id = v_z.tenant_id) then
    raise exception 'Platba je stornovaná (nebo je to storno) — úhradu neprokazuje.' using errcode = 'check_violation';
  end if;
  -- Úhradu prokazuje jen platba z BANKY (výpis, napojení banky) — stejné
  -- zdroje jako automatické párování faktur. Ručně zapsaná platba nebo
  -- platba z pokladny by se ukázala jako „ověřeno v bance“ (ověření 21. 10.).
  if v_t.zdroj not in ('fio_api', 'bankovni_agregator', 'csv_banka') then
    raise exception 'Úhradu prokazuje jen platba z banky (výpis nebo napojení banky). Tahle platba je zapsaná ručně nebo pochází z pokladny.'
      using errcode = 'check_violation';
  end if;
  if v_z.mena is null or v_t.mena is distinct from v_z.mena then
    raise exception 'Měna platby nesedí s měnou záznamu.' using errcode = 'check_violation';
  end if;
  if p_castka_haleru is null or p_castka_haleru <= 0 or p_castka_haleru > v_t.castka_haleru then
    raise exception 'Částka úhrady musí být kladná a nejvýš rovna platbě.' using errcode = 'check_violation';
  end if;
  -- Soupeři o tutéž platbu: jiné Jiné platby i potvrzené párování s fakturami.
  select coalesce((select sum(uhrada_castka_haleru) from public.jine_platby
                    where uhrada_transakce_id = p_transakce and id <> v_z.id and tenant_id = v_z.tenant_id), 0)
       + coalesce((select sum(castka_haleru) from public.platby_faktury
                    where transakce_id = p_transakce and tenant_id = v_z.tenant_id and stav = 'potvrzeno'), 0)
    into v_jinde;
  if v_jinde + p_castka_haleru > v_t.castka_haleru then
    raise exception 'Platba je už rozdělená k jiným záznamům nebo fakturám — zbývá % hal.', v_t.castka_haleru - v_jinde using errcode = 'check_violation';
  end if;

  update public.jine_platby
     set uhrada_transakce_id = p_transakce, uhrada_castka_haleru = p_castka_haleru,
         stav_uhrady = case when v_z.castka_haleru is not null and p_castka_haleru >= v_z.castka_haleru then 'uhrazeno' else 'castecne' end,
         zmeneno = now()
   where id = v_z.id;
  perform app.jp_historie(v_z, 'uhrada_evidovana', jsonb_build_object('transakce', p_transakce, 'castka_haleru', p_castka_haleru));
end $$;

revoke all on function public.jine_platby_evidovat_uhradu(uuid, uuid, integer) from public, anon;
grant execute on function public.jine_platby_evidovat_uhradu(uuid, uuid, integer) to authenticated;

create or replace function public.jine_platby_opravit_trzbu(p_zaznam uuid, p_verze integer, p_nova_castka_haleru integer, p_duvod text, p_doklad_opravy text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_t      public.ostatni_trzby;
  v_duvod  text;
  v_id     uuid;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.oprava', 'Opravu tržby smí provést jen ten, kdo má právo na opravy.');
  -- Verze (kontrola 17. 10.): souběžná oprava se jinak tiše přepíše a dvojklik
  -- přidá storno a nový řádek dvakrát.
  perform app.jp_verze(v_z, p_verze);
  v_duvod := app.jp_duvod(p_duvod);
  if v_z.stav_trzby not in ('zapsano', 'propojeno') then
    raise exception 'Není co opravit — tržba není zapsaná.' using errcode = 'check_violation';
  end if;
  if v_z.stav_faktury = 'propojena' and nullif(btrim(coalesce(p_doklad_opravy, '')), '') is null then
    raise exception 'K záznamu je propojená faktura. Opravte ji opravným dokladem v systému, kde byla vystavena, a jeho číslo uveďte.'
      using errcode = 'check_violation';
  end if;
  if p_nova_castka_haleru is not null and p_nova_castka_haleru <= 0 then
    raise exception 'Opravená částka musí být kladná (pro zrušení tržby použijte storno).' using errcode = 'check_violation';
  end if;

  select * into v_t from public.ostatni_trzby where zaznam_id = v_z.id and stav = 'platna' for update;
  if v_t.id is null then
    raise exception 'Platná tržba k záznamu chybí.' using errcode = 'check_violation';
  end if;
  update public.ostatni_trzby
     set stav = 'stornovana', stornovano = now(), stornoval = auth.uid(),
         storno_duvod = left(v_duvod || coalesce(' (opravný doklad ' || nullif(btrim(p_doklad_opravy), '') || ')', ''), 1000)
   where id = v_t.id;

  if p_nova_castka_haleru is not null then
    insert into public.ostatni_trzby (tenant_id, branch_id, datum, castka_haleru, mena, zdroj, zaznam_id, zapocitat, kategorie,
                                      pos_pripojeni_id, pos_prodej_id, faktura_cislo, nahrazuje, potvrdil)
    values (v_t.tenant_id, v_t.branch_id, v_t.datum, p_nova_castka_haleru, v_t.mena, v_t.zdroj, v_t.zaznam_id, v_t.zapocitat, v_t.kategorie,
            v_t.pos_pripojeni_id, v_t.pos_prodej_id, v_t.faktura_cislo, v_t.id, auth.uid())
    returning id into v_id;
    update public.jine_platby
       set castka_haleru = p_nova_castka_haleru, castka_puvod = 'rucne',
           stav_uhrady = case when uhrada_transakce_id is null then 'neovereno'
                              when uhrada_castka_haleru >= p_nova_castka_haleru then 'uhrazeno' else 'castecne' end,
           verze = verze + 1, zmeneno = now()
     where id = v_z.id;
  else
    -- Storno ruší i propojení s prodejem z pokladny: id prodeje by jinak
    -- viselo u stornované tržby a další kontrola by podle něj hledala
    -- prodej, se kterým už záznam nic nemá (ověření 21. 10.).
    update public.jine_platby set stav_trzby = 'stornovano', pos_prodej_id = null, verze = verze + 1, zmeneno = now() where id = v_z.id;
  end if;

  perform app.jp_historie(v_z, case when p_nova_castka_haleru is null then 'trzba_stornovana' else 'trzba_opravena' end,
    jsonb_build_object('pred', v_t.castka_haleru, 'po', p_nova_castka_haleru, 'duvod', v_duvod, 'doklad_opravy', p_doklad_opravy));
  perform app.audit(v_z.tenant_id, 'finance.ostatni_trzba_opravena', 'ostatni_trzby', v_t.id::text, v_z.branch_id,
    jsonb_build_object('castka_haleru', v_t.castka_haleru), jsonb_build_object('castka_haleru', p_nova_castka_haleru, 'novy', v_id));
  return v_id;
end $$;

revoke all on function public.jine_platby_opravit_trzbu(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.jine_platby_opravit_trzbu(uuid, integer, integer, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Storno platby po napárování úhrady
-- ---------------------------------------------------------------------
-- Storno přichází jako nová transakce se storno_of (banka je jen pro
-- čtení). Úhrada napárovaná na stornovanou platbu přestává platit —
-- jinak by záznam dál tvrdil „uhrazeno“ (ověření 21. 10.).
create function app.jp_storno_platby()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_z public.jine_platby;
begin
  for v_z in
    select * from public.jine_platby
     where uhrada_transakce_id = new.storno_of and tenant_id = new.tenant_id
     for update
  loop
    update public.jine_platby
       set stav_uhrady = 'neovereno', uhrada_transakce_id = null, uhrada_castka_haleru = null, zmeneno = now()
     where id = v_z.id;
    insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, udalost, detail)
    values (v_z.tenant_id, v_z.branch_id, v_z.id, 'uhrada_zrusena_stornem',
            jsonb_build_object('transakce', new.storno_of, 'storno', new.id, 'castka_haleru', v_z.uhrada_castka_haleru));
  end loop;
  return null;
end $$;

revoke all on function app.jp_storno_platby() from public, anon, authenticated;

create trigger trg_storno_platby_jine_platby after insert on public.transakce
  for each row when (new.storno_of is not null) execute function app.jp_storno_platby();
