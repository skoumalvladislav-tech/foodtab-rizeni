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
--   3. `transakce.otisk` — OBSAHOVÝ KLÍČ pohybu: sha256 z účtu, data,
--      směru, částky, měny, VS, protiúčtu a protistrany (bez pořadí, bez
--      poznámky). Má ho KAŽDÝ pohyb z importu (výpis, stažení z banky,
--      pokladní uzávěrka), ruční nikdy. NENÍ unikátní — dvě stejné platby
--      mají stejný klíč a import je POČÍTÁ (oddíl DVOJÍ ZÁPIS níž).
--      Počítá ho jen databáze (app.otisk_pohybu), jedna implementace pro
--      všechny cesty. Zadání: „stejný pohyb se nikdy nezapíše dvakrát".
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
--      párování faktur) — a účet, na který takové připojení míří, se
--      nedá přestěhovat jinam.
--   8. Id pohybu od banky je unikátní jen v rámci ZDROJE
--      (`ucet_id, zdroj, externi_id`): řádek výpisu s „Externí ID" nebo
--      z pokladny se stejným textem pohyb z banky nezablokuje. Přímým
--      zápisem smí přihlášený jen ruční platbu (`rucni`); výpis
--      a pokladní uzávěrku jen přes import, stažení z banky jen
--      synchronizace (app.hlida_zdroj_transakce).
--
-- DVOJÍ ZÁPIS: VÝPIS A STAŽENÍ Z BANKY
--
-- Zásada: pohyb stažený z banky (`banka_api`, s id od banky) se NIKDY
-- nezahodí kvůli obsahu jiného řádku. Viditelná dvojice je přijatelná
-- (dá se stornovat), ztracená platba ne. Dřívější verze téhle migrace
-- (porovnání otisku s pořadím stejného řádku v jednom volání) platbu
-- uměla trvale zahodit: banka stahuje po stránkách nebo od poledne,
-- pořadí se pak počítalo jinak než ve výpisu (kontrola kroku 1, 20. 11.).
--
--   * Důvěryhodná sada účtu = pohyby téhož účtu ze stažení (`banka_api`)
--     a z výpisu (`csv_banka`), které přišly importem (mají dávku).
--     Pokladní uzávěrka (`csv_pokladna`), pokladna (`pos_adapter`)
--     a ruční zápis se do ní nepočítají NIKDY — výpis omylem nahraný jako
--     pokladní uzávěrka pohyb z banky nezablokuje.
--   * Řádek bez id (výpis; stažení bez id): za každý obsahový klíč se
--     zapíše tolik řádků, o kolik jich má import víc než sada účtu. Dvě
--     stejné platby ve výpisu zůstanou dvě, opakovaný nebo překrývající
--     se výpis nic nepřidá. Pokladní uzávěrka se počítá jen proti
--     pokladním uzávěrkám téhož účtu.
--   * Řádek s id ze stažení: přeskočí se, když účet to id už má (řádek
--     `banka_api` nebo potvrzení); jinak si „nárokuje" nenárokovaný
--     a nestornovaný řádek výpisu se stejným klíčem — zapíše se jen
--     POTVRZENÍ (`transakce_potvrzeni_banky`), že ten řádek výpisu banka
--     potvrdila; jinak se zapíše jako nový pohyb.
--   * STORNO (oprava pohybu, `storno_of`) ukazuje vždy na pohyb téže
--     firmy a téhož účtu (složený cizí klíč `transakce_storno_tez_ucet`).
--     Stornovaný řádek výpisu dál DRŽÍ MÍSTO svého klíče proti dalším
--     výpisům (a stornovaná pokladní uzávěrka proti uzávěrkám) — dvojice,
--     kterou člověk stornem vyřešil, se s dalším překrývajícím se výpisem
--     nevrátí. Proti stažení z banky stornovaný řádek místo nedrží: nedá
--     se nárokovat a stažení bez id se proti němu nepočítá — pohyb z banky
--     se kvůli stornovanému řádku nezahodí.
--   * Výsledek pro každý klíč: řádků = víc z (výpisů, stažených), a každé
--     id ze stažení je buď řádek `banka_api`, nebo potvrzení — žádné se
--     neztratí, ani když banka stahuje po stránkách nebo okno začíná
--     uprostřed dne.
--   * Mez (ROZHODNOUT, otázka 120): výpis jen ČÁSTI dne, ve kterém je
--     jen druhá ze dvou stejných plateb, ji nepřidá (klíč už na účtu
--     je). Banky exportují po celých dnech; s napojenou bankou ji
--     doplní stažení (má vlastní id). Totéž po stornu: stornovaný řádek
--     výpisu drží místo, takže výpis se stejnou platbou podruhé ji
--     nepřidá (doplní ji jen stažení z banky).
--   * Mez (ROZHODNOUT): storno pohybu z BANKY (`banka_api`) další výpis
--     se stejným obsahem nezastaví — řádek výpisu se zapíše (viditelná
--     dvojice raději než chybějící platba). Opakované stažení téhož id
--     ho nezapíše (id zná).
--   * Mez (ROZHODNOUT): poskytovatel, který nedává VS ani protiúčet
--     (Salt Edge, Enable Banking — lib/integrace-saltedge.ts,
--     lib/integrace-enablebanking.ts), má jiný obsahový klíč než výpis
--     téže banky. Překryv výpisu a stažení se pak zdvojí (každý pohyb
--     dvakrát, nárok se neuplatní). Dnes to nic nespustí: Enable Banking
--     do synchronizace zapojený není, nové připojení Salt Edge se
--     nenabízí. Rozhodnout dřív, než se některý zapojí.
--   * Souběh (synchronizace a import výpisu téhož účtu najednou) řadí
--     zámek na účet — druhý počká a uvidí, co zapsal první.
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
  'tenhle sloupec). Přihlášený smí přímo zapsat jen rucni; csv_banka '
  'a csv_pokladna jen přes public.importovat_transakce, banka_api jen '
  'synchronizace (app.hlida_zdroj_transakce).';


