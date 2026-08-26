# Foodtab — Etapa 0: rámec odsouhlasen

Plná specifikace (verze 3): https://claude.ai/code/artifact/b598a3a4-45e3-446c-97ec-397fad8cf5d3

**Stav: všechna zásadní rozhodnutí potvrzena. Další krok = migrace a autorizační vrstva.**

## Architektura

- **Databáze:** Supabase Postgres, region Frankfurt. Cloudflare D1 se opouští.
- **Framework:** odchod z `vinext` na běžný Next.js.
- **Hosting:** Hetzner + Coolify, Německo. Cloudflare jen jako DNS, TLS a ochrana.
- **Domény:** `app.foodtab.cz` (produkce), `test.foodtab.cz`, `n8n.foodtab.cz`, `foodtab.cz` (prezentace).
- **`tenant_id`** v datech od začátku; rozhraní zůstává jednofiremní.

## Moduly (zapínají se za celou firmu)

| Modul | Klíč | Stav | Obsah |
|---|---|---|---|
| Provoz | `provoz` | **vždy** | Směny, docházka, úkoly, checklisty, komunikace, receptury, lístky, motivace, **Gastro AI** |
| Finance a účetnictví | `finance` | volitelný | Tržby, náklady, faktury, závazky, banka |
| Marketing | `marketing` | volitelný | Menu do příspěvků, kalendář, publikace |
| Objednávky | `objednavky` | volitelný | Dodavatelé, ceníky, objednávky, příjemky, sklad |

Přístup = **modul aktivní ∧ role má oprávnění ∧ rozsah pokrývá pobočku ∧ členství aktivní.**

Gastro AI v základu → náklad ošetřen `tenant_modules.limits`. **Číslo limitu zatím neurčeno.**

## Rozsah firma / pobočka

Neomezený počet poboček, dvě úrovně, přepínač v hlavičce. Rozsah je v adrese. Server ověřuje povolený rozsah z členství u každého požadavku. `branch_id NULL` = firemní úroveň. Od ~10 poboček předpočítávat `branch_daily_stats`.

## Lidé a přístupy

- **Zaměstnanec ≠ účet.** `employees.user_id` je volitelné — brigádník jde plánovat na směny bez přihlášení.
- **Role a oprávnění jsou data**, definovatelné per firma.
- **Vstup jen na pozvánku**, kanál e-mail **nebo SMS**. Telefon je plnohodnotný přihlašovací údaj.
- **SMS jako jediný způsob přihlášení jen u rolí bez citlivých oprávnění.** Kdo vidí finance, mzdy nebo spravuje lidi → e-mail + druhý faktor (riziko přenesení čísla na cizí SIM).
- Hromadný import zaměstnanců z tabulky + rozeslání pozvánek jedním krokem.

## Napojení pokladny — tři úrovně

1. **Nativní konektor** (Storyous, Dotykačka, Choice QR…) — Foodtab si data tahá sám
2. **Obecný příjem** — webhook / FTP / e-mail export s nastavitelným mapováním sloupců
3. **Ruční import** denní uzávěrky — pojistka, aby šlo napojit i pokladnu bez API

Sjednocený model: `pos_connections`, `pos_sales_daily`, `pos_sales_items`, `pos_payments`, `pos_item_mappings`.

⚠️ **`business_date` ≠ datum účtu.** Účet z 2:15 patří do včerejší uzávěrky; odvozuje se z otevírací doby pobočky. Každý import má otisk kvůli idempotenci.

## Účetní a mzdové výstupy

Účetní dostává: tržby, přijaté faktury, podklady pro mzdy, pohyby na účtu.

Doručení dvěma cestami: **vlastní účet s rolí Účetní** (`finance.read` + `payroll.export`, auditované) a **exporty** (ISDOC, XLSX, Pohoda/Money XML). **Nikdy e-mailem jako příloha.**

**Hranice:** Foodtab ukládá hodiny, absence, sazby a typ poměru. **Neukládá** rodné číslo, číslo účtu, pojišťovnu, srážky ani vypočtenou čistou mzdu — to patří mzdové účtárně.

Sazby v samostatné tabulce `employee_wages` s vlastním oprávněním `payroll.manage`, nikdy v seznamech, nikdy v promptu modelu.

Vyžaduje: záznam o činnostech zpracování, zpracovatelskou smlouvu s účetní, informaci pro zaměstnance, retenční lhůty.

## Banka

Jen pro čtení, vynuceno `CHECK (access_scope = 'read_only')`. Konkrétní banka později.

## Kdo a kdy staví

Vývojářský tým nastupuje **až po odzkoušení finální verze v ostrém provozu obou provozoven**. Do té doby je specifikace stavební plán, ne předávací protokol. Hotová a vyzkoušená musí být minimálně etapa 0 + modul Provoz.

Pořadí po etapě 0: **pokladna → objednávky → finance a účetní výstupy → agenti → marketing.**


## Hotovo: krok 1 — základ na Postgresu (23. 8. 2026)

Pět migrací, 1 605 řádků, 34 procházejících kontrol. Ověřeno proti čistému PostgreSQL 16
s napodobeninou `auth.users` / `auth.uid()`. **Proti skutečnému Supabase zatím neběželo.**

| Soubor | Obsah |
|---|---|
| `20260823115000_drop_legacy.sql` | Odstraní `user_access` a její triggery |
| `20260823120000_foundation.sql` | Firma, pobočky, pozice, lidé, role, moduly, pozvánky, audit |
| `20260823120100_catalog.sql` | Katalog modulů a oprávnění, šablony rolí |
| `20260823120200_authz.sql` | `app.has_access()` + RLS nad každou tabulkou |
| `20260823120300_tenant_setup.sql` | `create_tenant`, `create_invitation`, `accept_invitation` |

Testy: `supabase/tests/run.sh`.

Ověřené vlastnosti: modul vypnutý → oprávnění neúčinné; vedoucí pobočky nevidí cizí
pobočku ani firemní úroveň; cizí uživatel nevidí nic; citlivou roli nejde pozvat přes SMS;
pozvánka je jednorázová a nejde přijmout pod cizím účtem; v DB je jen otisk tokenu;
audit nejde změnit ani smazat; základní modul nejde vypnout; firma má právě jednoho vlastníka.

### Následuje
Krok 2 — provozní tabulky (směny, docházka, úkoly, checklisty, komunikace, receptury,
lístky, motivace) s RLS a `branch_id NULL` = firemní úroveň.

## Nálezy ve stávajícím kódu

- **Na prázdné databázi se do aplikace nedostane nikdo.** Trigger zakládá uživatele jako `pending`, schválit může jen administrátor, kterého nemá kdo vytvořit.
- `app/api/access/route.ts` — `allowedBranches` natvrdo obsahuje obě pobočky; nové pobočce nejde nikoho přiřadit.
- Role jsou `CHECK` constraint → přidání role = migrace.
- `app/dashboard.tsx` má 4 651 řádků včetně pevných seznamů navigace. Rozdělení na komponenty je podmínkou pro vypínatelné moduly.
- `vinext 0.0.50` je předverze.
- V historii repa (15 commitů) **žádné uniklé klíče**.

## Otevřené otázky

1. Měsíční limit dotazů Gastro AI v základu?
2. Které pokladny běží na vašich provozovnách?
3. Kde dnes leží směrnice, HACCP a smlouvy?
4. V čem pracuje účetní? (Pohoda / Money / Fakturoid / iDoklad)
5. Retenční lhůty pro docházku a mzdové podklady — potvrdit s účetní.
6. SMS brána — preferovaný poskytovatel?
