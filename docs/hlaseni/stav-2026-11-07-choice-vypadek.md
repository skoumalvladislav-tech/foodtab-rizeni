# Stav k 7.–10. 11. 2026 — výpadek napojení Choice: upozornění a opakovaný test (10. 11. sloučeno a nasazeno)

## Nejdřív to podstatné

- **Proč:** 3. 11. v 19:41 Choice jedinkrát odmítl přístup (403). Obě
  napojení (Bernard Bar i Černá Perla) se tím přepnula na „vyžaduje
  pozornost“ a úloha je od té doby přeskakovala. Čtyři dny se nenačetla
  jediná rezervace a **nikdo o tom nevěděl**.
- **Hotovo v PR #178 — 10. 11. sloučená a nasazená** (`8f4b16b`,
  migrace `20261108100000`, podrobně oddíl „Nasazení 10. 11.“ na konci):
  1. **Upozornění, když napojení spadne.** Když napojení Choice přejde
     z „připojeno“ na „vyžaduje pozornost“, přijde **jedno** upozornění
     „Choice nenačítá rezervace — Bernard Bar Tábor“ majiteli a každému,
     kdo má na té pobočce právo spravovat napojení (`integrace.manage`).
     Ne při každém běhu: další běhy, změna textu chyby ani přechod na
     „chyba“ a zpátky nic nového nepošlou. Klepnutí vede rovnou na
     Rezervace → Napojení té pobočky, kde je „Ověřit znovu“. Když se
     napojení spraví, nepřečtené upozornění se nahradí tichým „Choice
     zase načítá rezervace“ (bez zvonění). Po odpojení napojení se
     nepřečtené upozornění stáhne.
  2. **Jediná 403 už nezastaví načítání napořád.** Napojení, které
     stojí, zkusí Foodtab sám znovu **jednou za 2 hodiny** — tentýž
     dotaz jako „Ověřit znovu“ (jen čte, do Choice nic nepíše), přes
     společnou frontu dotazů (limit Choice 1 dotaz / 5 s). Když projde,
     napojení je zase „připojeno“ a **načte se hned v tomtéž běhu**.
     Když ne, stav zůstane a zkusí se za 2 hodiny.
- **Nasazeno 10. 11. 2026** na pokyn „sluč 178 a db push“: sloučeno
  ve 22:39. První pokus Vercelu postavit novou verzi aplikace
  **selhal** na chybě u písma z Google Fonts v souboru, který tato PR
  nemění. Ostrá aplikace mezitím běžela dál na předchozí verzi a nic
  nevypadlo. Druhý pokus s týmž kódem prošel ve 23:01,
  `db push` ve 23:03. Ověřeno čtecím dotazem a prvním během úlohy
  ve 23:11 — obě pobočky bez chyby. Pořadí kód → migrace dodržené.
- **Napojení, která stála od 3. 11., už v době nasazení nestála:**
  poslední test napojení u obou poboček prošel 7. 11. v 17:21 (Bernard
  Bar) a 17:26 (Černá Perla), nejspíš přes „Ověřit znovu“. Od té doby
  se rezervace zase načítají.
  Opakovaný test i upozornění na výpadek proto **zatím naostro neběžely**
  — ukážou se, až Choice příště odmítne přístup.
- **Kdo kdy dostane push:** majitel hned, ostatní až na začátku své
  směny (stávající pravidlo upozornění pro prioritu „important“).
  **Zvoní nejvýš jednou za 24 hodin na napojení** — když napojení
  kolísá (test projde, další běh zase 403), další výpadky ten den
  přijdou tiše, jen do seznamu upozornění (otázka 91).
- **Banka a pokladna zatím upozornění neposílají** (otázka 90) — mají
  stejné riziko, ale „vyžaduje pozornost“ tam znamená i jiné věci.

## Co je hotové

