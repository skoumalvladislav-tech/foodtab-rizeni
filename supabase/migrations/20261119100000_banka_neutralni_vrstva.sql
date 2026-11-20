-- =====================================================================
-- Foodtab — Finance Fáze 0, krok 1: neutrální bankovní vrstva
--
-- Zadání: docs/finance-faze0-zadani.md, oddíl 3 (Krok 1), 4 a 5
-- (zkoušky 1 a 6). Scénář: supabase/tests/krok111_scenar.sql.
--
-- PROČ NE NOVÉ TABULKY `bankovni_ucty` / `bankovni_pohyby`
--
-- Zadání mluví o „neutrálních tabulkách". Ty tu už jsou:
-- `platebni_ucty` (účet), `transakce` (pohyb, append-only ledger),
-- `import_davky` (výpis / stažení) a `bankovni_zustatky` (zůstatek).
-- Nečtou je jen Platby — čte je párování s fakturami
-- (app.automaticky_sparovat_fakturu), Jiné platby
-- (jine_platby_evidovat_uhradu), cashflow, tržby z banky a účetní
-- export. Druhá dvojice tabulek by znamenala dva zdroje pravdy
-- o téže platbě a přepsání všech těch míst najednou. Neutrální tu
-- nebyl tvar tabulek, ale HODNOTY: jméno banky v `zdroj`/`typ`
-- („fio_api") a v CHECK omezeních. To tahle migrace odstraňuje.
--
-- CO SE MĚNÍ
--
--   1. Zdroj pohybu, zůstatku i dávky z bankovního API je jediná
--      hodnota `banka_api` (dřív `fio_api` a `bankovni_agregator`).
--      Stávající řádky se převedou. Jména poskytovatelů zůstávají jen
--      v `integrace_pripojeni.poskytovatel` a v kódu konektorů.
--   2. `transakce.protiucet` — účet protistrany zvlášť od jména
--      (normalizuje appka: lib/banka/ucet.ts).
--   3. `transakce.otisk` — idempotence importu i bez id pohybu od
--      banky: sha256 z účtu, data, směru, částky, měny, VS, protiúčtu,
--      protistrany a POŘADÍ stejného řádku v jednom výpisu (dvě stejné
--      platby v jednom výpisu zůstanou dvě). Počítá ho jen databáze
--      (app.otisk_pohybu), jedna implementace pro všechny cesty. Má ho
--      KAŽDÝ importovaný pohyb (i s id od banky), aby se poznal týž
--      pohyb z výpisu (bez id) a ze stažení přes API (s id) — zadání:
--      „stejný pohyb se nikdy nezapíše dvakrát".
--   4. `public.importovat_vypis` — dávka a pohyby v JEDNÉ transakci.
--      Dřív appka založila dávku a teprve potom zapsala řádky; když
--      zápis spadl, dávka zůstala a blokovala opakovaný import téhož
--      souboru (unikátní hash).
--   5. RLS podle POBOČKY ÚČTU: pohyby a zůstatky vidí jen ten, kdo má
--      právo k pobočce účtu; firemní účet (bez pobočky) jen člověk
--      s rozsahem celé firmy. Dřív stačilo `finance.read` kdekoli ve
--      firmě (app.can_read_scoped s branch null kontroluje jen právo,
--      ne rozsah). Totéž párování plateb s fakturami a součet plateb
--      zakázky. ZÁPIS pohybů a zůstatků zůstává jen za celou firmu
--      (beze změny, viz oddíl 4 — ROZHODNOUT). Druhá linie: pobočka
--      účtu musí patřit téže firmě a účet se mezi firmami nestěhuje.
--   6. Přístupové údaje k bance už nevydává RPC přihlášenému
--      (`integrace_precti_tajemstvi` pro oblast `banka` odmítne);
--      server si je čte až po ověření v databázi
--      (`integrace_overit_spravu`, lib/banka/tajemstvi.ts). Oblast
--      bankovního připojení se nedá přepnout (jinak by RPC šifru vydala).
--   7. Připojení pobočky smí synchronizovat jen do účtu TÉ pobočky
--      (synchronizace zapisuje jako služba a pohybům z banky věří
--      párování faktur).
--
-- POŘADÍ NASAZENÍ (narazil, nepřehlédnout)
--
-- Po `db push` a PŘED nasazením aplikace by stará aplikace zapisovala
-- `fio_api` / `bankovni_agregator` — nové CHECK to odmítne a
-- synchronizace skončí chybou (u připojení se zapíše, nic se neztratí,
-- příští běh po nasazení to stáhne znovu). 19. 11. 2026 není žádné
-- připojení banky živé (jediné, KB, je odpojené), takže okno nic
-- nerozbije — ale migraci a aplikaci nasadit hned po sobě.
--
-- BANKA JEN PRO ČTENÍ (CLAUDE.md, skill foodtab-finance): nic tu
-- neodesílá platby, žádná nová práva nad rámec čtení.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ZDROJ BEZ JMÉNA BANKY
--
-- Pravidla `*_no_update` blokují UPDATE (append-only). Na převod
-- hodnoty se pravidlo na chvíli zahodí a hned se vrátí — ve stejné
-- migraci, takže mezi tím nikdo jiný nezapisuje.
-- ---------------------------------------------------------------------

alter table public.transakce drop constraint transakce_zdroj_check;
alter table public.import_davky drop constraint import_davky_typ_check;
alter table public.bankovni_zustatky drop constraint bankovni_zustatky_zdroj_check;

drop rule transakce_no_update on public.transakce;
update public.transakce set zdroj = 'banka_api' where zdroj in ('fio_api', 'bankovni_agregator');
create rule transakce_no_update as
  on update to public.transakce do instead nothing;

drop rule bankovni_zustatky_no_update on public.bankovni_zustatky;
update public.bankovni_zustatky set zdroj = 'banka_api' where zdroj in ('fio_api', 'bankovni_agregator');
create rule bankovni_zustatky_no_update as
  on update to public.bankovni_zustatky do instead nothing;

update public.import_davky set typ = 'banka_api' where typ in ('fio_api', 'bankovni_agregator');

alter table public.transakce add constraint transakce_zdroj_check
  check (zdroj in ('rucni', 'csv_banka', 'csv_pokladna', 'pos_adapter', 'banka_api'));
alter table public.import_davky add constraint import_davky_typ_check
  check (typ in ('banka_csv', 'pokladna_csv', 'pokladna_prodeje_csv', 'banka_api'));
alter table public.bankovni_zustatky add constraint bankovni_zustatky_zdroj_check
  check (zdroj in ('banka_api', 'csv', 'rucni'));

comment on column public.transakce.zdroj is
  'Odkud pohyb přišel: rucni, csv_banka (import výpisu), csv_pokladna, '
  'pos_adapter, banka_api (stažení z banky — kterou, říká připojení, ne '
  'tenhle sloupec). banka_api smí zapsat jen synchronizace (app.hlida_zdroj_transakce).';


-- Platbu „z banky přes API" smí zapsat jen synchronizace (service_role).
-- Stejné pravidlo jako v 20261008120000, jen s neutrální hodnotou.
create or replace function app.hlida_zdroj_transakce()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.zdroj = 'banka_api' then
    raise exception 'Platbu ze zdroje „%" zapisuje jen synchronizace banky.', new.zdroj
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function app.hlida_zdroj_transakce() from public, anon, authenticated;


-- Starší automatické párování (20261008120000) — dnes ho nevolá appka
-- (nahradilo ho automaticky_sparovat_fakturu), ale funkce v databázi je
-- a mohla by se zavolat. Tělo beze změny kromě seznamu zdrojů.
create or replace function app.automaticky_sparovat_platbu(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura   bigint := hashtextextended(p_faktura, 0);
  v_branch         uuid;
  v_castka_transakce integer;
begin
  if p_castka_haleru <= 0 or p_castka_haleru <> p_castka_faktury_celkem then
    return false;
  end if;

  -- Stejné pořadí zámků jako app.potvrdit_alokaci_platby — souběh s ručním
  -- potvrzením téže platby/faktury se srazí na zámku, ne v datech.
  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant and t.smer = 'vydaj'
     -- Jen platba, která skutečně přišla z banky — ruční zápis nebo pokladnu
     -- si může kdokoli s financemi napsat sám a fakturu by tím „zaplatil".
     and t.zdroj in ('banka_api', 'csv_banka');

  if v_castka_transakce is null or v_castka_transakce <> p_castka_haleru then
    return false;
  end if;

  -- Cokoli už spárovaného (i částečně, i jinou cestou) = už to není
  -- jednoznačné. Rozhodne člověk.
  if exists (select 1 from public.platby_faktury
              where stav = 'potvrzeno'
                and (transakce_id = p_transakce or (tenant_id = p_tenant and faktura_id = p_faktura))) then
    return false;
  end if;

  -- Člověk tohle párování už jednou zrušil (stav 'zamitnuto') — automatika
  -- ho nesmí vracet pořád dokola.
  if exists (select 1 from public.platby_faktury
              where transakce_id = p_transakce and faktura_id = p_faktura and stav = 'zamitnuto') then
    return false;
  end if;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, jistota, stav, potvrzeno_kdy, zpusob)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, 1, 'potvrzeno', now(), 'automaticky');

  perform app.audit(p_tenant, 'finance.platba_alokovana_automaticky', 'platby_faktury', p_faktura, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', p_castka_haleru));
  return true;
end $$;


-- Automatické párování faktur (20261018100000) — tělo beze změny kromě
-- seznamu zdrojů.
create or replace function app.automaticky_sparovat_fakturu(
  p_tenant        uuid,
  p_transakce     uuid,
  p_faktura       uuid,
  p_castka_haleru integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce   bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura     bigint := hashtextextended(p_faktura::text, 0);
  v_branch           uuid;
  v_castka_transakce integer;
  v_castka_faktury   integer;
begin
  if p_castka_haleru is null or p_castka_haleru <= 0
     or app.faktury_stav_prevodu(p_tenant) is distinct from 'dokonceno' then
    return false;
  end if;

  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select f.castka_haleru into v_castka_faktury
    from public.faktury f
   where f.id = p_faktura and f.tenant_id = p_tenant
     and upper(btrim(f.mena)) = 'CZK' and not f.archivovano and not f.duplicita
     for no key update;
  if v_castka_faktury is null or v_castka_faktury <> p_castka_haleru then
    return false;
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant and t.smer = 'vydaj'
     and upper(btrim(t.mena)) = 'CZK'
     -- Jen platba, která skutečně přišla z banky (ruční zápis si může
     -- kdokoli s financemi napsat sám a fakturu by tím „zaplatil").
     and t.zdroj in ('banka_api', 'csv_banka');

  if v_castka_transakce is null or v_castka_transakce <> p_castka_haleru then
    return false;
  end if;

  -- Cokoli už spárovaného (i částečně, i jinou cestou) = není jednoznačné.
  if exists (select 1 from public.platby_faktury p
              where p.stav = 'potvrzeno'
                and (p.transakce_id = p_transakce or p.faktura = p_faktura)) then
    return false;
  end if;

  -- Člověk tohle párování už jednou zrušil — automatika ho nevrací.
  if exists (select 1 from public.platby_faktury p
              where p.transakce_id = p_transakce and p.faktura = p_faktura and p.stav = 'zamitnuto') then
    return false;
  end if;

  -- Platbu už (i zčásti) spotřebovala úhrada Jiných plateb (20261016100000):
  -- jednoznačná shoda to není. Vrátit „ne", ne spadnout na spoušti součtu
  -- trg_platby_faktury_jine_platby — úloha banky by jinak skončila chybou.
  if exists (select 1 from public.jine_platby z where z.uhrada_transakce_id = p_transakce) then
    return false;
  end if;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura, castka_haleru, jistota, stav, potvrzeno_kdy, zpusob)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, 1, 'potvrzeno', now(), 'automaticky');

  perform app.audit(p_tenant, 'finance.platba_alokovana_automaticky', 'platby_faktury', p_faktura::text, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', p_castka_haleru));
  return true;
end $$;


-- Úhrada Jiných plateb (20261021100000) — tělo beze změny kromě
-- seznamu zdrojů.
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
  if v_t.zdroj not in ('banka_api', 'csv_banka') then
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


-- ---------------------------------------------------------------------
-- 2. PROTIÚČET A OTISK
-- ---------------------------------------------------------------------

alter table public.transakce add column protiucet text not null default '';
alter table public.transakce add column otisk text;

comment on column public.transakce.protiucet is
  'Účet protistrany, normalizovaný appkou (lib/banka/ucet.ts): IBAN velkými '
  'písmeny bez mezer, český tvar předčíslí-číslo/kód banky převedený na IBAN, '
  'jinak očištěný text. Jméno protistrany je v `protistrana`.';
comment on column public.transakce.otisk is
  'U každého importovaného pohybu: sha256 z app.otisk_pohybu. Pohyb bez id '
  'od banky ho má unikátní na účtu (opakovaný nebo překrývající se výpis '
  'pohyb nezdvojí); u pohybu s id slouží k poznání téhož pohybu z výpisu.';

-- Otisk jen u pohybu z importu (dávka).
alter table public.transakce add constraint transakce_otisk_jen_z_importu
  check (otisk is null or import_davka_id is not null);

-- Ruční zápis nemá nic z importu: id od banky ani dávku (a tím ani
-- otisk). Jinak by si ho někdo s právem zápisu „zabral" dopředu —
-- skutečný pohyb se stejným id nebo otiskem by import přeskočil jako
-- už zapsaný a v knize by zůstal jen ruční řádek, kterému párování
-- faktur ani úhrady Jiných plateb nevěří (kontrola kroku 1, 20. 11.).
-- Appka ruční platbu bez id i dávky zapisuje vždycky (platby/akce.ts,
-- zakazky/akce.ts); kdyby takový řádek v databázi byl, migrace spadne
-- nahlas — chyba dat, kterou je potřeba vidět (19. 11. žádný pohyb).
alter table public.transakce add constraint transakce_rucni_bez_importu
  check (zdroj <> 'rucni' or (externi_id is null and import_davka_id is null));

-- Unikátní jen u pohybů BEZ id (u nich je otisk jediná ochrana před
-- dvojím zápisem, i při souběhu dvou importů). Pohyby s id hlídá id —
-- dva různé pohyby od banky smí mít shodný otisk (banka u dvou stejných
-- plateb změní pořadí mezi staženími).
create unique index transakce_otisk
  on public.transakce (ucet_id, otisk)
  where otisk is not null and externi_id is null;
create index transakce_otisk_hledani
  on public.transakce (ucet_id, otisk)
  where otisk is not null;


/*
  OTISK POHYBU. Jediná implementace — volá ji import i dopočet níž.
  Pořadí (1, 2, …) odliší dvě stejné platby v jednom výpisu: obě
  zůstanou, a opakovaný výpis je pozná obě.

  Normalizace jen lehká (mezery, velikost písmen) — protiúčet už
  normalizuje appka. Poznámka do otisku nepatří (zadání, rozhodnutí 3):
  banky ji u téhož pohybu mezi exporty mění.

  Datum přes to_char, ne `::text` — převod data na text řídí nastavení
  relace (DateStyle), takže by týž pohyb dal v jiném klientovi jiný
  otisk. VS jen číslice bez úvodních nul (jako normalizovatVs
  v lib/finance-parovani.ts): Excel při uložení výpisu nuly smaže
  („0012345" → „12345") a týž výpis by se zapsal podruhé.

  Pořadí 0 = otisk OBSAHU (bez pořadí) — podle něj se stejné řádky
  číslují; stejná funkce, takže číslování a otisk normalizují stejně.
*/
create function app.otisk_pohybu(
  p_ucet          uuid,
  p_datum         date,
  p_smer          text,
  p_castka_haleru integer,
  p_mena          text,
  p_vs            text,
  p_protiucet     text,
  p_protistrana   text,
  p_poradi        bigint
)
returns text
language sql stable set search_path = ''
as $$
  select encode(sha256(convert_to(concat_ws('|',
    p_ucet::text,
    to_char(p_datum, 'YYYY-MM-DD'),
    p_smer,
    p_castka_haleru::text,
    upper(btrim(coalesce(p_mena, 'CZK'))),
    ltrim(regexp_replace(coalesce(p_vs, ''), '\D', '', 'g'), '0'),
    upper(regexp_replace(coalesce(p_protiucet, ''), '\s', '', 'g')),
    lower(regexp_replace(btrim(coalesce(p_protistrana, '')), '\s+', ' ', 'g')),
    p_poradi::text
  ), 'UTF8')), 'hex')
$$;

comment on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text, bigint) is
  'Otisk importovaného pohybu (transakce.otisk). Pořadí = kolikátý stejný '
  'řádek v jednom výpisu; 0 = otisk obsahu bez pořadí (klíč číslování).';

revoke all on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text, bigint) from public, anon;
grant execute on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text, bigint) to authenticated, service_role;


