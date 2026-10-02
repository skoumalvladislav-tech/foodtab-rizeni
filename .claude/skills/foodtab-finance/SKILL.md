---
name: foodtab-finance
description: Stav modulu Finance ve Foodtabu — od 15. 9. 2026 existuje sekce Faktury (data v oddělené databázi), gastro ERP (sklad, nákup, foodcost, platby) zatím prakticky ne. Použij dřív, než začneš cokoli stavět pod finance, faktury, suroviny nebo bankovní napojení, aby sis nedomýšlel architekturu, která nebyla rozhodnutá.
---

# Modul Finance — stav k 2. 10. 2026

Předchozí verze tohohle skillu (14. 9.) tvrdila, že Finance neexistuje.
Od 15. 9. 2026 to neplatí — viz `docs/hlaseni/FOODTAB-CURRENT-HANDOFF.md`
a plný rozbor v `docs/finance-marketing-audit.md` (2. 10. 2026). Tenhle
skill je mapa a seznam pastí, ne zadání.

## Co existuje

- **Faktury** (`app/[rozsah]/finance/faktury/*`, `lib/faktury-*.ts`,
  `lib/supabase/faktury.ts`, `app/api/faktury/export`): 8 obrazovek,
  9 serverových akcí, CSV export. Oprávnění `faktury.read` / `faktury.manage`
  pod modulem `finance` (migrace `20260915100000_modul_faktury.sql`).
  Modul se zapíná per firma ručním řádkem v `tenant_modules`.
- **Data faktur NEJSOU v hlavní databázi.** Žijí v samostatném Supabase
  projektu `ctqtwahlzhyjerqulqyn` (rozhodnutí Šéfíka 15. 9., „Možnost A").
  Ta databáze nemá sdílené přihlášení a RLS na ní je „allow all" s anon
  klíčem. Izolace zákazníků je proto zatím JEN aplikační: každý dotaz
  filtruje `.eq('tenant_id', tenantId)` (fáze 1, 2. 10. 2026) — a pojistku
  proti zapomenutému filtru drží `scripts/faktury-tenant-izolace.test.mjs`.
  Sloupec `tenant_id` v té databázi musí doplnit Šéfík ručním SQL
  (`docs/hlaseni/faktury-tenant-izolace-2026-10-02.md`) PŘED nasazením.
  Skutečná RLS (fáze 2) potřebuje JWT Secret toho projektu — nerozhodnuto.
- **Katalog surovin a nákupní ceny** (od 2. 10., migrace
  `20261002100000_sklad_suroviny_zaklad.sql`): `ingredients`,
  `ingredient_purchase_prices` (insert-only historie), vazba
  `recipe_ingredients.ingredient_id`, `app.recipe_cost_per_portion`.
  Oprávnění `purchasing.read` / `purchasing.manage` (modul `objednavky`).
  Výpočet vrací NULL + seznam chybějících položek, nikdy tichý odhad;
  jednotka receptury se musí shodovat se základní jednotkou suroviny.
- Rezervované, nepoužité: `banking.read`. Závazné rozhodnutí z CLAUDE.md:
  **banka je výhradně pro čtení, nikdy platební příkazy.**

## Co NEexistuje (ověřeno čtením kódu 2. 10.)

Sklad (pohyby, inventury, příjemky), objednávky dodavatelům, tabulka
plateb/transakcí a přiřazení platby k faktuře, bankovní import, rozpočty,
CRM kontaktů (dodavatel je jen volný text `invoices.supplier`), POS adaptér
(Dotykačka), tržby a cashflow pod `/finance/`, příplatky ve mzdách.
Neplet si „Faktury fungují" s „Finance je hotové".

## Pasti

1. Před jakoukoli prací nad fakturami: každý nový dotaz na `invoices`
   MUSÍ filtrovat `tenant_id` (test to hlídá, ale nespoléhej na to).
2. Nezaváděj druhý katalog surovin ani druhou tabulku cen — rozšiřuj
   `ingredients` / `ingredient_purchase_prices`.
3. Faktury a hlavní databáze jsou dva projekty: nelze mezi nimi dělat FK
   ani join. Vazba je volný text (`ingredient_purchase_prices.source_invoice_id`).
4. Peníze jsou celé haléře (`*_haleru`), výsledky dělení se zaokrouhlují
   na celé haléře (`round(x)`), ne na setiny.
5. Chybějící data se ukazují jako chybějící, ne jako nula.

## Kam dál

`docs/finance-marketing-audit.md` (stav a priority), `docs/data-flows.md`,
`docs/tenant-isolation.md`, `docs/Foodtab_Claude_Code_nocni_zadani.md`
(oddíly 4–7: cílový stav gastro ERP — je to zadání, ne popis dneška).
