# Audit: Finance/Faktury, Marketing, gastro ERP — 2. 10. 2026

Zpracováno na začátku práce na nočním zadání `docs/Foodtab_Claude_Code_nocni_zadani.md`,
podle jeho oddílu 3 ("Nejprve skutečný audit"). Provedeno čtením kódu a migrací
(7 nezávislých průchodů), bez přístupu k produkční databázi (Supabase MCP
nemá připojený projekt). Kde není uvedeno jinak, je řádek **ověřený čtením
souboru**; řádky označené „PŘEDPOKLAD" nebyly ověřeny až na dno.

## Nejdůležitější zjištění (shrnutí pro rozhodování)

1. **Faktury jsou v úplně jiné Supabase databázi** (`ctqtwahlzhyjerqulqyn`) než
   zbytek appky (`spekntcsuroqhehmjssv`), **bez sloupce `tenant_id` a bez RLS
   podle firmy** — RLS je dnes „allow all" s anon klíčem. Jediná obrana je
   FoodTabí `faktury.read/manage` (kdo smí otevřít obrazovku), ne RLS nad
   daty. Dnes to nevadí (jedna firma), ale **druhý zákazník s modulem Finance
   by viděl stejné faktury jako první**. → P0, blokuje prodej modulu Finance.
2. **Sklad, katalog surovin a foodcost/beverage cost neexistují vůbec** — ani
   jedna tabulka. Receptury (`recipes`/`recipe_ingredients`) existují s RLS,
   ale `cost_haleru` je prázdné pole s komentářem „naplní se z modulu
   Objednávky, až bude". Modul `menu` je stub („Připravujeme"). → P0/P1.
3. **Cross-tenant eskalace oprávnění byla v produkci 17 dní** (8.–25. 9. 2026),
   opravena migrací `20260925120000_prava_firma_radku.sql` (dvě linie obrany +
   regresní test `krok58_scenar.sql` proti reálnému PostgreSQL). Hloubkový
   sken 115 aktuálně platných SECURITY DEFINER funkcí (checklisty, docházka,
   zálohy, marketing, pozvánky, realtime, přílohy, konverzace) **nenašel další
   vykořistitelnou díru stejného typu**. Zbývá ~121 starších funkcí
   neprověřených tímto behem (doporučeno: `20260901170000_zarizeni_pobocky.sql`
   — výdej klíčů kiosků, anon-dosažitelné; `mzdy_vypocet.sql`). Dva křehké (dnes
   bezpečné) vzory k zapsání jako regresní test: `app.zapsat_potvrzeni_zalohy`/
   `app.zrusit_vyzvu_k_zaloze` a `app.upravit_usek_dochazky`/
   `app.stornovat_usek_dochazky` — bezpečné jen díky tomu, že VŠICHNI dnešní
   volající si tenant ověří sami, ne díky filtru v těle funkce samotné.
4. **Produkce má dnes jednu firmu a UI nemá přepínač firem** —
   `lib/firma.ts:17-21` bere „první firmu, kterou vrátila databáze". Architektura
   je prokazatelně multi-tenant (desítky testů s reálnou druhou firmou v CI
   proti PostgreSQL), ale produktově to na dva zákazníky najednou nejde použít.
5. **Marketing má hotovou a otestovanou publikační frontu** (persistentní queue,
   GitHub Actions cron, `SKIP LOCKED`, idempotence, retry) — ale reálná cesta
   ven (n8n) je dnes **vypnutá** kvůli kolizi se starým workflow. Byznysově
   dnes nic nepublikuje automaticky, i když kód je hotový.
6. **Dotykačka POS, banka, Google Business, Metricool/Windsor.ai/Canva/Choice QR
   — nic z toho není napojené ani zárodečně.** Jediné reálně fungující externí
   integrace: Resend (e-mail pozvánek), n8n (marketingový webhook, dnes vypnutý),
   Anthropic Claude (AI návrhy), MET Norsko (počasí), Supabase Storage, Web Push.
7. **Obecný "provider registry" vzor neexistuje.** Nejblíž je
   `lib/marketing-katalog.ts` (katalog metadat + capability flags `podporovany/
   umi/neumi` — brání falešné integraci), ale skutečné odesílání je zadrátované
   if/else podle klíče poskytovatele, ne pluggable rozhraní.
