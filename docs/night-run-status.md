# Night run status — gastro ERP + marketing

Větev: `gastro-erp-marketing` (worktree `C:\Users\vladi\foodtab-gastro-erp`,
založeno z `main` @ `7df7292`). Vlastní samostatný `node_modules` (junction na
`foodtab-nasazeni`), nesahá na `foodtab-rizeni` (ten je rozdělaný na jiné
větvi `komunikace-hlasove-zpravy` z jiné relace).

## Hotovo

| Co | Commit | Čeká na db push? |
|---|---|---|
| Instalace skillů `supabase`, `supabase-postgres-best-practices`, `frontend-design`, `webapp-testing` | `70ed0dd` | ne |
| Uložení obou zadávacích dokumentů do `docs/` | `70ed0dd` | ne |
| `docs/finance-marketing-audit.md` — 7 nezávislých auditních průchodů kódem | `f46f354` | ne |
| Faktury: tenant_id izolace fáze 1 (aplikační filtr ve všech dotazech) + regresní test + SQL pro Šéfíka | `19e406b` | **ano — SQL v `docs/hlaseni/faktury-tenant-izolace-2026-10-02.md` musí proběhnout PŘED nasazením tohohle kódu, jinak appka spadne na chybějící sloupec** |
| Baseline `tsc --noEmit` | čistý, bez chyb | — |
| Přepínač firem pro členy víc firem zároveň (P1) + regresní test | `35ae439` | ne |
| `docs/tenant-isolation.md` (povinný výstup) | `f8fb3a1` | — |
| `docs/provider-development.md` (povinný výstup) | `d9ae1cd` | — |
| `docs/integrations-setup.md` (povinný výstup) | `edabb63` | — |
| `docs/data-flows.md` (povinný výstup) | (tento commit) | — |
| Katalog surovin + historie nákupních cen + `app.recipe_cost_per_portion` (P0, oddíl 7 zadání) | **běží na pozadí** (Workflow práce→testy→kontrola→dodělávky; krok69 scénář už vznikl, krok70 a registrace v `run.sh` ještě ne), zatím necommitnuto | — |

## Proč teď jen dokumentace a žádný další kód

`supabase/tests/run.sh` (společný seznam scénářů) právě upravuje běžící
Workflow na katalog surovin. Další DB práce (např. zpevnění dvou křehkých
SECURITY DEFINER vzorů, zálohy/docházka) by do stejného souboru zapisovala
souběžně — čekám, až Workflow doběhne a výsledek se commitne, pak
pokračuji dál (viz "Priority souhrn" v audit dokumentu).

## Zjištění (viz `docs/finance-marketing-audit.md` pro plné znění)

Nejdůležitější: Faktury žijí v oddělené Supabase DB bez tenant_id/RLS (P0);
sklad+katalog surovin+foodcost zcela neexistují (P0); cross-tenant eskalace
práv byla v produkci 17 dní, opravena 25.9., hloubkový sken 115 aktuálně
platných SECURITY DEFINER funkcí nenašel další díru (2 křehké vzory k
zpevnění, P1); produkce má 1 firmu a UI bez přepínače firem (P1); marketingová
publikační fronta je hotová, ale n8n je provozně vypnuté (P0 byznysově).

## Blokery vyžadující lidský krok

1. **Přístup k databázi Faktur** (`ctqtwahlzhyjerqulqyn`, odlišná od hlavní
   `spekntcsuroqhehmjssv`) — potřeba pro opravu tenant izolace. Supabase MCP
   v této relaci nemá připojený žádný projekt (`list_projects` vrátil prázdno).
2. **`.env.local`** (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
   — chybí v každém worktree, které jsem našel. Bez něj nejde spustit `next dev`
   proti reálné testovací databázi a testovat v prohlížeči. Anon klíč není
   tajný (jde do prohlížeče), jde bezpečně předat.
3. **Ověření produkčních Realtime logů** (claims_role po PR #92) — nemám
   přístup k Vercel/Supabase produkčním logům (MCP nástroje vrací 403/prázdno).
4. **n8n marketingový webhook** je provozně vypnutý — rozhodnutí, zda a kdy
   ho znovu zapnout, patří vlastníkovi (provozní riziko, ne kódová chyba).

## Další krok (bez čekání na blokery výše)

Pokračuji implementací P0 oblasti, která blokery výše nepotřebuje: společný
datový model pro sklad/suroviny/nákupní ceny (oddíl 4 a 7 zadání) —
aditivní migrace + PGlite scénáře, stejně jako celý dosavadní vývoj v tomto
projektu. Priority a pořadí viz "Priority souhrn" na konci audit dokumentu.

## Rozhodnutí

- Model/effort: relace běžela na Sonnet 5 / aktuální effort; uživatel zvolil
  přepnout na Opus + high, ale nástroj pro změnu modelu vlastní relace je
  záměrně blokovaný ("a session must not silently re-price its own turns") —
  přepnutí čeká na uživatele přímo v UI aplikace.
- Nová práce jde do samostatného worktree/větve (`gastro-erp-marketing`), ne
  do `foodtab-rizeni` ani žádné existující feature větve — podle zavedené
  konvence projektu (jedna větev na jednu souvislou práci).
