# Stav k 25. 10. 2026 — zdvojené zálohy: jedna záloha se teď nezapíše dvakrát

Hlášení Šéfíka 25. 10.: „některým zaměstnancům nefungovalo přihlášení,
respektive zapnutí apky, potom odečítání záloh se zdvojovalo". Upřesnění
týž den: „problém s přihlášením vyřešen, nešel internet".

Větev `claude/keen-bardeen-f7ttd3`. Nová migrace
`20261025100000_zalohy_jedno_odeslani` (novější než všechny v `main`).

## Nejdřív to podstatné

- **Nic není nasazené.** Nic jsem nesloučil do `main` a `db push` jsem nespustil.
- **Výpočty záloh jsou v pořádku.** Prošel jsem Můj účet, dlaždici na Docházce, Výdělky i Po dnech. Nikde se jedna záloha nezapočítá dvakrát.
- **Zdvojení vznikalo při ZÁPISU.** Výplata zapsala novou zálohu při každém odeslání. Při výpadku internetu se záloha zapsala, odpověď do telefonu nedošla, obsluha viděla chybu a vyplatila znovu. Stejně dopadlo i dvojí ťuknutí na pomalém telefonu.
- **Oprava:** každé vyplnění formuláře „Vyplatit zálohu“ nese **číslo odeslání**. Když přijde totéž číslo podruhé, databáze novou zálohu nezapíše a vrátí tu první. Obsluha uvidí „Tahle záloha už zapsaná byla… Podruhé se nezapsala — vyplacená je jednou.“
- **Při výpadku spojení obrazovka nespadne.** Ukáže „Spojení vypadlo a nevíme, jestli se záloha zapsala. Stiskněte Vyplatit znovu — když už zapsaná je, podruhé se nezapíše.“ Pole zůstanou vyplněná.
- **Zálohy, které už jsou v databázi zdvojené, oprava nesmaže.** Do zákaznických dat jsem nesahal. Zruší se tlačítkem Storno na obrazovce Zálohy. Najde je dotaz níž v oddílu „Co čeká na Šéfíka“.
- **Přihlášení:** podle Šéfíka šlo o výpadek internetu, v kódu jsem chybu nenašel. Přihlášení kódem z e-mailu i první přihlášení z pozvánky vypadají správně.

## Co je hotové

| co | commit | čeká na db push |
|---|---|---|
| migrace: sloupec `advances.klic_odeslani`, jedinečný ve firmě; `vyplatit_zalohu` s `p_klic` a výstupem `opakovane` | `c2f6ed5` | **ano** |
| formulář a serverová akce: posílají číslo, mění ho jen po úspěchu, druhé upozornění příjemci neposílají | `c2f6ed5` | ne (bez migrace jede postaru) |
| scénář `krok101`, úprava `krok57` na novou podobu funkce, kontroly v `scripts/zalohy.test.mjs` | `c2f6ed5` | — |

**Co se při opakování děje přesně:**
- Totéž číslo, stejná osoba, částka, pobočka a vydávající: vrátí se první záloha. Audit ani upozornění příjemci podruhé nevzniknou. Varování („odpracováno zatím…“) vyjde stejně jako napoprvé.
- Totéž číslo, ale cokoli z toho jinak: výplata spadne s hláškou „Tohle odeslání už patří jiné záloze“ a nic se nezapíše. Opakování je jen přesná kopie téhož odeslání.
- Opakování projde i tehdy, když člověku mezitím pozastavili zálohy. Záloha už zapsaná JE, chyba by obsluhu jen zmátla.
- **Dvě zálohy téže osobě týž den o stejné částce dál jdou.** Rozhoduje číslo odeslání, ne podobnost. Dvakrát 500 Kč za den je běžné.

**Do nasazení migrace** aplikace pozná, že databáze číslo nezná, a vyplatí jako dřív (bez ochrany). Nic tedy nespadne, jen ochrana začne platit až po `db push`.

## Čísla — a z čeho jsou

- **`supabase/tests/run.sh` na skutečném PostgreSQL 16** (lokální čistá databáze, ne PGlite):
  - před změnou 4 034 kontrol;
  - po změně **4 064** (+30 v novém `krok101`, `krok57` beze změny počtu);
  - nic nespadlo, včetně seedu.
  - Výchozí práva Supabase pro `anon`/`authenticated` lokálně nejsou, viz CLAUDE.md. Proto `krok101` čtení nového sloupce schválně nekontroluje (vysvětleno v hlavičce migrace a scénáře).
