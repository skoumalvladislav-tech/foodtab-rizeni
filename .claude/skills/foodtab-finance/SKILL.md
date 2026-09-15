---
name: foodtab-finance
description: Stav modulu Finance ve Foodtabu — z velké části NEEXISTUJE, jen rezervované jméno modulu a oprávnění. Použij dřív, než začneš cokoli stavět pod finance nebo bankovní napojení, aby ses nedomýšlel architekturu, která zatím nebyla rozhodnutá.
---

# Modul Finance — stav k 14. 9. 2026

**Tenhle skill schválně nepopisuje, jak má finance fungovat — protože
to zatím nikde není rozhodnuté.** Cílem je zabránit tomu, aby si
relace domyslela schéma nebo obrazovky bez zadání.

## Co existuje

- Slot v systému modulů: `MODULES` v `lib/authz.ts` obsahuje
  `'finance'`, takže firma modul teoreticky může zapnout.
- Rezervovaná oprávnění v `PERMISSIONS` (`lib/authz.ts`):
  `finance.read`, `finance.manage`, `banking.read`.
- Jedno závazné rozhodnutí z CLAUDE.md, „Závazná rozhodnutí":
  **Banka je výhradně pro čtení, nikdy platební příkazy.** Cokoli
  budoucího napojení na bankovní API musí tohle dodržet od první
  řádky — nejde to „nejdřív udělat a pak zabezpečit".

## Co NEexistuje

Podle `docs/FOODTAB-MASTER-AUDIT-2026-09-14.md`, oddíl „MODUL:
FINANCE": žádný `app/[rozsah]/finance/` adresář, žádné migrace,
žádné tabulky, žádná obrazovka. Status: **CHYBÍ**.

Poznámka k oddělenému projektu Faktury (`skoumalvladislav-tech/
faktury-app`): je to blízký, ale **samostatný produkt** s vlastní
databází (`ctqtwahlzhyjerqulqyn`, jiný Supabase projekt než Foodtab).
Sloučení do Foodtabu je otevřená architektonická otázka, na kterou
čeká Šéfíkovo rozhodnutí (viz master audit, oddíl „Architektonická
otázka"). Neplet si přebírání faktur s modulem finance výše — dokud
Šéfík nerozhodne o sloučení, jsou to dvě různé věci.

## Než začneš cokoli psát

Podle CLAUDE.md, „Jak spolu pracujeme": *„Ptej se jen na to, co
v dokumentech není."* U financí dnes není napsané skoro nic — takže
se ptá skoro na všechno: jaké obrazovky, jaké tabulky, jaký vztah
k modulu Faktury. Nedomýšlej si pravidla provozu restaurace ani
architekturu, která nebyla odsouhlasená.

Až vznikne zadání pro finance (obdoba `docs/etapa0-specifikace.md`
pro základ nebo `docs/marketing-zadani.md` pro marketing), doplň do
tohohle skillu: schéma tabulek, oprávnění v akci, vztah k modulu
Faktury, a odkaz na to zadání. Do té doby tenhle soubor zůstává
záměrně tenký.