| Co | Commit | Nasazeno |
|---|---|---|
| Spoušť upozornění na výpadek a obnovení napojení Choice (migrace 20261108100000) | `a3034d6` | 10. 11. (`db push`) |
| Funkce pro opakovaný test (odstup + místo ve frontě naráz, jen úloha) | `a3034d6` | 10. 11. (`db push`) |
| Opakovaný test v úloze `rezervace-choice` (jednou za 2 h, jeden za běh) | `a3034d6` | 10. 11. (kód + migrace) |
| Texty upozornění, odkaz na Napojení, věta a tlačítko na stránce Upozornění | `a3034d6` | 10. 11. (kód) |
| Hláška u napojení: „Foodtab přístup zkouší znovu sám každé 2 hodiny…“ | `a3034d6` | 10. 11. (kód + migrace) |
| Opravy po nezávislé kontrole: zvonění nejvýš 1× za 24 h, výpadek hlásí jen server, odpojení stáhne upozornění | `ebe143a` | 10. 11. (`db push`) |
| Testy, scénář krok110, CI (`run.sh`, `databaze.yml`), otázky 89–91, `docs/rezervace-choice.md`, toto hlášení | `a3034d6`, `ebe143a` a commit s tímto hlášením | — |

## Čísla — a z čeho jsou

- **Scénář krok110: 66 kontrol** (PGlite, `node scripts/scenare-pglite.mjs
  etapa0_scenar krok110_scenar` → 105 = 39 etapa0 + 66 krok110; počítá
  se z řádků „OK“ v NOTICE). Celý řetěz scénářů v jedné databázi (jako
  CI): **4602 kontrol**, krok110 i tam 66; spadl jen krok101 — známá
  vada PGlite runneru (`\set` v uvozovkách, padá stejně i na `main`),
  ne tato PR. **PGlite neověří RLS ani sloupcové granty** (běží jako
  superuživatel) — granty funkcí a nové
  tabulky se ptají přes `has_function_privilege` / `has_table_privilege`,
  to PGlite spočítá, ale rozhoduje workflow Databáze proti PostgreSQL 16.
- **`scripts/rezervace-choice.test.mjs`: 553 kontrol OK** (řádky „OK“;
  oddíl 12 je nový, zbytek se jen přizpůsobil nové hlášce u napojení).
- **`scripts/upozorneni.test.mjs`: 228 kontrol OK** (oddíl „Výpadek
  napojení“ nový).
- **Celý seznam testů z CI** (`TESTY` v `.github/workflows/aplikace.yml`):
  **101 ze 101 prošlo** (po opravách z nezávislé kontroly, `ebe143a`
  + dokumentace).
- `npx eslint` na změněných souborech čisto. `npx tsc --noEmit`: jen
  4 chyby, všechny z chybějícího balíčku `imapflow` ve sdílených
  `node_modules` (hlavní checkout má starší instalaci než `package.json`)
  — v souborech této PR žádná.

## Schválná rozbití

Dvě kola, každé rozbití vrácené z paměti (ne `git checkout`), po každém
celá sada; počítá se, jestli spadla **jmenovaná** kontrola (u scénáře
první `SELHALO`, u testů řádek `CHYBA` s tím názvem).

- **2. kolo (po opravách, platí): 68 rozbití, 67 spadlo na své
  kontrole.** 34 v migraci (spoušť: podmínky `when`, majitel, kdo
  dostane, jen z „připojeno“, jen server, obnovení, přečtené, priorita,
  zkrácení důvodu, tělo bez účtu, granty, zvonění 1× za 24 h, odpojení;
  funkce testu: meze, odstup od běhu, zápis odstupu, plná fronta),
  26 v kódu (filtry, token, `var_symbol`, odstup, řazení, nesmysl
  z databáze, log, fronta, rozestup, zápis výsledku, úloha) a 8 v textech,
  odkazu a stránce Upozornění.
- **Jedno nespadlo a je to v pořádku:** odebrat `revoke` na nové
  tabulce `app.integrace_vypadek_zvoneni` nic nezmění — ve schématu
  `app` nikdo výchozí práva nemá. Revoke nechávám (stejně jako
  u `app.rezervace_choice_overeni`) a že kontrola umí spadnout, ukázalo
  rozbití „grant select pro přihlášené“ — spadlo.