-- Kdo smí zapsat který zdroj. Přihlášený (authenticated/anon) PŘÍMÝM
-- zápisem jen ruční platbu. Výpis a pokladní uzávěrku jen přes
-- public.importovat_transakce — ta si na dobu zápisu nastaví příznak
-- `foodtab.import_transakci` (jen pro svou transakci) a hned ho vrátí.
-- Pohyb „z banky přes API" jen synchronizace (service_role), pokladnu
-- (`pos_adapter`) dnes nezapisuje nikdo jiný než služba.
--
-- Proč: řádek výpisu nebo pokladny s vymyšleným id pohybu a obsahem by
-- se jinak počítal do kontroly dvojího zápisu a falešný „výpis" by
-- párování faktur bralo jako platbu z banky.
--
-- SECURITY INVOKER schválně — rozhoduje role, která zapisuje
-- (current_user), ne vlastník funkce.
create or replace function app.hlida_zdroj_transakce()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') or new.zdroj = 'rucni' then
    return new;
  end if;

  if new.zdroj = 'banka_api' then
    raise exception 'Platbu ze zdroje „%" zapisuje jen synchronizace banky.', new.zdroj
      using errcode = 'insufficient_privilege';
  end if;

  if new.zdroj in ('csv_banka', 'csv_pokladna')
     and current_setting('foodtab.import_transakci', true) = '1' then
    return new;
  end if;

  raise exception 'Platbu ze zdroje „%" zapisuje jen import výpisu, ne přímý zápis.', new.zdroj
    using errcode = 'insufficient_privilege';
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
-- 2. PROTIÚČET, OBSAHOVÝ KLÍČ (OTISK) A POTVRZENÍ Z BANKY
-- ---------------------------------------------------------------------

alter table public.transakce add column protiucet text not null default '';
alter table public.transakce add column otisk text;

comment on column public.transakce.protiucet is
  'Účet protistrany, normalizovaný appkou (lib/banka/ucet.ts): IBAN velkými '
  'písmeny bez mezer, český tvar předčíslí-číslo/kód banky převedený na IBAN, '
  'jinak očištěný text. Jméno protistrany je v `protistrana`.';
comment on column public.transakce.otisk is
  'Obsahový klíč pohybu z importu (app.otisk_pohybu): účet, datum, směr, '
  'částka, měna, VS, protiúčet, protistrana. NENÍ unikátní — dvě stejné '
  'platby mají stejný klíč a import je počítá (public.importovat_transakce). '
  'Ruční zápis ho nemá.';