-- Dopočet otisku u pohybů, které už z importu přišly (19. 11. 2026 v ostré
-- databázi žádné nejsou — ale migrace má sedět i nad daty). Pořadí v
-- původním souboru se neuložilo; u STEJNÝCH řádků na pořadí nezáleží,
-- vyjde stejná sada otisků. Dřív se ale řádky bez id nehlídaly vůbec, takže
-- dvakrát importovaný výpis má stejný otisk dvakrát — u pohybů bez id ho
-- dostane jen první (distinct on), ostatní zůstanou bez otisku (unikátní
-- index by jinak migraci shodil). Pohyby s id dostanou otisk všechny
-- (hlídá je id, otisk u nich není unikátní). Jméno protistrany staré
-- importy občas plnily číslem účtu — takový řádek se s novým importem
-- téhož výpisu nepozná (narazil).
drop rule transakce_no_update on public.transakce;
with ocislovane as (
  select t.id, t.ucet_id, t.externi_id,
         app.otisk_pohybu(t.ucet_id, t.datum, t.smer, t.castka_haleru, t.mena, t.vs, t.protiucet, t.protistrana,
           row_number() over (
             partition by t.import_davka_id,
                          app.otisk_pohybu(t.ucet_id, t.datum, t.smer, t.castka_haleru, t.mena, t.vs, t.protiucet, t.protistrana, 0)
             order by t.created_at, t.id)) as otisk
    from public.transakce t
   where t.import_davka_id is not null
     and t.otisk is null
),
k_zapisu as (
  (select distinct on (o.ucet_id, o.otisk) o.id, o.otisk
     from ocislovane o
    where o.externi_id is null
    order by o.ucet_id, o.otisk, o.id)
  union all
  select o.id, o.otisk
    from ocislovane o
   where o.externi_id is not null
)
update public.transakce t set otisk = k.otisk from k_zapisu k where t.id = k.id;
create rule transakce_no_update as
  on update to public.transakce do instead nothing;


