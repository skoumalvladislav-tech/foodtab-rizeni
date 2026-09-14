---
name: foodtab-e2e
description: Jak jsou ve Foodtabu strukturované a spouštěné testy — scripts/*.test.mjs, supabase/tests/run.sh, rozdíl mezi PGlite a opravdovým PostgreSQL. Použij, když píšeš nový testovací skript, spouštíš testovací sadu, nebo se ptáš, co který soubor pokrývá. Doplňuje skill scenar (JAK napsat kontrolu, co umí spadnout) o mapu toho, co dnes existuje a jak se to pouští.
---

# Testovací sada Foodtabu — mapa a spouštění

Metodika psaní kontroly („rozbij to schválně a podívej se") je ve
skillu `scenar`. Tenhle skill je průvodce tím, co dnes existuje.

## Dvě různé databázové cesty — nejsou zaměnitelné

```bash
node scripts/scenare-pglite.mjs        # rychlé, běží v Node, PGlite
supabase/tests/run.sh                  # pomalé, opravdový PostgreSQL 15+
```

**PGlite běží jako jediný uživatel a je to superuživatel.**
`set role authenticated` tam nedělá to co na Supabase — RLS se
z velké části neuplatní a sloupcové granty vůbec. Kontroly typu
„cizí firma to nevidí" tam projdou i nad rozbitou politikou.

**Zelený běh PGlite není důkaz, že je hotovo.** Rozhoduje workflow
Databáze proti PostgreSQL 16 (`supabase/tests/run.sh`), ne lokální
běh. Detaily „proč se to liší" → skill `foodtab-db-security`.

## `supabase/tests/run.sh` — co dělá

1. Postaví čistou databázi (`dropdb`/`createdb`), pustí
   `00_harness.sql` (napodobenina `auth.users`/`auth.uid`/rolí).
2. Pustí všechny migrace ze `supabase/migrations/` popořadě.
3. Pustí provozní scénáře `krokN_scenar.sql` (vlastní číselná řada).
4. Pustí marketingové scénáře `marketingN_scenar.sql` (**oddělená**
   číselná řada — `foodtab-release`, pravidlo o dvou relacích).
5. Pustí seed dvakrát (`supabase/seed/test-provoz.sql` a
   `test-marketing.sql`) a ověří, že druhý běh nic nezdvojil.
6. **Doběhne vždycky** — jeden spadlý scénář se zapíše do `SPADLE`
   a pokračuje se dál, číslo kontrol se sčítá jen z toho, co proběhlo.
   Nenulově končí až na konci, ne na první chybě.

Přidáváš-li nový scénář, musí se zapsat do smyčky v `run.sh` **i** do
kontroly hlášek v `.github/workflows/databaze.yml` — jinak může padat,
aniž si toho kdo všimne.

## `scripts/*.test.mjs` — co která skupina pokrývá

| Skupina | Příklad | Co ověřuje |
|---|---|---|
| Čtení dat a import | `tabulka.test.mjs`, `xlsx.test.mjs`, `nahrani-lidi.test.mjs`, `prideleni.test.mjs` | co se stane dřív, než data dorazí do DB — čtení CSV/XLSX, plán nahrávání, strop oprávnění |
| Čitelnost scénářů | `scenare.test.mjs` | že SQL soubor nemá ztracený znak (`\echo`→`echo`, `do $$`→`do $`) |
| Pořadí scénářů | `scenare-poradi.test.mjs` | konzistence číselné řady |
| Čas | `cas.test.mjs` | `lib/cas.ts` — formátování v pásmu pobočky |
| Marketing | `marketing-*.test.mjs` (přes 20 souborů) | jednotlivé `lib/marketing-*.ts` moduly, granty (viz níže) |
| Ostatní doménové | `zalohy`, `rozpis`, `sablony`, `dochazka-stav`, `nabidka`, `email`, `penize`, `qr`, `sklonovani`, `manifest`, `prihlaseni`, `upozorneni`, `ranni-prehled`, `adresa`, `vlozky`, `barvy-lidi` | čistá logika vytažená z `lib/`, aby šla spustit bez serverové komponenty |

Spuštění bez sestavení: `node --experimental-strip-types
scripts/xxx.test.mjs`. Proto mají importy v `lib/` mezi sebou
příponu **`.ts`** a `tsconfig.json` má `allowImportingTsExtensions` —
bez přípony to Node nenajde.

**`scripts/marketing-granty.test.mjs`** je zvláštní případ: neběží
nad databází vůbec, prochází **text** migračních souborů a ptá se,
jestli ke každé `marketing_*` tabulce existuje `revoke`. Tenhle typ
kontroly (nad zdrojovým textem, ne nad běžící DB) je jediný způsob,
jak chytit chybějící `revoke` dřív, než se nasadí — PGlite to
neověří (`foodtab-db-security`). Pro provozní tabulky obdobná
kontrola zatím neexistuje.

**`scripts/barvy.js`** — kontrast a rozlišitelnost barevné palety
(`app/_tokeny.css`, `app/globals.css`). Měří dvě různé věci: kontrastní
poměr (čitelnost textu) a ΔE2000 (rozlišitelnost dvou barev od sebe) —
jedno druhé nenahrazuje. Vrací 1 při propadu, dá se pověsit do CI.

## Kdy napsat čistou funkci místo testování komponenty

Když logika sedí zavřená v serverové komponentě a nejde ji spustit
izolovaně, vytáhni ji do čisté funkce v `lib/` — přesně proto vznikl
`lib/dochazka-stav.ts`. Bez toho testuje kontrola vlastní očekávání
vedle kódu, ne kód sám (`scenar`, bod 2).

## Než hlásíš čísla

„X kontrol prošlo" bez „z čeho" je bezcenné — viz skill `scenar`,
bod 4, a `hlaseni`.
