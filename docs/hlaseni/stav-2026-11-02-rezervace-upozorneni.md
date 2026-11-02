# Stav k 2. 11. 2026 — Rezervace a akce: komu chodí upozornění, a Word v přílohách

## Nejdřív to podstatné

- V **Provoz → Rezervace a akce** je nová záložka **Upozornění** se
  zvonečkem (vidí ji jen ten, kdo rezervace zapisuje). U každé pobočky se
  zaškrtnou lidé a u každého, co mu chodí: **akce** (nová, každá změna,
  zrušení; po proběhlé akci už nic), **rezervace** (nová i obnovená
  zrušená, zrušení, „z rezervace je akce“) a **ranní souhrn**.
- K rezervacím a akcím jde přiložit i **dokument Word (.docx)** — ve
  formuláři nové rezervace i v detailu. Starý `.doc` a `.docm` s makry ne.
- **NASAZENO 2. 11. 2026** na „sluč 171 a db push“: PR #171 sloučen
  (`f7dbea7`), Vercel nasadil produkci, `db push` obou migrací
  (`20261106100000` upozornění, `20261106110000` Word) a výsledek ověřený
  čtecím dotazem — viz oddíl „Nasazení“ na konci.
- **Na akce a rezervace teď nechodí nic nikomu, dokud u pobočky nikoho
  nevyberete** (otázka 81). Ranní souhrn chodí dál jako dosud.

## Co je hotové

| Co | Commit | `db push` |
|---|---|---|
| Upozornění: tabulka výběru, obrazovka Upozornění, spoušť na rezervacích, ranní souhrn podle výběru, scénář `krok107` | `ae1f394` + opravy `6355b3f` | nasazeno 2. 11., `20261106100000` |
| Word `.docx` v přílohách (kbelík, kontrola typu, cesta; stažení pod názvem bez diakritiky), scénář `krok108` | `ae1f394` | nasazeno 2. 11., `20261106110000` |
| Opravy po kontrole kódu (níž) | `6355b3f` | součást `20261106100000` |
| CI: řádku `KROK 107` v `databaze.yml` chybělo pokračování, přidán `KROK 108` | `ae1f394` | — |

## Čísla — a z čeho jsou

- **`krok107_scenar.sql`: 94 kontrol**, `krok108_scenar.sql`:
  **23 kontrol** — PGlite. PGlite běží jako superuživatel, **neověří RLS
  ani granty**. Rozhoduje workflow Databáze proti PostgreSQL 16 na PR.
- **Celý řetěz PGlite** (všechny scénáře v jedné databázi, jako CI):
  **4476 kontrol** prošlo, spadl jen `krok101` — známá vada PGlite
  (`\set` s hodnotou v uvozovkách, runner je nesundá; psql na CI ano),
  s touhle prací nesouvisí a spadl stejně i před ní.
- **Migrace pod vlastníkem, který není superuživatel** (napodobenina
  Supabase): `etapa0` + `krok107` + `krok108` = **156 kontrol** prošlo,
  migrace pouštěl `vlastnik_migraci` (superuživatel: ne, předáno 613
  objektů).
- **Testy aplikace:** všech 100 ze seznamu CI prošlo;
  `scripts/rezervace.test.mjs` 163 kontrol, `scripts/upozorneni.test.mjs`
  197. `eslint` čistý na 10 změněných souborech, `tsc --noEmit` bez
  chyby.
- Že v migraci nechybí `revoke` proti výchozím právům Supabase, hlídá
  `scripts/provoz-granty.test.mjs` (čte text migrace) — lokální databáze
  testů ta výchozí práva nemá, takže tam by to nespadlo. Vyzkoušeno
  smazáním řádku.

### Schválná rozbití

**65 rozbití migrace upozornění** proti `krok107` a **45 rozbití
Wordu a textů** (databáze proti `krok108`, aplikace proti
`scripts/rezervace.test.mjs` a `scripts/upozorneni.test.mjs`) — každé
zvlášť, každé spadlo na kontrole, na kterou mířilo.

Dvě napoprvé spadla jinde, než měla, a obě něco odhalila:

