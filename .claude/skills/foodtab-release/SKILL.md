---
name: foodtab-release
description: Git a nasazovací kázeň ve Foodtabu — jedna větev na relaci nad jednou sdílenou databází, nasazuje se výhradně z main, db push není nikdy autonomní. Použij, když zakládáš větev, chystáš se sloučit práci do main, nebo se práce blíží k čemukoli, co by mohlo zasáhnout databázi či produkci. Doplňuje skill nasazeni (konkrétní kontrolní seznam před db push).
---

# Větvení a nasazování

Kontrolní seznam bezprostředně před `db push` je ve skillu `nasazeni`.
Tenhle skill je o tom, jak se k tomu bodu vůbec dojde — a proč nikdy
sám od sebe.

## Jedna relace, jedna větev — ale databáze je jen jedna

Na projektu může pracovat víc relací najednou nad **stejnou** databází
(typicky provoz na `main`, jiný modul na vlastní větvi). Tohle se
2. i 3. 9. 2026 srazilo dvakrát: tabulka zabraná jinou prací
(`create table if not exists` tiše nic neudělal) a spadlý scénář
z jiné relace, po kterém nebylo poznat, jestli proběhlé kontroly jsou
celý obrázek.

Čtyři pravidla z toho plynou:

1. **Nasazuje se výhradně z `main`.** Migrace z feature větve se do
   databáze nepouští. Důvod: `supabase/tests/run.sh` staví čistou
   databázi ze všech migrací, které leží v TÉ větvi — na feature větvi
   je jich jen část, takže by testy ověřovaly něco jiného, než co
   poběží v provozu. Postup: slej do `main`, tam prožeň
   `supabase/tests/run.sh`, teprve pak `db push` (skill `nasazeni`).
2. **`create table` bez `if not exists`.** Srážka jmen má spadnout
   nahlas a hned — `if not exists` je pro opakované spouštění, a to
   se tady nedělá (na to je historie migrací).
3. **Scénáře se nečíslují společnou řadou.** Provoz `krokN_scenar.sql`,
   marketing `marketingN_scenar.sql`. Jedna číselná řada pro dvě
   souběžné relace je srážka, která se stane jistě.
4. **`run.sh` musí doběhnout vždycky.** Pustí všechny scénáře,
   na konci vypíše, které spadly, a teprve pak skončí nenulově. Jeden
   rozbitý scénář nesmí schovat zbytek (detaily → `foodtab-e2e`).

**Do cizího modulu nesahej.** Najdeš-li chybu v modulu, který píše
jiná relace, nahlas ji a nech ji tomu, kdo ho píše.

## Proč `db push` nespouští automat z GitHubu

Z `.github/workflows/databaze.yml` byly 7. 9. 2026 **schválně
odstraněny** úlohy `tajemstvi` a `nasazeni` (commit `2166930`). Ne
proto, že by nefungovaly — protože **ostrá data dnes leží v projektu
`foodtab-test`**, na který CI míří. Dokud to platí, stačí, aby někdo
jednou přidal `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`
a `SUPABASE_PROJECT_REF` do nastavení repozitáře — pár kliknutí, nikomu
by to nepřišlo nebezpečné — a od té chvíle každý push do `main` mění
ostrý provoz, aniž to kdokoli odklikne.

> „Je to bezpečné, protože někdo něco nenastavil" **není pojistka, je
> to shoda okolností.** Pojistka je, že na ta tajemství ten soubor
> vůbec nesahá — a nespoléhej na to, že zůstanou nenastavená navždy.

Podmínka na vrácení je věcná, ne kalendářní: až vznikne samostatný
`foodtab-prod` a ostrá data se z `foodtab-test` přesunou, důvod
padá a klíče se smí zavést — proti prod projektu, s testovacím
nasazením mířícím na test. **Nasazuje Šéfík, ne push, dokud tahle
podmínka neplatí.**

## Hranice autonomie relace (`docs/pracovni-rezim-codea.md`)

Relace dělá bez ptaní: čtení repozitáře, opravy chyb, doplnění stavů,
testy, přístupnost, drobný refaktoring pod testy, psaní migrací
(ale ne jejich nasazení), dokumentaci, build.

Relace se **zastaví a vyžádá Šéfíka** u: nasazení čehokoli do databáze
(`db push`, ruční SQL), zásahu do ostrých dat, změny produkčních
proměnných/domény/přihlašování, odeslání e-mailu nebo oznámení
skutečným lidem, provozního pravidla, které není v dokumentech, a **u
jakékoli destruktivní operace v gitu**.

**Zvláštní pravidlo pro zásah do oprávnění:** nedodělaný přepnutí
odkud se berou práva se **necommituje** — ne „dokonči a označ jako
nehotové", ale v repozitáři nesmí ležet nic rozjetého. Poloviční
přepnutí se nepozná jako chyba v kódu, pozná se tak, že někomu chybí
přístup, který mít má.

## Než cokoli nasadíš

Konkrétní kroky (ověření napojeného projektu, `migration list`,
pořadí razítek, měřicí dotazy před rizikovým přepnutím) → skill
`nasazeni`.
