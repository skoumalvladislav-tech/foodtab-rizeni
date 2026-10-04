# Bankovní modul — stav k 4. 10. 2026

Zadání: `docs/bankovni-modul-zadani-2026-10-04.md`. Větev
`finance-banka-napojeni`, založená z `main` @ `55142b5` (po sloučení
PR #106 — vzhled dashboardu). **Neslitá, nepushnutá, žádný zásah do
produkce ani do reálného bankovního účtu.**

## Hotovo / Částečně / Blokováno

| Co | Stav | Komentář |
|---|---|---|
| Audit existujícího kódu (faktury, platby, cashflow, RLS, integrace) | **Hotovo** | viz oddíl „Audit" níž |
| `BankDataProvider` kontrakt | **Hotovo** | `lib/bank-provider-contract.ts` — žádná změna párování/cashflow při přidání adaptéru |
| Fio banka adaptér (čtení zůstatků i pohybů) | **Hotovo** | `lib/integrace-fio.ts`, ověřeno proti FIO API BANKOVNICTVÍ v1.9 (16.10.2025), 24 testů bez sítě |
| Enable Banking adaptér (KB/ČSOB/ČS/Raiffeisenbank) | **Kostra** | `lib/integrace-enablebanking.ts` — bez `ENABLEBANKING_*` appka nikdy nezkouší zavolat ven; podpis JWT (krok 1 toku) vědomě nedokončen, nebylo by jak ho vyzkoušet |
| CSV import jako plnohodnotný adapter | **Hotovo** | existoval od P0 (`lib/finance-csv-import.ts`), teď formálně stejná cílová data (`RadekImportu`) jako Fio/Enable Banking |
| Zůstatky jako snapshoty (ne odvozené) | **Hotovo** | `bankovni_zustatky` — append-only, book/available zvlášť, vlastní `platny_k` |
| Bezpečná alokace plateb (souběh, přesah) | **Hotovo** | `app.potvrdit_alokaci_platby` — advisory zámek, kontrola proti částce platby i faktury; `app.zrusit_alokaci_platby` vratná s auditem |
| Zámek souběhu synchronizace | **Hotovo** | `synchronizace_behy`, partial unique index, auto-zotavení ze zaseknutého běhu |
| Detekce možných duplicit mezi zdroji | **Hotovo** (jen detekce) | `app.mozne_duplicity_transakci` — appka NESLUČUJE automaticky, řešení je existující storno (`transakce.storno_of`) |
| Naplánovaná synchronizace (cron) | **Hotovo** | `app/api/uloha/banka-synchronizace`, `.github/workflows/banka-synchronizace.yml`, každé 4 h |
| Manuální synchronizace (stejná cesta, stejný limit) | **Hotovo** | `app/[rozsah]/finance/integrace/banka/akce.ts` → stejná funkce jako cron |
| UI: připojit/odpojit/synchronizovat Fio účet | **Hotovo** (minimální) | `app/[rozsah]/finance/integrace/banka/` |
| UI: Enable Banking | **Blokováno** | čeká na `ENABLEBANKING_APPLICATION_ID`/`PRIVATE_KEY` (krok pro Šéfíka — self-serve, zdarma) |
| Oprava: částečná úhrada se dřív hlásila jako „Uhrazeno" | **Hotovo** | `platby/akce.ts`, `potvrditParovani` — nalezeno při stavbě RPC, opraveno |
| PGlite scénáře (nová entity) | **Hotovo** | `krok83_scenar.sql`, 13 kontrol; `krok74_scenar.sql` přepsaný na novou RPC, +18 kontrol; `krok84_scenar.sql` (4. 10., dotažení), 15 kontrol |
| UI: zrušit potvrzenou alokaci | **Hotovo** | `finance/platby/page.tsx` — sekce „Potvrzená párování" s tlačítkem, server akce `zrusitAlokaci` existovala, jen nebyla napojená |
| Node testy adaptérů (bez sítě) | **Hotovo** | `integrace-fio.test.mjs` (24), `integrace-enablebanking.test.mjs` (10) |
| Akceptační scénář #2 (částečná úhrada, opakovaný sync) | **Hotovo** | krok74, sekce 3 |
| Akceptační scénář #5 (API+CSV stejné pohyby, cizí duplicity nesloučeny) | **Hotovo** (detekce) | krok83, sekce 4 — slabý VS signál se NEPOUŽIJE, appka ho sama nikdy neslučuje |
| Akceptační scénář #6 (dva souběžné joby nepřiřadí dvakrát) | **Hotovo** | advisory zámek (alokace) + partial unique index (sync) — oba mechanismy ověřeny |
| Akceptační scénář #8 (CZK/EUR se nesčítá, booked≠available, historický import nevytvoří falešný aktuální zůstatek) | **Hotovo** (částečně) | `bankovni_zustatky.typ`/`mena`/`platny_k` to strukturálně umožňují; appka DOSUD nemá obrazovku, která by víc měn SEČETLA špatně (žádná appka-strana to nedělá), ale ani explicitní test na „appka to odmítne sečíst" nebyl napsán — zapsáno jako mezera |
| Akceptační scénáře #1, #3, #4, #7, #9, #10 | **Částečně/Blokováno** | viz oddíl „Co nebylo stihnuto" níž |
| Finbricks MULTIBANK | **Vyřazeno pro tenhle krok** | žádný self-serve přístup (viz `docs/hlaseni/banka-poskytovatele-2026-10-04.md`) |
| GoCardless Bank Account Data | **Vyřazeno** | nové registrace zastavené od 7/2025 |

## Audit — co appka zjistila o existujícím kódu

- **`invoices.status`** (DB Faktur, oddělený Supabase projekt) je
  prostý editovatelný text (`Uhrazeno`/`Neuhrazeno`/`Částečně uhrazeno`/…),
  NE odvozený od alokací — přesně ten anti-pattern, co zadání
  varuje. Appka ho dál píše best-effort (Faktury ho pro svoje vlastní
  filtry potřebují), ale od teď ho SAMA NEČTE jako zdroj pravdy — vlastní
  výpočet jde z `platby_faktury` (`app.potvrdit_alokaci_platby` vrací
  `plne_uhrazeno` vypočtené ze SUMY alokací, ne z cizího stringu).
- **`platby_faktury`** uměla od P0 insert `stav='navrzeno'` i
  `'potvrzeno'`, ale BEZ jakékoli kontroly součtu (žádný trigger, žádný
  check na agregát) — `potvrditParovani` navíc VŽDY zapisovala celou
  částku FAKTURY jako alokaci, bez ohledu na to, kolik platba skutečně
  nesla. Obojí opraveno (`app.potvrdit_alokaci_platby`).
- **`app.aktualni_zustatky_uctu`** (P0) je PŘESNĖ „součet všech
  stažených pohybů" — zadání tohle výslovně zakazuje jako JEDINÝ zdroj
  „aktuálního" zůstatku. Appka ho nerušila (pořád užitečný pro 13týdenní
  výhled, kde přesný aktuální zůstatek nehraje roli), ale NOVĖ existuje
  `bankovni_zustatky` jako samostatný, autoritativní zdroj toho, co
  appka ukazuje jako „zůstatek k [čas]".