- **Dvě věci rozbité dvěma způsoby:** zvonění (nikdy tiše / nezapisuje
  se čas; a zvlášť „zapisuje i tichý výpadek“ a „okno 26 h“ — ty
  projdou kontrolou „tiše“ a chytí je jen kontrola „24 h od zvonění, ne
  od tichého výpadku“) a priorita výpadku (vždy `low` / `urgent`).
- **1. kolo (před opravami) ukázalo tři kontroly, které nad rozbitím
  mlčely** — všechny jsou teď jiné:
  - „napojení v odstupu nezdrží další“ ve skutečnosti odstup nezkoušela
    (řazení podle posledního testu poslalo napřed to druhé, takže
    `return` místo `continue` prošel). Nová kontrola: první na řadě je
    v odstupu kvůli běhu načítání (ten `posledni_test_kdy` nepíše) —
    v tomtéž volání se musí zkusit další.
  - `jeUpozorneniNapojeni` neměla mezi „nic jiného“ jiný druh
    `integrace.*` — doplněno.
  - `revoke … from service_role` u spouště byl navíc (`public` ho
    pokrývá) — podle zvyku projektu pryč, rozbití „bez `public`“ spadne.
  - 17 rozbití z 61 se v 1. kole vůbec nepoužilo (viz níž, konce řádků);
    ve 2. kole se použila všechna.

## Nezávislá kontrola kódu

Jedno kolo (agent četl jen commit `a3034d6` přes git). **Vážný nález
žádný**, 2 střední a 4 nízké:

| # | Nález | Co s tím |
|---|---|---|
| 1 | Když napojení kolísá (test projde, další běh zase 403), přišel by výpadek každé 2 h, majiteli jako push i v noci | **opraveno** (`ebe143a`): zvoní nejvýš 1× za 24 h, další tiše (otázka 91) |
| 2 | Chvilková chyba databáze při čtení tokenu se tváří jako „token chybí“ → napojení na „vyžaduje pozornost“ a teď i upozornění | **neopraveno** — je to starší kód načítání (`nacistToken`), mimo zadání. Opakovaný test to do 2 h sám spraví. Navazující práce níž |
| 3 | Správce s `integrace.manage` může stav napojení přepsat přímo přes API a poslat tak majiteli upozornění s vlastním textem a push | **opraveno** (`ebe143a`): výpadek hlásí jen server; člověkem přepnutý stav nepošle nic |
| 4 | Po odpojení zůstalo nepřečtené upozornění a push, který čekal na směnu, by přišel o napojení, které už není | **opraveno** (`ebe143a`) |
| 5 | Úzké okno: opakovaný test čte token, čeká až ~27 s; kdyby mezitím někdo připojil týž podnik nově a nový token neprošel, starý úspěch by zapsal „připojeno“ | **neopraveno** — okno je úzké, potřebuje fungující starý a nefungující nový token téhož podniku; hlídá se aspoň týž podnik (`var_symbol`) a stav |
| 6 | Běh s testem začne načítat o 5,5 s později — se dvěma zdravými napojeními se druhé může nevejít a načte se o 15 min později | **ponecháno**, popsané v otázce 89 (cena a co dělat, kdyby stojících napojení bylo hodně) |

## Co čeká na Šéfíka

- Nic k nasazení — #178 je od 10. 11. v provozu.
- Až přijde upozornění „Choice nenačítá rezervace — pobočka“: otevřít
  ho (vede na Rezervace → Napojení). Foodtab to pak sám zkouší znovu
  každé 2 hodiny; když to nepomůže ani „Ověřit znovu“, napsat Choice
  (api@choiceqr.com) nebo napojení připojit znovu.
- Otázky 89, 90, 91.

## Otázky

- **89** — Foodtab zkouší znovu sám jednou za 2 hodiny, bez konce;
  jedna konstanta v kódu (`OPAKOVAT_TEST_PO_MS`).
- **90** — upozornění zatím jen u Choice, ne u banky a pokladny.
- **91** — výpadek zvoní nejvýš jednou za 24 hodin na napojení, další
  ten den tiše.

Podrobně v `docs/hlaseni/otazky.md`.

## Na co jsem narazil a nešlo to