-- Otisk jen u pohybu z importu (dávka).
alter table public.transakce add constraint transakce_otisk_jen_z_importu
  check (otisk is null or import_davka_id is not null);

-- Ruční zápis nemá nic z importu: id od banky ani dávku (a tím ani
-- otisk). Kontrola dvojího zápisu ruční řádky nepočítá (podle zdroje)
-- a id od banky se porovnává jen v rámci zdroje — ruční řádek s dávkou
-- nebo id by se ale v knize tvářil jako importovaný. Appka ruční platbu
-- bez id i dávky zapisuje vždycky (platby/akce.ts, zakazky/akce.ts);
-- kdyby takový řádek v databázi byl, migrace spadne nahlas — chyba dat,
-- kterou je potřeba vidět (19. 11. žádný pohyb).
alter table public.transakce add constraint transakce_rucni_bez_importu
  check (zdroj <> 'rucni' or (externi_id is null and import_davka_id is null));

-- Obyčejný index, NE unikátní: podle klíče import počítá, kolik stejných
-- pohybů účet už má. Dvě stejné platby téhož dne jsou dvě.
create index transakce_otisk
  on public.transakce (ucet_id, otisk)
  where otisk is not null;

-- Id pohybu od banky je unikátní jen v rámci ZDROJE. Dřív (ucet_id,
-- externi_id) napříč zdroji: řádek výpisu s „Externí ID" nebo pokladní
-- uzávěrka se stejným textem jako budoucí id od banky by synchronizaci
-- účtu zablokoval (23505 při každém dalším stažení) a pohyb z banky by se
-- nezapsal nikdy (kontrola kroku 1, 20. 11.). Volnější index — co
-- prošlo dřív, projde i teď.
drop index public.transakce_externi_id;
create unique index transakce_externi_id
  on public.transakce (ucet_id, zdroj, externi_id)
  where externi_id is not null;

-- Složené klíče pro potvrzení níž (firma i účet řádku musí sedět s tím,
-- na co potvrzení ukazuje — stejná druhá linie jako app.hlida_firmu_transakce).
alter table public.transakce
  add constraint transakce_firma_ucet_id unique (tenant_id, ucet_id, id);
alter table public.import_davky
  add constraint import_davky_firma_id unique (tenant_id, id);

-- Storno ukazuje jen na pohyb TÉŽE firmy a TÉHOŽ účtu. Dřív stačilo
-- jakékoli id pohybu (20261003120000): majitel jiné firmy, který zná id
-- pohybu (třeba účetní s finance.read u nás), si u sebe zapsal ruční
-- „storno" našeho řádku výpisu a synchronizace naší banky pak ten řádek
-- brala jako stornovaný — místo potvrzení zapsala pohyb podruhé (kontrola
-- kroku 1, 23. 11.). Cizí klíč platí pro každou roli i pro službu, takže
-- import (app.import_roztridit, běží pod službou bez RLS) storno znovu
-- firmou nefiltruje. 19. 11. žádný pohyb — kdyby storno jiného účtu
-- v databázi bylo, migrace spadne nahlas.
alter table public.transakce
  add constraint transakce_storno_tez_ucet
  foreign key (tenant_id, ucet_id, storno_of)
  references public.transakce (tenant_id, ucet_id, id);

-- Import se u každého řádku sady ptá, jestli je stornovaný.
create index transakce_storno_of
  on public.transakce (storno_of)
  where storno_of is not null;


/*
  OBSAHOVÝ KLÍČ POHYBU. Jediná implementace — volá ji import i dopočet níž.

  Normalizace jen lehká (mezery, velikost písmen) — protiúčet už
  normalizuje appka. Poznámka do klíče nepatří (zadání, rozhodnutí 3):
  banky ji u téhož pohybu mezi exporty mění. Pořadí řádku taky ne:
  banka stahuje po stránkách nebo od poledne a pořadí stejných řádků se
  pak počítá jinak než ve výpisu.

  Datum přes to_char, ne `::text` — převod data na text řídí nastavení
  relace (DateStyle), takže by týž pohyb dal v jiném klientovi jiný
  klíč. VS jen číslice bez úvodních nul (jako normalizovatVs
  v lib/finance-parovani.ts): Excel při uložení výpisu nuly smaže
  („0012345" → „12345") a týž výpis by se zapsal podruhé.
*/
create function app.otisk_pohybu(
  p_ucet          uuid,
  p_datum         date,
  p_smer          text,
  p_castka_haleru integer,
  p_mena          text,
  p_vs            text,
  p_protiucet     text,
  p_protistrana   text
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
    lower(regexp_replace(btrim(coalesce(p_protistrana, '')), '\s+', ' ', 'g'))
  ), 'UTF8')), 'hex')