-- ---------------------------------------------------------------------
-- 3. IMPORT: DEDUP PODLE ID, JINAK PODLE OTISKU; DÁVKA ATOMICKY
-- ---------------------------------------------------------------------

/*
  Stávající podpis zůstává (volá ho stará appka během nasazení
  a scénář krok76). Nově:
    * jen zdroje importu (výpis, stažení z banky, pokladna) — ruční
      zápis importem nevzniká (jinak by dostal otisk a dávku);
    * `protiucet` v řádku (chybí-li, je prázdný),
    * každý řádek dostane otisk; pořadí = kolikátý stejný řádek
      v tomhle volání (pořadí v poli = pořadí ve výpisu);
    * řádek BEZ id od banky (`externi_id`, prázdný text = bez id) se
      přeskočí, když na účtu už je pohyb se stejným otiskem — z výpisu
      i ze stažení přes API;
    * řádek S id se přeskočí, když na účtu už je pohyb s tím id, nebo
      pohyb BEZ id se stejným otiskem (týž pohyb dřív z výpisu). Proti
      pohybům s id se otisk neporovnává: dva stejné pohyby od banky
      s různým id jsou dva (banka mezi staženími mění pořadí stejných
      řádků — porovnání otisků by druhý zahodilo).
  Mez (narazil): když banka mezi staženími přehází dvě stejné platby
  a teprve potom přijde výpis téhož dne, druhá platba z výpisu se zapíše
  podruhé. Dvojí zápis je vidět a dá se stornovat; zahozená platba ne.
  Anti-join, ne ON CONFLICT: `transakce` má pravidlo na UPDATE
  a PostgreSQL proto ON CONFLICT na ní odmítá (20261003170000).
  SECURITY INVOKER — politiky platí jako u přímého zápisu.
*/
create or replace function public.importovat_transakce(
  p_tenant uuid,
  p_ucet   uuid,
  p_davka  uuid,
  p_zdroj  text,
  p_radky  jsonb
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pocet integer;
begin
  if p_zdroj is null or p_zdroj not in ('banka_api', 'csv_banka', 'csv_pokladna') then
    raise exception 'Import tohohle zdroje neexistuje.' using errcode = 'check_violation';
  end if;

  with radky as (
    select x.poradi_v_poli,
           r.datum::date as datum, r.smer, r.castka_haleru, coalesce(r.mena, 'CZK') as mena,
           coalesce(r.protistrana, '') as protistrana, coalesce(r.protiucet, '') as protiucet,
           coalesce(r.vs, '') as vs, coalesce(r.poznamka, '') as poznamka,
           -- Prázdný text = bez id (hlídá otisk). Jinak id přesně, jak přišlo
           -- (dřív uložené řádky se s ním musí shodovat znak po znaku).
           case when btrim(r.externi_id) = '' then null else r.externi_id end as externi_id
      from jsonb_array_elements(p_radky) with ordinality as x(radek, poradi_v_poli)
      cross join lateral jsonb_to_record(x.radek) as r(
        datum text, smer text, castka_haleru integer, mena text,
        protistrana text, protiucet text, vs text, poznamka text, externi_id text
      )
  ),
  s_klicem as (
    select r.*,
           app.otisk_pohybu(p_ucet, r.datum, r.smer, r.castka_haleru, r.mena, r.vs, r.protiucet, r.protistrana, 0) as klic
      from radky r
  ),
  s_otiskem as (
    select k.*,
           app.otisk_pohybu(p_ucet, k.datum, k.smer, k.castka_haleru, k.mena, k.vs, k.protiucet, k.protistrana,
             row_number() over (partition by k.klic order by k.poradi_v_poli)) as otisk
      from s_klicem k
  ),
  nove as (
    select s.* from s_otiskem s
     where not exists (
             select 1 from public.transakce t
              where t.ucet_id = p_ucet and t.otisk = s.otisk
                and (s.externi_id is null or t.externi_id is null))
       and (s.externi_id is null or not exists (
             select 1 from public.transakce t
              where t.ucet_id = p_ucet and t.externi_id = s.externi_id))
  ),
  vlozene as (
    insert into public.transakce (
      tenant_id, ucet_id, smer, castka_haleru, mena, datum,
      protistrana, protiucet, vs, poznamka, zdroj, externi_id, otisk, import_davka_id
    )
    select
      p_tenant, p_ucet, n.smer, n.castka_haleru, n.mena, n.datum,
      n.protistrana, n.protiucet, n.vs, n.poznamka,
      p_zdroj, n.externi_id, n.otisk, p_davka
    from nove n
    order by n.poradi_v_poli
    returning 1
  )
  select count(*)::integer into v_pocet from vlozene;

  update public.import_davky set pocet_novych = v_pocet where id = p_davka;

  return v_pocet;
end $$;

comment on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) is
  'Hromadný zápis importu do existující dávky (jen zdroje importu). Dedup: '
  'řádek bez id podle (ucet_id, otisk) proti všem pohybům účtu; řádek s id '
  'podle (ucet_id, externi_id) a proti pohybům BEZ id podle otisku (týž '
  'pohyb z výpisu i ze stažení). Otisk počítá app.otisk_pohybu i s pořadím '
  'stejného řádku ve výpisu. Anti-join, ne ON CONFLICT (pravidlo na UPDATE). '
  'Zapisuje import_davky.pocet_novych. Nová appka volá importovat_vypis '
  '(dávka i řádky v jedné transakci).';