- **„Import ze souboru se hlásí“ — nespadlo nic.** Nové rezervace ze
  souboru zastavovala podmínka u spouště a zároveň (od přestavby na
  dávky) i dávková cesta. Podmínka napsaná dvakrát drží, ale kontrola
  nad ní nejde shodit. Dávková cesta teď platí výslovně jen pro
  rezervační systém; soubor hlídá jediná podmínka a rozbití ji trefí.
- **„Souhrn všem, kdo vidí“** spadlo dřív, na kontrole „ukončenému
  (Otto) ne“ — taky správně, ale kontrola „Karel a Věra (vidí, ale
  vybraní nejsou) ne“ tím nebyla vyzkoušená. Přidal jsem druhé rozbití
  „souhrn všem aktivním, kdo vidí“, které trefí právě ji.

Po druhé revizi minulo dalších pět. Tři z nich byly díra ve scénáři,
ne v migraci, a dvě spadly o kontrolu vedle:

- **„Konec akce se nehlásí“ — nespadlo nic.** Kontrola „změna jen konce:
  čas“ četla poslední upozornění, a to bylo pořád to nepřečtené ze změny
  začátku, které „čas“ už mělo. Teď se u každé změny ptá, jestli přišlo
  **nové** upozornění.
- **„Začátek se nehlásí“** shodilo scénář chybou syntaxe místo kontroly
  (prázdná proměnná). Opraveno stejnou úpravou.
- **„Pozastavené členství mezi příjemci“ — nespadlo nic.** Pozastavenému
  nic nepošle už služba upozornění sama (starší migrace), takže kontrola
  na konci nemohla spadnout. Teď se ptá i přímo na seznam příjemců
  (pozastavený v něm není, po obnovení zase je) — ten bere lidi ze
  stejného místa jako nabídka na obrazovce.
- **„Jen běžící načítání“** spadlo dřív, na první kontrole Choice —
  správně (první načítání doběhne týž den). Na kontrolu „připojení, které
  kalendář prošlo před 3 dny“ proto přibylo rozbití „od posledního
  načítání“, které trefí přesně ji.
- **„Word: i výpadek sítě jako před db push“** spadlo na kontrole
  politiky úložiště (tu přeložilo taky). Přestavěné tak, aby síťovou
  chybu přeložilo jako politiku — teď trefí kontrolu „výpadek sítě →
  původní hláška“.

## Kontrola kódu (revize) — co našla a co se opravilo

Revize (18 nezávislých pohledů, každý nález ověřený zvlášť) potvrdila
12 nálezů — dva se překrývaly, takže **10 různých věcí, všechny
opravené** (commit `6355b3f`); 2 další vyvrátila:

1. **První den připojení se počítal od první rezervace, ne od připojení.**
   Příjmové API založené před týdnem, které první rezervaci pošle až
   dnes, by ji (a všechny další 24 hodin) tiše spolklo. Teď se den počítá
   od prvního načítání (Choice), u příjmového API od založení připojení.
2. **Z akce rezervace nikomu nic**, a zrušení zároveň se změnou druhu
   šlo té skupině, která o řádku nevěděla. Teď: kuchyně (vybraní na akce)
   dostane „Změna: z akce je rezervace“ pod názvem akce, vybraní na
   rezervace „Nová rezervace“; zrušení jde podle druhu před uložením.
3. **Rezervace zapsaná na minulý den a opravená na skutečný** (překlep
   v datu) se neohlásila nikdy. Teď je nová.
4. **Dávka z rezervačního systému:** každý nový řádek dávky upozornění
   smazal a zapsal znovu, zařadil k odeslání na telefon a pokaždé znovu
   počítal příjemce — u dávky se stovkami řádků zbytečně pomalé. Teď
   jedno upozornění za pobočku a dávku, poslané až při potvrzení dávky;
   když dávka spadne, nepřijde nic.
5. **Word před `db push`:** appka se z `main` nasadí dřív než databáze;
   do té doby by nahrání Wordu skončilo anglickou hláškou úložiště. Teď
   česky: „Word půjde přiložit až po aktualizaci databáze — zatím ho
   uložte jako PDF.“ (Obrazovka Upozornění to řešila už předtím.)
6. **Scénář — kontrola, která nemohla spadnout:** „Karel výběr nečte“
   běžela nad prázdnou tabulkou, takže by prošla s jakoukoli politikou.
   Teď se ptá, když řádky jsou, a i za Báru z jiné pobočky.
