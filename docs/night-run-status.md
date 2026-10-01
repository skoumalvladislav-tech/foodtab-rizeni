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
| `docs/finance-marketing-audit.md` — 7 nezávislých auditních průchodů kódem | (tento commit) | ne |
| Baseline `tsc --noEmit` | čistý, bez chyb | — |

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