- **`tenants`** nemá samostatný „právní subjekt" oddělený od tenanta
  (`ico`/`legal_name`/`dic` žijí přímo na `tenants`, komentář v P0
  migraci: „Rozhraní je zatím jednofiremní"). Appka proto `tenant_id`
  POUŽÍVÁ jako právní subjekt (1:1) — pokud bude někdy potřeba víc
  právních subjektů pod jedním tenantem, je to samostatná, větší
  změna, ne součást téhle práce.
- **RLS/druhá linie**: `integrace_pripojeni.branch_id` nemá druhou
  linii (vědomě přijato od P0 — mismatch neotvírá nic v cizí firmě).
  Nový `platebni_ucet_id` DRUHOU LINII MÁ (`trg_firma_integrace_pripojeni`)
  — mismatch by tam znamenal zápis transakcí cizí firmy do našeho
  účtu, skutečná integrita dat, ne jen RLS mezera.
- **Workery/cron**: existující vzor (`zapomenuty-odchod`) dělá „jedna
  RPC dělá všechno" — nejde použít přímo, protože synchronizace volá
  VNĖJŠÍ HTTP (Fio API), což Postgres sám neumí. Orchestrace proto
  žije v `lib/integrace-fio-sync.ts` (TS), RPC dělá jen zápis.

## Co appka NESTIHLA / vědomé mezery

- **Akceptační scénář #1** (dva klienti, stejné VS a externí ID —
  žádný únik): **Doplněno 4. 10. 2026** (`krok84_scenar.sql`, sekce
  1–2) — explicitní RLS SELECT test pro `bankovni_zustatky` a
  `synchronizace_behy` (cizí firma neuvidí řádek, i když zná jeho ID —
  dřív to krok83 testoval jen na úrovni druhé linie při INSERTu, ne
  SELECTu), a explicitní test, že stejný VS + stejné externí ID u DVOU
  firem na JEJICH VLASTNÍCH účtech nekoliduje (unikátní index je per
  `ucet_id`, ne globální) a appka mezi firmami možné duplicity ani
  nehledá.
