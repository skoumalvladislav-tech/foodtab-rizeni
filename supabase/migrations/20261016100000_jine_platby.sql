-- =====================================================================
-- Foodtab — Finance → Tržby → Jiné platby
--
-- Zadání: Šéfík 15. 10. 2026 (doslova v PR). Návrh a důvody:
-- docs/jine-platby-navrh.md — tahle hlavička říká jen to, co by někdo
-- za rok „opravil", kdyby to nevěděl.
--
-- ---------------------------------------------------------------------
-- CO JE ZDROJ PRAVDY (a proč se nic nezapisuje jinam)
--
--   * Tržba z pokladny = `pokladna_prodeje_denni`. Sem Jiné platby NIKDY
--     nepíšou: synchronizace za poslední tři dny maže řádky cizího zdroje
--     (20261012200000, `pokladna_nahradit_prodeje`), a co by přežilo, by
--     se sečetlo s Ostatními tržbami dvakrát.
--   * Tržba mimo pokladnu = NOVÁ evidence `ostatni_trzby`. Agenda
--     „Ostatní tržby" do 16. 10. 2026 neexistovala (na Tržbách byla jen
--     karta „modul se připravuje"), takže nevzniká paralelní evidence,
--     vzniká jediná.
--   * Prodej, který v pokladně UŽ JE, se jen propojí (`zapocitat=false`)
--     — `check (not (zapocitat and pos_prodej_id is not null))`.
--   * Faktura NENÍ tržba a úhrada NENÍ tržba. Do DB Faktur (oddělený
--     projekt bez tenant_id, přes anon klíč — otázka 45) se nezapisuje;
--     do `transakce` (skutečné peníze) taky ne. Úhrada je jen vazba na
--     existující příchozí transakci.
--   * Sklad dělá pokladna (rozhodnutí Šéfíka 2. 10. 2026). Appka eviduje
--     návrh výdeje, schválení a sledovaný krok v pokladně (`pos_operace`),
--     nikdy zásobu ani skladovou kartu.
--
-- ---------------------------------------------------------------------
-- BEZPEČNOST
--
--   * Všechny tabulky: tenant_id + branch_id (kde dává smysl, not null),
--     RLS jen pro čtení, ZÁPIS JEN PŘES FUNKCE (`revoke all` a zpět jen
--     select). Výchozí práva Supabase by jinak `create table` dala
--     anon/authenticated všechno (CLAUDE.md, Konvence).
--   * Funkce jsou SECURITY DEFINER → RLS se v nich neuplatní. Každá si
--     záznam najde podle id, firmu a pobočku vezme Z ŘÁDKU a právo ověří
--     přes `app.has_access(firma, právo, pobočka záznamu)`. Firma ani
--     pobočka z parametru se nikdy nepoužijí k rozhodnutí o přístupu
--     (kromě založení, kde se ověří, že pobočka firmě patří).
--   * Spouště `jp_hlida_*` jsou druhá linie: dítě musí patřit téže firmě
--     a pobočce jako záznam, připojení a kontakt téže firmě.
--   * Právo na tržbu NEumožňuje sklad a naopak — každá funkce chce svoje.
--
-- ---------------------------------------------------------------------
-- CO SE SCHVÁLNĚ NEDĚLÁ
--
--   * Foodcost se nemění (`foodcost_beverage_prehled` beze změny). Jestli
--     odpis v Dotykačce leze do jejích prodejů, je neověřené — přičíst
--     spotřebu by mohlo znamenat dvojí započtení (otázka 53). Potvrzená
--     spotřeba je dohledatelná přes `jine_platby_spotreba`.
--   * Žádné vystavení faktury (číselná řada, DPH plátce, sídlo firmy
--     chybí; otázka 51).
--   * Oprávnění se dosavadním zaměstnancům nedosazují (kromě majitele,
--     ten má vše z aktivních modulů automaticky). Do rolí u zákazníků se
--     nesahá (20260831010000, ř. 122–125).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. OPRÁVNĚNÍ
--
-- Modul `finance` (ne nový modul): has_access chce aktivní tenant_modules
-- modulu toho práva — nový modul by nefungoval nikomu, dokud by ho
-- někdo nezapnul (stejná úvaha jako integrace.manage, 20261007110000).
--
-- Citlivé (= nejde pozvat přes SMS) jsou ta, která mění peníze, sklad
-- nebo historii. Obsluha (zadat, upravit, odeslat ke schválení) citlivá
-- práva nepotřebuje.
-- ---------------------------------------------------------------------

insert into public.permissions (key, module_key, label, sensitive, sort_order) values
  ('jine_platby.zadat',         'finance', 'Jiné platby: vytvořit záznam a nahrát doklad', false, 520),
  ('jine_platby.upravit',       'finance', 'Jiné platby: upravit návrh (položky, ceny, mapování do pokladny)', false, 521),
  ('jine_platby.sklad_odeslat', 'finance', 'Jiné platby: odeslat skladový návrh ke schválení', false, 522),
  ('jine_platby.trzba',         'finance', 'Jiné platby: potvrdit zápis do Ostatních tržeb', true, 523),
  ('jine_platby.vydej_pos',     'finance', 'Jiné platby: Potvrdit výdej do POS', true, 524),
  ('jine_platby.faktura',       'finance', 'Jiné platby: vystavit nebo propojit fakturu a evidovat úhradu', true, 525),
  ('jine_platby.oprava',        'finance', 'Jiné platby: oprava a storno', true, 526)
on conflict (key) do update
  set module_key = excluded.module_key,
      label      = excluded.label,
      sensitive  = excluded.sensitive,
      sort_order = excluded.sort_order;


-- ---------------------------------------------------------------------
-- 2. KDO VIDÍ
--
-- Záznamy pobočky vidí, kdo má NA TÉ POBOČCE kterékoli právo agendy nebo
-- finanční přehled. `branch_id` je u všech řádků povinné — řádek bez
-- pobočky by `can_read_scoped(…, null)` pustil každému s právem kdekoli
-- (díra popsaná u Financí po pobočkách, otázka 48).
-- ---------------------------------------------------------------------

