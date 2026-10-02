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
| Marketing: test zkoušky spojení + oprava reálné díry (klíč v chybě sítě mohl utéct do hlášky) | `c8353a9` | ne |
| Katalog surovin + historie nákupních cen + `app.recipe_cost_per_portion` (P0, oddíl 7 zadání) | `3ae449d` | ne (aditivní, ale db push po sloučení) |

## Zádrhel ve workflow na sklad/suroviny — řešeno osobní kontrolou

Fáze "Práce" i "Testy" workflow (práce→testy→kontrola→dodělávky) odvedly
solidní, osobně ověřenou práci — opravily neplatnou SQL syntaxi, chybějící
druhou linii obrany a immutabilitu historie cen, napsaly 42 mutačně
ověřených kontrol (`krok69`/`krok70_scenar.sql`). **Ale fáze "Kontrola"
(bezpečnostní review) a "Dodělávky" se zmátly** — místo zadané recenze
katalogu surovin se obě chybně rozhodly, že mají "najít modul Faktury"
(text, který patřil do téhle konverzace se mnou, ne do jejich zadání), a
bezpečnostní review katalogu surovin vůbec neprovedly. Korektnostní
review (druhý souběžný recenzent) zmatené nebylo a našlo 2 reálné nálezy.

**Nedůvěřoval jsem samoobslužné zprávě workflow** — sám jsem přečetl
výslednou migraci, oba scénáře a `run.sh`, spustil `node
scripts/scenare-pglite.mjs` (2894 kontrol), a opravil oba korektnostní
nálezy sám (Nález A: chybějící kontrola shody jednotky — vážné, tiše
špatný výsledek; Nález B: nekonzistentní zaokrouhlení — drobné), včetně
mutačního ověření opravy A. Bezpečnostní review katalogu surovin, který
workflow nedodal, jsem udělal čtením sám při verifikaci (RLS, granty,
druhá linie — vše v migraci existuje a odpovídá vzoru `krok58`).

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

## Další krok

Katalog surovin/cen je hotový (viz výš) — zbytek P0/P1 seznamu z audit
dokumentu ("Priority souhrn") zatím nedotčený: sklad (pohyby/inventury),
UI pro Tvorbu menu/receptur (teď už by stavělo na reálném katalogu surovin,
dřív by to bylo předčasné), dva křehké SECURITY DEFINER vzory
(zálohy/docházka — vyžaduje novou migraci + úpravu `run.sh`), procure-to-pay
(platby/transakce), marketingové CRM/GDPR. Žádný další souběžný Workflow
neběží, takže `supabase/tests/run.sh` je teď volné pro další práci.

## Rozhodnutí

- Model/effort: relace běžela na Sonnet 5 / aktuální effort; uživatel zvolil
  přepnout na Opus + high, ale nástroj pro změnu modelu vlastní relace je
  záměrně blokovaný ("a session must not silently re-price its own turns") —
  přepnutí čeká na uživatele přímo v UI aplikace.
- Nová práce jde do samostatného worktree/větve (`gastro-erp-marketing`), ne
  do `foodtab-rizeni` ani žádné existující feature větve — podle zavedené
  konvence projektu (jedna větev na jednu souvislou práci).