revoke all on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) to authenticated, service_role;


/*
  Výpis (soubor nebo jedno stažení z banky) = dávka + pohyby v JEDNÉ
  transakci. Spadne-li zápis pohybů, zmizí i dávka — opakovaný import
  téhož souboru pak neblokuje „už importováno". Typ dávky se odvodí ze
  zdroje (jedna hodnota navíc by mohla nesedět).

  Stejný soubor podruhé: unikátní (tenant_id, soubor_hash) → 23505.
  SECURITY INVOKER — u přihlášeného platí politiky dávky i pohybů.
*/
create function public.importovat_vypis(
  p_tenant       uuid,
  p_ucet         uuid,
  p_zdroj        text,
  p_soubor_nazev text,
  p_soubor_hash  text,
  p_radky        jsonb
)
returns table (davka_id uuid, pocet_novych integer)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_typ   text;
  v_davka uuid;
begin
  v_typ := case p_zdroj
             when 'banka_api'    then 'banka_api'
             when 'csv_banka'    then 'banka_csv'
             when 'csv_pokladna' then 'pokladna_csv'
           end;
  if v_typ is null then
    raise exception 'Import tohohle zdroje neexistuje.' using errcode = 'check_violation';
  end if;
  if p_radky is null or jsonb_typeof(p_radky) <> 'array' then
    raise exception 'Řádky importu musí být pole.' using errcode = 'check_violation';
  end if;

  insert into public.import_davky (tenant_id, typ, soubor_nazev, soubor_hash, pocet_radku, stav)
  values (p_tenant, v_typ, coalesce(p_soubor_nazev, ''), p_soubor_hash, jsonb_array_length(p_radky), 'zpracovano')
  returning id into v_davka;

  return query
    select v_davka, public.importovat_transakce(p_tenant, p_ucet, v_davka, p_zdroj, p_radky);