7. **Scénář — chybělo:** že **pobočka bez výběru** nedostane nic a že
   **výběr platí jen pro svou pobočku** (a uložení Perly nesmaže výběr
   Baru). Přidán oddíl s Barem a tři rozbití, která na něj míří.
8. **Scénář — data v roce 2031:** spoušť porovnává se skutečným dneškem,
   takže by scénář jednou sám spadl. Teď 2099.
9. **Scénář — souhrn majitele** počítal pobočky ve sdílené databázi.
   Teď se ptá „Bar ano, Perla ne“.

Vyvrácené: „kontroly grantů v CI nespadnou“ (hlídá je statický test
textu migrace, viz výš) a „souhrn bez výběru jde i ukončeným; když si
ho všichni vybraní vypnou, nedojde nikomu“. První polovina už byla
v pracovní kopii opravená (příjemce i náhradníky souhrnu teď určuje
jedno místo, jen aktivní). Druhá je pravda, ale záměr — osobní vypnutí
vyhrává. Dopsáno do otázky 81.

### Druhá revize (po opravách)

Druhá revize (8 pohledů, každý nález ověřený zvlášť) našla dalších
**14 věcí, všechny opravené** v commitu `6355b3f`; 3 další vyvrátila.
Ty podstatné pro provoz:

1. **Obnovená zrušená rezervace se nikomu neohlásila.** Vybraní dostali
   „Zrušená rezervace“ a pak už nic — s rezervací by nepočítali. Teď
   dostanou „Nová rezervace“.
2. **Z rezervace akce: lidé na rezervacích to nevěděli** a zrušení té
   akce pak dostala jen kuchyně. Teď dostanou „Změna rezervace … Změna:
   z rezervace je akce.“ (nový druh upozornění; kuchyně „Nová akce“).
   Další změny a zrušení jdou už jen podle nového druhu — kdo chce
   o akcích vědět, má být vybraný na akce.
3. **Upozornění chodila i po skončené akci** (doplněný počet hostů po
   „proběhla“, změna proběhlé akce na rezervaci). Teď po „proběhla“
   a „nedorazili“ nic.
4. **„První den připojení“ se počítal i od nepovedeného pokusu
   o načtení** (neplatný klíč, plná fronta). Když se připojení opravilo
   až za pár dní, první skutečné načtení by ohlásilo celý kalendář jako
   „120 nových rezervací“. Teď se počítá jen načítání, které kalendář
   opravdu prošlo.
5. **Texty slibovaly víc, než platí:** „kdo rezervaci zapíše, tomu se
   o ní nic nepošle“ — ve skutečnosti se nepošle jen o té jeho změně.
   Opraveno na obrazovce i v otázce 81. A věta při nahrání Wordu po
   `db push` mohla tvrdit „půjde až po aktualizaci databáze“ i tam, kde
   je příčina jiná — teď u odmítnutí politikou úložiště příčinu jen
   nabízí („Jestli databáze ještě nebyla aktualizovaná…“).
6. **Scénář — chybělo** (doplněno 12 kontrol): změny akce po
   jednotlivých polích (začátek, konec, menu, typ akce, potvrzení),
   pozastavené členství, souhrn, když všichni vybraní mezitím skončili,
   připojení, které kalendář prošlo před třemi dny (nová musí dojít),
   autor u druhého upozornění při změně druhu. Statická kontrola „tělo
   nenese jméno hosta“ četla špatný kus migrace — teď čte jen funkci,
   která tělo skládá. A kontrola z první opravy, která pořád běžela nad
   prázdnou tabulkou, je pryč.

Vyvrácené: dvojí upozornění při založení a zrušení v jedné dávce,
tvrzení o oddílu 5 a nesoulad počtů v hlášení.

## Co jsem viděl na obrazovce

Snímky z náhledu s ukázkovými daty (ne přihlášený proti databázi —
migrace v testovací databázi není): obrazovka Upozornění na počítači
(1280 px) a na telefonu (390 px) a přílohy v detailu rezervace s Wordem.
Tabulka lidí se na telefonu vejde, nic nepřetéká, pobočka bez lidí
ukáže větu „Rezervace téhle pobočky zatím nikdo nevidí“. Po opravách
z druhé revize vyfoceno znovu (počítač i telefon): nové věty „obnovená
zrušená“, „z rezervace je akce“, „po proběhlé akci už nic“ a „o té své
změně nic“ se vykreslují a na telefonu nepřetékají. Upozornění „Změna
rezervace“ v seznamu upozornění vykreslené vidět nebylo — ověřené
testem nadpisu, věty a odkazu. **Česká hláška
při nahrání Wordu před `db push` vykreslená vidět nebyla** — je ověřená
testem (`chybaNahrani`), ne snímkem.

