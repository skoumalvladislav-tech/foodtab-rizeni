---
name: foodtab-finance
description: Stav modulu Finance ve Foodtabu — sekce Faktury (od 18. 10. 2026 v hlavní databázi, public.faktury, převod ze staré databáze), platby a párování, gastro ERP. Použij dřív, než začneš cokoli stavět pod finance, faktury, suroviny nebo bankovní napojení, aby sis nedomýšlel architekturu, která nebyla rozhodnutá.
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
- **OD 18. 10. 2026 (větev faktury-slouceni, docs/faktury-slouceni-navrh.md)
  jsou faktury v hlavní databázi: `public.faktury`** (česká jména sloupců,
  `castka_haleru`), brána `lib/faktury-pristup.ts` (otevřeno jen ve stavu
  převodu `dokonceno`), čtení VŽDY přes `fakturyFirmy()` (filtr firmy),
  párování přes `sparovat_platbu_s_fakturou` / `zrusit_parovani_faktury`.
  Do sloučení té větve a dokončení převodu platí odstavec níž (stará databáze).
- **Do sloučení: data faktur NEJSOU v hlavní databázi.** Žijí v samostatném Supabase
  projektu `ctqtwahlzhyjerqulqyn` (rozhodnutí Šéfíka 15. 9., „Možnost A").
  Ta databáze nemá sdílené přihlášení a RLS na ní je „allow all" s anon
  klíčem. **Sloupec `tenant_id` v ní NEEXISTUJE** (SQL z
  `docs/hlaseni/faktury-tenant-izolace-2026-10-02.md` nikdy neproběhlo a
  do toho projektu se dnes nikdo nepřihlásí) — dotaz s `.eq('tenant_id', …)`
  spadne a stránka ukáže prázdno (tak to bylo v provozu 3.–8. 10. 2026).
  Databáze je JEDNOFIREMNÍ: izolace stojí na bráně `pristupKFakturam()`
  (`lib/supabase/faktury.ts`), která pustí jen firmu z nastavení prostředí
  `FAKTURY_DB_TENANT_ID` — bez něj nikoho, a NIKDY podle IČO (to si správce
  firmy může přepsat sám). Hlídá to `scripts/faktury-tenant-izolace.test.mjs`.
  `needs_review` je v živé DB vždy false — „ke kontrole" počítej přes
  `potrebujeKontrolu` / `FILTR_KE_KONTROLE` (`lib/faktury-types.ts`).
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

Objednávky dodavatelům, tabulka plateb/transakcí a přiřazení platby
k faktuře, bankovní import, rozpočty, CRM kontaktů (dodavatel je jen
volný text `invoices.supplier`), POS adaptér (Dotykačka), tržby a
cashflow pod `/finance/`, příplatky ve mzdách. Neplet si „Faktury
fungují" s „Finance je hotové".

**Sklad (pohyby, fyzické inventury, příjemky/výdejky) — NEBUDE EXISTOVAT.**
ROZHODNUTÍ ŠÉFÍKA (2. 10. 2026): tohle dělá pokladní systém (Dotykačka),
appka si to nemá duplikovat. Nenavrhuj tabulky skladových pohybů ani
inventur, ani když to zadání (`docs/Foodtab_Claude_Code_nocni_zadani.md`,
oddíl 7) žádá — tenhle bod je rozhodnutím uzavřený. Skutečná (ne jen
teoretická z receptury) spotřeba půjde přes budoucí adaptér na
Dotykačku, až bude.

## Pasti

1. Před jakoukoli prací nad fakturami zjisti, jestli je sloučená větev
   faktury-slouceni. PO sloučení: `invoices` v appce NEEXISTUJE (jen úloha
   převodu `lib/faktury-prevod-sync.ts`), čte se `public.faktury` přes
   `fakturyFirmy()` a filtry/řazení píšou ČESKÁ jména sloupců (aliasy
   v `SLOUPCE_FAKTURY` platí jen pro výstup). PŘED sloučením: dotazy na
   `invoices` přes `pristupKFakturam()` bez `tenant_id` (sloupec tam není).
   Data faktur chtějí `faktury.read` za celou firmu, ne jen `finance.read`.
   Hlídá scripts/faktury-tenant-izolace.test.mjs.
2. Nezaváděj druhý katalog surovin ani druhou tabulku cen — rozšiřuj
   `ingredients` / `ingredient_purchase_prices`.
3. Po sloučení mají párování a evidence příjmu skutečný cizí klíč
   (`faktura uuid` → `faktury(tenant_id, id)`); textové `faktura_id` zůstává
   do úklidu jen kvůli návratu zpět. Volný text zůstává u příjemek, vybavení
   a `source_invoice_id` (otázka 62).
4. Peníze jsou celé haléře (`*_haleru`), výsledky dělení se zaokrouhlují
   na celé haléře (`round(x)`), ne na setiny.
5. Chybějící data se ukazují jako chybějící, ne jako nula.

## Kam dál

`docs/finance-marketing-audit.md` (stav a priority), `docs/data-flows.md`,
`docs/tenant-isolation.md`, `docs/Foodtab_Claude_Code_nocni_zadani.md`
(oddíly 4–7: cílový stav gastro ERP — je to zadání, ne popis dneška).