create function app.jine_platby_vidi(p_tenant uuid, p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_tenant is not null and p_branch is not null and exists (
    select 1
      from unnest(array[
        'finance.read', 'jine_platby.zadat', 'jine_platby.upravit', 'jine_platby.sklad_odeslat',
        'jine_platby.trzba', 'jine_platby.vydej_pos', 'jine_platby.faktura', 'jine_platby.oprava'
      ]) as p(pravo)
     where app.has_access(p_tenant, p.pravo, p_branch)
  )
$$;

comment on function app.jine_platby_vidi(uuid, uuid) is
  'Vidí záznamy Jiných plateb této pobočky? Kterékoli právo agendy nebo '
  'finance.read, vždy NA POBOČCE (has_access). Bez pobočky ne.';

revoke all on function app.jine_platby_vidi(uuid, uuid) from public, anon;
grant execute on function app.jine_platby_vidi(uuid, uuid) to authenticated, service_role;

-- Katalog pokladny a ověřená mapování patří připojení. Vidí je jen ten,
-- kdo vidí záznamy NĚKTERÉ pobočky, kterou ta pokladna obsluhuje — ne
-- kdokoli s právem kdekoli ve firmě (kontrola 17. 10.: obsluha Perly by
-- jinak četla katalog Baru a znala id jeho pokladny).
create function app.jine_platby_vidi_pripojeni(p_tenant uuid, p_pripojeni uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_tenant is not null and p_pripojeni is not null and exists (
    select 1
      from public.integrace_pripojeni p
     where p.id = p_pripojeni
       and p.tenant_id = p_tenant
       and p.oblast = 'pokladna'
       and ((p.branch_id is not null and app.jine_platby_vidi(p_tenant, p.branch_id))
            or (p.branch_id is null and exists (
                  select 1
                    from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) e
                   where e ->> 'branch_id' ~ '^[0-9a-f-]{36}$'
                     and app.jine_platby_vidi(p_tenant, (e ->> 'branch_id')::uuid))))
  )
$$;

revoke all on function app.jine_platby_vidi_pripojeni(uuid, uuid) from public, anon;
grant execute on function app.jine_platby_vidi_pripojeni(uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 3. TABULKY
-- ---------------------------------------------------------------------

-- 3.1 Záznam (jeden doklad). Stavy jsou ZVLÁŠŤ po částech — dokončení
-- jedné nikdy neoznačí jinou za hotovou (zadání, oddíl 3 a 11).
create table public.jine_platby (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  branch_id             uuid not null references public.branches(id) on delete restrict,
  pripojeni_id          uuid references public.integrace_pripojeni(id) on delete restrict,
  pos_provozovna        text check (pos_provozovna is null or char_length(pos_provozovna) between 1 and 100),
  klient_id             uuid not null,
  datum_prodeje         date,
  oznaceni              text not null default '' check (char_length(oznaceni) <= 200),
  kontakt_id            uuid references public.kontakty(id) on delete restrict,
  mena                  text check (mena ~ '^[A-Z]{3}$'),
  castka_haleru         integer check (castka_haleru >= 0),
  castka_puvod          text check (castka_puvod in ('doklad', 'vypocet', 'rucne')),
  typ_dokladu           text not null default 'nezjisteno'
                        check (typ_dokladu in ('otevreny_ucet', 'uzavreny_prodej', 'informativni_sjetina', 'rucni_spotreba', 'nezjisteno')),
  externi_ucet          text check (externi_ucet is null or char_length(externi_ucet) between 1 and 100),
  pos_prodej_id         text check (pos_prodej_id is null or char_length(pos_prodej_id) between 1 and 100),
  stav_kontroly         text not null default 'rozpracovano'
                        check (stav_kontroly in ('rozpracovano', 'ke_kontrole', 'zkontrolovano', 'zruseno')),
  stav_trzby            text not null default 'nezapsano'
                        check (stav_trzby in ('nezapsano', 'zapsano', 'propojeno', 'stornovano')),
  stav_skladu           text not null default 'bez_navrhu'
                        check (stav_skladu in ('bez_navrhu', 'nevyzaduje', 'ceka_na_schvaleni', 'zamitnuto', 'schvaleno',
                                               'zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'jiz_odecteno',
                                               'rucne_dolozeno', 'nepodporovano', 'chyba', 'nutna_kontrola', 'opraveno')),
  stav_faktury          text not null default 'bez_faktury'
                        check (stav_faktury in ('bez_faktury', 'podklady', 'propojena')),
  faktura_cislo         text check (faktura_cislo is null or char_length(faktura_cislo) between 1 and 100),
  faktura_zdroj         text check (faktura_zdroj in ('pos', 'externi')),
  faktura_castka_haleru integer check (faktura_castka_haleru >= 0),
  faktura_podklady      jsonb,
  stav_uhrady           text not null default 'neovereno'
                        check (stav_uhrady in ('neovereno', 'castecne', 'uhrazeno')),
  uhrada_transakce_id   uuid references public.transakce(id) on delete restrict,
  uhrada_castka_haleru  integer check (uhrada_castka_haleru > 0),
  vydej_externi_id      text check (vydej_externi_id is null or char_length(vydej_externi_id) between 1 and 100),
  vydej_doklad          text check (vydej_doklad is null or char_length(vydej_doklad) between 1 and 100),
  kontrola_trzby        jsonb,
  kontrola_skladu       jsonb,
  duplicita             jsonb,
  -- Upozornění AI k CELÉMU dokladu (nízká jistota, víc dokladů v jednom,
  -- zachycený pokyn v textu dokladu…). Dokud nějaké je, záznam je „ke
  -- kontrole“ a označit ho jako zkontrolovaný jde jen s výslovným
  -- potvrzením, že je člověk prověřil (kontrola 19. 10.).
  upozorneni_dokladu    jsonb not null default '[]'::jsonb check (jsonb_typeof(upozorneni_dokladu) = 'array'),
  -- Rozpoznání AI, ze kterého je uložený návrh (zapisuje ulozit_navrh, když
  -- ho akce rozpoznání předá). Panel „Částky na dokladu“ čte tenhle řádek,
  -- ne poslední pokus (kontrola 20. 10.). Cizí klíč níž, po tabulce rozpoznání.
  rozpoznani_id         uuid,
  zruseni_duvod         text check (zruseni_duvod is null or char_length(zruseni_duvod) <= 1000),
  verze                 integer not null default 1 check (verze >= 1),
  vytvoril              uuid,
  vytvoreno             timestamptz not null default now(),
  zmeneno               timestamptz not null default now(),
  unique (tenant_id, klient_id),
  check (pos_prodej_id is null or pripojeni_id is not null),
  check (stav_faktury <> 'propojena' or faktura_cislo is not null),
  check ((stav_uhrady = 'neovereno') = (uhrada_transakce_id is null))
);

-- Jeden prodej v pokladně = nejvýš jeden živý záznam. Jinak vyfocená
-- sjetina podruhé propojí tentýž prodej a výdej k němu dvakrát.
create unique index jine_platby_pos_prodej on public.jine_platby (tenant_id, pripojeni_id, pos_prodej_id)
  where pos_prodej_id is not null and stav_kontroly <> 'zruseno';
create index jine_platby_pobocka_datum on public.jine_platby (tenant_id, branch_id, datum_prodeje);
create index jine_platby_vytvoreno on public.jine_platby (tenant_id, vytvoreno desc);
create index jine_platby_ke_schvaleni on public.jine_platby (tenant_id, branch_id) where stav_skladu = 'ceka_na_schvaleni';

comment on table public.jine_platby is
  'Jiné platby: jeden doklad (sjetina, otevřený účet, ručně psané položky). '
  'Tržba, sklad, faktura a úhrada mají každá vlastní stav. Zápis jen přes '
  'funkce jine_platby_*. Název neznamená, že je prodej zaplacený.';

-- 3.2 Originály. Otisk počítá NÁŠ server ze stažených bajtů a zapsat ho smí
-- jen on: jine_platby_pripojit_soubor má jen service_role (kontrola 19. 10.).
create table public.jine_platby_soubory (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete restrict,
  zaznam_id  uuid not null references public.jine_platby(id) on delete restrict,
  poradi     smallint not null check (poradi between 1 and 10),
  cesta      text not null unique check (char_length(cesta) <= 300),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  velikost   integer not null check (velikost > 0 and velikost <= 10485760),
  otisk      text not null check (otisk ~ '^[0-9a-f]{64}$'),
  nahral     uuid,
  nahrano    timestamptz not null default now(),
  -- false = záznam byl zrušený: soubor zůstává jako historie, ale otisk
  -- už neblokuje připojení téhož dokladu k novému (správnému) záznamu.
  aktivni    boolean not null default true,
  unique (zaznam_id, poradi)
);
-- Tentýž soubor nejde připojit ke dvěma ŽIVÝM záznamům (opakovaně nahraná fotka).
create unique index jine_platby_soubory_otisk on public.jine_platby_soubory (tenant_id, otisk) where aktivni;

-- 3.3 Výstup AI — jen přidávat, nikdy neměnit obsah. Opravy člověka jdou
-- do položek a historie; původní rozpoznání zůstává (zadání, oddíl 4).
create table public.jine_platby_rozpoznani (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null references public.branches(id) on delete restrict,
  zaznam_id     uuid not null references public.jine_platby(id) on delete restrict,
  verze_zaznamu integer not null,
  stav          text not null check (stav in ('bezi', 'ok', 'chyba', 'bez_klice')),
  model         text check (model is null or char_length(model) <= 100),
  verze_zadani  text check (verze_zadani is null or char_length(verze_zadani) <= 50),
  vysledek      jsonb,
  text_dokladu  text check (text_dokladu is null or char_length(text_dokladu) <= 20000),
  duvod         text check (duvod is null or char_length(duvod) <= 2000),
  spustil       uuid,
  vytvoreno     timestamptz not null default now(),
  dokonceno     timestamptz
);
create index jine_platby_rozpoznani_den on public.jine_platby_rozpoznani (tenant_id, vytvoreno);
create index jine_platby_rozpoznani_zaznam on public.jine_platby_rozpoznani (zaznam_id, vytvoreno desc);

-- 3.4 Položky návrhu. Množství numeric(12,3), peníze v haléřích.
alter table public.jine_platby add constraint jine_platby_rozpoznani_fk
  foreign key (rozpoznani_id) references public.jine_platby_rozpoznani(id) on delete set null;

create table public.jine_platby_polozky (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  branch_id              uuid not null references public.branches(id) on delete restrict,
  zaznam_id              uuid not null references public.jine_platby(id) on delete restrict,
  poradi                 smallint not null check (poradi between 1 and 200),
  nazev_puvodni          text not null default '' check (char_length(nazev_puvodni) <= 300),
  nazev                  text not null check (char_length(btrim(nazev)) between 1 and 300),
  mnozstvi               numeric(12, 3) check (mnozstvi > 0),
  jednotka               text check (jednotka is null or char_length(jednotka) between 1 and 20),
  cena_jednotkova_haleru integer,
  cena_celkem_haleru     integer,
  sazba_dph              numeric(5, 2) check (sazba_dph >= 0 and sazba_dph <= 100),
  jistota                numeric(4, 3) check (jistota >= 0 and jistota <= 1),
  zdroj                  text not null check (zdroj in ('ai', 'rucne')),
  druh                   text not null default 'nezarazeno'
                         check (druh in ('pokrm', 'rozlevany_napoj', 'kusove_zbozi', 'sluzba', 'spropitne', 'sleva', 'neskladova', 'nezarazeno')),
  pos_produkt_id         text check (pos_produkt_id is null or char_length(pos_produkt_id) between 1 and 100),
  pos_produkt_nazev      text check (pos_produkt_nazev is null or char_length(pos_produkt_nazev) <= 300),
  pos_mnozstvi           numeric(12, 3) check (pos_mnozstvi > 0),
  mapovani               text not null default 'nenamapovano'
                         check (mapovani in ('nenamapovano', 'navrh', 'overeno', 'neskladova')),
  vyzaduje_kontrolu      boolean not null default false,
  duvod_kontroly         text not null default '' check (char_length(duvod_kontroly) <= 1000),
  unique (zaznam_id, poradi),
  check (mapovani not in ('navrh', 'overeno') or pos_produkt_id is not null),
  check (druh <> 'sleva' or cena_celkem_haleru is null or cena_celkem_haleru <= 0)
);

-- 3.5 Katalog pokladny (plní server z RelacePos.katalog) a ověřené aliasy.
create table public.pos_katalog (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  pripojeni_id   uuid not null references public.integrace_pripojeni(id) on delete cascade,
  externi_id     text not null check (char_length(externi_id) between 1 and 100),
  nazev          text not null check (char_length(nazev) between 1 and 300),
  jednotka       text check (jednotka is null or char_length(jednotka) <= 40),
  mira           numeric(12, 4) check (mira > 0),
  odecita_sklad  boolean,
  ma_recepturu   boolean,
  plu            text[] not null default '{}',
  ean            text[] not null default '{}',
  smazano        boolean not null default false,
  aktualizovano  timestamptz not null default now(),
  unique (pripojeni_id, externi_id)
);

create table public.pos_mapovani (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  pripojeni_id    uuid not null references public.integrace_pripojeni(id) on delete cascade,
  alias           text not null check (char_length(alias) between 1 and 300),
  pos_produkt_id  text not null check (char_length(pos_produkt_id) between 1 and 100),
  overil          uuid,
  overeno         timestamptz not null default now(),
  unique (pripojeni_id, alias)
);

-- 3.6 Skladový návrh — schválení je svázané s OTISKEM obsahu. Obsah
-- sestavuje databáze (app.jp_sestavit_vydej), ne prohlížeč.
create table public.jine_platby_skladove_navrhy (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  branch_id              uuid not null references public.branches(id) on delete restrict,
  zaznam_id              uuid not null references public.jine_platby(id) on delete restrict,
  verze_zaznamu          integer not null,
  obsah                  jsonb not null,
  otisk                  text not null check (otisk ~ '^[0-9a-f]{64}$'),
  stav                   text not null check (stav in ('ceka_na_schvaleni', 'schvaleno', 'zamitnuto', 'nahrazeno', 'provedeno')),
  odeslal                uuid,
  odeslano               timestamptz not null default now(),
  schvalil               uuid,
  schvaleno              timestamptz,
  zamitl                 uuid,
  zamitnuto              timestamptz,
  duvod_zamitnuti        text check (duvod_zamitnuti is null or char_length(duvod_zamitnuti) <= 1000),
  kontrola_pri_schvaleni jsonb
);
create unique index jine_platby_navrh_zivy on public.jine_platby_skladove_navrhy (zaznam_id)
  where stav in ('ceka_na_schvaleni', 'schvaleno');

-- Sledovaný krok v pokladně, nezávislý na dodavateli. Klíč je zároveň
-- externí ID v pokladně — podle něj se výsledek dohledá po timeoutu.
create table public.pos_operace (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  branch_id           uuid not null references public.branches(id) on delete restrict,
  pripojeni_id        uuid references public.integrace_pripojeni(id) on delete restrict,
  zaznam_id           uuid not null references public.jine_platby(id) on delete restrict,
  navrh_id            uuid references public.jine_platby_skladove_navrhy(id) on delete restrict,
  druh                text not null check (druh in ('vydej', 'korekce')),
  idempotencni_klic   text not null unique check (idempotencni_klic ~ '^[A-Za-z0-9_-]{8,80}$'),
  stav                text not null default 'pripraveno'
                      check (stav in ('pripraveno', 'odesila_se', 'uspech', 'nejasny_vysledek', 'chyba', 'nepodporovano', 'rucne_dolozeno', 'zruseno')),
  pokusu              smallint not null default 0 check (pokusu >= 0),
  platnost_do         timestamptz,
  externi_provozovna  text,
  polozky             jsonb not null default '[]'::jsonb,
  poznamka            text not null default '' check (char_length(poznamka) <= 200),
  externi_id          text check (externi_id is null or char_length(externi_id) between 1 and 100),
  externi_doklad      text check (externi_doklad is null or char_length(externi_doklad) between 1 and 100),
  vysledek            jsonb,
  chyba               text check (chyba is null or char_length(chyba) <= 2000),
  duvod               text check (duvod is null or char_length(duvod) <= 2000),
  zahajil             uuid,
  zahajeno            timestamptz not null default now(),
  odeslano            timestamptz,
  dokonceno           timestamptz,
  korekce_pro         uuid references public.pos_operace(id) on delete restrict,
  check (stav <> 'uspech' or externi_id is not null)
);
-- Nejvýš jedna NEUKONČENÁ nebo úspěšná operace výdeje na návrh. Nová
-- smí vzniknout jen po prokázané chybě (`chyba`) — viz jine_platby_vydej_znovu.
create unique index pos_operace_jedna_ziva on public.pos_operace (navrh_id)
  where druh = 'vydej' and stav in ('pripraveno', 'odesila_se', 'nejasny_vysledek', 'uspech', 'rucne_dolozeno', 'nepodporovano');
create index pos_operace_zaznam on public.pos_operace (zaznam_id, zahajeno desc);

-- 3.8 Ostatní tržby — jediná evidence tržeb mimo pokladnu.
create table public.ostatni_trzby (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  branch_id         uuid not null references public.branches(id) on delete restrict,
  datum             date not null,
  castka_haleru     integer not null check (castka_haleru > 0),
  mena              text not null check (mena ~ '^[A-Z]{3}$'),
  zdroj             text not null check (zdroj in ('jine_platby')),
  zaznam_id         uuid references public.jine_platby(id) on delete restrict,
  zapocitat         boolean not null,
  kategorie         text not null default 'jine_platby' check (char_length(kategorie) between 1 and 60),
  pos_pripojeni_id  uuid references public.integrace_pripojeni(id) on delete restrict,
  pos_prodej_id     text check (pos_prodej_id is null or char_length(pos_prodej_id) between 1 and 100),
  faktura_cislo     text check (faktura_cislo is null or char_length(faktura_cislo) between 1 and 100),
  stav              text not null default 'platna' check (stav in ('platna', 'stornovana')),
  storno_duvod      text check (storno_duvod is null or char_length(storno_duvod) <= 1000),
  stornoval         uuid,
  stornovano        timestamptz,
  nahrazuje         uuid references public.ostatni_trzby(id) on delete restrict,
  potvrdil          uuid,
  potvrzeno         timestamptz not null default now(),
  -- Prodej známý v pokladně se nikdy nezapočítá podruhé (zadání, oddíl 5).
  check (not (zapocitat and pos_prodej_id is not null)),
  check (pos_prodej_id is null or pos_pripojeni_id is not null),
  check ((stav = 'stornovana') = (stornovano is not null))
);
create unique index ostatni_trzby_jedna_na_zaznam on public.ostatni_trzby (zaznam_id) where stav = 'platna';
create unique index ostatni_trzby_jedna_na_prodej on public.ostatni_trzby (tenant_id, pos_pripojeni_id, pos_prodej_id)
  where stav = 'platna' and pos_prodej_id is not null;
create index ostatni_trzby_obdobi on public.ostatni_trzby (tenant_id, datum);

comment on table public.ostatni_trzby is
  'Tržby mimo pokladnu (Finance → Tržby). zapocitat=false = prodej, který už je v '
  'tržbách jinde (pokladna) — jen propojený, do součtu se NEPŘIČÍTÁ. Kategorie je '
  'popisek, součet nemění. Oprava = storno + nový řádek (nahrazuje), historie se nepřepisuje.';

-- 3.9 Historie pro obrazovku (bez tajemství, bez fotek).
create table public.jine_platby_historie (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete restrict,
  zaznam_id  uuid not null references public.jine_platby(id) on delete restrict,
  kdy        timestamptz not null default now(),
  kdo        uuid,
  udalost    text not null check (char_length(udalost) between 1 and 60),
  detail     jsonb not null default '{}'::jsonb
);
create index jine_platby_historie_zaznam on public.jine_platby_historie (zaznam_id, kdy desc);


-- ---------------------------------------------------------------------
-- 4. GRANTY A RLS — číst přes politiku, zapisovat jen funkcemi
-- ---------------------------------------------------------------------

revoke all on public.jine_platby from public, anon, authenticated;
revoke all on public.jine_platby_soubory from public, anon, authenticated;
revoke all on public.jine_platby_rozpoznani from public, anon, authenticated;
revoke all on public.jine_platby_polozky from public, anon, authenticated;
revoke all on public.pos_katalog from public, anon, authenticated;
revoke all on public.pos_mapovani from public, anon, authenticated;
revoke all on public.jine_platby_skladove_navrhy from public, anon, authenticated;
revoke all on public.pos_operace from public, anon, authenticated;
revoke all on public.ostatni_trzby from public, anon, authenticated;
revoke all on public.jine_platby_historie from public, anon, authenticated;

grant select on public.jine_platby, public.jine_platby_soubory, public.jine_platby_rozpoznani,
  public.jine_platby_polozky, public.pos_katalog, public.pos_mapovani,
  public.jine_platby_skladove_navrhy, public.pos_operace, public.ostatni_trzby,
  public.jine_platby_historie to authenticated, service_role;

alter table public.jine_platby enable row level security;
alter table public.jine_platby_soubory enable row level security;
alter table public.jine_platby_rozpoznani enable row level security;
alter table public.jine_platby_polozky enable row level security;
alter table public.pos_katalog enable row level security;
alter table public.pos_mapovani enable row level security;
alter table public.jine_platby_skladove_navrhy enable row level security;
alter table public.pos_operace enable row level security;
alter table public.ostatni_trzby enable row level security;
alter table public.jine_platby_historie enable row level security;

create policy jine_platby_select on public.jine_platby for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy jine_platby_soubory_select on public.jine_platby_soubory for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy jine_platby_rozpoznani_select on public.jine_platby_rozpoznani for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy jine_platby_polozky_select on public.jine_platby_polozky for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy jine_platby_navrhy_select on public.jine_platby_skladove_navrhy for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy pos_operace_select on public.pos_operace for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy ostatni_trzby_select on public.ostatni_trzby for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy jine_platby_historie_select on public.jine_platby_historie for select to authenticated
  using (app.jine_platby_vidi(tenant_id, branch_id));
create policy pos_katalog_select on public.pos_katalog for select to authenticated
  using (app.jine_platby_vidi_pripojeni(tenant_id, pripojeni_id));
create policy pos_mapovani_select on public.pos_mapovani for select to authenticated
  using (app.jine_platby_vidi_pripojeni(tenant_id, pripojeni_id));


-- ---------------------------------------------------------------------
-- 5. DRUHÁ LINIE — spouště „patří téže firmě a pobočce"
-- ---------------------------------------------------------------------

create function app.jp_hlida_firmu_zaznamu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
    raise exception 'Pobočka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.pripojeni_id is not null and not exists (
       select 1 from public.integrace_pripojeni p
        where p.id = new.pripojeni_id and p.tenant_id = new.tenant_id and p.oblast = 'pokladna') then
    raise exception 'Pokladna nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.kontakt_id is not null and not exists (
       select 1 from public.kontakty k where k.id = new.kontakt_id and k.tenant_id = new.tenant_id) then
    raise exception 'Kontakt nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.uhrada_transakce_id is not null and not exists (
       select 1 from public.transakce t where t.id = new.uhrada_transakce_id and t.tenant_id = new.tenant_id) then
    raise exception 'Platba nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_firmu_zaznamu() from public, anon, authenticated;

create trigger trg_firma_jine_platby
  before insert or update of tenant_id, branch_id, pripojeni_id, kontakt_id, uhrada_transakce_id
  on public.jine_platby
  for each row execute function app.jp_hlida_firmu_zaznamu();

-- Děti záznamu: firma a pobočka musí sedět se záznamem (jeden filtr,
-- ne dva — jinak by kontrola nad ním nešla shodit).
create function app.jp_hlida_dite_zaznamu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
       select 1 from public.jine_platby z
        where z.id = new.zaznam_id and z.tenant_id = new.tenant_id and z.branch_id = new.branch_id) then
    raise exception 'Řádek nepatří záznamu téže firmy a pobočky.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_dite_zaznamu() from public, anon, authenticated;

create trigger trg_firma_jine_platby_soubory before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_soubory for each row execute function app.jp_hlida_dite_zaznamu();
create trigger trg_firma_jine_platby_rozpoznani before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_rozpoznani for each row execute function app.jp_hlida_dite_zaznamu();
create trigger trg_firma_jine_platby_polozky before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_polozky for each row execute function app.jp_hlida_dite_zaznamu();
create trigger trg_firma_jine_platby_navrhy before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_skladove_navrhy for each row execute function app.jp_hlida_dite_zaznamu();
create trigger trg_firma_pos_operace before insert or update of tenant_id, branch_id, zaznam_id
  on public.pos_operace for each row execute function app.jp_hlida_dite_zaznamu();