- **Obrazovku jsem neviděl vykreslenou.** Věta pod upozorněním
  a tlačítko „Otevřít napojení“ na stránce Upozornění jsou ověřené jen
  ze zdrojáku (test, že stránka volá `popisNapojeni` a
  `jeUpozorneniNapojeni`) a texty čistými funkcemi. Push na telefonu
  taky ne. Přihlášená stránka s upozorněním by potřebovala databázi
  s migrací — ta před `db push` nikde není. **Po nasazení 10. 11.
  pořád neviděno:** migrace v ostré databázi je, ale žádné upozornění
  na výpadek zatím nevzniklo (nic nespadlo).
- **Proti živému Choice jsem nic nezkoušel** — na Choice jsem se
  neptal vůbec. Opakovaný test je tentýž GET jako „Ověřit znovu“, které
  funguje; jestli Choice dnes pouští, ukáže až první běh po nasazení.
  **Doplněno 10. 11.:** Choice pouští od 7. 11. (poslední test
  napojení prošel, nejspíš přes „Ověřit znovu“), první běh
  po nasazení (23:11) u obou poboček bez chyby.
  Samotný opakovaný test se naostro nespustil — nebylo co zkoušet.
- **Obnovené napojení se načte „hned“, jen když má starší běh než
  zdravé.** Úloha řadí napojení podle posledního běhu; stojící napojení
  ho má staré (3. 11.), takže jde první. Test to nejdřív neukazoval —
  obě napojení byla bez běhů a rozhodlo id; dopsal jsem skutečnou
  historii. Kdyby obě byla úplně nová, načte se obnovené o běh později
  (15 min).
- **Výpadek hlásí jen server — rozhodnutí z nezávislé kontroly.**
  Původně jsem posílal upozornění i při přepnutí člověkem (kromě něj
  samotného). Kontrola ukázala, že správce s `integrace.manage` smí řádek
  napojení přes API měnit a mohl by tak majiteli posílat push s vlastním
  textem. Choice výpadek zapisuje jen automat (klient služby), takže se
  tím nic skutečného neztratí.
- **Konce řádků:** po prvním commitu se soubory v pracovní kopii
  přepnuly na CRLF (git `autocrlf`) a můj skript s rozbitími hledal
  text s LF — 17 rozbití z 61 se v 1. kole nepoužilo. Skript teď konce
  řádků přizpůsobí; 2. kolo pustilo všechna.
- `scripts/scenare-poradi.test.mjs` padá i na `main` (krok33) — je
  ve `VYNECHANE`, s touto PR nesouvisí.
- `tsc` ve sdílených `node_modules` chybí `imapflow` (viz čísla) —
  prostředí, ne kód.

## Kde jsem skončil a co zbývá

Obě části zadání jsou hotové v jedné PR, 10. 11. sloučené a nasazené
(oddíl „Nasazení 10. 11.“). Naostro se ukážou až při dalším
odmítnutí od Choice.

Navazující věci mimo zadání (nedělal jsem):

- Úloha pokladny má stejné „stojí napořád po jedné odmítnuté
  odpovědi“ (otázka 90).
- `nacistToken` (`lib/rezervace-choice-sync.ts`) nerozliší „token
  chybí“ od chyby databáze — chvilková chyba přepne napojení na
  „vyžaduje pozornost“ (nález 2 nezávislé kontroly).
- KROK 109 (scénář z PR #176) v `databaze.yml` nemá kontrolu hlášky
  „KROK 109 HOTOV“ — kdyby scénář skončil v půlce bez chyby, CI to
  nepozná. KROK 110 ji má.

## Nasazení 10. 11.

Při práci na PR (7. 11.) jsem nic nenasazoval ani neslučoval a na
Choice se neptal. Nasazení proběhlo 10. 11. na pokyn Šéfíka „sluč 178
a db push“ (časy místní, UTC+1):

1. **Před sloučením:**
   - CI #178 zelené (Testy aplikace, Migrace a scénáře, Migrace jen
     přibývají), `MERGEABLE` / `CLEAN`.
   - CLI napojené na `spekntcsuroqhehmjssv` / `foodtab-test`.
   - `migration list`: databáze i repozitář končí na `20261107100000`,
     nic dalšího nenasazeného.
   - Čtecí dotaz: 203 rezervací. Choice Bernard Bar i Černá Perla
     `pripojeno`, poslední test 7. 11. 17:21 / 17:26 úspěšný. Nová
     tabulka ani funkce zatím neexistují.