$$;

comment on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text) is
  'Obsahový klíč importovaného pohybu (transakce.otisk) — bez pořadí '
  'a bez poznámky. Stejný klíč mají i dvě různé stejné platby.';

revoke all on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text) from public, anon;
grant execute on function app.otisk_pohybu(uuid, date, text, integer, text, text, text, text) to authenticated, service_role;


-- Dopočet klíče u pohybů, které už z importu přišly (19. 11. 2026 v ostré
-- databázi žádné nejsou — ale migrace má sedět i nad daty). Klíč není
-- unikátní, takže ho dostanou VŠECHNY importované pohyby (výpis, stažení,
-- pokladní uzávěrka), i dvakrát importovaný starý výpis — další import
-- pak počítá i s nimi. Ruční a pokladní (`pos_adapter`) pohyby klíč
-- nedostanou, do kontroly dvojího zápisu nepatří. Jméno protistrany staré
-- importy občas plnily číslem účtu — takový řádek se s novým importem
-- téhož výpisu nepozná (narazil).
drop rule transakce_no_update on public.transakce;
update public.transakce t
   set otisk = app.otisk_pohybu(t.ucet_id, t.datum, t.smer, t.castka_haleru, t.mena, t.vs, t.protiucet, t.protistrana)
 where t.import_davka_id is not null
   and t.zdroj in ('banka_api', 'csv_banka', 'csv_pokladna')
   and t.otisk is null;
create rule transakce_no_update as
  on update to public.transakce do instead nothing;


/*
  POTVRZENÍ Z BANKY. Když stažení z banky přinese pohyb (s id od banky),
  který na účtu už je z nahraného výpisu (`csv_banka`), nezapíše se
  podruhé — zapíše se jen tohle potvrzení: „tenhle řádek výpisu banka
  potvrdila, její id je X". Párování faktur pak řádek výpisu bere jako
  ověřený bankou (lib/finance-automaticke-parovani.ts) a příští stažení
  téhož id ho přeskočí.

  Jen přidávání (žádná úprava, žádné mazání mimo kaskádu účtu nebo
  firmy — ani službou). Zapisuje JEN public.importovat_transakce pod
  službou (synchronizace) — přihlášený tabulku jen čte, a to jen u účtů,
  jejichž platby vidí.
*/
create table public.transakce_potvrzeni_banky (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  ucet_id         uuid not null,
  transakce_id    uuid not null,
  externi_id      text not null check (btrim(externi_id) <> ''),
  import_davka_id uuid not null,
  created_at      timestamptz not null default now(),
  -- Jedno id od banky = jeden pohyb (řádek `banka_api` nebo tohle potvrzení).
  constraint transakce_potvrzeni_banky_id_od_banky unique (ucet_id, externi_id),
  -- Jeden řádek výpisu potvrdí banka nejvýš jednou.
  constraint transakce_potvrzeni_banky_jednou unique (transakce_id),
  constraint transakce_potvrzeni_banky_transakce
    foreign key (tenant_id, ucet_id, transakce_id)
    references public.transakce (tenant_id, ucet_id, id) on delete cascade,
  constraint transakce_potvrzeni_banky_davka
    foreign key (tenant_id, import_davka_id)
    references public.import_davky (tenant_id, id)
);

comment on table public.transakce_potvrzeni_banky is
  'Řádek výpisu (csv_banka), který stažení z banky potvrdilo (id od banky). '
  'Zapisuje jen public.importovat_transakce pod službou; jen přidávání.';

create index transakce_potvrzeni_banky_davka on public.transakce_potvrzeni_banky (import_davka_id);
create index transakce_potvrzeni_banky_firma on public.transakce_potvrzeni_banky (tenant_id);