create trigger trg_firma_jine_platby_historie before insert or update of tenant_id, branch_id, zaznam_id
  on public.jine_platby_historie for each row execute function app.jp_hlida_dite_zaznamu();

-- Operace v pokladně: pokladna, návrh a opravovaná operace patří témuž
-- záznamu a firmě (kontrola 19. 10. — dřív se hlídal jen záznam).
create function app.jp_hlida_vazby_operace()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.pripojeni_id is not null and not exists (
       select 1 from public.integrace_pripojeni p
        where p.id = new.pripojeni_id and p.tenant_id = new.tenant_id and p.oblast = 'pokladna') then
    raise exception 'Pokladna nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.navrh_id is not null and not exists (
       select 1 from public.jine_platby_skladove_navrhy n
        where n.id = new.navrh_id and n.tenant_id = new.tenant_id and n.zaznam_id = new.zaznam_id) then
    raise exception 'Návrh nepatří témuž záznamu.' using errcode = 'check_violation';
  end if;
  if new.korekce_pro is not null and not exists (
       select 1 from public.pos_operace o
        where o.id = new.korekce_pro and o.tenant_id = new.tenant_id and o.zaznam_id = new.zaznam_id) then
    raise exception 'Opravovaná operace nepatří témuž záznamu.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_vazby_operace() from public, anon, authenticated;

create trigger trg_vazby_pos_operace before insert or update of tenant_id, zaznam_id, pripojeni_id, navrh_id, korekce_pro
  on public.pos_operace for each row execute function app.jp_hlida_vazby_operace();

-- Párování platby s fakturou (potvrdit_alokaci_platby, automatické párování
-- a kdokoli další, kdo zapíše platby_faktury) musí počítat i úhrady Jiných
-- plateb z téže transakce — jinak by jedna platba zaplatila fakturu i Jinou
-- platbu. Opačný směr hlídá jine_platby_evidovat_uhradu (kontrola 20. 10.).
create function app.jp_hlida_platbu_faktury()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_castka integer;
  v_jinde  bigint;
begin
  if new.stav <> 'potvrzeno' then
    return new;
  end if;
  select t.castka_haleru into v_castka from public.transakce t where t.id = new.transakce_id;
  select coalesce((select sum(f.castka_haleru) from public.platby_faktury f
                    where f.transakce_id = new.transakce_id and f.stav = 'potvrzeno' and f.id <> new.id), 0)
       + coalesce((select sum(z.uhrada_castka_haleru) from public.jine_platby z
                    where z.uhrada_transakce_id = new.transakce_id), 0)
    into v_jinde;
  if v_jinde + new.castka_haleru > v_castka then
    raise exception 'Alokace přesahuje částku platby: platba je už rozdělená k fakturám nebo k Jiným platbám (zbývá % hal.).',
      greatest(v_castka - v_jinde, 0) using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_platbu_faktury() from public, anon, authenticated;

create trigger trg_platby_faktury_jine_platby before insert or update of stav, castka_haleru, transakce_id
  on public.platby_faktury for each row execute function app.jp_hlida_platbu_faktury();

create function app.jp_hlida_firmu_pripojeni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
       select 1 from public.integrace_pripojeni p
        where p.id = new.pripojeni_id and p.tenant_id = new.tenant_id and p.oblast = 'pokladna') then
    raise exception 'Pokladna nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_firmu_pripojeni() from public, anon, authenticated;

create trigger trg_firma_pos_katalog before insert or update of tenant_id, pripojeni_id
  on public.pos_katalog for each row execute function app.jp_hlida_firmu_pripojeni();
create trigger trg_firma_pos_mapovani before insert or update of tenant_id, pripojeni_id
  on public.pos_mapovani for each row execute function app.jp_hlida_firmu_pripojeni();

create function app.jp_hlida_firmu_trzby()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.branches b where b.id = new.branch_id and b.tenant_id = new.tenant_id) then
    raise exception 'Pobočka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.zaznam_id is not null and not exists (
       select 1 from public.jine_platby z
        where z.id = new.zaznam_id and z.tenant_id = new.tenant_id and z.branch_id = new.branch_id) then
    raise exception 'Tržba nepatří záznamu téže firmy a pobočky.' using errcode = 'check_violation';
  end if;
  if new.pos_pripojeni_id is not null and not exists (
       select 1 from public.integrace_pripojeni p
        where p.id = new.pos_pripojeni_id and p.tenant_id = new.tenant_id and p.oblast = 'pokladna') then
    raise exception 'Pokladna nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.nahrazuje is not null and not exists (
       select 1 from public.ostatni_trzby o
        where o.id = new.nahrazuje and o.tenant_id = new.tenant_id and o.zaznam_id is not distinct from new.zaznam_id) then
    raise exception 'Nahrazovaná tržba nepatří témuž záznamu.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.jp_hlida_firmu_trzby() from public, anon, authenticated;

create trigger trg_firma_ostatni_trzby before insert or update of tenant_id, branch_id, zaznam_id, pos_pripojeni_id, nahrazuje
  on public.ostatni_trzby for each row execute function app.jp_hlida_firmu_trzby();

-- Audit (ústřední audit_log). Rozpoznání a katalog se neauditují:
-- rozpoznání nese celý výstup AI (do auditu nepatří), katalog jsou
-- stovky řádků při každém načtení.
create trigger trg_audit_jine_platby after insert or update or delete on public.jine_platby
  for each row execute function app.audit_zmenu('jina_platba');
create trigger trg_audit_jine_platby_navrhy after insert or update or delete on public.jine_platby_skladove_navrhy
  for each row execute function app.audit_zmenu('jina_platba_skladovy_navrh');
create trigger trg_audit_pos_operace after insert or update or delete on public.pos_operace
  for each row execute function app.audit_zmenu('pos_operace');
create trigger trg_audit_ostatni_trzby after insert or update or delete on public.ostatni_trzby
  for each row execute function app.audit_zmenu('ostatni_trzba');
create trigger trg_audit_pos_mapovani after insert or update or delete on public.pos_mapovani
  for each row execute function app.audit_zmenu('pos_mapovani');
-- Položky se při každém uložení smažou a vloží znovu (celý návrh najednou).
-- Bez auditu by se předchozí podoba návrhu ztratila (kontrola 17. 10.).
create trigger trg_audit_jine_platby_polozky after insert or update or delete on public.jine_platby_polozky
  for each row execute function app.audit_zmenu('jina_platba_polozka');


-- ---------------------------------------------------------------------
-- 6. ÚLOŽIŠTĚ ORIGINÁLŮ — kbelík „jine-platby"
--
-- Cesta <firma>/<pobočka>/<záznam>/<uuid>.<přípona>. Fotka jde z
-- prohlížeče rovnou sem (serverová akce má strop 1 MB), pak ji server
-- stáhne, ověří typ podle obsahu a připojí (jine_platby_pripojit_soubor).
-- Bez `on conflict`: srážka jmen má spadnout nahlas. Žádná UPDATE
-- politika — soubor pod vydaným odkazem se nesmí potichu změnit.
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jine-platby', 'jine-platby', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

create function app.jine_platby_cesta(p_name text)
returns table (tenant_id uuid, branch_id uuid, zaznam_id uuid)
language plpgsql immutable
set search_path = ''
as $$
declare
  v_slozky text[] := storage.foldername(p_name);
begin
  if array_length(v_slozky, 1) is distinct from 3 then
    return;
  end if;
  if storage.filename(p_name) !~ '^[0-9a-f-]{36}\.(jpg|png|webp|pdf)$' then
    return;
  end if;
  begin
    tenant_id := v_slozky[1]::uuid;
    branch_id := v_slozky[2]::uuid;
    zaznam_id := v_slozky[3]::uuid;
  exception when invalid_text_representation then
    return;
  end;
  return next;
end $$;

comment on function app.jine_platby_cesta(text) is
  'Firma, pobočka a záznam z cesty v kbelíku jine-platby. Nesmyslná cesta '
  'vrací prázdno, ne výjimku (jinak by politika úložiště padala).';

revoke all on function app.jine_platby_cesta(text) from public, anon;
grant execute on function app.jine_platby_cesta(text) to authenticated, service_role;

create policy jine_platby_soubory_cist on storage.objects for select to authenticated
  using (
    bucket_id = 'jine-platby'
    and exists (
      select 1 from app.jine_platby_cesta(storage.objects.name) c
       join public.jine_platby z on z.id = c.zaznam_id and z.tenant_id = c.tenant_id and z.branch_id = c.branch_id
       where app.jine_platby_vidi(z.tenant_id, z.branch_id)));

create policy jine_platby_soubory_nahrat on storage.objects for insert to authenticated
  with check (
    bucket_id = 'jine-platby'
    and exists (
      select 1 from app.jine_platby_cesta(storage.objects.name) c
       join public.jine_platby z on z.id = c.zaznam_id and z.tenant_id = c.tenant_id and z.branch_id = c.branch_id
       where z.stav_kontroly <> 'zruseno'
         and (app.has_access(z.tenant_id, 'jine_platby.zadat', z.branch_id)
              or app.has_access(z.tenant_id, 'jine_platby.upravit', z.branch_id))));

create policy jine_platby_soubory_sirotek on storage.objects for delete to authenticated
  using (
    bucket_id = 'jine-platby'
    and owner = auth.uid()
    and not exists (select 1 from public.jine_platby_soubory s where s.cesta = storage.objects.name));


-- ---------------------------------------------------------------------
-- 7. POMOCNÉ FUNKCE (jen pro funkce níž, nikdo jiný je nevolá)
-- ---------------------------------------------------------------------

-- Záznam k zápisu: zamkne ho a ověří, že ho volající vůbec VIDÍ. Cizí
-- nebo neexistující = stejná odpověď, ať se z chyby nedá poznat, že id existuje.
create function app.jp_nacist(p_zaznam uuid)
returns public.jine_platby
language plpgsql security definer set search_path = ''
as $$
declare
  v_z public.jine_platby;
begin
  select * into v_z from public.jine_platby where id = p_zaznam for update;
  if not found or not app.jine_platby_vidi(v_z.tenant_id, v_z.branch_id) then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  return v_z;
end $$;

revoke all on function app.jp_nacist(uuid) from public, anon, authenticated;

create function app.jp_vyzadovat(p_z public.jine_platby, p_pravo text, p_hlaska text)
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not app.has_access(p_z.tenant_id, p_pravo, p_z.branch_id) then
    raise exception '%', p_hlaska using errcode = 'insufficient_privilege';
  end if;
end $$;

revoke all on function app.jp_vyzadovat(public.jine_platby, text, text) from public, anon, authenticated;

create function app.jp_verze(p_z public.jine_platby, p_verze integer)
returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_verze is distinct from p_z.verze then
    raise exception 'Záznam mezitím upravil někdo jiný — načtěte ho znovu.' using errcode = 'serialization_failure';
  end if;
end $$;

revoke all on function app.jp_verze(public.jine_platby, integer) from public, anon, authenticated;

create function app.jp_duvod(p_text text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v text := btrim(coalesce(p_text, ''));
begin
  if char_length(v) < 5 then
    raise exception 'Napište důvod (aspoň pár slov).' using errcode = 'check_violation';
  end if;
  return left(v, 1000);
end $$;

revoke all on function app.jp_duvod(text) from public, anon, authenticated;

create function app.jp_historie(p_z public.jine_platby, p_udalost text, p_detail jsonb)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (p_z.tenant_id, p_z.branch_id, p_z.id, auth.uid(), p_udalost, coalesce(p_detail, '{}'::jsonb));
$$;

revoke all on function app.jp_historie(public.jine_platby, text, jsonb) from public, anon, authenticated;

-- Kontrola proti pokladně platí jen pro tutéž verzi a jen omezenou dobu.
create function app.jp_kontrola_plati(p_k jsonb, p_verze integer, p_minut integer)
returns boolean
language sql stable set search_path = ''
as $$
  select p_k is not null
     and (p_k ->> 'verze')::integer = p_verze
     and (p_k ->> 'kdy')::timestamptz > now() - make_interval(mins => p_minut)
$$;

revoke all on function app.jp_kontrola_plati(jsonb, integer, integer) from public, anon, authenticated;

-- Obsah výdeje sestavuje DATABÁZE z položek — co schvalovatel potvrdí,
-- je přesně tohle, ne něco, co poslal prohlížeč.
--   * jen druhy, které se skladu můžou týkat (pokrm, rozlévaný nápoj, kusové zboží);
--   * pokrm se vydává JAKO POKRM — suroviny odečte pokladna podle SVÉ
--     receptury; receptury appka nečte, takže pokrm s kusovým zbožím ve
--     výdeji dostane varování a schválení chce výslovné potvrzení, že zboží
--     není jeho surovina (dvojí spotřeba hlídá člověk, ne databáze);
--   * produkt, o kterém katalog pokladny říká „sklad neodečítá a nemá
--     recepturu", se vynechá (pokladna by nic neodečetla);
--   * cokoli nejasného blokuje odeslání.
--
-- OTISK (kontrola 17. 10.) je jen z VĚCNÉHO obsahu: pokladna, provozovna
-- a seřazený seznam (produkt, součet množství). Pořadí řádků ani název
-- produktu do něj nepatří — přejmenování v pokladně nebo smazaný řádek se
-- spropitným by jinak „změnily výdej" a po provedení by záznam nešel ani
-- uložit. `zmena` = otisk + blokace: přidání nejasné skladové položky
-- k odeslanému návrhu ho musí zneplatnit, i když se otisk nezměnil.
-- Název ve výdeji je z KATALOGU pokladny (ne z prohlížeče), jinak by
-- schvalovatel mohl vidět jiné zboží, než se odepíše.
-- Obsluhuje pokladna záznamu (a u pokladny celé firmy i uložená provozovna)
-- pořád pobočku záznamu? Přiřazení provozoven jde v Integracích změnit;
-- kontrola ani výdej pak nesmí pracovat s provozovnou cizí pobočky
-- (kontrola 19. 10.).
create function app.jp_pokladna_obsluhuje(p_z public.jine_platby)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_z.pripojeni_id is not null and exists (
    select 1
      from public.integrace_pripojeni p
     where p.id = p_z.pripojeni_id
       and p.tenant_id = p_z.tenant_id
       and p.oblast = 'pokladna'
       and p.odpojeno_kdy is null
       and ((p.branch_id is not null and p.branch_id = p_z.branch_id)
            or (p.branch_id is null and exists (
                  select 1
                    from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) e
                   where e ->> 'branch_id' = p_z.branch_id::text
                     and (p_z.pos_provozovna is null or e ->> 'id' = p_z.pos_provozovna))))
  )
$$;

revoke all on function app.jp_pokladna_obsluhuje(public.jine_platby) from public, anon, authenticated;