2. **Sloučeno ve 22:39** (`8f4b16b`).
3. **První produkční sestavení na Vercelu selhalo ve 22:40.** Z build
   logu:
   - Turbopack build failed with 12 errors;
   - `next/font/google` (písmo Archivo) v `app/layout.tsx`: „Module not
     found: Can't resolve '@vercel/turbopack-next/internal/font/google/
     font'“ a „next/font/google queries have exactly one entry“.

   Kód #178 písma ani `layout.tsx` nemění. Poslední úspěšné sestavení
   (9. 11., #179) běželo na stejném Node 26 a Next.js 16.2.6. Z údajů,
   které jsem porovnal, se lišila verze sestavovacího nástroje Vercelu
   (CLI 65.11.0 → 65.14.0) a obě sestavení vycházela z jiné
   mezipaměti. Jakou verzi nástroje a jakou mezipaměť použilo
   opakované sestavení, které prošlo, v záznamech nemám. Adresy písem,
   které Google Fonts vrací, byly při ruční kontrole po selhání běžné
   (bez `?` a `&`). Co dostalo samotné sestavení ve 22:40, nevím.
   Ostrá aplikace mezitím běžela dál na verzi #179, nic nespadlo.
4. **Opakované sestavení téhož commitu** (redeploy přes Vercel API,
   `dpl_9H9s86otEcZWjbbsuRh5JPtfkT4W`) **prošlo ve 23:01**:
   - produkční adresa `foodtab-rizeni.vercel.app` převedená;
   - `/prihlaseni` vrací 200.

   Stejný commit napodruhé prošel, takže chyba nebyla v kódu #178.
   Co přesně první sestavení shodilo (nástroj, nebo mezipaměť
   Vercelu), z dostupných údajů nevím. Build log šel přečíst
   až poté, co Šéfík povolil Vercel MCP přístup k týmu.
5. **`db push` ve 23:03**, výstup doslovně:

   ```
   Initialising login role...
   Connecting to remote database...
   Do you want to push these migrations to the remote database?
    • 20261108100000_rezervace_choice_vypadek.sql
    [Y/n] y
   Applying migration 20261108100000_rezervace_choice_vypadek.sql...
   {"upToDate":false,"dryRun":false,"migrations":["20261108100000_rezervace_choice_vypadek.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
   ```

   (exit 0)
6. **Ověřeno čtecím dotazem** (dotaz, který v databázi nic nemění).
   Všechno je tak, jak to po migraci má být:

   | Co | Výsledek |
   |---|---|
   | Poslední migrace | `20261107100000`, `20261108100000` |
   | `app.integrace_vypadek_zvoneni` | existuje, RLS zapnuté, sloupce `pripojeni_id uuid not null`, `zvonilo timestamptz not null`; `anon`, `authenticated` ani `service_role` nemají select/insert/update/delete/truncate; 0 řádků |
   | `app.integrace_vypadek_upozornit()` | security definer, `search_path=""`; spustit nesmí `anon`, `authenticated`, `public` ani `service_role` |
   | `public.rezervace_choice_zabrat_opakovany_test(…)` | security definer, `search_path=""`; spustit smí jen `service_role` (`anon`, `authenticated`, `public` ne) |
   | Spoušť `trg_integrace_vypadek_upozornit` | zapnutá; `AFTER UPDATE OF stav, odpojeno_kdy`, jen `oblast = 'rezervace'` a `poskytovatel = 'choice'` |
   | Upozornění `integrace.vypadek` / `integrace.obnoveno` | 0 |
7. **První běh úlohy po `db push` (23:11):** obě pobočky `hotovo`, bez
   chyby (0 nových rezervací — v tu chvíli nic nového), Choice u obou
   dál `pripojeno`. Tabulka zvonění dál prázdná a upozornění
   na výpadek či obnovení dál žádné.