create rule transakce_potvrzeni_banky_no_update as
  on update to public.transakce_potvrzeni_banky do instead nothing;

alter table public.transakce_potvrzeni_banky enable row level security;

-- Výchozí práva Supabase dávají anon, authenticated i service_role
-- všechno — nejdřív vše odebrat VŠEM, pak vypsat, co kdo smí. Přihlášený
-- jen čte (politika v oddílu 4), služba čte a přidává (synchronizace).
-- Bez service_role v revoke by si služba nechala DELETE a TRUNCATE
-- (TRUNCATE obejde i audit) a smazané potvrzení by vrátilo řádek výpisu
-- mezi neověřené bankou (kontrola kroku 1, 23. 11.). Kaskáda od pohybu
-- a firmy běží s právy vlastníka tabulky, té to nevadí. Čistá databáze
-- z run.sh výchozí práva nemá — hlídá to text: scripts/provoz-granty.test.mjs.
revoke all on public.transakce_potvrzeni_banky from public, anon, authenticated, service_role;
grant select on public.transakce_potvrzeni_banky to authenticated;
grant select, insert on public.transakce_potvrzeni_banky to service_role;

create trigger trg_audit_transakce_potvrzeni_banky
  after insert on public.transakce_potvrzeni_banky
  for each row execute function app.audit_zmenu('transakce_potvrzeni_banky');


-- ---------------------------------------------------------------------
-- 3. IMPORT: DVOJÍ ZÁPIS PODLE OBSAHU A ID; DÁVKA ATOMICKY
-- ---------------------------------------------------------------------