end $$;

comment on function public.importovat_vypis(uuid, uuid, text, text, text, jsonb) is
  'Import výpisu: dávka i pohyby v jedné transakci (dřív samostatná dávka, '
  'která po chybě zápisu blokovala opakovaný import). Vrací id dávky a '
  'počet skutečně nových pohybů.';

revoke all on function public.importovat_vypis(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.importovat_vypis(uuid, uuid, text, text, text, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 4. RLS PODLE POBOČKY ÚČTU
--
-- app.has_access(tenant, právo, pobočka): s pobočkou = člen té pobočky
-- nebo celé firmy; s NULL = JEN člen s rozsahem celé firmy. To je
-- přesně pravidlo pro účet: firemní účet (branch_id null) vidí jen
-- rozsah firmy. app.can_read_scoped s NULL by kontroloval jen právo
-- (jakýkoli rozsah) — proto se tu nepoužívá.
-- ---------------------------------------------------------------------

/*
  Účty, ke kterým má přihlášený právo. SECURITY DEFINER — uvnitř žádné
  RLS (20260823120200: vlastník obchází RLS), filtr dělá has_access.
  Politiky níž se ptají na `ucet_id in (select …)`: nekorelovaný dotaz,
  počítá se jednou na dotaz, ne na řádek.

  Předfiltr na firmy, kde je přihlášený členem, je jen zrychlení
  (has_access se jinak volá pro každý účet v databázi); o přístupu
  rozhoduje has_access.
*/
create function app.platebni_ucty_s_pravem(p_pravo text)
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select u.id
    from public.platebni_ucty u
   where u.tenant_id in (select m.tenant_id from public.memberships m where m.user_id = (select auth.uid()))
     and app.has_access(u.tenant_id, p_pravo, u.branch_id)
$$;

comment on function app.platebni_ucty_s_pravem(text) is
  'Id platebních účtů, ke kterým má přihlášený právo p_pravo — u účtu '
  'pobočky na té pobočce, u firemního (bez pobočky) za celou firmu.';

revoke all on function app.platebni_ucty_s_pravem(text) from public, anon;
grant execute on function app.platebni_ucty_s_pravem(text) to authenticated;


drop policy platebni_ucty_read on public.platebni_ucty;
create policy platebni_ucty_read on public.platebni_ucty for select to authenticated
  using (app.has_access(tenant_id, 'finance.read', branch_id));

drop policy transakce_read on public.transakce;
create policy transakce_read on public.transakce for select to authenticated
  using (ucet_id in (select app.platebni_ucty_s_pravem('finance.read')));

-- ZÁPIS se tu NEMĚNÍ: `transakce_insert` (20261003120000) i
-- `bankovni_zustatky_insert` (20261004100000) zůstávají jen pro rozsah
-- celé firmy — `app.has_access(tenant_id, 'finance.manage', null)`. To je
-- přísnější než „podle pobočky účtu" (na účet pobočky i firemní účet smí
-- jen celá firma), takže zápis na cizí účet nepustí ani tak. Rozšíření na
-- pobočku (ruční platba na účet své pobočky) by otevřelo zápis lidem,
-- kterým ho appka nedává — Finance na pobočce chtějí finance.read za
-- celou firmu (lib/finance-pristup.ts, otázka 47) — a s ním cesty, jak
-- „zabrat" id nebo otisk pohybu z banky, stornovat platbu firemního
-- účtu (storno_of) nebo podstrčit zůstatek, který vypadá jako od banky
-- (kontrola kroku 1, 20. 11.). Proto nejopatrnější varianta.
-- ROZHODNOUT: smí člověk s rozsahem jen pobočky zapisovat ruční platby
-- (a zůstatky) na účet své pobočky? Dnes ne. Otázka 113 (docs/hlaseni/otazky.md).

drop policy bankovni_zustatky_select on public.bankovni_zustatky;
create policy bankovni_zustatky_select on public.bankovni_zustatky for select to authenticated
  using (platebni_ucet_id in (select app.platebni_ucty_s_pravem('finance.read')));

-- Párování plateb s fakturami: vidí ho jen ten, kdo vidí PLATBU (politika
-- transakce_read v poddotazu platí i tady). Dřív stačilo finance.read
-- v jakémkoli rozsahu — pobočka tak viděla id, částky a faktury plateb
-- firemního účtu, které sama vidět nesmí. Appka párování čte jen ve
-- Financích za celou firmu, té se nic nemění.
drop policy platby_faktury_read on public.platby_faktury;
create policy platby_faktury_read on public.platby_faktury for select to authenticated
  using (exists (select 1 from public.transakce t where t.id = platby_faktury.transakce_id));

-- Dávka pobočku nemá (import výpisu je jen za celou firmu,
-- app/[rozsah]/finance/platby/import/layout.tsx) — čtení jen s rozsahem
-- celé firmy, stejně jako zápis.
drop policy import_davky_read on public.import_davky;
create policy import_davky_read on public.import_davky for select to authenticated
  using (app.has_access(tenant_id, 'finance.read', null));


-- Uhrazeno na zakázku (20261003220000) je SECURITY DEFINER a sčítal
-- VŠECHNY platby zakázky, i z účtů, které volající vidět nesmí (záloha na
-- firemní účet u zakázky pobočky). Tělo beze změny kromě filtru účtu —
-- stejně jako politika transakce_read. Appka ho volá jen ve Financích za
-- celou firmu, té se součet nemění.
create or replace function app.zakazka_uhrazeno(p_tenant uuid, p_zakazka uuid)
returns bigint
language sql stable security definer set search_path = ''
as $$
  select coalesce(sum(
    case when x.smer = 'prijem' then x.castka_haleru
         when x.smer = 'vydaj' then -x.castka_haleru
         else 0 end
  ), 0)::bigint
  from public.transakce x
  join public.zakazky z on z.id = x.zakazka_id
  where x.zakazka_id = p_zakazka
    and z.tenant_id = p_tenant
    and app.has_access(p_tenant, 'finance.read', z.branch_id)
    and x.ucet_id in (select app.platebni_ucty_s_pravem('finance.read'));
$$;


-- ---------------------------------------------------------------------
-- 4b. PŘEHLED TRŽEB: BANKOVNÍ ČÁST PODLE POBOČKY ÚČTU
--
-- public.pokladna_prehled_trzeb (20261012200000) je SECURITY DEFINER
-- a v bankovní části napodoboval STAROU politiku transakcí (firemní
-- účet viděl kdokoli s finance.read). Tělo beze změny kromě filtru účtu
-- (a komentáře) — tržby a platby z pokladen se nemění.
-- ---------------------------------------------------------------------

create or replace function public.pokladna_prehled_trzeb(
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
             -- Účet pobočky jen s právem na té pobočce, firemní (bez pobočky)
             -- jen za celou firmu — stejně jako politika transakce_read.
             and u.id in (select app.platebni_ucty_s_pravem('finance.read'))
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
  'jako RLS, bez kontroly po řádcích. Bankovní část od 20261119100000 podle '
  'pobočky účtu (firemní účet jen za celou firmu).';

revoke all on function public.pokladna_prehled_trzeb(uuid, date, date, text) from public, anon;
grant execute on function public.pokladna_prehled_trzeb(uuid, date, date, text) to authenticated;


-- DRUHÁ LINIE: pobočka účtu musí patřit téže firmě. has_access s rozsahem
-- celé firmy pustí JAKOUKOLI pobočku (i cizí firmy) — bez spouště by šel
-- účet „přestěhovat" pod cizí pobočku.
--
-- A účet se mezi firmami nestěhuje vůbec: politiky pohybů a zůstatků se
-- ptají jen na účet (ne na firmu řádku), takže majitel dvou firem by
-- přestěhováním účtu ukázal celou historii pohybů firmy A lidem firmy B
-- (kontrola kroku 1, 20. 11.). Pohyby i zůstatky nesou firmu účtu
-- (app.hlida_firmu_transakce), účet jiné firmy = nový účet.
create function app.hlida_firmu_platebniho_uctu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.tenant_id is distinct from old.tenant_id then
    raise exception 'Platební účet nejde převést do jiné firmy.' using errcode = 'check_violation';
  end if;
  if new.branch_id is not null and not exists (
    select 1 from public.branches b
     where b.id = new.branch_id and b.tenant_id = new.tenant_id
  ) then
    raise exception 'Pobočka nepatří této firmě.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function app.hlida_firmu_platebniho_uctu() is
  'Spoušť: platebni_ucty.branch_id musí být pobočka téže firmy a účet se '
  'nepřevádí do jiné firmy.';

revoke all on function app.hlida_firmu_platebniho_uctu() from public, anon, authenticated;

create trigger trg_firma_platebniho_uctu
  before insert or update of tenant_id, branch_id on public.platebni_ucty
  for each row execute function app.hlida_firmu_platebniho_uctu();

-- Stávající řádky: spoušť je nezkontroluje, tak to udělá migrace. Účet pod
-- cizí pobočkou = chyba dat, kterou je potřeba vidět, ne tiše nechat.
do $$
begin
  if exists (
    select 1 from public.platebni_ucty u
      join public.branches b on b.id = u.branch_id
     where b.tenant_id <> u.tenant_id
  ) then
    raise exception 'Platební účet je přiřazený pobočce jiné firmy — opravit data před nasazením.';
  end if;
end $$;


-- DRUHÁ LINIE U PŘIPOJENÍ: připojení pobočky jen k účtu TÉ pobočky.
--
-- Politika zápisu připojení (20261007110000) se ptá na pobočku
-- PŘIPOJENÍ, spoušť z 20261004100000 na firmu účtu — ne na jeho pobočku.
-- Člověk s integrace.manage jen na pobočce by tak namířil připojení své
-- pobočky na firemní účet (nebo účet jiné pobočky) a synchronizace by
-- tam jako služba zapisovala pohyby `banka_api`, kterým věří párování
-- faktur (kontrola kroku 1, 20. 11.). Připojení za celou firmu (bez
-- pobočky — jen tak je dnes zakládá appka) smí ke kterémukoli účtu firmy.
-- Spoušť běží jen při změně firmy, pobočky nebo účtu — stávající
-- připojení (appka žádnému pobočku nedává) se nekontrolují znovu.
create or replace function app.hlida_firmu_integrace_pripojeni()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_firma   uuid;
  v_pobocka uuid;
begin
  if new.platebni_ucet_id is null then
    return new;
  end if;
  select u.tenant_id, u.branch_id into v_firma, v_pobocka
    from public.platebni_ucty u
   where u.id = new.platebni_ucet_id;
  if v_firma is distinct from new.tenant_id then
    raise exception 'Platební účet nepatří této firmě.' using errcode = 'check_violation';
  end if;
  if new.branch_id is not null and v_pobocka is distinct from new.branch_id then
    raise exception 'Připojení pobočky smí jen k platebnímu účtu té pobočky.' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function app.hlida_firmu_integrace_pripojeni() from public, anon, authenticated;

drop trigger trg_firma_integrace_pripojeni on public.integrace_pripojeni;
create trigger trg_firma_integrace_pripojeni
  before insert or update of tenant_id, branch_id, platebni_ucet_id on public.integrace_pripojeni
  for each row execute function app.hlida_firmu_integrace_pripojeni();


-- Oblast bankovního připojení se nepřepíná. RPC integrace_precti_tajemstvi
-- (oddíl 5) odmítne šifru podle oblasti `banka` — a oblast smí měnit každý
-- s integrace.manage (politika integrace_pripojeni_write je `for all`).
-- Bez spouště by si majitel přepnul oblast na `pokladna`, přečetl šifru
-- banky přes /rest/v1/rpc a oblast vrátil (kontrola kroku 1, 20. 11.).
-- Stejný vzor jako u e-mailové schránky (app.hlida_schranku_prijmu).
create function app.hlida_oblast_banky()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (old.oblast = 'banka') is distinct from (new.oblast = 'banka') then
    raise exception 'Oblast bankovního připojení nejde změnit — připojení odpojte a založte znovu.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;

comment on function app.hlida_oblast_banky() is
  'Spoušť: připojení banky nejde přepnout na jinou oblast ani jiné na banku '
  '(šifru banky RPC nevydává podle oblasti).';

revoke all on function app.hlida_oblast_banky() from public, anon, authenticated;

create trigger trg_hlida_oblast_banky
  before update of oblast on public.integrace_pripojeni
  for each row execute function app.hlida_oblast_banky();


-- ---------------------------------------------------------------------
-- 5. PŘÍSTUPOVÉ ÚDAJE K BANCE JEN NA SERVERU
--
-- integrace_precti_tajemstvi vracela šifru komukoli s integrace.manage
-- přes /rest/v1/rpc — tedy i do prohlížeče. Šifra bez klíče nejde
-- přečíst, ale přístupové údaje k bance do prohlížeče nepatří vůbec.
-- Server teď ověří právo funkcí níž (bez šifry) a šifru si přečte sám
-- (lib/banka/tajemstvi.ts). Ostatní oblasti (rezervace — Choice) RPC
-- používají dál; jejich přepnutí je mimo Finance.
-- ROZHODNOUT: odebrat RPC i pro ostatní oblasti (přepnout rezervace na
-- stejnou serverovou cestu)? Otázka 115 (docs/hlaseni/otazky.md).
-- ---------------------------------------------------------------------

create or replace function app.integrace_precti_tajemstvi(p_pripojeni uuid)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
  v_oblast text;
  v_sifra  text;
begin
  select c.tenant_id, c.branch_id, c.oblast into v_tenant, v_branch, v_oblast
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'integrace.manage', v_branch) then
    raise exception 'Nemáte oprávnění číst přístupové údaje.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_oblast = 'banka' then
    raise exception 'Přístupové údaje k bance čte jen server.'
      using errcode = 'insufficient_privilege';
  end if;

  select t.sifra into v_sifra
    from public.integrace_tajemstvi t
   where t.pripojeni_id = p_pripojeni and t.tenant_id = v_tenant;

  return v_sifra;
end $$;


/*
  Smí přihlášený spravovat tohle připojení? Stejná podmínka jako čtení
  tajemství (integrace.manage na pobočce připojení, živé připojení), ale
  šifru NEVRACÍ — jen firmu, podle které si server tajemství dohledá.
*/
create function app.integrace_overit_spravu(p_pripojeni uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid;
  v_branch uuid;
begin
  select c.tenant_id, c.branch_id into v_tenant, v_branch
    from public.integrace_pripojeni c
   where c.id = p_pripojeni and c.odpojeno_kdy is null;

  if v_tenant is null or not app.has_access(v_tenant, 'integrace.manage', v_branch) then
    raise exception 'Nemáte oprávnění spravovat tohle připojení.'
      using errcode = 'insufficient_privilege';
  end if;

  return v_tenant;
end $$;

comment on function app.integrace_overit_spravu(uuid) is
  'Ověří integrace.manage k živému připojení a vrátí jeho firmu. Šifru '
  'nevrací — tu si server přečte sám (lib/banka/tajemstvi.ts).';

revoke all on function app.integrace_overit_spravu(uuid) from public, anon;
grant execute on function app.integrace_overit_spravu(uuid) to authenticated;

create function public.integrace_overit_spravu(p_pripojeni uuid)
returns uuid
language sql stable security invoker set search_path = ''
as $$
  select app.integrace_overit_spravu(p_pripojeni);
$$;

revoke all on function public.integrace_overit_spravu(uuid) from public, anon;
grant execute on function public.integrace_overit_spravu(uuid) to authenticated;
