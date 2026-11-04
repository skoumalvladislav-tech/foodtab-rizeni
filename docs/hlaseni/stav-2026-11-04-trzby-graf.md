# Stav k 4. 11. 2026 — graf srovnání u Tržeb (jako „Měsíční tržby“ v Dotykačce)

## Nejdřív to podstatné

- **Šéfík:** „Ve financích potřebuju u tržeb udělat podobný graf srovnání
  tržeb“ (se snímkem karty *Měsíční tržby* z Dotykačky).
- **Hotovo v PR #175 do `main`, nesloučené.** Finance → Tržby má místo
  dosavadní čáry kartu **Srovnání tržeb**:
  - **sloupce** = zobrazené období (po měsících: měsíce roku; po dnech:
    dny měsíce),
  - **čára** = srovnávací období,
  - po dnech přepínač **Předchozí měsíc / Stejný měsíc loni**,
  - podnadpis jako v Dotykačce: „2026 · porovnání vůči 1. 1. – 31. 12. 2025“,
  - bublina s čísly po najetí myší (na telefonu pruh pod grafem po klepnutí),
    rozdíl v procentech,
  - **Tabulka srovnání** pod grafem (to, co v Dotykačce dělá tlačítko
    Detail).
- **Čísla jsou ze stejného místa a pod stejným přihlášením jako zbytek
  stránky Tržby**: stejná funkce v databázi (`pokladna_prehled_trzeb`)
  přes uživatelský klient, stejný provozní den (od 5:00, pražský čas),
  na pobočce jen řádky té pobočky — u zobrazeného i u srovnávacího
  období. Žádná nová funkce v databázi ani klíč služby, jen druhé
  volání téže funkce pro srovnávací období.
- **Když srovnání data nemá, graf to řekne nahlas a čáru nekreslí.**
  Nulu si nevymýšlí. Pro rok 2026 to dnes platí: appka má tržby
  z pokladny teprve od 1. 1. 2026 (Perla) a od 28. 2. 2026 (Bernard Bar).
  Po měsících proto karta teď hlásí *„Za 2025 nemá appka z pokladny
  žádné tržby, takže čára srovnání chybí. Neznamená to nulové tržby —
  pokladna tehdy nejspíš ještě nebyla napojená.“* Po dnech (říjen proti
  září) srovnání data má.
- **Bez migrace**, `db push` není potřeba. Stačí „sluč 175“.

## Co je hotové

| Co | Commit |
|---|---|
| Graf srovnání: výpočet (`lib/trzby-srovnani.ts`), kresba, karta, napojení na stránku, barvy pro světlý i tmavý režim, test `scripts/trzby-srovnani.test.mjs` v seznamu CI | `d0dfa12` |
| Klepnutí na telefonu nepřepíše výběr, bublina po zvednutí prstu nezmizí | `db7cc9b` |
| Kontrola, kterou schválné rozbití napoprvé neshodilo (rozběhnutý měsíc) | `581a85b` |
| Dlouhý výčet dní s jinými provozovnami zkrácený na počet + první tři | `ad4dbfc` |
| Telefon: čísla v pruhu pod grafem místo bubliny, která zakrývala sloupec | `2eba139` |
| Bublina o kus širší; podnadpis bez „proti říjen“ (špatný pád) | `4768b1a`, `60ed4dc` |
| Nález z kontroly kódu: měsíc s pokladnou napojenou v půlce (12 dní proti 31) už nedá falešný rozdíl v procentech | `3f6c78c` |
| Hlášení, otázky 84–86 | (tento commit) |

## Jak graf počítá

- **Po měsících** (rok): sloupce = měsíce zvoleného roku, čára = tytéž
  měsíce předchozího roku. Přepínač tu není. U roku je „předchozí
  období“ i „předchozí rok“ totéž, dvě tlačítka by dělala stejnou věc.
- **Po dnech** (měsíc): sloupce = dny měsíce, čára = buď předchozí měsíc
  (výchozí), nebo týž měsíc loni. Dny se párují podle čísla dne
  (1. s 1.), ne podle dne v týdnu. Viz otázka 84. 31. den, který
  srovnávací měsíc nemá, je bez čáry.