## Co čeká na Šéfíka

1. ~~„sluč 171 a db push“~~ — hotovo 2. 11.
2. **Rezervace → Upozornění** — u každé pobočky zaškrtnout lidi
   (otázka 81). Kdo v seznamu chybí, nemá právo rezervace vidět:
   Nastavení → Zařazení (otázka 76).

## Otázky

81 (komu chodí po nasazení — nikomu, dokud nikoho nevyberete; doplněno
o osobní vypnutí souhrnu), 82 (změna akce na dnešek obyčejně, ne
naléhavě), 83 (nová a hned zrušená rezervace — dvě upozornění). Ke každé
je zvolená nejopatrnější varianta, nic nečeká.

## Na co jsem narazil a nešlo to

- **Dvakrát napsaná podmínka** (import ze souboru) — viz rozbití výš.
  Našlo ji až rozbití, ne revize.
- **PGlite neumí ověřit politiku čtení** (běží jako superuživatel) —
  kontroly čtení pod rolí `authenticated` proto rozhodne až CI.
- **Upozornění se nedožene:** když v prvním dni připojení přijde
  skutečně nová rezervace, upozornění na ni nepřijde (ukáže ji kalendář
  a ranní souhrn). Rozlišit „stará, poprvé viděná“ od „nová“ zdroj
  neumí spolehlivě říct.
- **Co jsem schválně nedělal:** vlastní vypínač upozornění na akce
  a rezervace v Nastavení (rozhoduje vedoucí výběrem), volbu lidí
  u jednotlivé akce, připomínku den před akcí, jméno hosta v upozornění
  (jde přes cizí službu na zamčenou obrazovku telefonu).

## Kde jsem skončil a co zbývá

Hotové obě zadání (tlačítko Upozornění s výběrem lidí a Word v přílohách)
včetně oprav po revizi, sloučené a nasazené. Zbývá jen výběr lidí
u poboček (Šéfík) a ověřit první skutečné upozornění, až někdo
vybraný bude a přijde nová rezervace nebo akce.

## Nasazení (2. 11. 2026, na „sluč 171 a db push“)

- CI na PR #171: 5 kontrol zelených (vč. workflow Databáze proti
  PostgreSQL 16), sloučeno jako `f7dbea7`. Vercel: produkce nasazená
  („Deployment has completed“).
- `supabase/.temp/linked-project.json`: `spekntcsuroqhehmjssv` /
  `foodtab-test`. `migration list --linked` před nasazením: chyběly
  přesně dvě, `20261106100000` a `20261106110000`, nic jiného.
- `db push --yes`:

  ```
  Applying migration 20261106100000_rezervace_upozorneni.sql...
  Applying migration 20261106110000_rezervace_prilohy_word.sql...
  Finished supabase db push.
  ```

- Ověřeno čtecím dotazem (`db query --linked`):
  - `rezervace_upozorneni`: RLS zapnuté, jediný grant
    `authenticated: SELECT`, jediná politika (čtení), 0 řádků (nikdo
    zatím vybraný není — tak má být).
  - Spouště na `rezervace`: `trg_rezervace_upozornit_vlozeni`, `_zmena`
    a `_davka` (odložená do potvrzení dávky).
  - Vnitřní funkce (`kdo_vidi`, `prijemci`, `upozornit`,
    `upozornit_davku`, `upozorneni_telo`, `upozorneni_hlida`,
    `souhrn_dne`) nesmí volat `anon`, `authenticated` ani
    `service_role`; všechny se `search_path=""`. Obrazovka smí jen
    `rezervace_upozorneni_lide` a `_ulozit` (`authenticated`, ne `anon`).
  - Kbelík `rezervace`: soukromý, 10 MB, typy fotky + PDF + Word `.docx`;
    CHECK na `rezervace_prilohy.mime` totéž. Cesta `….docx` projde,
    `….doc` ne.