create function app.jp_sestavit_vydej(p_zaznam uuid)
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
           k.externi_id as k_id, k.smazano as k_smazano
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
        -- nepatří. Když o receptuře neví (Dotykačka ji bez include=ingredients
        -- neprozradí, `ma_recepturu` je null), položka v návrhu zůstane:
        -- pokrm s recepturou má v Dotykačce „Odečítat ze skladu" vypnuté a
        -- suroviny odečte až podle receptury. Při odpisu pokladna odečte,
        -- co má nastavené — nebo nic.
        null;
      else
        if v_p.druh = 'pokrm' then v_ma_pokrm := true; elsif v_p.druh = 'kusove_zbozi' then v_ma_zbozi := true; end if;
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
  -- Pokrm s recepturou odečte pokladna i se surovinami. Appka receptury
  -- nečte, takže nepozná, jestli kusové zboží ve výdeji není surovina téhož
  -- pokrmu (smetana ke svíčkové). Schválení pak chce výslovné potvrzení
  -- (p_bez_surovin); otisk ani zmena se tím nemění (kontrola 20. 10.).
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


-- Možné duplicity jednoho záznamu — JEDNO pravidlo pro tržbu i pro výdej
-- (kontrola 17. 10.: výdej neměl žádné, tržba hledala bez data a napříč
-- pobočkami i bez pokladny):
--   * stejná pobočka + provozní den + částka + měna, nebo
--   * stejné číslo účtu (bez mezer, malými) u téže pokladny do ±7 dní;
--     záznam BEZ pokladny jen v téže pobočce (ruční „stůl 5" na dvou
--     provozovnách není tentýž prodej), s pokladnou celé firmy i napříč.
-- 'trzba' = proti záznamům s platnou Ostatní tržbou; 'sklad' = proti
-- záznamům s výdejem odeslaným, schváleným, probíhajícím nebo provedeným.
-- Samotná částka nestačí nikdy.
create function app.jp_mozne_duplicity(p_z public.jine_platby, p_druh text)
returns table (zaznam_id uuid, branch_id uuid)
language sql stable security definer set search_path = ''
as $$
  select o.id, o.branch_id
    from public.jine_platby o
   where o.tenant_id = p_z.tenant_id
     and o.id <> p_z.id
     and o.stav_kontroly <> 'zruseno'
     and ((p_druh = 'trzba' and exists (select 1 from public.ostatni_trzby t where t.zaznam_id = o.id and t.stav = 'platna'))
          or (p_druh = 'sklad' and o.stav_skladu in ('ceka_na_schvaleni', 'schvaleno', 'nepodporovano', 'zpracovava_se',
                                                     'nejasny_vysledek', 'odecteno_v_pos', 'rucne_dolozeno', 'jiz_odecteno', 'opraveno')))
     and ((o.branch_id = p_z.branch_id and o.datum_prodeje = p_z.datum_prodeje
           and o.castka_haleru = p_z.castka_haleru and o.mena = p_z.mena)
          or (p_z.externi_ucet is not null and o.externi_ucet is not null
              and ((o.pripojeni_id is not distinct from p_z.pripojeni_id
                    and (p_z.pripojeni_id is not null or o.branch_id = p_z.branch_id))
                   -- záznam s pokladnou a záznam bez ní na téže pobočce (kontrola 19. 10.)
                   or (o.branch_id = p_z.branch_id and (o.pripojeni_id is null) <> (p_z.pripojeni_id is null)))
              and p_z.datum_prodeje is not null and o.datum_prodeje is not null
              and abs(o.datum_prodeje - p_z.datum_prodeje) <= 7
              and lower(regexp_replace(o.externi_ucet, '\s', '', 'g')) = lower(regexp_replace(p_z.externi_ucet, '\s', '', 'g'))))
$$;

revoke all on function app.jp_mozne_duplicity(public.jine_platby, text) from public, anon, authenticated;

-- Text o duplicitě pro hlášku: id jen záznamů, které volající smí vidět
-- (jinak by chyba prozradila záznam cizí pobočky).
create function app.jp_popis_duplicit(p_tenant uuid, p_kandidati uuid[], p_pobocky uuid[])
returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select 'u záznamu ' || string_agg(k.id::text, ', ')
       from unnest(p_kandidati, p_pobocky) as k(id, branch_id)
      where app.jine_platby_vidi(p_tenant, k.branch_id)),
    'na provozovně, kterou nevidíte (rozhodne někdo s přístupem k oběma)')
$$;

revoke all on function app.jp_popis_duplicit(uuid, uuid[], uuid[]) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 8. FUNKCE PRO PŘIHLÁŠENÉ (jediná cesta k zápisu)
--
-- Chyby: 42501 bez práva, 23514 obchodní pravidlo s českou hláškou,
-- 40001 verze nesedí, 23505 duplicita, P0002 nenalezeno/cizí.
-- ---------------------------------------------------------------------

-- 8.1 Založení. Pokladna musí patřit firmě a obsluhovat pobočku
-- (stejné pravidlo jako pokladnaPatriPobocce v lib/pokladna-trzby.ts).
create function public.jine_platby_zalozit(
  p_tenant uuid, p_branch uuid, p_pripojeni uuid, p_oznaceni text, p_klient_id uuid
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id          uuid;
  v_pr_branch   uuid;
  v_pr_ucet     jsonb;
  v_provozovna  text;
  v_z           public.jine_platby;
begin
  if p_tenant is null or p_branch is null or p_klient_id is null then
    raise exception 'Chybí firma, provozovna nebo klíč formuláře.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.branches b
                  where b.id = p_branch and b.tenant_id = p_tenant and b.deleted_at is null and b.active) then
    raise exception 'Provozovna nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if not app.has_access(p_tenant, 'jine_platby.zadat', p_branch) then
    raise exception 'Na této provozovně nemáte právo zakládat Jiné platby.' using errcode = 'insufficient_privilege';
  end if;

  -- Dvojklik / opakované odeslání formuláře: stejný klíč = stejný záznam.
  select id into v_id from public.jine_platby where tenant_id = p_tenant and klient_id = p_klient_id;
  if v_id is not null then
    return v_id;
  end if;

  if p_pripojeni is not null then
    select p.branch_id, p.externi_ucet into v_pr_branch, v_pr_ucet
      from public.integrace_pripojeni p
     where p.id = p_pripojeni and p.tenant_id = p_tenant and p.oblast = 'pokladna' and p.odpojeno_kdy is null;
    if not found then
      raise exception 'Pokladna nepatří této firmě nebo je odpojená.' using errcode = 'check_violation';
    end if;
    if v_pr_branch is not null then
      if v_pr_branch <> p_branch then
        raise exception 'Tahle pokladna provozovnu neobsluhuje.' using errcode = 'check_violation';
      end if;
    else
      select pv ->> 'id' into v_provozovna
        from jsonb_array_elements(coalesce(v_pr_ucet -> 'provozovny', '[]'::jsonb)) pv
       where pv ->> 'branch_id' = p_branch::text
       limit 1;
      if v_provozovna is null then
        raise exception 'Tahle pokladna provozovnu neobsluhuje — přiřaďte ji v Integrace → Pokladní systémy.' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  insert into public.jine_platby (tenant_id, branch_id, pripojeni_id, pos_provozovna, klient_id, oznaceni, vytvoril)
  values (p_tenant, p_branch, p_pripojeni, v_provozovna, p_klient_id, left(btrim(coalesce(p_oznaceni, '')), 200), auth.uid())
  on conflict (tenant_id, klient_id) do nothing
  returning * into v_z;

  if v_z.id is null then
    select id into v_id from public.jine_platby where tenant_id = p_tenant and klient_id = p_klient_id;
    return v_id;
  end if;

  perform app.jp_historie(v_z, 'zalozeno', jsonb_build_object('pokladna', p_pripojeni is not null));
  return v_z.id;
end $$;

revoke all on function public.jine_platby_zalozit(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.jine_platby_zalozit(uuid, uuid, uuid, text, uuid) to authenticated;

-- 8.2 Připojení souboru z úložiště.
-- Jen service_role: otisk a typ podle obsahu ověřuje server ze stažených
-- bajtů (akce-soubory.ts) a právo zadat/upravit na pobočce záznamu ověřuje
-- server dřív, než funkci zavolá. Přihlášený by jinak poslal vymyšlený
-- otisk a obešel „stejná fotka podruhé neprojde“ (kontrola 19. 10.).
create function public.jine_platby_pripojit_soubor(p_zaznam uuid, p_cesta text, p_otisk text, p_nahral uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z        public.jine_platby;
  v_c        record;
  v_meta     jsonb;
  v_owner    uuid;
  v_mime     text;
  v_velikost bigint;
  v_jiny     uuid;
  v_jina_pobocka uuid;
  v_poradi   integer;
  v_id       uuid;
begin
  select * into v_z from public.jine_platby where id = p_zaznam for update;
  if not found then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  if p_nahral is null then
    raise exception 'Chybí, kdo soubor nahrál.' using errcode = 'check_violation';
  end if;
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;

  select * into v_c from app.jine_platby_cesta(p_cesta);
  if not found or v_c.tenant_id is distinct from v_z.tenant_id or v_c.branch_id is distinct from v_z.branch_id
     or v_c.zaznam_id is distinct from v_z.id then
    raise exception 'Cesta k souboru nesedí s tímhle záznamem.' using errcode = 'check_violation';
  end if;
  if p_otisk is null or p_otisk !~ '^[0-9a-f]{64}$' then
    raise exception 'Chybí otisk souboru.' using errcode = 'check_violation';
  end if;

  select o.metadata, o.owner into v_meta, v_owner
    from storage.objects o where o.bucket_id = 'jine-platby' and o.name = p_cesta;
  if not found then
    raise exception 'Soubor v úložišti není.' using errcode = 'check_violation';
  end if;
  if v_owner is distinct from p_nahral then
    raise exception 'Soubor nahrál někdo jiný.' using errcode = 'check_violation';
  end if;

  v_mime := v_meta ->> 'mimetype';
  v_velikost := nullif(v_meta ->> 'size', '')::bigint;
  if v_mime is null or v_velikost is null then
    raise exception 'Úložiště nevrátilo typ nebo velikost souboru.' using errcode = 'check_violation';
  end if;
  if v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
     or (v_mime = 'image/jpeg' and p_cesta !~ '\.jpg$')
     or (v_mime = 'image/png' and p_cesta !~ '\.png$')
     or (v_mime = 'image/webp' and p_cesta !~ '\.webp$')
     or (v_mime = 'application/pdf' and p_cesta !~ '\.pdf$') then
    raise exception 'Nepovolený typ souboru.' using errcode = 'check_violation';
  end if;
  if v_velikost <= 0 or v_velikost > 10485760 then
    raise exception 'Soubor je prázdný nebo větší než 10 MB.' using errcode = 'check_violation';
  end if;

  -- Jen živé záznamy (zrušený záznam doklad uvolní). Id druhého záznamu
  -- jen tomu, kdo ho smí vidět — jinak by hláška prozradila záznam pobočky,
  -- na kterou volající nemá.
  select s.zaznam_id, s.branch_id into v_jiny, v_jina_pobocka from public.jine_platby_soubory s
   where s.tenant_id = v_z.tenant_id and s.otisk = p_otisk and s.aktivni;
  if v_jiny is not null then
    -- Id druhého záznamu jen na pobočce téhož záznamu; aplikace ho ukáže,
    -- jen když ho uživatel vidí (server volá za něj, auth.uid() tu není).
    if v_jina_pobocka = v_z.branch_id then
      raise exception 'Tento soubor už je připojený k záznamu %.', v_jiny using errcode = 'unique_violation';
    end if;
    raise exception 'Tento soubor už je připojený k jinému záznamu (na provozovně, kterou nevidíte).' using errcode = 'unique_violation';
  end if;

  select coalesce(max(poradi), 0) + 1 into v_poradi from public.jine_platby_soubory where zaznam_id = v_z.id;
  if v_poradi > 10 then
    raise exception 'K jednomu záznamu jde připojit nejvýš 10 souborů.' using errcode = 'check_violation';
  end if;

  insert into public.jine_platby_soubory (tenant_id, branch_id, zaznam_id, poradi, cesta, mime, velikost, otisk, nahral)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_poradi, p_cesta, v_mime, v_velikost::integer, p_otisk, p_nahral)
  returning id into v_id;

  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, p_nahral, 'soubor_pripojen',
          jsonb_build_object('poradi', v_poradi, 'mime', v_mime, 'velikost', v_velikost));
  return v_id;
end $$;

