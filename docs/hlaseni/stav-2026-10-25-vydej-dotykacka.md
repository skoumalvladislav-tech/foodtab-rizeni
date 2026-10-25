# Stav k 25. 10. 2026 — výdej ze skladu v Dotykačce u Jiných plateb: průzkum, návrh a příprava (zápis vypnutý)

## Nejdřív to podstatné

- **Do Dotykačky se nic nezapisuje.** Zápis je připravený celý, ale v kódu
  vypnutý prázdným seznamem provozoven (`ZAPIS_VYDEJE_DOTYKACKA`). Zapnout
  ho jde jen změnou kódu po zkoušce na testovacím cloudu a po vašem
  výslovném pokynu (otázka 54).
- **Doporučený způsob zápisu: POS akce s Odpisem** — totéž, co dnes dělá
  obsluha ručně. Jde dohledat podle klíče appky, takže appka vždycky pozná,
  jestli se výdej provedl, a nikdy neodečte dvakrát. Přímý výdej ze skladu
  (`warehouses/…/sales`) se dohledat nedá, proto ho nedoporučuji
  (otázka 71).
- **AI položky jen navrhuje.** Nové tlačítko „Najít produkty v pokladně
  (AI)“ v panelu Sklad. AI vybírá jen z kandidátů, které jí appka nabídne
  z katalogu pokladny. Každý návrh jde ke kontrole a potvrzuje ho člověk.
  Do AI nejdou ceny ani jména.
- **Návrh:** `docs/jine-platby-vydej-dotykacka.md` (s odkazy do
  dokumentace Dotykačky). **PR:** viz níž. Migrace
  `20261025230000_jine_platby_vydej_dotykacka.sql` **bez db push**.

## Co je hotové

| Co | Kde | db push |
|---|---|---|
| Průzkum dokumentace Dotykačky (API 2026.39.0): POS akce, přímý výdej, naskladnění s korekcí, inventura, manifest, receptury, oprávnění, ověření | `docs/jine-platby-vydej-dotykacka.md`, oddíl 1 | — |
| Přiřazení položek přes AI (kandidáti z katalogu, jen návrh ke kontrole, strop 10 na doklad a 100 na firmu denně) | `lib/jine-platby-ai-parovani*.ts`, `akce-parovani.ts`, `sekce-sklad.tsx` | ano (tabulka pokusů) |
| Receptury z katalogu Dotykačky a varování jménem, když je surovina pokrmu ve výdeji ještě zvlášť | `lib/pokladna-dotykacka-sklad.ts`, `pos_katalog.suroviny`, `app.jp_sestavit_vydej` | ano |
| Provozovna u pokladny připojené k pobočce (dřív by výdej neměl kam jít) | `pos_operace_zahajit`, `app.jp_provozovna_vydeje` | ano |
| Kontrola nastavení provozovny před odesláním (licence POS akcí, odečet skladu zapnutý) | `odeslatVydejDotykacka` | — |
| Po zápisu porovnání položek účtu v pokladně s výdejem | `porovnatPolozkyVydeje` | — |
| Vypínač v kódu (zápis i schopnost „api“ jen pro provozovnu ze seznamu) | `lib/pokladna-dotykacka-zapis.ts` | — |
| Otázky 71–75, doplněná 54 | `docs/hlaseni/otazky.md` | — |

## Čísla — a z čeho jsou

- `scripts/jine-platby-ai-parovani.test.mjs` (nový): **58 kontrol** — jádro
  přiřazení, serverová akce s podvrženou databází i AI, vykreslený panel
  Sklad.
- `scripts/jine-platby-pos-operace.test.mjs`: **100** (bylo 73).
- `scripts/jine-platby-detail.test.mjs`: **663** (po převzetí main).
- `scripts/pokladna-dotykacka-sklad.test.mjs`: prošel celý (receptury,
  manifest, povolené provozovny, zapnutý zápis jen v testu).
- `jine-platby`, `jine-platby-ai`, `jine-platby-obrazovka`,
  `jine-platby-kiosek`, `pokladna-dotykacka`, `pokladna-napojeni`,
  `pokladna-trzby`: prošly. `tsc` a `eslint` čisté.