- **Akceptační scénář #3** (dvě různé faktury s VS 123 a stejnou
  částkou → ruční kontrola): appka NEPSALA explicitní test ani kód,
  který by tohle rozlišil od „jasné shody" — `navrhnoutParovani`
  (existující z P0, `lib/finance-parovani.ts`) nebyl v téhle práci
  měněn, i když zadání popisuje přesnější pravidla (silné
  identifikátory, konflikt dvou kandidátů → jen návrh). Vyžaduje
  zásah do already-tested matching algoritmu, ne jen nové tabulky.
- **Akceptační scénář #4** (pending → faktura neuhrazená; booked
  aktualizace TÉŽE platby → jediný pohyb): Enable Banking rozlišuje
  pending/booked (appka IMPORTUJE jen `booked`), ale appka NEŘEŠÍ
  přechod pending→booked jako AKTUALIZACI existujícího řádku (zadání:
  „bez druhé transakce tam, kde jde prokazatelně o tutéž platbu") —
  dokud appka pending vůbec neimportuje, tenhle scénář je
  bezpředmětný, ale až bude Enable Banking funkční, bude potřeba
  dořešit.
- **Akceptační scénář #7** (jedna platba na dvě faktury, záloha a
  její zúčtování, přeplatek, dobropis, refund): **Část doplněna
  4. 10. 2026** (`krok84_scenar.sql`, sekce 3) — jedna transakce
  rozdělená na DVĖ různé faktury teď má explicitní test (dřív
  `krok74_scenar.sql` testoval jen opačný směr: jedna faktura, dvě
  platby/doplatek), včetně toho, že třetí alokace přesahující zbytek
  částky platby spadne. Zálohy/dobropisy/refundy appka POŘÁD nemá
  samostatně ověřené — `zakazky`/zálohy (z předchozí noci) existují
  nezávisle, propojení s touhle bezpečnou alokací zůstává neprověřené.
- **Akceptační scénář #9** (karetní prodej 10000 vs. settlement 9800,
  200 Kč poplatek doložitelný): appka TOHLE VŮBEC NEŘEŠILA — žádná
  logika, která by settlement z bankovního pohybu spojila s
  `pokladna_prodeje_denni` jako FINANCOVÁNÍ již evidované tržby (ne
  druhý výnos). Zapsáno jako čistá mezera, ne částečné řešení.
- **Akceptační scénář #10** (odvolaný souhlas, 429, chybějící
  stránka, restart workeru, nedostupný zůstatek): appka ošetřuje
  429 (Fio i Enable Banking vrací srozumitelnou hlášku), restart
  workeru (zámek `synchronizace_behy` se zotaví po timeoutu) —
  ale NEŘEŠÍ stránkování (appka natahuje jen 14denní okno, ne víc,
  takže appka se stránkováním ještě nesetkala) ani odvolaný souhlas
  (appka nemá mechanismus, který by PROAKTIVNĖ upozornil na blížící
  se/už odvolaný souhlas — `souhlas_platny_do` sloupec existuje, ale
  nic ho zatím nečte ani nehlásí).