/*
  Roztřídění řádků importu (pravidla v hlavičce, oddíl DVOJÍ ZÁPIS).
  Vrací řádky, které se mají zapsat: `narok_na` prázdné = nový pohyb,
  jinak id řádku výpisu, který stažení z banky jen potvrdí.

    * Totéž id dvakrát v jednom volání = jeden pohyb (první výskyt).
    * Id už známé = přeskočit: řádek téhož ZDROJE s tím id; u stažení
      z banky i potvrzení s tím id.
    * Řádek bez id, a každý řádek výpisu či pokladní uzávěrky: za každý
      klíč nejvýš (kolik jich je v importu) − (kolik míst účet už drží,
      `drzi_misto`). Známé id se do „v importu" počítá, zapíše se ale jen
      neznámé.
    * Řádek s id ze stažení: k-tý takový řádek s daným klíčem si nárokuje
      k-tý nenárokovaný nestornovaný řádek výpisu (podle času zápisu); na
      co nezbude, zapíše se jako nový pohyb.

  Důvěryhodná sada = pohyby účtu z importu (mají dávku), samy nejsou
  storno; pro pokladní uzávěrku jen pokladní uzávěrky, jinak jen stažení
  z banky a výpisy. Ruční zápis a pokladna nikdy. Místo drží nestornované
  řádky sady; u výpisu a pokladní uzávěrky i stornované řádky TÉHOŽ
  zdroje (storno drží proti dalšímu výpisu). U stažení z banky stornovaný
  řádek místo nedrží a nárokovat se nedá — pohyb z banky se kvůli němu
  nezahodí. Storno je vždy na témže účtu (transakce_storno_tez_ucet),
  firma storna se proto znovu nefiltruje.

  SECURITY INVOKER: u přihlášeného čte pod RLS (importovat_transakce proto
  pustí jen na účet, jehož platby vidí). Jen čte — zapisuje volající.
*/
create function app.import_roztridit(p_ucet uuid, p_zdroj text, p_radky jsonb)
returns table (
  poradi_v_poli bigint,
  datum         date,
  smer          text,
  castka_haleru integer,
  mena          text,
  protistrana   text,
  protiucet     text,
  vs            text,
  poznamka      text,
  externi_id    text,
  klic          text,
  narok_na      uuid
)
language sql stable security invoker set search_path = ''
as $$
  with radky as (
    select x.poradi_v_poli,
           r.datum::date as datum, r.smer, r.castka_haleru, coalesce(r.mena, 'CZK') as mena,
           coalesce(r.protistrana, '') as protistrana, coalesce(r.protiucet, '') as protiucet,
           coalesce(r.vs, '') as vs, coalesce(r.poznamka, '') as poznamka,
           -- Prázdný text = bez id. Jinak id přesně, jak přišlo (dřív uložené
           -- řádky se s ním musí shodovat znak po znaku).
           case when btrim(r.externi_id) = '' then null else r.externi_id end as externi_id
      from jsonb_array_elements(p_radky) with ordinality as x(radek, poradi_v_poli)
      cross join lateral jsonb_to_record(x.radek) as r(
        datum text, smer text, castka_haleru integer, mena text,
        protistrana text, protiucet text, vs text, poznamka text, externi_id text
      )
  ),
  s_klicem as (
    select r.*,
           app.otisk_pohybu(p_ucet, r.datum, r.smer, r.castka_haleru, r.mena, r.vs, r.protiucet, r.protistrana) as klic,
           row_number() over (partition by r.externi_id order by r.poradi_v_poli) as vyskyt_id
      from radky r
  ),
  jednou as (
    select k.* from s_klicem k
     where k.externi_id is null or k.vyskyt_id = 1
  ),
  s_id as (
    select j.*,
           (j.externi_id is not null and (
              exists (select 1 from public.transakce t
                       where t.ucet_id = p_ucet and t.zdroj = p_zdroj and t.externi_id = j.externi_id)
              or (p_zdroj = 'banka_api' and exists (
                    select 1 from public.transakce_potvrzeni_banky b
                     where b.ucet_id = p_ucet and b.externi_id = j.externi_id))
           )) as zname_id
      from jednou j
  ),
  sada as (
    select t.id, t.otisk, t.zdroj, t.created_at,
           exists (select 1 from public.transakce x where x.storno_of = t.id) as stornovany
      from public.transakce t
     where t.ucet_id = p_ucet
       and t.otisk in (select s.klic from s_id s)
       and t.import_davka_id is not null
       and t.storno_of is null
       and case when p_zdroj = 'csv_pokladna' then t.zdroj = 'csv_pokladna'
                else t.zdroj in ('banka_api', 'csv_banka') end
  ),
  -- Kolik míst klíče účet drží. Stornovaný řádek výpisu (pokladní
  -- uzávěrky) drží místo proti dalšímu výpisu (uzávěrce) — jinak by se
  -- s každým překrývajícím se výpisem vrátil (kontrola kroku 1, 23. 11.).
  drzi_misto as (
    select a.otisk
      from sada a
     where not a.stornovany
        or (p_zdroj in ('csv_banka', 'csv_pokladna') and a.zdroj = p_zdroj)
  ),
  pocitane as (
    select s.* from s_id s
     where p_zdroj <> 'banka_api' or s.externi_id is null
  ),
  pocty as (
    select p.klic,
           count(*) as v_importu,
           (select count(*) from drzi_misto a where a.otisk = p.klic) as na_uctu
      from pocitane p
     group by p.klic
  ),
  nove_pocitane as (
    select p.*
      from (select p0.*,
                   row_number() over (partition by p0.klic order by p0.poradi_v_poli) as poradi_klice
              from pocitane p0
             where not p0.zname_id) p
      join pocty c on c.klic = p.klic
     where p.poradi_klice <= c.v_importu - c.na_uctu
  ),
  stazene as (
    select s.*,
           row_number() over (partition by s.klic order by s.poradi_v_poli) as poradi_klice
      from s_id s
     where p_zdroj = 'banka_api' and s.externi_id is not null and not s.zname_id
  ),
  volne_vypisy as (
    select a.id, a.otisk,
           row_number() over (partition by a.otisk order by a.created_at, a.id) as poradi_klice
      from sada a
     where a.zdroj = 'csv_banka'
       and not a.stornovany
       and not exists (select 1 from public.transakce_potvrzeni_banky b where b.transakce_id = a.id)
  )
  select n.poradi_v_poli, n.datum, n.smer, n.castka_haleru, n.mena, n.protistrana, n.protiucet,
         n.vs, n.poznamka, n.externi_id, n.klic, null::uuid
    from nove_pocitane n
  union all
  select s.poradi_v_poli, s.datum, s.smer, s.castka_haleru, s.mena, s.protistrana, s.protiucet,
         s.vs, s.poznamka, s.externi_id, s.klic, v.id
    from stazene s
    left join volne_vypisy v on v.otisk = s.klic and v.poradi_klice = s.poradi_klice