- **Po rocích** zůstává dosavadní čára bez srovnání.
- **Rozběhnutý měsíc / dnešek** má světlejší sloupec a **rozdíl
  v procentech se u něj neukazuje**. Polovina listopadu proti celému
  loňskému listopadu by vypadala jako propad.
- **Za celou firmu, když se liší provozovny:** když je v měsíci (dni)
  jiná sada provozoven než ve srovnání, třeba Bar ještě nebyl napojený
  nebo měl zavřeno, rozdíl v procentech se neukáže. Karta to řekne
  větou a bublina i tabulka vypíšou, které provozovny to jsou. Jinak by
  graf ukázal falešný růst.
- **Měsíc s výrazně méně prodejními dny** (pokladna napojená v půlce,
  12 dní proti 31) má stejnou sadu provozoven, a přesto by dal falešný
  rozdíl. Když má kterákoli provozovna na jedné straně méně než 2/3 dní
  druhé strany, rozdíl v procentech se neukáže a karta řekne proč.
  Týden zavřeno ještě projde. Viz otázka 86.
- **Počet dní u provozoven se nesčítá.** U měsíce, kde jedna provozovna
  prodávala 31 dní a druhá 4, stojí „(4–31 dní podle provozovny)“,
  ne „35 dní“.
- **Barvy** jsou dva nové tokeny (`--graf-obdobi` mosazná, `--graf-srovnani`
  modrá), zvlášť pro světlý a tmavý režim. Kontrast vůči kartě je
  v obou režimech aspoň 3 : 1, ověřený testem. Texty mají barvu textu,
  ne barvu řady.

## Čísla — a z čeho jsou

- **`scripts/trzby-srovnani.test.mjs`: 113 kontrol**, Node bez databáze.
  Logika, vykreslená karta a **skutečná `page.tsx`** s podvrženým
  přihlášením a podvrženým načtením tržeb. Kontroluje se, s jakými
  parametry se tržby načítají, že na pobočce dostane karta jen řádky
  pobočky (i za srovnání), a že při odepřeném přístupu se nenačítá nic.
- **Celá sada testů z CI: 101 ze 101 prošlo**, třikrát, naposledy po
  posledním commitu kódu `3f6c78c` (`.github/workflows/aplikace.yml`,
  seznam `TESTY`, každý test zvlášť). `tsc` čistý, `eslint` na změněných
  souborech čistý.
- **Tohle neověřuje databázi.** Test podvrhuje odpověď funkce
  `pokladna_prehled_trzeb`. RLS ani granty tím ověřené nejsou. Funkce
  ani databáze se ale nemění, graf volá totéž co stránka dnes, jen
  podruhé pro srovnávací období.
- **Schválná rozbití: 22**, každé shodilo tu kontrolu, na kterou mířilo
  (a celý test skončil kódem 1). Patří k nim:
  - nula místo „bez dat“;
  - čára přes mezery;
  - srovnání na pobočce nezúžené na pobočku;
  - volba „stejný měsíc loni“ nepropsaná do dotazu;
  - šipky období, které volbu zapomenou;
  - sčítání dní;
  - rozdíl u rozběhnutého měsíce;
  - chybějící barvy v tmavém režimu;
  - nízký kontrast;
  - hranice telefonu jinak v kódu a v CSS;
  - rozdíl i při 12 dnech proti 31;
  - hranice počtu dní příliš volná i příliš přísná.

  Výsledky jsou ve sdílených poznámkách (`trzby-graf-rozbiti.txt`).

## Snímky obrazovky

Jen **smyšlená čísla** (dočasná náhledová stránka, do gitu nepatří,
ostrá čísla z pokladny nikde nejsou). 13 snímků:
- počítač,
- telefon (390 px),
- světlý i tmavý režim.

Ukazují:
- rok se srovnáním, rok bez dat, rok s částečným srovnáním, rok
  s jinými provozovnami;
- dny za firmu s bublinou;
- dny na pobočce proti loňsku;
- telefon s pruhem po klepnutí.

Na telefonu se stránka do strany nerozjíždí (šířka stránky = šířka
okna, změřeno u každého snímku). Graf je u každého snímku oživený
(hydratovaný). Snímky jsou ve sdílených poznámkách ve složce
`trzby-graf-snimky`. Třináctý snímek ukazuje rok, kde srovnání
začíná březnem s 12 dny.