- **`transaction_sources`** jako samostatná tabulka (zadání ji
  jmenuje) appka NEPOSTAVILA — `transakce.zdroj` + `externi_id` dělá
  podobnou práci (rozlišení původu, dedup v rámci zdroje), ale bez
  explicitní vazby mezi víc zdroji na JEDEN logický pohyb. Pro P0
  rozsah appka tohle vyhodnotila jako dostatečné (zadání: „Nevytváření
  nové názvy povinně, pokud již existuje ekvivalent") — mezera je v
  tom, že CROSS-SOURCE sloučení (po lidské kontrole možné duplicity)
  appka neumí zapsat jinak než stornem.
- **`reconciliation_suggestions`** appka taky nepostavila jako
  tabulku — návrhy párování se počítají ŽIVĖ (jako od P0), ne
  persistují. Souběh na úrovni ALOKACE je ošetřený (advisory zámek),
  ale souběh na úrovni DVOU LIDÍ dívajících se na STEJNÝ návrh (ne na
  alokaci) appka neřeší — druhý z nich prostě uvidí už provedenou
  alokaci při refreshi, ne race condition v datech.

## Požadavky na produkční onboarding (krok vlastníka, ne appky)

1. **Fio** — appka je hotová. Klient (majitel restaurace) si ve svém
   Fio internetovém bankovnictví vygeneruje token („Sledování účtu",
   NE platební příkazy), zadá ho v appce (Finance → Integrace →
   Banka). Appka ho ověří živě před uložením.
2. **Enable Banking** (KB/ČSOB/ČS/Raiffeisenbank) — Šéfík (FoodTab
   jako provozovatel, ne jednotliví klienti) si musí:
   a. Založit kontrolní panel na `enablebanking.com/sign-in`
      (e-mail, zdarma, bez smlouvy).
   b. Vytvořit API aplikaci (sandbox), stáhnout soukromý klíč.
   c. Zapsat `ENABLEBANKING_APPLICATION_ID`/`ENABLEBANKING_PRIVATE_KEY`
      do prostředí appky (Vercel).
   d. Appka DOPÍŠE podpis JWT a propojí ho s UI — zbývající
      engineering krok, teprve POTOM mají jednotliví klienti co
      používat.
   e. Pro VEŘEJNÉ zpřístupnění klientům (ne jen Šéfíkovo vlastní
      testování) bude pravděpodobně potřeba podepsaná smlouva +
      KYB u Enable Banking — appka tohle NEPODEPISUJE ani
      nezjednává, to je krok vlastníka.
3. **MONETA Money Bank** — appka ani Enable Banking ji nepodporují.
   Pokud bude potřeba, další krok je Finbricks (obchodní jednání,
   viz `docs/hlaseni/banka-poskytovatele-2026-10-04.md`) — appka to
   nezačíná sama, dokud o to vlastník výslovně nepožádá.
4. **CRON_SECRET**/`APP_URL` GitHub Secrets — appka PŘEDPOKLÁDÁ, že
   už existují (zapomenuty-odchod je stejně nastavený); pokud ne,
   `banka-synchronizace.yml` to ohlásí jasnou chybou, ne tichým
   selháním.

## Ověření

- `npx tsc --noEmit` — čisté.
- `npx eslint .` — 0 chyb, 9 varování (všechna předcházející, nesouvisí).
- `node scripts/provoz-granty.test.mjs` — čisté, nové tabulky
  (`bankovni_zustatky`, `synchronizace_behy`) mají revoke-před-grant.
- `node scripts/scenare-pglite.mjs` — viz číslo v samostatném hlášení
  (běželo na pozadí při psaní tohohle dokumentu).
- Node testy adaptérů bez sítě: `integrace-fio.test.mjs` (24 kontrol),
  `integrace-enablebanking.test.mjs` (10 kontrol) — vyžadují
  `--conditions=react-server` (`import 'server-only'`), ve CI
  zařazeny do `VYNECHANE` ze stejného důvodu jako `marketing-ai`.
- **Žádné volání na reálnou banku appka neudělala** — Fio API nemá
  sandbox (ověřeno v dokumentaci), appka ho proto NEMOHLA vyzkoušet
  proti živému účtu. Adaptér je hotový a testovaný na úrovni
  parsování/chybových kódů, ne na úrovni „opravdu to funguje proti
  Fio serveru" — to musí ověřit Šéfík nebo klient s reálným tokenem.