$$;

comment on function app.import_roztridit(uuid, text, jsonb) is
  'Které řádky importu zapsat (narok_na null) a které jen potvrdit jako '
  'řádek výpisu ověřený bankou (narok_na = id řádku výpisu). Jen čte; '
  'volá ji public.importovat_transakce pod zámkem účtu.';

revoke all on function app.import_roztridit(uuid, text, jsonb) from public, anon;
grant execute on function app.import_roztridit(uuid, text, jsonb) to authenticated, service_role;


/*
  Stávající podpis zůstává (volá ho stará appka během nasazení
  a scénář krok76). Pravidla dvojího zápisu: app.import_roztridit.
    * jen zdroje importu (výpis, stažení z banky, pokladní uzávěrka) —
      ruční zápis importem nevzniká;
    * stažení z banky jen služba (synchronizace); přihlášený jen na účet,
      jehož platby vidí — jinak by pod RLS nepoznal už zapsané pohyby
      a zapsal by je podruhé;
    * zámek na účet PŘED roztříděním (samostatný příkaz — další příkaz
      už vidí, co mezitím zapsal souběžný import);
    * na dobu zápisu příznak `foodtab.import_transakci` (jen pro tuhle
      transakci, hned se vrací) — app.hlida_zdroj_transakce podle něj
      pustí přihlášenému výpis a pokladní uzávěrku, přímý zápis ne.
  Stažení z banky a ostatní zdroje jsou dva různé příkazy: zápis
  potvrzení (jen služba) by u přihlášeného shodil i import výpisu —
  PostgreSQL kontroluje právo zápisu i u příkazu, který nic nezapíše.
  Anti-join, ne ON CONFLICT: `transakce` má pravidlo na UPDATE
  a PostgreSQL proto ON CONFLICT na ní odmítá (20261003170000).
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
  v_pocet   integer;
  v_priznak text;
begin
  if p_zdroj is null or p_zdroj not in ('banka_api', 'csv_banka', 'csv_pokladna') then
    raise exception 'Import tohohle zdroje neexistuje.' using errcode = 'check_violation';
  end if;

  if current_user in ('authenticated', 'anon') then
    if p_zdroj = 'banka_api' then
      raise exception 'Platbu ze zdroje „%" zapisuje jen synchronizace banky.', p_zdroj
        using errcode = 'insufficient_privilege';
    end if;
    if p_ucet is null or p_ucet not in (select app.platebni_ucty_s_pravem('finance.read')) then
      raise exception 'Výpis jde nahrát jen na účet, jehož platby vidíte.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Souběh dvou importů téhož účtu (synchronizace a nahraný výpis): druhý
  -- počká, až první skončí, a teprve pak počítá, co účet už má.
  perform pg_advisory_xact_lock(hashtextextended('transakce:' || p_ucet::text, 0));

  v_priznak := current_setting('foodtab.import_transakci', true);
  perform set_config('foodtab.import_transakci', '1', true);

  if p_zdroj = 'banka_api' then
    with r as materialized (
      select * from app.import_roztridit(p_ucet, p_zdroj, p_radky)
    ),
    vlozene as (
      insert into public.transakce (
        tenant_id, ucet_id, smer, castka_haleru, mena, datum,
        protistrana, protiucet, vs, poznamka, zdroj, externi_id, otisk, import_davka_id
      )
      select p_tenant, p_ucet, r.smer, r.castka_haleru, r.mena, r.datum,
             r.protistrana, r.protiucet, r.vs, r.poznamka,
             p_zdroj, r.externi_id, r.klic, p_davka
        from r
       where r.narok_na is null
       order by r.poradi_v_poli
      returning 1
    ),
    potvrzene as (
      insert into public.transakce_potvrzeni_banky (tenant_id, ucet_id, transakce_id, externi_id, import_davka_id)
      select p_tenant, p_ucet, r.narok_na, r.externi_id, p_davka
        from r
       where r.narok_na is not null
       order by r.poradi_v_poli
      returning 1
    )
    select (select count(*) from vlozene)::integer into v_pocet;
  else
    with r as materialized (
      select * from app.import_roztridit(p_ucet, p_zdroj, p_radky)
    ),
    vlozene as (
      insert into public.transakce (
        tenant_id, ucet_id, smer, castka_haleru, mena, datum,
        protistrana, protiucet, vs, poznamka, zdroj, externi_id, otisk, import_davka_id
      )
      select p_tenant, p_ucet, r.smer, r.castka_haleru, r.mena, r.datum,
             r.protistrana, r.protiucet, r.vs, r.poznamka,
             p_zdroj, r.externi_id, r.klic, p_davka
        from r
       where r.narok_na is null
       order by r.poradi_v_poli
      returning 1
    )
    select count(*)::integer into v_pocet from vlozene;
  end if;

  perform set_config('foodtab.import_transakci', coalesce(v_priznak, ''), true);

  update public.import_davky set pocet_novych = v_pocet where id = p_davka;

  return v_pocet;
end $$;

comment on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) is
  'Hromadný zápis importu do existující dávky (jen zdroje importu). Dvojí '
  'zápis hlídá app.import_roztridit (počty podle obsahového klíče proti '
  'důvěryhodné sadě účtu, id jen v rámci zdroje, stažení z banky si '
  'nárokuje řádek výpisu potvrzením). Pod zámkem účtu. Anti-join, ne ON '
  'CONFLICT (pravidlo na UPDATE). Zapisuje import_davky.pocet_novych = '
  'počet nových pohybů (potvrzení se nepočítají). Nová appka volá '
  'importovat_vypis (dávka i řádky v jedné transakci).';

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

-- Potvrzení z banky (oddíl 2) vidí, kdo vidí platby účtu. Jiná politika
-- není: zápis jen služba (grant), úprava ani mazání nikdo.
create policy transakce_potvrzeni_banky_read on public.transakce_potvrzeni_banky for select to authenticated
  using (ucet_id in (select app.platebni_ucty_s_pravem('finance.read')));

-- ZÁPIS se tu NEMĚNÍ: `transakce_insert` (20261003120000) i
-- `bankovni_zustatky_insert` (20261004100000) zůstávají jen pro rozsah
-- celé firmy — `app.has_access(tenant_id, 'finance.manage', null)`. To je
-- přísnější než „podle pobočky účtu" (na účet pobočky i firemní účet smí
-- jen celá firma), takže zápis na cizí účet nepustí ani tak. Rozšíření na
-- pobočku (ruční platba na účet své pobočky) by otevřelo zápis lidem,
-- kterým ho appka nedává — Finance na pobočce chtějí finance.read za
-- celou firmu (lib/finance-pristup.ts, otázka 47) — a s ním cesty, jak
-- stornovat platbu firemního účtu (storno_of) nebo podstrčit zůstatek,
-- který vypadá jako od banky (kontrola kroku 1, 20. 11.). Proto
-- nejopatrnější varianta. Zdroj přímého zápisu hlídá i tak
-- app.hlida_zdroj_transakce (přímo jen `rucni`).
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
--
-- Účet, na který míří připojení POBOČKY, se nestěhuje na jinou pobočku
-- ani na firmu: spoušť u připojení (níž) hlídá jen změnu připojení, ne
-- účtu. Bez toho by se účet pobočky přesunul a připojení té pobočky by
-- dál synchronizovalo do účtu, který jí už nepatří (kontrola kroku 1,
-- 20. 11.). Připojení se počítá, dokud není odpojené ÚPLNĚ (stav
-- `odpojeno` i čas odpojení — appka nastavuje obojí; synchronizace se
-- ptá na čas). Připojení za celou firmu (bez pobočky) stěhování nebrání.
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
  if tg_op = 'UPDATE' and new.branch_id is distinct from old.branch_id and exists (
    select 1 from public.integrace_pripojeni c
     where c.platebni_ucet_id = new.id
       and c.branch_id is not null
       and c.branch_id is distinct from new.branch_id
       and (c.odpojeno_kdy is null or c.stav <> 'odpojeno')
  ) then
    raise exception 'Na účet míří připojení jiné pobočky — nejdřív ho odpojte, pak účet přesuňte.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

comment on function app.hlida_firmu_platebniho_uctu() is
  'Spoušť: platebni_ucty.branch_id musí být pobočka téže firmy, účet se '
  'nepřevádí do jiné firmy a nepřesouvá od pobočky, jejíž připojení na něj míří.';

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