- **`scripts/zalohy.test.mjs`:** +21 kontrol, celá sada prošla. Kontroly pouštějí skutečnou serverovou akci s podvrženou databází a skutečný formulář.
- `tsc` i `eslint` na změněných souborech čisté, `scenare.test.mjs` a `migrace-poradi.mjs` prošly.
- **Souběh** (dvě ťuknutí naráz) se v jednom spojení napodobit nedá. Vyzkoušel jsem ho dvěma spojeními: druhé počkalo na první, dostalo tutéž zálohu s `opakovane = true` a v databázi byla jedna záloha a jeden audit. Bez `on conflict` druhé spadlo na jedinečném indexu. V textu migrace to hlídá `zalohy.test.mjs`.

**Schválná rozbití:**
- **Databáze, 13:** bez předběžného hledání, varování počítá i sebe, nesrovnává se částka / vydávající / pobočka / osoba, audit i při opakování, upozornění i při opakování, hledání čísla bez firmy, právo až po čísle, pomocná funkce otevřená přihlášeným, číslo se neuloží. K tomu souběh bez `on conflict`, ověřený dvěma spojeními. Každé spadlo na své kontrole. Rozbití „hledání bez firmy“ nejdřív spadlo holou výjimkou, proto jsem přidal pojmenovanou kontrolu a spadlo znovu, už na ní.
- **Aplikace, 10:** číslo se neposílá, push i při opakování, nové číslo i po chybě, nové číslo po výpadku, výpadek shodí obrazovku, chybí skryté pole, stránka nedá číslo, chyba bez hodnot formuláře, neověřené číslo, chybí záloha na starší databázi. Všechna spadla.

## Co čeká na Šéfíka

1. **Sloučit do `main` a pak `db push`** (jedna migrace).
2. **Najít a stornovat zálohy, které už jsou zdvojené.** Dotaz pro Supabase → SQL Editor (jen čte):

   ```sql
   select e.full_name, a.business_date, a.castka_haleru / 100 as kc,
          count(*) as kolikrat, min(a.created_at) as prvni, max(a.created_at) as posledni
   from public.advances a
   join public.employees e on e.id = a.employee_id
   where a.stav <> 'stornovana'
   group by e.full_name, a.employee_id, a.business_date, a.castka_haleru
   having count(*) > 1
   order by posledni desc;
   ```

   Dvojice s rozdílem pár vteřin až minut jsou nejspíš zdvojení. Ty se stornují na obrazovce Zálohy. Dvojice s rozdílem hodin můžou být dvě skutečné zálohy, o tom rozhodne ten, kdo je vyplácel.

## Otázky

Žádné nové.

## Na co jsem narazil a nešlo to

- **Do ostré databáze ani do záznamů přihlášení v Supabase jsem neviděl** (nástroj Supabase odmítl oprávnění). Že zdvojené zálohy v databázi opravdu jsou, mám tedy jen z hlášení a z rozboru kódu, ne z dat. Potvrdí to dotaz výš.
- **Skutečné ťuknutí na telefonu jsem nevyzkoušel** a formulář jsem neviděl vykreslený v prohlížeči. Logiku formuláře ověřují kontroly ve `zalohy.test.mjs` a vykreslení skutečné komponenty do HTML.
- Opakovat `krok101` nad touž databází se nedá bez přejmenování. Úklid nesmaže firmu ani uživatele (stejná překážka s auditem jako u `krok57`). Pro schválná rozbití jsem proto scénář pokaždé přejmenoval. `run.sh` staví čistou databázi, tam to nevadí.
- **Mimo zadání, neopravené:** obrazovka Dnes načítá pro „vaše příští směny“ jen prvních 200 směn celé firmy od dneška. Při víc pobočkách to vystačí jen na pár dní dopředu a pozdější směna se neukáže. Nic to neshodí. Nechal jsem to na samostatnou opravu.

## Kde jsem skončil a co zbývá

Oprava zdvojených záloh je hotová celá, čeká jen na sloučení a `db push`. Nic rozdělaného nezůstalo.

## Nenasazoval jsem

Žádný `db push`, žádné sloučení do `main`, žádný zásah do dat.