revoke all on function public.jine_platby_pripojit_soubor(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.jine_platby_pripojit_soubor(uuid, text, text, uuid) to service_role;

-- 8.3 Uložení návrhu (hlavička + celé položky najednou, s kontrolou verze).
create function public.jine_platby_ulozit_navrh(p_zaznam uuid, p_verze integer, p_hlavicka jsonb, p_polozky jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_z           public.jine_platby;
  v_datum       date;
  v_mena        text;
  v_castka      integer;
  v_puvod       text;
  v_typ         text;
  v_ext         text;
  v_kontakt     uuid;
  v_oznaceni    text;
  v_upoz        jsonb;
  v_rozp        uuid;
  v_e           jsonb;
  v_i           integer;
  v_ma_katalog  boolean;
  v_produkt     text;
  v_otisk_pred  text;
  v_otisk_po    text;
  v_zmena_pred  text;
  v_zmena_po    text;
  v_navrh       record;
  v_ke_kontrole boolean;
  v_nova_verze  integer;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.upravit', 'K úpravě návrhu nemáte oprávnění.');
  perform app.jp_verze(v_z, p_verze);
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(coalesce(p_hlavicka, 'null'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_polozky, 'null'::jsonb)) <> 'array' then
    raise exception 'Návrh nemá platný tvar.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_polozky) > 200 then
    raise exception 'Návrh má víc než 200 položek.' using errcode = 'check_violation';
  end if;

  begin
    v_datum := nullif(p_hlavicka ->> 'datum_prodeje', '')::date;
  exception when others then
    raise exception 'Datum prodeje není platné.' using errcode = 'check_violation';
  end;
  if v_datum is not null and v_datum > (now() at time zone 'Europe/Prague')::date + 1 then
    raise exception 'Datum prodeje je v budoucnu.' using errcode = 'check_violation';
  end if;
  v_mena := upper(nullif(btrim(coalesce(p_hlavicka ->> 'mena', '')), ''));
  if v_mena is not null and v_mena !~ '^[A-Z]{3}$' then
    raise exception 'Měna musí být třípísmenný kód (CZK, EUR…).' using errcode = 'check_violation';
  end if;
  begin
    v_castka := nullif(p_hlavicka ->> 'castka_haleru', '')::integer;
  exception when others then
    raise exception 'Celková částka není platná.' using errcode = 'check_violation';
  end;
  if v_castka is not null and v_castka < 0 then
    raise exception 'Celková částka nesmí být záporná.' using errcode = 'check_violation';
  end if;
  v_puvod := nullif(p_hlavicka ->> 'castka_puvod', '');
  if v_castka is null then
    v_puvod := null;
  elsif v_puvod is null or v_puvod not in ('doklad', 'vypocet', 'rucne') then
    raise exception 'U celkové částky chybí, odkud pochází.' using errcode = 'check_violation';
  end if;
  v_typ := coalesce(nullif(p_hlavicka ->> 'typ_dokladu', ''), 'nezjisteno');
  if v_typ not in ('otevreny_ucet', 'uzavreny_prodej', 'informativni_sjetina', 'rucni_spotreba', 'nezjisteno') then
    raise exception 'Neznámý typ dokladu.' using errcode = 'check_violation';
  end if;
  v_ext := left(nullif(btrim(coalesce(p_hlavicka ->> 'externi_ucet', '')), ''), 100);
  v_oznaceni := left(btrim(coalesce(p_hlavicka ->> 'oznaceni', '')), 200);
  begin
    v_kontakt := nullif(p_hlavicka ->> 'kontakt_id', '')::uuid;
  exception when others then
    raise exception 'Odběratel není platný.' using errcode = 'check_violation';
  end;
  if v_kontakt is not null and not exists (
       select 1 from public.kontakty k where k.id = v_kontakt and k.tenant_id = v_z.tenant_id and k.deleted_at is null) then
    raise exception 'Odběratel nepatří této firmě.' using errcode = 'check_violation';
  end if;
  -- Upozornění AI k celému dokladu: posílá je jen rozpoznání; ruční uložení
  -- klíč vynechá a upozornění zůstanou, dokud je nenahradí nové čtení.
  if p_hlavicka ? 'upozorneni_dokladu' then
    if jsonb_typeof(p_hlavicka -> 'upozorneni_dokladu') <> 'array' then
      raise exception 'Upozornění k dokladu nemají platný tvar.' using errcode = 'check_violation';
    end if;
    select coalesce(jsonb_agg(to_jsonb(left(btrim(e #>> '{}'), 300))), '[]'::jsonb) into v_upoz
      from (select e from jsonb_array_elements(p_hlavicka -> 'upozorneni_dokladu') e
             where jsonb_typeof(e) = 'string' and btrim(e #>> '{}') <> '' limit 20) x;
  else
    v_upoz := v_z.upozorneni_dokladu;
  end if;
  -- Rozpoznání, ze kterého návrh je: posílá ho jen akce rozpoznání; musí to
  -- být úspěšné čtení TOHOTO záznamu. Ruční uložení klíč vynechá a vazba
  -- zůstane (panel pak řekne, že se návrh od čtení ručně upravil).
  if p_hlavicka ? 'rozpoznani_id' then
    begin
      v_rozp := nullif(p_hlavicka ->> 'rozpoznani_id', '')::uuid;
    exception when others then
      raise exception 'Rozpoznání není platné.' using errcode = 'check_violation';
    end;
    if v_rozp is not null and not exists (
         select 1 from public.jine_platby_rozpoznani r where r.id = v_rozp and r.zaznam_id = v_z.id and r.stav = 'ok') then
      raise exception 'Rozpoznání nepatří tomuto záznamu nebo neskončilo úspěšně.' using errcode = 'check_violation';
    end if;
  else
    v_rozp := v_z.rozpoznani_id;
  end if;

  -- Zapsaná tržba a propojená faktura se TIŠE nepřepisují (zadání, oddíl 5).
  if v_z.stav_trzby in ('zapsano', 'propojeno')
     and (v_castka is distinct from v_z.castka_haleru or v_mena is distinct from v_z.mena or v_datum is distinct from v_z.datum_prodeje) then
    raise exception 'Tržba je už zapsaná — částku, měnu nebo datum změňte opravou tržby.' using errcode = 'check_violation';
  end if;
  if v_z.stav_faktury = 'propojena' and v_castka is distinct from v_z.castka_haleru then
    raise exception 'K záznamu je propojená faktura — částku nejde tiše změnit.' using errcode = 'check_violation';
  end if;

  select v ->> 'otisk', v ->> 'zmena' into v_otisk_pred, v_zmena_pred from (select app.jp_sestavit_vydej(v_z.id) as v) x;

  select exists (select 1 from public.pos_katalog k where k.pripojeni_id = v_z.pripojeni_id and k.tenant_id = v_z.tenant_id)
    into v_ma_katalog;

  delete from public.jine_platby_polozky where zaznam_id = v_z.id;

  v_i := 0;
  for v_e in select value from jsonb_array_elements(p_polozky) loop
    v_i := v_i + 1;
    if jsonb_typeof(v_e) <> 'object' or nullif(btrim(coalesce(v_e ->> 'nazev', '')), '') is null then
      raise exception 'Položka % nemá název.', v_i using errcode = 'check_violation';
    end if;
    v_produkt := nullif(btrim(coalesce(v_e ->> 'pos_produkt_id', '')), '');
    -- Když pokladna dodala katalog, produkt musí být z něj (žádné vymyšlené ID).
    if v_produkt is not null and v_ma_katalog and not exists (
         select 1 from public.pos_katalog k
          where k.pripojeni_id = v_z.pripojeni_id and k.tenant_id = v_z.tenant_id
            and k.externi_id = v_produkt and not k.smazano) then
      raise exception 'Produkt u položky % v katalogu pokladny není.', v_i using errcode = 'check_violation';
    end if;
    begin
      insert into public.jine_platby_polozky (
        tenant_id, branch_id, zaznam_id, poradi, nazev_puvodni, nazev, mnozstvi, jednotka,
        cena_jednotkova_haleru, cena_celkem_haleru, sazba_dph, jistota, zdroj, druh,
        pos_produkt_id, pos_produkt_nazev, pos_mnozstvi, mapovani, vyzaduje_kontrolu, duvod_kontroly)
      values (
        v_z.tenant_id, v_z.branch_id, v_z.id, v_i,
        left(coalesce(v_e ->> 'nazev_puvodni', ''), 300),
        left(btrim(v_e ->> 'nazev'), 300),
        nullif(v_e ->> 'mnozstvi', '')::numeric(12, 3),
        left(nullif(btrim(coalesce(v_e ->> 'jednotka', '')), ''), 20),
        nullif(v_e ->> 'cena_jednotkova_haleru', '')::integer,
        nullif(v_e ->> 'cena_celkem_haleru', '')::integer,
        nullif(v_e ->> 'sazba_dph', '')::numeric(5, 2),
        nullif(v_e ->> 'jistota', '')::numeric(4, 3),
        coalesce(nullif(v_e ->> 'zdroj', ''), 'rucne'),
        coalesce(nullif(v_e ->> 'druh', ''), 'nezarazeno'),
        v_produkt,
        -- Název produktu z KATALOGU, ne z prohlížeče (kontrola 17. 10.):
        -- schvalovatel nesmí vidět jiné zboží, než se odepíše.
        case when v_produkt is not null and v_ma_katalog
             then (select k.nazev from public.pos_katalog k
                    where k.pripojeni_id = v_z.pripojeni_id and k.tenant_id = v_z.tenant_id and k.externi_id = v_produkt)
             else left(nullif(btrim(coalesce(v_e ->> 'pos_produkt_nazev', '')), ''), 300) end,
        nullif(v_e ->> 'pos_mnozstvi', '')::numeric(12, 3),
        coalesce(nullif(v_e ->> 'mapovani', ''), 'nenamapovano'),
        coalesce((v_e ->> 'vyzaduje_kontrolu')::boolean, false),
        left(coalesce(v_e ->> 'duvod_kontroly', ''), 1000));
    exception
      when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
        raise exception 'Položka % má neplatnou hodnotu.', v_i using errcode = 'check_violation';
    end;
  end loop;

  select v ->> 'otisk', v ->> 'zmena' into v_otisk_po, v_zmena_po from (select app.jp_sestavit_vydej(v_z.id) as v) x;

  -- Schválení je svázané s obsahem výdeje.
  --   * Zahájený nebo provedený výdej (i „předáno k ručnímu odpisu" =
  --     nepodporovano — schvalovatel může právě odepisovat v pokladně):
  --     věcnou změnu (otisk) nejde uložit. Kontrola 17. 10.: jinak by obsluha
  --     zrušila schválení uprostřed ručního odpisu a hrozil druhý odpis.
  --   * Jinak změna obsahu NEBO nová blokace (zmena) nahradí živý návrh,
  --     schvaluje se znovu.
  --   * Schválený výdej (i když provedení selhalo a obrazovka vede k ručnímu
  --     odpisu) a předaný k ručnímu odpisu: nejde měnit obsah ANI přidat
  --     nejasnou skladovou položku. Uvolní ho jen „Zrušit schválení“
  --     oprávněnou osobou (kontrola 19. 10.).
  if v_z.stav_skladu = 'nepodporovano'
     and (v_otisk_po is distinct from v_otisk_pred or v_zmena_po is distinct from v_zmena_pred) then
    raise exception 'Výdej je předaný k ručnímu provedení v pokladně — nejdřív ho doložte (Ručně doloženo), nebo schválení výslovně zrušte.'
      using errcode = 'check_violation';
  end if;
  if v_z.stav_skladu = 'schvaleno'
     and (v_otisk_po is distinct from v_otisk_pred or v_zmena_po is distinct from v_zmena_pred) then
    raise exception 'Výdej je schválený — položky, které se týkají skladu, teď nejde měnit. Nejdřív ho proveďte nebo doložte, nebo schválení zrušte (Zrušit schválení).'
      using errcode = 'check_violation';
  end if;
  if v_z.stav_skladu in ('zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno')
     and v_otisk_po is distinct from v_otisk_pred then
    raise exception 'Výdej už proběhl nebo probíhá — položky ovlivňující sklad změňte opravou.' using errcode = 'check_violation';
  end if;
  if v_zmena_po is distinct from v_zmena_pred
     and v_z.stav_skladu not in ('zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'jiz_odecteno', 'rucne_dolozeno', 'opraveno', 'nepodporovano') then
    for v_navrh in
      select id, stav from public.jine_platby_skladove_navrhy
       where zaznam_id = v_z.id and stav in ('ceka_na_schvaleni', 'schvaleno')
       for update
    loop
      update public.jine_platby_skladove_navrhy set stav = 'nahrazeno' where id = v_navrh.id;
      update public.pos_operace set stav = 'zruseno', dokonceno = now(), duvod = 'Návrh se po schválení změnil.'
       where navrh_id = v_navrh.id and stav in ('pripraveno', 'nepodporovano');
      perform app.jp_historie(v_z, 'schvaleni_zneplatneno', jsonb_build_object('navrh', v_navrh.id, 'byl', v_navrh.stav));
    end loop;
    if v_z.stav_skladu in ('ceka_na_schvaleni', 'schvaleno', 'zamitnuto', 'nevyzaduje', 'chyba', 'nutna_kontrola') then
      v_z.stav_skladu := 'bez_navrhu';
    end if;
  end if;

  select exists (select 1 from public.jine_platby_polozky p where p.zaznam_id = v_z.id and p.vyzaduje_kontrolu)
    into v_ke_kontrole;
  v_ke_kontrole := v_ke_kontrole or v_castka is null or v_mena is null or v_datum is null or jsonb_array_length(v_upoz) > 0;

  update public.jine_platby
     set datum_prodeje = v_datum, mena = v_mena, castka_haleru = v_castka, castka_puvod = v_puvod,
         typ_dokladu = v_typ, externi_ucet = v_ext, oznaceni = v_oznaceni, kontakt_id = v_kontakt,
         upozorneni_dokladu = v_upoz, rozpoznani_id = v_rozp,
         stav_kontroly = case when v_ke_kontrole then 'ke_kontrole' else 'rozpracovano' end,
         stav_skladu = v_z.stav_skladu,
         -- Úhrada je vazba na skutečnou platbu; stav se po změně částky přepočítá.
         stav_uhrady = case when uhrada_transakce_id is null then 'neovereno'
                            when v_castka is not null and uhrada_castka_haleru >= v_castka then 'uhrazeno'
                            else 'castecne' end,
         verze = verze + 1, zmeneno = now()
   where id = v_z.id
   returning verze into v_nova_verze;

  perform app.jp_historie(v_z, 'navrh_ulozen', jsonb_build_object(
    'verze', v_nova_verze, 'polozek', v_i, 'castka_haleru', v_castka, 'mena', v_mena,
    'vydej_zmenen', v_otisk_po is distinct from v_otisk_pred));
  return v_nova_verze;
end $$;

revoke all on function public.jine_platby_ulozit_navrh(uuid, integer, jsonb, jsonb) from public, anon;
grant execute on function public.jine_platby_ulozit_navrh(uuid, integer, jsonb, jsonb) to authenticated;

-- 8.4 Člověk potvrdí, že údaje dokladu sedí.
create function public.jine_platby_oznacit_zkontrolovano(p_zaznam uuid, p_verze integer, p_duvod_rozdilu text default null,
                                                         p_upozorneni_provereno boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z         public.jine_platby;
  v_polozek   integer;
  v_s_cenou   integer;
  v_soucet    bigint;
  v_tolerance integer;
  v_duvod     text;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.upravit', 'K úpravě návrhu nemáte oprávnění.');
  perform app.jp_verze(v_z, p_verze);
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;
  if v_z.datum_prodeje is null or v_z.mena is null or v_z.castka_haleru is null then
    raise exception 'Doplňte datum prodeje, měnu a celkovou částku.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.jine_platby_polozky p where p.zaznam_id = v_z.id and p.vyzaduje_kontrolu) then
    raise exception 'Některé položky pořád čekají na kontrolu.' using errcode = 'check_violation';
  end if;
  -- Upozornění AI k celému dokladu (nízká jistota, víc dokladů, pokyn
  -- v textu…) nejdou odkliknout bez výslovného „prověřil jsem“.
  if jsonb_array_length(v_z.upozorneni_dokladu) > 0 and not coalesce(p_upozorneni_provereno, false) then
    raise exception 'AI k dokladu napsala upozornění (%). Prověřte je a potvrďte, že jste je prověřili.',
      (select string_agg(e #>> '{}', '; ') from jsonb_array_elements(v_z.upozorneni_dokladu) e) using errcode = 'check_violation';
  end if;

  -- Nesoulad celku se součtem položek vyžaduje kontrolu (zadání, oddíl 4):
  -- když mají všechny položky cenu celkem a součet (spropitné do ceny
  -- prodeje nepatří) nesedí s celkovou částkou, člověk musí napsat, proč je
  -- rozdíl v pořádku. U CZK je 50 hal. zaokrouhlení hotovosti, jinde nic.
  -- Záznam bez položek (jen celková částka) se nekontroluje — není s čím.
  -- Cena řádku: z dokladu, jinak množství × jednotková cena (stejně jako
  -- obrazovka; jinak by jedna chybějící cena celkem kontrolu vypnula).
  select count(*),
         count(coalesce(cena_celkem_haleru, round(mnozstvi * cena_jednotkova_haleru))),
         coalesce(sum(coalesce(cena_celkem_haleru, round(mnozstvi * cena_jednotkova_haleru))), 0)
    into v_polozek, v_s_cenou, v_soucet
    from public.jine_platby_polozky
   where zaznam_id = v_z.id and druh <> 'spropitne';
  v_tolerance := case when v_z.mena = 'CZK' then 50 else 0 end;
  if v_polozek > 0 and v_s_cenou = v_polozek and abs(v_soucet - v_z.castka_haleru) > v_tolerance then
    if nullif(btrim(coalesce(p_duvod_rozdilu, '')), '') is null then
      raise exception 'Součet položek (% hal.) nesedí s celkovou částkou (% hal.). Opravte položky, nebo napište, proč je rozdíl v pořádku.',
        v_soucet, v_z.castka_haleru using errcode = 'check_violation';
    end if;
    v_duvod := app.jp_duvod(p_duvod_rozdilu);
  end if;

  update public.jine_platby set stav_kontroly = 'zkontrolovano', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'zkontrolovano', jsonb_build_object('verze', v_z.verze,
    'upozorneni_proverena', case when jsonb_array_length(v_z.upozorneni_dokladu) > 0 then v_z.upozorneni_dokladu end,
    'rozdil_haleru', case when v_duvod is null then null else v_soucet - v_z.castka_haleru end, 'duvod_rozdilu', v_duvod));
end $$;

revoke all on function public.jine_platby_oznacit_zkontrolovano(uuid, integer, text, boolean) from public, anon;
grant execute on function public.jine_platby_oznacit_zkontrolovano(uuid, integer, text, boolean) to authenticated;

-- 8.5 Ruční doložení stavu v pokladně. NENÍ to automatické ověření —
-- zdroj 'rucni_prohlaseni', povinný důvod, kdo a kdy (zadání, oddíl 8).
create function public.jine_platby_prohlasit(
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
  --   * „pravděpodobně“ (shoda jen částky): přepsat smí ten, kdo prohlašuje,
  --     s výslovným potvrzením p_prepsat_pokladnu (prodej v pokladně je jiný);
  --   * „nalezeno“ (konkrétní účet) a „už odečteno“: jen s právem na opravy
  --     a s výslovným potvrzením.
  v_stara := case when p_druh = 'trzba' then v_z.kontrola_trzby else v_z.kontrola_skladu end;
  v_prepis := v_stara ->> 'zdroj' = 'pos_api'
     and ((p_druh = 'trzba' and v_stara ->> 'vysledek' in ('nalezeno', 'pravdepodobne') and p_vysledek = 'nenalezeno')
          or (p_druh = 'sklad' and v_stara ->> 'vysledek' = 'jiz_odecteno' and p_vysledek = 'neodecteno'));
  if coalesce(v_prepis, false) then
    if not coalesce(p_prepsat_pokladnu, false) then
      raise exception 'Pokladna při kontrole tohle našla (výsledek: %). Ruční prohlášení opačného znění to bez výslovného potvrzení nepřepíše — zopakujte kontrolu v pokladně, nebo potvrďte, že prodej v pokladně je jiný.',
        v_stara ->> 'vysledek' using errcode = 'check_violation';
    end if;
    if v_stara ->> 'vysledek' <> 'pravdepodobne' and not app.has_access(v_z.tenant_id, 'jine_platby.oprava', v_z.branch_id) then
      raise exception 'Pokladna při kontrole tohle našla (výsledek: %) — konkrétní prodej nebo odpis přepsat smí jen člověk s právem na opravy.',
        v_stara ->> 'vysledek' using errcode = 'check_violation';
    end if;
  end if;

  v_k := jsonb_build_object(
    'vysledek', p_vysledek, 'zdroj', 'rucni_prohlaseni', 'verze', v_z.verze,
    'kdy', now(), 'kdo', auth.uid(),
    'detail', jsonb_build_object('duvod', v_duvod, 'pos_prodej_id', left(nullif(btrim(coalesce(p_pos_prodej_id, '')), ''), 100)));

  if p_druh = 'trzba' then
    update public.jine_platby set kontrola_trzby = v_k, zmeneno = now() where id = v_z.id;
  else
    update public.jine_platby set kontrola_skladu = v_k, zmeneno = now() where id = v_z.id;
  end if;
  perform app.jp_historie(v_z, 'rucne_dolozeno_' || p_druh, jsonb_build_object('vysledek', p_vysledek, 'duvod', v_duvod,
    'prepsano_pokladny', case when coalesce(v_prepis, false) then v_stara ->> 'vysledek' end,
    'prepsany_vysledek', case when coalesce(v_prepis, false) then v_stara end));
end $$;

revoke all on function public.jine_platby_prohlasit(uuid, integer, text, text, text, text, boolean) from public, anon;
grant execute on function public.jine_platby_prohlasit(uuid, integer, text, text, text, text, boolean) to authenticated;

-- 8.6 Zápis nebo propojení v Ostatních tržbách.
--   'nova'     = tržba mimo pokladnu (zapocitat) — jen když kontrola prodej v pokladně VYLOUČILA;
--   'propojit' = prodej už je v tržbách jinde — jen se ukáže, do součtu se nepřičte.
-- Propojení nikdy nic nepřičte, takže je povolené při jakémkoli výsledku
-- kontroly kromě 'nenalezeno'. Nová tržba jen po 'nenalezeno'.
create function public.jine_platby_potvrdit_trzbu(p_zaznam uuid, p_verze integer, p_rezim text, p_duplicita_duvod text default null,
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
         pos_prodej_id = coalesce(v_prodej, pos_prodej_id),
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

-- 8.7 Náhled výdeje (jen čtení).
create function public.jine_platby_sestavit_vydej(p_zaznam uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select tenant_id, branch_id into v_tenant, v_branch from public.jine_platby where id = p_zaznam;
  if not found or not app.jine_platby_vidi(v_tenant, v_branch) then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  return app.jp_sestavit_vydej(p_zaznam);
end $$;

revoke all on function public.jine_platby_sestavit_vydej(uuid) from public, anon;
grant execute on function public.jine_platby_sestavit_vydej(uuid) to authenticated;

-- 8.8 Odeslání skladového návrhu ke schválení. Sklad se tím NEMĚNÍ.
create function public.jine_platby_odeslat_sklad(p_zaznam uuid, p_verze integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z   public.jine_platby;
  v_v   jsonb;
  v_id  uuid;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.sklad_odeslat', 'Skladový návrh smí odeslat jen ten, kdo na to má právo.');
  perform app.jp_verze(v_z, p_verze);
  if v_z.stav_kontroly <> 'zkontrolovano' then
    raise exception 'Nejdřív zkontrolujte údaje dokladu.' using errcode = 'check_violation';
  end if;
  if v_z.stav_skladu not in ('bez_navrhu', 'zamitnuto', 'nevyzaduje') then
    raise exception 'Skladový návrh už je odeslaný nebo zpracovaný.' using errcode = 'check_violation';
  end if;

  v_v := app.jp_sestavit_vydej(v_z.id);
  if jsonb_array_length(v_v -> 'blokace') > 0 then
    raise exception 'Návrh výdeje nejde odeslat: %', v_v -> 'blokace' -> 0 ->> 'duvod' using errcode = 'check_violation';
  end if;

  if (v_v ->> 'polozek')::integer = 0 then
    update public.jine_platby set stav_skladu = 'nevyzaduje', zmeneno = now() where id = v_z.id;
    perform app.jp_historie(v_z, 'sklad_nevyzaduje', '{}'::jsonb);
    return null;
  end if;

  insert into public.jine_platby_skladove_navrhy (tenant_id, branch_id, zaznam_id, verze_zaznamu, obsah, otisk, stav, odeslal)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_z.verze, v_v -> 'obsah', v_v ->> 'otisk', 'ceka_na_schvaleni', auth.uid())
  returning id into v_id;

  update public.jine_platby set stav_skladu = 'ceka_na_schvaleni', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'sklad_odeslan', jsonb_build_object('navrh', v_id, 'polozek', (v_v ->> 'polozek')::integer));
  return v_id;
end $$;

revoke all on function public.jine_platby_odeslat_sklad(uuid, integer) from public, anon;
grant execute on function public.jine_platby_odeslat_sklad(uuid, integer) to authenticated;

-- 8.9 „Potvrdit výdej do POS" / zamítnout. Schválení drží OTISK obsahu
-- a vyžaduje čerstvou kontrolu, že pokladna spotřebu už neodečetla.
create function public.jine_platby_rozhodnout_vydej(p_navrh uuid, p_otisk text, p_schvalit boolean, p_duvod text default null,
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

-- 8.10 Nová operace po PROKÁZANÉ chybě (pokladna požadavek neprovedla).
-- Nejasný výsledek se neopakuje — nejdřív se dohledá.
create function public.jine_platby_vydej_znovu(p_zaznam uuid)
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

-- 8.11 Pokladna už spotřebu odečetla (sama, nebo dřív) — jen propojit.
create function public.jine_platby_propojit_vydej(p_zaznam uuid, p_verze integer, p_externi_id text, p_doklad text, p_duvod text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z     public.jine_platby;
  v_duvod text;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Výdej smí propojit jen oprávněná osoba pro tuto provozovnu.');
  perform app.jp_verze(v_z, p_verze);
  v_duvod := app.jp_duvod(p_duvod);
  if not app.jp_kontrola_plati(v_z.kontrola_skladu, v_z.verze, 15) or v_z.kontrola_skladu ->> 'vysledek' <> 'jiz_odecteno' then
    raise exception 'Nejdřív doložte, že pokladna už odečetla (kontrola v pokladně nebo ruční prohlášení, platí 15 minut).'
      using errcode = 'check_violation';
  end if;
  if v_z.stav_skladu in ('zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos', 'rucne_dolozeno', 'opraveno') then
    raise exception 'Výdej z appky už proběhl nebo probíhá — nejde ho nahradit propojením.' using errcode = 'check_violation';
  end if;

  update public.pos_operace set stav = 'zruseno', dokonceno = now(), duvod = 'Pokladna už odečetla — propojeno.'
   where zaznam_id = v_z.id and druh = 'vydej' and stav in ('pripraveno', 'nepodporovano');
  update public.jine_platby_skladove_navrhy set stav = 'nahrazeno'
   where zaznam_id = v_z.id and stav in ('ceka_na_schvaleni', 'schvaleno');
  update public.jine_platby
     set stav_skladu = 'jiz_odecteno',
         vydej_externi_id = left(nullif(btrim(coalesce(p_externi_id, '')), ''), 100),
         vydej_doklad = left(nullif(btrim(coalesce(p_doklad, '')), ''), 100),
         zmeneno = now()
   where id = v_z.id;
  perform app.jp_historie(v_z, 'vydej_propojen', jsonb_build_object('duvod', v_duvod,
    'zdroj_kontroly', v_z.kontrola_skladu ->> 'zdroj', 'externi_id', p_externi_id, 'doklad', p_doklad));
end $$;

revoke all on function public.jine_platby_propojit_vydej(uuid, integer, text, text, text) from public, anon;
grant execute on function public.jine_platby_propojit_vydej(uuid, integer, text, text, text) to authenticated;

-- 8.12 Ručně provedeno v pokladně (API zápis neumí, nebo neprošel).
-- NENÍ to „Odečteno v POS" — stav 'rucne_dolozeno'.
--
-- U záznamu s pokladnou je doložení svázané s OTISKEM schváleného
-- návrhu (kontrola 17. 10.): formulář posílá otisk toho, co schvalovatel
-- v pokladně odepsal; ze staré stránky se doklad nepřipíše k jinému návrhu.
--
-- Bez pokladny (záznam bez připojení) návrh výdeje vzniknout nemůže —
-- není katalog ani provozovna. Aby záznam nezůstal navždy „bez návrhu",
-- smí oprávněná osoba rovnou doložit, jak se spotřeba vyřešila (třeba
-- papírová výdejka), s povinným důvodem.
create function public.jine_platby_rucne_dolozit_vydej(p_zaznam uuid, p_otisk text, p_doklad text, p_duvod text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_n      public.jine_platby_skladove_navrhy;
  v_op     public.pos_operace;
  v_duvod  text;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Ruční výdej smí doložit jen oprávněná osoba pro tuto provozovnu.');
  v_duvod := app.jp_duvod(p_duvod);

  if v_z.pripojeni_id is null then
    if v_z.stav_kontroly <> 'zkontrolovano' then
      raise exception 'Nejdřív zkontrolujte údaje dokladu.' using errcode = 'check_violation';
    end if;
    if v_z.stav_skladu not in ('bez_navrhu', 'zamitnuto') then
      raise exception 'Sklad tohoto záznamu už je vyřízený.' using errcode = 'check_violation';
    end if;
    update public.jine_platby
       set stav_skladu = 'rucne_dolozeno', vydej_doklad = left(nullif(btrim(coalesce(p_doklad, '')), ''), 100), zmeneno = now()
     where id = v_z.id;
    perform app.jp_historie(v_z, 'vydej_rucne_dolozen', jsonb_build_object('doklad', p_doklad, 'duvod', v_duvod, 'bez_pokladny', true));
    return;
  end if;

  select * into v_n from public.jine_platby_skladove_navrhy where zaznam_id = v_z.id and stav = 'schvaleno' for update;
  if not found then
    raise exception 'Ručně doložit jde jen schválený návrh výdeje.' using errcode = 'check_violation';
  end if;
  if p_otisk is distinct from v_n.otisk then
    raise exception 'Schválený návrh je jiný, než jaký máte otevřený — načtěte stránku znovu a doložte ten, který jste v pokladně odepsali.'
      using errcode = 'check_violation';
  end if;
  -- Nevyřešená skladová položka (přidaná mimo uložení návrhu) by se
  -- s doložením neodečetla nikdy (kontrola 19. 10.). Změna katalogu po
  -- schválení (produkt zrušený v pokladně) doložení NEBLOKUJE — doložit se
  -- smí, co bylo schváleno a v pokladně odepsáno (kontrola 20. 10.).
  if exists (select 1 from public.jine_platby_polozky p
              where p.zaznam_id = v_z.id
                and (p.vyzaduje_kontrolu or p.druh = 'nezarazeno'
                     or (p.druh in ('pokrm', 'rozlevany_napoj', 'kusove_zbozi')
                         and (p.mapovani <> 'overeno' or p.pos_mnozstvi is null)))) then
    raise exception 'Návrh výdeje má nevyřešené položky — doložit jde až po jejich vyřešení (nebo schválení zrušte).' using errcode = 'check_violation';
  end if;
  select * into v_op from public.pos_operace where navrh_id = v_n.id and druh = 'vydej' order by zahajeno desc limit 1 for update;
  -- Nejasný výsledek: dokud může pokladna požadavek ještě provést (platnost
  -- + 2 min rezerva), jen dohledat. Po platnosti smí oprávněná osoba doložit,
  -- co v pokladně ověřila — jinak by záznam neměl východ, když pokladna
  -- nejde otevřít nebo dohledání trvale selhává (kontrola 20. 10.).
  if v_op.stav in ('odesila_se', 'nejasny_vysledek')
     and (v_op.platnost_do is null or v_op.platnost_do + interval '2 minutes' > now()) then
    raise exception 'Požadavek do pokladny má nejasný výsledek — nejdřív ho dohledejte, ať se výdej nezdvojí. Ručně doložit jde až po vypršení jeho platnosti.' using errcode = 'check_violation';
  end if;
  if v_op.stav in ('uspech', 'rucne_dolozeno') then
    raise exception 'Výdej už je hotový.' using errcode = 'check_violation';
  end if;

  if v_op.id is not null and v_op.stav in ('pripraveno', 'nepodporovano', 'chyba', 'odesila_se', 'nejasny_vysledek') then
    update public.pos_operace
       set stav = 'rucne_dolozeno', externi_doklad = left(nullif(btrim(coalesce(p_doklad, '')), ''), 100),
           duvod = v_duvod, dokonceno = now()
     where id = v_op.id;
  end if;
  update public.jine_platby_skladove_navrhy set stav = 'provedeno' where id = v_n.id;
  update public.jine_platby
     set stav_skladu = 'rucne_dolozeno', vydej_doklad = left(nullif(btrim(coalesce(p_doklad, '')), ''), 100), zmeneno = now()
   where id = v_z.id;
  perform app.jp_historie(v_z, 'vydej_rucne_dolozen', jsonb_build_object('doklad', p_doklad, 'duvod', v_duvod, 'navrh', v_n.id));
end $$;

revoke all on function public.jine_platby_rucne_dolozit_vydej(uuid, text, text, text) from public, anon;
grant execute on function public.jine_platby_rucne_dolozit_vydej(uuid, text, text, text) to authenticated;

-- 8.12b Zrušit schválení — jen oprávněná osoba pro výdej, s důvodem
-- („v pokladně nic neodepsáno"). Jediná cesta, jak uvolnit výdej předaný
-- k ručnímu odpisu (nepodporovano): úprava položek ani zrušení záznamu
-- ho samy neuvolní, aby nevznikl druhý odpis (kontrola 17. 10.).
create function public.jine_platby_zrusit_schvaleni(p_zaznam uuid, p_duvod text)
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
  update public.jine_platby set stav_skladu = 'bez_navrhu', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'schvaleni_zruseno', jsonb_build_object('duvod', v_duvod, 'byl', v_z.stav_skladu));
end $$;

revoke all on function public.jine_platby_zrusit_schvaleni(uuid, text) from public, anon;
grant execute on function public.jine_platby_zrusit_schvaleni(uuid, text) to authenticated;

-- 8.13 Faktura: podklady, propojení existující, odpojení. Vystavení
-- faktury appka zatím neumí (otázka 51) — a do DB Faktur nepíše.
create function public.jine_platby_faktura(p_zaznam uuid, p_akce text, p_data jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z        public.jine_platby;
  v_kontakt  uuid;
  v_cislo    text;
  v_zdroj    text;
  v_castka   integer;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.faktura', 'Fakturu smí připravit nebo propojit jen ten, kdo na to má právo.');
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;
  p_data := coalesce(p_data, '{}'::jsonb);

  if p_akce = 'podklady' then
    begin
      v_kontakt := nullif(p_data ->> 'kontakt_id', '')::uuid;
    exception when others then
      raise exception 'Odběratel není platný.' using errcode = 'check_violation';
    end;
    if v_kontakt is not null and not exists (
         select 1 from public.kontakty k where k.id = v_kontakt and k.tenant_id = v_z.tenant_id and k.deleted_at is null) then
      raise exception 'Odběratel nepatří této firmě.' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(p_data -> 'podklady') is distinct from 'object' then
      raise exception 'Podklady faktury nemají platný tvar.' using errcode = 'check_violation';
    end if;
    -- Změna odběratele zvedne verzi: otevřený editor návrhu by ho jinak při
    -- uložení tiše přepsal původní hodnotou (kontrola 17. 10.).
    update public.jine_platby
       set faktura_podklady = p_data -> 'podklady', kontakt_id = coalesce(v_kontakt, kontakt_id),
           stav_faktury = case when stav_faktury = 'propojena' then 'propojena' else 'podklady' end,
           verze = case when coalesce(v_kontakt, kontakt_id) is distinct from kontakt_id then verze + 1 else verze end,
           zmeneno = now()
     where id = v_z.id;
    perform app.jp_historie(v_z, 'faktura_podklady', jsonb_build_object('kontakt', v_kontakt));
  elsif p_akce = 'propojit' then
    v_cislo := left(nullif(btrim(coalesce(p_data ->> 'cislo', '')), ''), 100);
    v_zdroj := p_data ->> 'zdroj';
    begin
      v_castka := nullif(p_data ->> 'castka_haleru', '')::integer;
    exception when others then
      raise exception 'Částka faktury není platná.' using errcode = 'check_violation';
    end;
    if v_cislo is null or v_zdroj not in ('pos', 'externi') or (v_castka is not null and v_castka < 0) then
      raise exception 'Faktura potřebuje číslo a zdroj (pokladna, nebo jiný systém).' using errcode = 'check_violation';
    end if;
    if v_z.stav_faktury = 'propojena' and v_z.faktura_cislo is distinct from v_cislo then
      raise exception 'Nejdřív odpojte původní fakturu.' using errcode = 'check_violation';
    end if;
    -- Faktura z pokladny = účet uzavřený v pokladně, tržbu má pokladna.
    -- K ZAPOČTENÉ Ostatní tržbě by to byla druhá tržba (kontrola 17. 10.).
    if v_zdroj = 'pos' and v_z.stav_trzby = 'zapsano' then
      raise exception 'Faktura z pokladny znamená tržbu v pokladně — nejdřív stornujte Ostatní tržbu a prodej propojte.'
        using errcode = 'check_violation';
    end if;
    update public.jine_platby
       set faktura_cislo = v_cislo, faktura_zdroj = v_zdroj, faktura_castka_haleru = v_castka,
           stav_faktury = 'propojena', zmeneno = now()
     where id = v_z.id;
    update public.ostatni_trzby set faktura_cislo = v_cislo where zaznam_id = v_z.id and stav = 'platna';
    perform app.jp_historie(v_z, 'faktura_propojena', jsonb_build_object('cislo', v_cislo, 'zdroj', v_zdroj, 'castka_haleru', v_castka));
  elsif p_akce = 'odpojit' then
    if v_z.stav_faktury <> 'propojena' then
      raise exception 'Žádná faktura není propojená.' using errcode = 'check_violation';
    end if;
    perform app.jp_historie(v_z, 'faktura_odpojena', jsonb_build_object('cislo', v_z.faktura_cislo, 'duvod', app.jp_duvod(p_data ->> 'duvod')));
    update public.jine_platby
       set faktura_cislo = null, faktura_zdroj = null, faktura_castka_haleru = null,
           stav_faktury = case when faktura_podklady is null then 'bez_faktury' else 'podklady' end,
           zmeneno = now()
     where id = v_z.id;
    update public.ostatni_trzby set faktura_cislo = null where zaznam_id = v_z.id and stav = 'platna';
  else
    raise exception 'Neznámá akce s fakturou.' using errcode = 'check_violation';
  end if;
end $$;

revoke all on function public.jine_platby_faktura(uuid, text, jsonb) from public, anon;
grant execute on function public.jine_platby_faktura(uuid, text, jsonb) to authenticated;

-- 8.14 Úhrada = vazba na EXISTUJÍCÍ příchozí bankovní transakci. Appka
-- tím nepřidá ani korunu do cashflow (zadání, oddíl 5 a 10).
create function public.jine_platby_evidovat_uhradu(p_zaznam uuid, p_transakce uuid, p_castka_haleru integer)
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
  select t.id, t.castka_haleru, t.mena, t.smer, t.storno_of, u.branch_id into v_t
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

-- 8.15 Oprava tržby: storno platného řádku + nový řádek (nahrazuje).
-- Historie se nepřepisuje. S propojenou fakturou jen s číslem opravného dokladu.
create function public.jine_platby_opravit_trzbu(p_zaznam uuid, p_verze integer, p_nova_castka_haleru integer, p_duvod text, p_doklad_opravy text default null)
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
    update public.jine_platby set stav_trzby = 'stornovano', verze = verze + 1, zmeneno = now() where id = v_z.id;
  end if;

  perform app.jp_historie(v_z, case when p_nova_castka_haleru is null then 'trzba_stornovana' else 'trzba_opravena' end,
    jsonb_build_object('pred', v_t.castka_haleru, 'po', p_nova_castka_haleru, 'duvod', v_duvod, 'doklad_opravy', p_doklad_opravy));
  perform app.audit(v_z.tenant_id, 'finance.ostatni_trzba_opravena', 'ostatni_trzby', v_t.id::text, v_z.branch_id,
    jsonb_build_object('castka_haleru', v_t.castka_haleru), jsonb_build_object('castka_haleru', p_nova_castka_haleru, 'novy', v_id));
  return v_id;
end $$;

revoke all on function public.jine_platby_opravit_trzbu(uuid, integer, integer, text, text) from public, anon;
grant execute on function public.jine_platby_opravit_trzbu(uuid, integer, integer, text, text) to authenticated;

-- 8.16 Korekce provedeného výdeje — přes API pokladny zatím nepodporovaná,
-- proto ručně doložená oprávněnou osobou. Původní operace zůstává.
create function public.jine_platby_korekce_vydeje(p_zaznam uuid, p_doklad text, p_duvod text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_puv    public.pos_operace;
  v_duvod  text;
  v_op     uuid;
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.oprava', 'Korekci výdeje smí provést jen ten, kdo má právo na opravy.');
  perform app.jp_vyzadovat(v_z, 'jine_platby.vydej_pos', 'Korekci výdeje smí provést jen oprávněná osoba pro výdej do POS.');
  v_duvod := app.jp_duvod(p_duvod);
  if v_z.stav_skladu not in ('odecteno_v_pos', 'rucne_dolozeno') then
    raise exception 'Korigovat jde jen výdej provedený z appky.' using errcode = 'check_violation';
  end if;
  select * into v_puv from public.pos_operace
   where zaznam_id = v_z.id and druh = 'vydej' and stav in ('uspech', 'rucne_dolozeno')
   order by zahajeno desc limit 1;

  insert into public.pos_operace (tenant_id, branch_id, pripojeni_id, zaznam_id, navrh_id, druh, idempotencni_klic, stav,
                                  externi_provozovna, polozky, externi_doklad, duvod, zahajil, dokonceno, korekce_pro)
  values (v_z.tenant_id, v_z.branch_id, v_z.pripojeni_id, v_z.id, v_puv.navrh_id, 'korekce',
          'ftjk' || replace(gen_random_uuid()::text, '-', ''), 'rucne_dolozeno', v_z.pos_provozovna,
          coalesce(v_puv.polozky, '[]'::jsonb), left(nullif(btrim(coalesce(p_doklad, '')), ''), 100), v_duvod, auth.uid(), now(), v_puv.id)
  returning id into v_op;

  update public.jine_platby set stav_skladu = 'opraveno', zmeneno = now() where id = v_z.id;
  perform app.jp_historie(v_z, 'vydej_korigovan', jsonb_build_object('operace', v_op, 'doklad', p_doklad, 'duvod', v_duvod));
  return v_op;
end $$;

revoke all on function public.jine_platby_korekce_vydeje(uuid, text, text) from public, anon;
grant execute on function public.jine_platby_korekce_vydeje(uuid, text, text) to authenticated;

-- 8.17 Zrušení záznamu — jen dokud nic neproběhlo (žádná tržba,
-- žádný zahájený výdej, žádná propojená faktura). Autor svůj
-- rozpracovaný záznam smí zrušit i bez práva na opravy.
create function public.jine_platby_zrusit(p_zaznam uuid, p_duvod text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z      public.jine_platby;
  v_duvod  text;
begin
  v_z := app.jp_nacist(p_zaznam);
  v_duvod := app.jp_duvod(p_duvod);
  if not (app.has_access(v_z.tenant_id, 'jine_platby.oprava', v_z.branch_id)
          or (v_z.vytvoril = auth.uid() and app.has_access(v_z.tenant_id, 'jine_platby.zadat', v_z.branch_id)
              and v_z.stav_skladu in ('bez_navrhu', 'nevyzaduje', 'zamitnuto'))) then
    raise exception 'Záznam smí zrušit jen jeho autor (dokud je rozpracovaný), nebo ten, kdo má právo na opravy.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Záznam už je zrušený.' using errcode = 'check_violation';
  end if;
  if v_z.stav_trzby in ('zapsano', 'propojeno') then
    raise exception 'Tržba je zapsaná — nejdřív ji stornujte.' using errcode = 'check_violation';
  end if;
  if v_z.stav_faktury = 'propojena' then
    raise exception 'Nejdřív odpojte fakturu.' using errcode = 'check_violation';
  end if;
  -- Napárovaná úhrada by jinak blokovala bankovní platbu pro správný
  -- záznam a ze zrušeného ji nejde odpojit (kontrola 17. 10.).
  if v_z.uhrada_transakce_id is not null then
    raise exception 'Nejdřív odpojte úhradu.' using errcode = 'check_violation';
  end if;
  -- Předáno k ručnímu odpisu = schvalovatel může právě odepisovat
  -- v pokladně. Uvolnit to smí jen on (Zrušit schválení s důvodem).
  if v_z.stav_skladu = 'nepodporovano' then
    raise exception 'Výdej je předaný k ručnímu provedení v pokladně — nejdřív ho doložte (Ručně doloženo), nebo nechte schválení zrušit.'
      using errcode = 'check_violation';
  end if;
  -- Schválený výdej může schvalovatel právě odepisovat v pokladně (i když
  -- provedení přes API selhalo) — uvolní ho jen Zrušit schválení (kontrola 19. 10.).
  if v_z.stav_skladu = 'schvaleno' then
    raise exception 'Výdej je schválený — nejdřív ho doložte, nebo schválení zrušte (Zrušit schválení).' using errcode = 'check_violation';
  end if;
  if v_z.stav_skladu not in ('bez_navrhu', 'nevyzaduje', 'zamitnuto', 'ceka_na_schvaleni', 'chyba') then
    raise exception 'Výdej proběhl nebo probíhá — záznam nejde zrušit, jen opravit.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pos_operace where zaznam_id = v_z.id and stav in ('odesila_se', 'nejasny_vysledek')) then
    raise exception 'Požadavek do pokladny má nejasný výsledek — nejdřív ho dohledejte.' using errcode = 'check_violation';
  end if;

  update public.pos_operace set stav = 'zruseno', dokonceno = now(), duvod = 'Záznam zrušen.'
   where zaznam_id = v_z.id and stav in ('pripraveno', 'nepodporovano');
  update public.jine_platby_skladove_navrhy set stav = 'nahrazeno'
   where zaznam_id = v_z.id and stav in ('ceka_na_schvaleni', 'schvaleno');
  -- Soubory zůstávají jako historie, ale doklad jde připojit k novému záznamu.
  update public.jine_platby_soubory set aktivni = false where zaznam_id = v_z.id;
  update public.jine_platby
     set stav_kontroly = 'zruseno', zruseni_duvod = v_duvod,
         -- Ze zrušeného záznamu nic nečeká na schválení (fronta schvalovatele).
         stav_skladu = case when stav_skladu in ('ceka_na_schvaleni', 'schvaleno', 'chyba') then 'bez_navrhu' else stav_skladu end,
         zmeneno = now()
   where id = v_z.id;
  perform app.jp_historie(v_z, 'zruseno', jsonb_build_object('duvod', v_duvod));
end $$;

revoke all on function public.jine_platby_zrusit(uuid, text) from public, anon;
grant execute on function public.jine_platby_zrusit(uuid, text) to authenticated;

-- 8.18 Ověřený alias „název z dokladu → produkt v pokladně". Právo
-- upravit NA POBOČCE ZÁZNAMU a pokladna ze záznamu (kontrola 17. 10.:
-- dřív stačilo právo kdekoli ve firmě a obsluha Perly mohla přepsat
-- alias pokladny Baru, který se pak sám použil jako „ověřený").
create function public.jine_platby_ulozit_mapovani(p_zaznam uuid, p_alias text, p_pos_produkt_id text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z       public.jine_platby;
  v_alias   text := left(lower(btrim(coalesce(p_alias, ''))), 300);
  v_produkt text := left(nullif(btrim(coalesce(p_pos_produkt_id, '')), ''), 100);
begin
  v_z := app.jp_nacist(p_zaznam);
  perform app.jp_vyzadovat(v_z, 'jine_platby.upravit', 'K mapování položek nemáte oprávnění.');
  if v_z.pripojeni_id is null then
    raise exception 'Záznam nemá pokladnu — není k čemu přiřazovat.' using errcode = 'check_violation';
  end if;
  if v_alias = '' or v_produkt is null then
    raise exception 'Chybí název nebo produkt.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.pos_katalog k where k.pripojeni_id = v_z.pripojeni_id and k.tenant_id = v_z.tenant_id) then
    raise exception 'Katalog pokladny není načtený — nejdřív ho načtěte, pak jde přiřazení ověřit.' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.pos_katalog k
                      where k.pripojeni_id = v_z.pripojeni_id and k.tenant_id = v_z.tenant_id
                        and k.externi_id = v_produkt and not k.smazano) then
    raise exception 'Produkt v katalogu pokladny není.' using errcode = 'check_violation';
  end if;
  insert into public.pos_mapovani (tenant_id, pripojeni_id, alias, pos_produkt_id, overil, overeno)
  values (v_z.tenant_id, v_z.pripojeni_id, v_alias, v_produkt, auth.uid(), now())
  on conflict (pripojeni_id, alias) do update
    set pos_produkt_id = excluded.pos_produkt_id, overil = excluded.overil, overeno = excluded.overeno;
end $$;

revoke all on function public.jine_platby_ulozit_mapovani(uuid, text, text) from public, anon;
grant execute on function public.jine_platby_ulozit_mapovani(uuid, text, text) to authenticated;

-- 8.19 Pokladny, které obsluhují pobočku — jen netajné údaje.
-- `integrace_pripojeni` čte přes RLS jen ten, kdo má finance.read, ale
-- obsluha zakládající záznam a schvalovatel výdeje musí vidět, do které
-- pokladny se záznam váže. Žádné tajemství, žádné kurzory synchronizace.
-- Bez práva na pobočce = prázdný seznam (ne chyba).
create function public.jine_platby_pokladny(p_tenant uuid, p_branch uuid)
returns table (id uuid, nazev text, poskytovatel text, stav text, pos_provozovna text, provozovna_nazev text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.nazev, p.poskytovatel, p.stav,
         case when p.branch_id is null then pv ->> 'id' end,
         case when p.branch_id is null then pv ->> 'nazev' end
    from public.integrace_pripojeni p
    left join lateral (
      select e as pv from jsonb_array_elements(coalesce(p.externi_ucet -> 'provozovny', '[]'::jsonb)) e
       where e ->> 'branch_id' = p_branch::text
       limit 1
    ) x on true
   where p.tenant_id = p_tenant
     and p.oblast = 'pokladna'
     and p.odpojeno_kdy is null
     and (p.branch_id = p_branch or (p.branch_id is null and x.pv is not null))
     and app.jine_platby_vidi(p_tenant, p_branch)
   order by p.nazev
$$;

revoke all on function public.jine_platby_pokladny(uuid, uuid) from public, anon;
grant execute on function public.jine_platby_pokladny(uuid, uuid) to authenticated;

-- 8.20 Potvrzená spotřeba (pro budoucí napojení na Foodcost — otázka 53).
create function public.jine_platby_spotreba(p_tenant uuid, p_branch uuid, p_od date, p_do date)
returns table (datum date, branch_id uuid, pos_produkt_id text, nazev text, mnozstvi numeric, druh text)
language sql stable security definer set search_path = ''
as $$
  select z.datum_prodeje, z.branch_id, e ->> 'pos_produkt_id', e ->> 'nazev', (e ->> 'mnozstvi')::numeric,
         e ->> 'druh'  -- druh je v obsahu výdeje (položky se po výdeji smějí přečíslovat)
    from public.jine_platby z
    join public.jine_platby_skladove_navrhy n on n.zaznam_id = z.id and n.stav = 'provedeno'
    cross join lateral jsonb_array_elements(n.obsah -> 'polozky') e
   where z.tenant_id = p_tenant
     and (p_branch is null or z.branch_id = p_branch)
     and z.datum_prodeje between p_od and p_do
     and z.stav_skladu in ('odecteno_v_pos', 'rucne_dolozeno')
     and app.jine_platby_vidi(z.tenant_id, z.branch_id)
$$;

revoke all on function public.jine_platby_spotreba(uuid, uuid, date, date) from public, anon;
grant execute on function public.jine_platby_spotreba(uuid, uuid, date, date) to authenticated;


-- ---------------------------------------------------------------------
-- 9. FUNKCE JEN PRO SERVER (service_role) — volá je serverová akce až
-- po ověření práva uživatelským klientem. Provenience: „ověřeno
-- v pokladně" a „rozpoznala AI" nesmí jít zapsat z prohlížeče.
-- ---------------------------------------------------------------------

create function public.jine_platby_zahajit_rozpoznani(p_zaznam uuid, p_spustil uuid, p_verze integer default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_z     public.jine_platby;
  v_dnes  integer;
  v_id    uuid;
begin
  select * into v_z from public.jine_platby where id = p_zaznam for update;
  if not found then
    raise exception 'Záznam nenalezen.' using errcode = 'P0002';
  end if;
  if v_z.stav_kontroly = 'zruseno' then
    raise exception 'Zrušený záznam už nejde měnit.' using errcode = 'check_violation';
  end if;
  -- Levné kontroly PŘED placeným čtením (kontrola 19. 10.).
  if p_verze is not null and p_verze is distinct from v_z.verze then
    raise exception 'Záznam mezitím upravil někdo jiný, načtěte ho znovu.' using errcode = 'serialization_failure';
  end if;
  -- Schválený nebo provedený výdej: nové čtení by měnilo skladové položky
  -- a uložení by spadlo až po zaplaceném čtení. Zapsaná tržba čtení nebrání
  -- (položky pro sklad; částku, měnu a datum akce ponechá) — kontrola 20. 10.
  if v_z.stav_skladu in ('schvaleno', 'nepodporovano', 'zpracovava_se', 'nejasny_vysledek', 'odecteno_v_pos',
                         'jiz_odecteno', 'rucne_dolozeno', 'opraveno') then
    raise exception 'Výdej je schválený nebo provedený — nové rozpoznání by měnilo položky skladu. Změňte je ručně (Zrušit schválení, nebo korekce).' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.jine_platby_rozpoznani
              where zaznam_id = v_z.id and stav = 'bezi' and vytvoreno > now() - interval '3 minutes') then
    raise exception 'Rozpoznání tohohle dokladu už běží.' using errcode = 'check_violation';
  end if;
  -- Denní strop na firmu (den podle Prahy). Pokus se počítá PŘED voláním AI;
  -- zámek na firmu, jinak by souběžné pokusy na různých záznamech strop
  -- přešly (kontrola 19. 10.).
  perform pg_advisory_xact_lock(hashtextextended('jine_platby_ai:' || v_z.tenant_id::text, 0));
  select count(*) into v_dnes from public.jine_platby_rozpoznani
   where tenant_id = v_z.tenant_id
     and vytvoreno >= (date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague');
  if v_dnes >= 200 then
    raise exception 'Dnešní strop rozpoznání (200 za firmu) je vyčerpaný — zadejte položky ručně.' using errcode = 'check_violation';
  end if;
  insert into public.jine_platby_rozpoznani (tenant_id, branch_id, zaznam_id, verze_zaznamu, stav, spustil)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_z.verze, 'bezi', p_spustil)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.jine_platby_zahajit_rozpoznani(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.jine_platby_zahajit_rozpoznani(uuid, uuid, integer) to service_role;

create function public.jine_platby_dokoncit_rozpoznani(
  p_rozpoznani uuid, p_stav text, p_model text, p_verze_zadani text, p_vysledek jsonb, p_text text, p_duvod text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_r  public.jine_platby_rozpoznani;
  v_z  public.jine_platby;
begin
  select * into v_r from public.jine_platby_rozpoznani where id = p_rozpoznani for update;
  if not found or v_r.stav <> 'bezi' then
    raise exception 'Rozpoznání neběží.' using errcode = 'check_violation';
  end if;
  if p_stav not in ('ok', 'chyba', 'bez_klice') then
    raise exception 'Neznámý výsledek rozpoznání.' using errcode = 'check_violation';
  end if;
  update public.jine_platby_rozpoznani
     set stav = p_stav, model = left(p_model, 100), verze_zadani = left(p_verze_zadani, 50),
         vysledek = case when p_stav = 'ok' then p_vysledek else null end,
         text_dokladu = left(p_text, 20000), duvod = left(p_duvod, 2000), dokonceno = now()
   where id = v_r.id;
  select * into v_z from public.jine_platby where id = v_r.zaznam_id;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, v_r.spustil, 'rozpoznano',
          jsonb_build_object('stav', p_stav, 'model', p_model, 'verze_zadani', p_verze_zadani));
end $$;

revoke all on function public.jine_platby_dokoncit_rozpoznani(uuid, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.jine_platby_dokoncit_rozpoznani(uuid, text, text, text, jsonb, text, text) to service_role;

create function public.jine_platby_zapsat_kontrolu(
  p_zaznam uuid, p_verze integer, p_druh text, p_vysledek text, p_detail jsonb, p_kdo uuid
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_z  public.jine_platby;
  v_k  jsonb;
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
  if p_druh = 'trzba' then
    update public.jine_platby set kontrola_trzby = v_k, zmeneno = now() where id = v_z.id;
  else
    update public.jine_platby set kontrola_skladu = v_k, zmeneno = now() where id = v_z.id;
  end if;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, kdo, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, p_kdo, 'kontrola_pos_' || p_druh, jsonb_build_object('vysledek', p_vysledek));
end $$;

revoke all on function public.jine_platby_zapsat_kontrolu(uuid, integer, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.jine_platby_zapsat_kontrolu(uuid, integer, text, text, jsonb, uuid) to service_role;

-- Zabrání operace. Souběh: druhé volání během prvního dostane 'obsazeno'
-- (skip locked), po něm 'nelze' (stav už není 'pripraveno'). Před
-- odesláním se ještě jednou chce čerstvá kontrola skladu (pokladna mohla
-- mezitím výdej provést sama — zadání, oddíl 8).
create function public.pos_operace_zahajit(p_operace uuid, p_platnost_do timestamptz)
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

-- Ukončení operace. „Úspěch" jen s ID z pokladny (check na tabulce) —
-- appka ho nastaví až po ověřeném dohledání (lib/jine-platby-pos-operace.ts).
create function public.pos_operace_dokoncit(
  p_operace uuid, p_stav text, p_externi_id text, p_doklad text, p_vysledek jsonb, p_chyba text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_op      public.pos_operace;
  v_z       public.jine_platby;
  v_zaznam  uuid;
begin
  select zaznam_id into v_zaznam from public.pos_operace where id = p_operace;
  if v_zaznam is null then
    raise exception 'Operace nenalezena.' using errcode = 'P0002';
  end if;
  select * into v_z from public.jine_platby where id = v_zaznam for update;
  select * into v_op from public.pos_operace where id = p_operace for update;
  if p_stav not in ('uspech', 'nejasny_vysledek', 'chyba', 'nepodporovano') then
    raise exception 'Neznámý výsledek operace.' using errcode = 'check_violation';
  end if;
  if not ((v_op.stav = 'odesila_se')
          or (v_op.stav = 'nejasny_vysledek' and p_stav in ('uspech', 'chyba', 'nejasny_vysledek'))
          or (v_op.stav = 'pripraveno' and p_stav = 'nepodporovano')) then
    raise exception 'Operaci ve stavu % nejde ukončit jako %.', v_op.stav, p_stav using errcode = 'check_violation';
  end if;

  update public.pos_operace
     set stav = p_stav,
         externi_id = case when p_stav = 'uspech' then left(nullif(btrim(coalesce(p_externi_id, '')), ''), 100) else externi_id end,
         externi_doklad = case when p_stav = 'uspech' then left(nullif(btrim(coalesce(p_doklad, '')), ''), 100) else externi_doklad end,
         vysledek = coalesce(p_vysledek, vysledek),
         chyba = left(p_chyba, 2000),
         dokonceno = case when p_stav = 'nejasny_vysledek' then null else now() end
   where id = v_op.id;

  if v_op.druh = 'vydej' then
    update public.jine_platby
       set stav_skladu = case p_stav when 'uspech' then 'odecteno_v_pos' when 'nejasny_vysledek' then 'nejasny_vysledek'
                                     when 'chyba' then 'chyba' else 'nepodporovano' end,
           vydej_externi_id = case when p_stav = 'uspech' then left(nullif(btrim(coalesce(p_externi_id, '')), ''), 100) else vydej_externi_id end,
           vydej_doklad = case when p_stav = 'uspech' then left(nullif(btrim(coalesce(p_doklad, '')), ''), 100) else vydej_doklad end,
           zmeneno = now()
     where id = v_z.id;
    if p_stav = 'uspech' then
      update public.jine_platby_skladove_navrhy set stav = 'provedeno' where id = v_op.navrh_id;
    end if;
  end if;
  insert into public.jine_platby_historie (tenant_id, branch_id, zaznam_id, udalost, detail)
  values (v_z.tenant_id, v_z.branch_id, v_z.id, 'vydej_' || p_stav,
          jsonb_build_object('operace', v_op.id, 'externi_id', p_externi_id, 'chyba', left(p_chyba, 300)));
end $$;

revoke all on function public.pos_operace_dokoncit(uuid, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.pos_operace_dokoncit(uuid, text, text, text, jsonb, text) to service_role;

-- Katalog z pokladny. Co v novém načtení chybí, se označí smazané
-- (neruší se — ověřená mapování na něj můžou ukazovat).
create function public.pos_katalog_nahradit(p_pripojeni uuid, p_produkty jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant  uuid;
  v_pocet   integer := 0;
  v_e       jsonb;
  v_ids     text[] := '{}';
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
    insert into public.pos_katalog (tenant_id, pripojeni_id, externi_id, nazev, jednotka, mira, odecita_sklad, ma_recepturu,
                                    plu, ean, smazano, aktualizovano)
    values (v_tenant, p_pripojeni, left(btrim(v_e ->> 'externi_id'), 100), left(btrim(v_e ->> 'nazev'), 300),
            left(nullif(v_e ->> 'jednotka', ''), 40),
            case when (v_e ->> 'mira') ~ '^[0-9]+(\.[0-9]+)?$' and (v_e ->> 'mira')::numeric > 0 then (v_e ->> 'mira')::numeric(12, 4) end,
            (v_e ->> 'odecita_sklad')::boolean, (v_e ->> 'ma_recepturu')::boolean,
            coalesce(array(select jsonb_array_elements_text(coalesce(v_e -> 'plu', '[]'::jsonb))), '{}'),
            coalesce(array(select jsonb_array_elements_text(coalesce(v_e -> 'ean', '[]'::jsonb))), '{}'),
            coalesce((v_e ->> 'smazano')::boolean, false), now())
    on conflict (pripojeni_id, externi_id) do update
      set nazev = excluded.nazev, jednotka = excluded.jednotka, mira = excluded.mira,
          odecita_sklad = excluded.odecita_sklad, ma_recepturu = excluded.ma_recepturu,
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