8. **"Pravidlo 8" (mzdy/docházka/kontakty/zálohy nikdy do LLM) je dodrženo a
   vynuceno automatizovaným testem nad zdrojovým textem** (ne jen komentářem)
   u `marketing-ai.ts` a `marketing-profil-ai.ts`. `marketing-menu-ai.ts` nemá
   stejnou strážní kontrolu zatím (dnes bezpečné, chybí jen pojistka).
9. **Nedávno dodaný AI nástroj "Najít značku na webu"** (PR #96/#97) je funkční,
   bezpečnostně nadstandardní (SSRF s DNS-rebinding ochranou, doménový
   allowlist, explicitní obrana proti prompt injection) a jeho test byl
   spuštěn živě — všech ~45 kontrol prošlo.

---

## 1. Finance / Faktury

| Oblast | Implementace (cesta:řádek) | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Katalog modulu | `lib/authz.ts:77-80,91-96,106`; `supabase/migrations/20260915100000_modul_faktury.sql` | Reálné, nasazené | Aktivace modulu per-tenant nemá UI, dělá se ručním SQL insertem do `tenant_modules` | P2 |
| Přehled, Seznam, Dodavatelé, Kalendář splatností, Přehledy+export, Upomínky, Ke schválení, Nová | `app/[rozsah]/finance/faktury/{page,seznam,dodavatele,kalendar,prehledy,upominky,schvaleni,nova}/*` | Reálné, 8 obrazovek funkčních, konzistentní auth gate (`faktury.read`/`faktury.manage`) | Ruční zadání faktury validuje jen dodavatele+částku; IČO/číslo faktury/VS/účet nejsou validované | P2 |
| Server akce (9×) | `app/[rozsah]/finance/faktury/akce.ts:1-339` | Reálné, `faktury.manage` vynucené přes `app.has_access` | — | — |
| CSV export | `app/api/faktury/export/route.ts` | Reálné | — | — |
| **DB `invoices` — umístění a izolace** | `lib/supabase/faktury.ts`, `lib/faktury-types.ts` | **Samostatný Supabase projekt `ctqtwahlzhyjerqulqyn`**, žádný `tenant_id`, RLS „allow all" s anon klíčem, globální připojení přes env | **Žádná izolace zákazníků na úrovni dat** — jediná obrana je FoodTabí oprávnění na obrazovku | **P0** |
| Bankovnictví (`banking.read`) | katalog oprávnění, nikde nepoužito | Rezervováno, nic nestaveno | Celé napojení chybí (očekávaně) | — |
| Joby vázané na fakturaci | žádný z 6 cronů se netýká financí | Příjem nových faktur běží mimo repo (externí n8n, IMAP trigger) | n8n trigger je podle handoff dokumentu „nikdy nezapínat" (opakované OOM pády) — nejisté, zda dnes něco nové faktury přidává | provozní otázka na Šéfíka |
| Procure-to-pay | příjem (ruční i n8n), fronta ke schválení, textový stav úhrady, ruční upomínky | Částečné | Chybí: objednávka dodavateli, příjem zboží/sklad, tabulka plateb/transakcí, přiřazení platby k faktuře, bankovní import | P1 (platby/rekonciliace), P2 (PO/příjem zboží) |
| Tržby/cashflow pohled | — | Neexistuje pod `/finance/` | Jen `faktury/`, žádný spojený příjmy-vs-náklady pohled | P2 |

## 2. Marketing

| Oblast | Implementace | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Obsahový kalendář | `app/[rozsah]/marketing/kalendar/*`, `lib/marketing-kalendar.ts` | Reálné | Drag&drop vědomě chybí | P2 |
| Mediální knihovna | `lib/marketing-media.ts`, `marketing/media/*` | Reálné, dedup, signed URL, `kandidat_znacky` kanál pro AI loga | — | — |
| Šablony | `lib/marketing-sablony.ts` (~40 šablon) | Reálné | Žádný SVG→PNG/video renderer napojený | P1 |
| Schvalovací workflow | `marketing/akce.ts:259,309,343` + DB spoušť `app.marketing_strez_rozhodnuti` | Reálné end-to-end, vynuceno v DB (ne jen UI) | — | — |
| OAuth Instagram/Facebook | `lib/marketing-katalog.ts:281` | **Chybí** — jen deklarace `podporovany:false`; publikování jde přes cizí n8n token | Vlastní OAuth z Foodtabu neexistuje | P1 |
| Google Business | — | **Zcela chybí** | Nic | P2/P3 |
| Token/expirace/reconnect | sloupce v `marketing_pripojeni` existují | Nenaplněné — bez OAuth se nic nenastavuje | Celý životní cyklus tokenu chybí | P1 |
| Plánovaná fronta publikací | `app/api/uloha/marketing-fronta/*`, RPC `marketing_vyzvednout_publikace`, cron 15 min | **Technicky hotové** (persistentní, idempotence, retry, `SKIP LOCKED`) | Reálná cesta ven (n8n) je **vypnutá** — dnes nic nepublikuje automaticky | **P0 (byznysově)** |
| Automatizace (denní/víkendové menu) | `app/api/uloha/marketing-automatizace/*` | Reálné, generuje jen koncepty | `evergreen` typ je jen název bez logiky | P2 |
| Marketingové CRM (hosté/segmenty/GDPR) | — | **Zcela chybí** | Žádný zárodek | P1 |
| UTM/krátké odkazy | `lib/marketing-odkazy.ts`, `/k/<klíč>` | Reálné, bezpečné, testováno | — | — |
| Odhad vs. doložené číslo | `marketing_metriky.zdroj` | Rozlišeno správně v schématu i UI | Prakticky skoro vše je dnes `vlastni` (proklik), síťová čísla chybí (účty nepřipojené) | — |
| Kupóny/ROAS | — | **Zcela chybí** | Žádná vazba na objednávky/tržby | P2/P3 |
| „Najít značku na webu" (AI) | `lib/marketing-profil-ai.ts`, `marketing-ssrf.ts`, `znacka/akce-ai.ts` | Funkční, bezpečné, otestováno živě | — | — |

## 3. Docházka / směny / zaměstnanci

| Oblast | Implementace | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Plán vs. skutečná docházka | `shifts` vs `attendance_events`, `app.worked_minutes` | Hotovo, oddělené od počátku | — | — |
| Historická sazba | `employee_rates` (jen insert, `valid_from`), `app.rate_at` | Hotovo, nezaměnitelné s aktuální sazbou | — | — |
| Příplatky (noc/víkend/svátek) | — | **Neimplementováno**, výslovně odloženo komentářem v migraci | Chybí pro skutečný mzdový/controllingový výpočet | **P1** |
| Náklady podle místa práce (více poboček) | `vydelky_prehled`/`vydelky_po_dnech` | Hodiny se vždy připíšou DOMOVSKÉ pobočce, ne místu práce | Autor sám označil jako otevřenou otázku pro Šéfíka | P1 (pokud controlling potřebuje náklady podle místa) |
| Práce pro dvě firmy téhož člověka | `employees` `unique(tenant_id,user_id)` | Architektonicky oddělené | Žádný konsolidovaný pohled napříč firmami (pravděpodobně záměrně) | P2 |
| RLS/granty nad sazbami | `employee_rates` revoke all + RLS | Dvě linie obrany | — | — |
| Citlivost `payroll.*` oprávnění | `sensitive=true`, šablona „provozní" bez nich | Ošetřeno proti tiché regresi | — | — |
| Pravidlo 8 vynucené testem | `scripts/marketing-ai.test.mjs`, `marketing-profil-ai.test.mjs` | Hlídáno automatizovaně u 2 ze 3 AI souborů | `marketing-menu-ai.ts` nemá stejnou strážní kontrolu | P2 |
| Prime cost (náklady práce) | `vydelky_po_dnech`, `vydelky_prehled` | **Polovina hotová** (náklady práce) | Druhá polovina (tržby/COGS) neexistuje — modul Finance ji nemá | P1/P2 |

## 4. Receptury / sklad / foodcost

| Oblast | Implementace | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Suroviny (master katalog) | — | **Neexistuje** — `recipe_ingredients.name` je volný text | Nelze sjednotit surovinu napříč recepturami ani vázat na nákup | P1 |
| Nákupní balení/jednotky/převody | — | **Neexistuje** | Nejde spočítat cenu na recepturovou jednotku | P1 |
| Receptury s porcemi/výtěžností/verzemi | `recipes`, `recipe_ingredients` | Částečné — jen počet porcí, RLS hotové | Žádná výtěžnost, ztráty, verze, účinnost od data | P1 |
| Vazba na nákupní ceny | `recipe_ingredients.cost_haleru` | Prázdné pole, nic ho neplní | Navíc faktury jsou v jiné databázi (viz výš) | **P0** (pokud má foodcost být skutečný) |
| Sklad (pohyby/inventury/příjemky/výdejky) | — | **Zcela neexistuje** — jen 2 jména oprávnění bez tabulek | Celá oblast | **P0** |
| Foodcost/beverage cost/marže na porci | — | **Žádný výpočet** nikde | Důsledek chybějících tří oblastí výše | **P0** |
| Menu jako jednotný zdroj ↔ marketing | `marketing_menu*` (vlastní, funkční OCR/text import) vs. `menus.*` (prázdná dílna) | Dvě oddělené evidence, vědomě/zdokumentovaně | Žádné sdílení dat; `zdroj='foodtab'` připravené, nepoužívané | P2 (dokud `menus.*` nemá UI) |
| UI pro Tvorbu menu | `app/[rozsah]/menu/page.tsx` | **Stub** („Připravujeme") | Žádný CRUD nad recepturami/menu | P1 |

## 5. Multi-tenant izolace a oprávnění

| Oblast | Implementace | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Tenant/pobočka model | `20260823120000_foundation.sql:27-65` | Hotovo, odpovídá dokumentaci | — | — |
| Odvození identity na serveru | `lib/firma.ts`, `lib/authz.ts:224-265`, RPC `my_tenants`/`my_context` | Hotovo — server nikdy nevěří klientskému tenant_id | — | — |
| Cross-tenant RLS testy | `krok2`, `krok58` + 15 dalších scénářů | Běží na reálném PostgreSQL 16 v CI, zeleně | Jen v CI — žádná pravidelná kontrola nad produkční DB | P2 |
| Multi-tenant produkce vs. UI | `lib/firma.ts:17-21` | Architektura ano, **produkce 1 firma, žádný přepínač firem v UI** | Blokuje prodej druhému zákazníkovi | **P1** |
| SECURITY DEFINER — eskalace práv (historická) | `20260925120000_prava_firma_radku.sql` | **Byla v produkci 17 dní (8.–25.9.), OPRAVENO** dvěma liniemi + test `krok58` | Potvrzeno 3. výskyt stejné třídy chyby v projektu | zdokumentováno, hlídat recidivu |
| SECURITY DEFINER — 115 aktuálně platných funkcí | checklisty, docházka, zálohy, marketing, pozvánky, realtime, přílohy, konverzace | **Žádná další díra nenalezena** (hloubkový sken) | ~121 starších funkcí neprověřeno tímto během — doporučeno `zarizeni_pobocky.sql`, `mzdy_vypocet.sql` | P2 |
| Křehké (dnes bezpečné) vzory | `app.zapsat_potvrzeni_zalohy`/`zrusit_vyzvu_k_zaloze`, `app.upravit_usek_dochazky`/`stornovat_usek_dochazky` | Bezpečné jen díky tomu, že všichni dnešní volající ověří tenant sami, ne filtr v těle | Čtvrtý volající bez kontroly = okamžitá díra | **P1** — přidat filtr do těla + regresní test |
| Provider adapter (obecně) | — | **Neexistuje** | POS/banka jen v zadání, nic v kódu | P2 |
| Provider katalog (jen marketing) | `lib/marketing-katalog.ts`, `marketing-spojeni.ts` | Existuje, ale specifické jen pro marketing | Není obecný framework pro POS/banku/mailbox | P1 |
| Tajemství per-tenant (marketing) | `marketing_tajemstvi`, `lib/marketing-klice.ts` | Hotovo, AES-256-GCM, bez grantu/auditu šifry | Jeden globální master klíč pro šifrování (standardní, ne kritické) | P2 |
| Tajemství globální (AI, e-mail) | `ANTHROPIC_API_KEY`, `RESEND_API_KEY` | V pořádku (Foodtabí vlastní účet) | Chybí infrastruktura pro budoucí zákaznické POS/bank klíče mimo marketing | P1 (až přijde druhý modul) |
| Sloupcový grant `employees.zalohy_pozastaveny` | přidán `20260902040000`, grant chybí dodnes | Latentní past — nic ho dnes nečte | První select na něj spadne `42501` | P2 |
| Zastaralá dokumentace skillů | `foodtab-db-security`, `foodtab-e2e` tvrdí, že granty TRUNCATE/REFERENCES jsou otevřené | **Opraveno** `20260917000000_granty_provoz_uklid.sql`, hlídáno testem | Skilly nejsou aktualizované, matou příští relaci | P2 (oprava dokumentace) |

## 6. Background joby a integrace

| Oblast | Implementace | Stav | Mezera | Priorita |
|---|---|---|---|---|
| Cron joby (6×) | `app/api/uloha/*` + `.github/workflows/*.yml`, auth přes `CRON_SECRET` (constant-time) | Funkční, konzistentní vzor | Jen přesnost GH Actions schedulingu (best-effort) | P2 |
| Resend (e-mail) | `lib/email.ts:41-58` | Funkční, jen pozvánky | Marketingová e-mailová upozornění nenapojená | P2 |
| n8n (IG/FB publikování) | `lib/marketing-n8n.ts` | Funkční kód, **provozně vypnuté** | Jen Instagram/Facebook, chybí cesta ven jinudy | P1 |
| Dotykačka POS | — | **Neexistuje** (jen zmínka v zadání) | Celý adaptér | P1 (dle zadání) |
| Metricool/Windsor.ai/Canva/Choice QR | — | **Neexistuje** nikde | — | — |
| Provider registry (pluggable) | `lib/marketing-katalog.ts` je jen katalog metadat; odesílání je if/else | Funguje pro 1 adaptér (n8n) | Chybí skutečné rozhraní pro N adaptérů stejné kategorie | P1 |
| Realtime kanály | `lib/supabase/zive.ts`, `ZivaAktualizace.tsx`, `zivy-checklist.tsx` | Funkční po opravě PR #92 | Produkční ověření `claims_role` po nasazení (nelze ověřit auditem) | P0 (ověření v produkci), jinak hotovo |
| OAuth (token storage/refresh/revoke) 3. stran | — | **Neexistuje** nikde | Dnešní šifrování statických klíčů jde znovupoužít jako základ, ale refresh/revoke chybí | P2 |

---

## Priority souhrn pro plánování (P0 → P1 → P2)

**P0 — bez tohoto nejde prodat/bezpečně rozšířit:**
- Izolace dat faktur (samostatná DB bez tenant_id/RLS)
- Sklad + katalog surovin + vazba na nákupní ceny + foodcost výpočet (celá oblast neexistuje)
- Ověřit v produkci, že Realtime kanály jedou jako `authenticated`, ne `anon` (PR #92)
- Publikační fronta marketingu reálně nic nepublikuje (n8n vypnuté) — byznysový P0, ne bezpečnostní

**P1 — potřeba brzy, než přibude druhý zákazník nebo druhý adaptér:**
- UI přepínač firem (produkce dnes bere „první firmu")
- Provider registry pattern (dnes if/else podle klíče) — než přibude druhý skutečný adaptér (Dotykačka)
- Dotykačka POS adaptér
- Dva křehké SECURITY DEFINER vzory (zálohy, docházka) — přidat filtr do těla + regresní test
- Příplatky ve mzdách; náklady podle místa práce (ne domovské pobočky)
- Procure-to-pay: tabulka plateb/transakcí, přiřazení platby k faktuře
- Marketingové CRM/segmenty/GDPR souhlasy
- OAuth Instagram/Facebook z Foodtabu (dnes jen přes cizí n8n token)
- Renderer šablon (SVG→PNG/video)
- UI pro Tvorbu menu/receptur (dnes stub)

**P2/P3 — později:**
- Google Business, ROAS/kupóny, evergreen automatizace, drag&drop kalendář
- Oprava zastaralé dokumentace skillů (`foodtab-db-security`, `foodtab-e2e`, `foodtab-finance`)
- Chybějící sloupcový grant `employees.zalohy_pozastaveny`
- Konsolidovaný pohled na náklady člověka napříč firmami

## Co tento audit neověřil (mimo dosah statického čtení kódu)

- Skutečný počet tenantů v produkční databázi (Supabase MCP nemá připojený projekt).
- Hodnoty produkčních proměnných prostředí (N8N_MARKETING_URL, CRON_SECRET, API klíče) na Vercelu/GitHub Secrets.
- RLS politiku `invoices` v cizí databázi přímým dotazem (přebráno z `docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md`).
- Zbývajících ~121 starších SECURITY DEFINER funkcí tělo-po-těle (vzorek prověřen, doporučeny 2 konkrétní soubory k doplnění).
- Obsah `supabase/tests/*.sql` scénářů proti reálnému PostgreSQL (vyžaduje běžící DB) — spuštěn jen reprezentativní vzorek `.test.mjs` skriptů.