## Co čeká na Šéfíka

1. Projít PR #175 a snímky. Když sedí, napsat **„sluč 175“**.
   Migrace není, `db push` netřeba.
2. Odpovědět na otázky 84–86 v `otazky.md`. Graf funguje i bez
   odpovědi, zvolil jsem opatrnější variantu.

## Otázky

- **84.** Po dnech párovat podle čísla dne (1. s 1.), nebo podle dne
  v týdnu (pondělí s pondělím)?
- **85.** Po měsících jen „proti loňsku“, bez přepínače. Stačí to?
- **86.** Od kolika chybějících prodejních dní se rozdíl v procentech
  nemá ukazovat (teď pod 2/3 druhé strany)?

Všechny s důvodem a co se změní v `docs/hlaseni/otazky.md`.

## Na co jsem narazil a nešlo to

- **Nezávislá kontrola kódu našla skutečnou díru.** Rozdíl v procentech
  se počítal i u měsíce, kdy byla pokladna ve srovnání napojená až
  v půlce. Sada provozoven byla stejná, takže hlídání „jiných
  provozoven“ to nechytilo, a věta o částečném srovnání taky ne (bere
  jen první a poslední měsíc s daty). Konkrétně: Bernard Bar je
  napojený od 28. 2. 2026, takže v únoru 2027 by graf ukázal falešný
  růst Baru. Opraveno (`3f6c78c`, otázka 86). Druhý nález kontroly
  (zúžení srovnání na pobočku kontrola nepozná) neplatil: schválné
  rozbití přesně tohoto řádku kontrolu shodilo.
- **Dny se nejdřív sčítaly přes provozovny.** Leden za firmu ukazoval
  „140 000 Kč (62 dní)“. Všiml jsem si toho až ve výpisu testu
  stránky, žádná kontrola na to tehdy nebyla. Oprava: dny se berou za jednu provozovnu (nejvíc a nejméně),
  kontrola na „31, ne 62“ přidaná.
- **Jedna kontrola napoprvé neuměla spadnout.** „Rozběhnutý listopad
  bez rozdílu“ procházela i po smazání podmínky. Ve fixtuře totiž
  chyběl loňský listopad, takže rozdíl vyšel prázdný tak jako tak.
  Přidal jsem případ, kde loňský listopad data má, a teď spadne.
- **Bublina na telefonu zakrývala sloupec, na který se kleplo** (bublina
  232 px v grafu širokém 288 px). Na snímku bylo vidět hned. Pod 480 px
  šířky grafu jsou proto čísla v pruhu pod grafem.
- **Po dnech je hodně dní „s jinými provozovnami“,** když jedna má jeden
  den v týdnu zavřeno. Je to pravda (nelze poznat „zavřeno“ od
  „nenapojeno“), ale výčet osmi dní topil větu. Nad tři dny karta říká
  počet a první tři.
- **Z Dotykačky jsem nepřebíral:**
  - tlačítko *Detail* (jeho roli má rozbalovací Tabulka srovnání);
  - filtry nad kartou (stránka Tržby už má šipky období a přepínač
    provozovny a graf je bere);
  - volné období od–do. Tržby mají jen pevná období (měsíc/rok);
    vlastní rozsah by byl nový ovladač pro celou stránku.
- **Na ostrých datech jsem graf vykreslený neviděl.** Snímky jsou
  z náhledu se smyšlenými čísly. Ostrá stránka potřebuje přihlášení
  a ostrá čísla do snímků nepatří. Co graf dostane, je ale totéž, co
  dnes tabulka pod ním. Test to ověřuje přes skutečnou `page.tsx`.

## Kde jsem skončil a co zbývá

- Práce je hotová a v PR #175. Zbývá jen sloučení na pokyn.
- Po sloučení stojí za to otevřít Tržby po dnech za říjen (srovnání se
  zářím, data tam mají obě provozovny) a pár dní porovnat s tabulkou
  pod grafem.

## Nenasazoval jsem

Nic. Nesloučeno, `db push` žádný (migrace není), Vercel nasadí sám až
po sloučení do `main`.