- Scénář **krok103** nad PGlite: **39 kontrol**. Celý řetěz PGlite:
  **4073 kontrol**, krok98 (Jiné platby) 255. **Spadl krok101** (zálohy
  z main, PR #156) — padá stejně i na čistém main `d58f1e0`, s touhle prací
  nesouvisí.
- PGlite **neověří RLS ani sloupcové granty** (běží jako superuživatel).
  Rozhoduje workflow Databáze proti PostgreSQL na PR.
- **Schválná rozbití:** 17 v TypeScriptu, 3 podmínky tlačítka a 16 v SQL
  (filtry firmy, odpojení a pobočky pokladny, „právě jedna provozovna“,
  změna provozovny, odvození receptury, obě varování, otisk, oba stropy,
  zamčený výdej…). Každé spadlo na své kontrole. Varování jsem rozbil třemi
  způsoby, protože jedno z nich chytila dřívější kontrola zA, která hlídá
  i obecné varování. Kontrolu „záznam jiné pobočky u pokladny pobočky“ jsem
  musel nejdřív opravit — v první podobě by prošla i bez filtru.

## Nezávislá kontrola (25. 10.)

Jeden kontrolor nad celým diffem: **0 kritických, 0 vysokých**, cestu
k zápisu ani k dvojímu odečtu nenašel. 2 střední a 3 nízké nálezy, všechny
platné:

| Nález | Co jsem udělal |
|---|---|
| Režim odečtu `orderPark` by prošel, ale POS akce účet nezaparkuje → „Odečteno v POS“ bez odečtu | opraveno: jen `documentIssue` |
| Konkrétní varování nahrazovalo obecné „pokrm i kusové zboží“ — při starém opisu receptury by se surovina odečetla dvakrát bez potvrzení | opraveno: obecné zůstává vždy, konkrétní přibývá |
| Řádek účtu navíc s nečitelným množstvím se hlásil jako „navíc 0“ | opraveno: nejasný výsledek |
| Načtení katalogu bez receptur (403) bylo tiché | opraveno: hláška to řekne |
| Obrazovka bere schopnost zápisu z adaptéru, ne z provozovny | dnes se neprojeví (seznam je prázdný); zapsáno jako povinná součást zapnutí (`lib/pokladna-dotykacka-zapis.ts`, návrh oddíl 6) |

## Co čeká na Šéfíka

1. Projít návrh a otázky **71–75** (hlavně 71: způsob zápisu).
2. Založit **testovací cloud** Dotykačky s licencí z 12. 10. (otázka 73).
3. Až test projde: pokyn „zapni zápis do Dotykačky pro provozovnu …“.
4. Sloučení a db push jen na vaše „sluč N“.

## Otázky

V `docs/hlaseni/otazky.md`: 54 (doplněná), 71 způsob zápisu, 72 převod
množství podle názvu produktu, 73 testovací cloud a práva aplikace, 74 pod
jakým uživatelem pokladny se odpis zapíše, 75 kdy a kolik přiřazení přes AI.

## Na co jsem narazil a nešlo to

- **Živě nic neběželo.** Ani proti testovacímu, ani proti ostrému cloudu.
  Všechno o zápisu je ověřené jen na podvržených odpovědích podle
  dokumentace. Testovací cloud neexistuje a účty nezakládám.
- **Dokumentace si odporuje** v tom, co vrátí POS akce: úvod říká „200
  s prázdným tělem“, reference „tělo s odpovědí webhooku“. Appka bere obojí
  jako „odesláno, ověří se dohledáním“.
- **`idempotency-key` u POS akce nechrání před dvojím provedením** (jen
  označuje volání webhooku). Ochranou zůstává externí ID účtu a pravidlo
  „nejasné se jen dohledává“.
- **Objem kusu** (pivo 0,5 l) Dotykačka v doložitelném poli neposílá.
  Pole `packagingMeasurement` / `unitMeasurement` by mohla, ale dokumentace
  to neříká — ověří se na testovacím cloudu (otázka 72).
- **Pomocník SDK přesouvá výčet (`enum`) ze schématu do popisu**, takže ho
  API nevymáhá. Jistotu AI proto appka převádí sama a neznámé slovo bere
  jako „nízkou“, místo aby kvůli němu zahodila celou odpověď.
- **Při psaní scénáře** jsem zjistil, že pokrm bez receptury a bez odečtu
  ze skladu z výdeje vypadne (tak to databáze má od 16. 10.). S recepturami
  z katalogu to začne platit doopravdy. Proto „bez receptury“ appka
  zapíše jen z prázdného seznamu surovin, nikdy z chybějícího údaje.
- **Razítko migrace:** původně 20261025100000, ale stejné razítko mezitím
  dostala migrace záloh v main (#156). Přerazítkováno na 20261025230000,
  scénář přečíslován na krok103 (krok101 je v main, krok102 si nejspíš
  vezme přečíslovaná #153).
- **Obrazovku jsem neviděl v prohlížeči.** Panel Sklad je ověřený
  vykreslením komponenty do HTML (tlačítko, formulář, kdy se nezobrazí),
  ne snímkem obrazovky.

## Kde jsem skončil a co zbývá

- Hotová fáze 1 (průzkum a návrh) i fáze 2 (implementace za vypnutým
  přepínačem). Zápis do Dotykačky zůstává vypnutý.
- Zbývá: testovací cloud a oddíl 6 návrhu, pak vaše rozhodnutí.

## Nenasazoval jsem

Nic jsem neslučoval ani nespouštěl db push. Do Dotykačky (ostré ani
testovací) jsem nic neposlal.
