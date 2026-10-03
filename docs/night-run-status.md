# Night run status — Finance a účetnictví (gastro ERP)

Větev: `finance-ucetnictvi-erp` (worktree `C:\Users\vladi\foodtab-finance-erp`,
založeno z `main` @ `6609630`, tj. po nasazení katalogu surovin/receptur
2. 10. 2026). Vlastní samostatný `node_modules` (junction na
`foodtab-nasazeni`).

Předchozí noc (gastro ERP + marketing, `gastro-erp-marketing` větev) je
hotová a sloučená — vlastní historie v `main`, ne tady. Tenhle soubor
popisuje JEN tuhle novou práci (Finance/účetnictví).

Plán: `C:\Users\vladi\.claude\plans\proud-scribbling-glade.md`, oddíl
„Finance a účetnictví — gastro ERP modul" (odsouhlasený Šéfíkem
2.–3. 10. 2026). Zadání: `docs/Foodtab_Claude_Code_nocni_zadani.md`,
oddíly 4–11 (cílový stav), 12 (priority), 13 (akceptační scénáře).

## Závazný mantinel

**Sklad/inventury (fyzické pohyby, příjemky/výdejky, šarže) se NESTAVÍ.**
Rozhodnutí Šéfíka 2. 10. 2026 (`eb9bd63`, v `main`) — dělá to Dotykačka,
appka si to nemá duplikovat. Teoretická spotřeba (recept × prodané
množství) ano, fyzická inventura nikdy. Platí pro celou tuhle práci,
i když původní zadání o skladu mluví.

## Hotovo

| Co | Commit | Čeká na db push? |
|---|---|---|
| Krok 0: donesena izolace Faktur z `gastro-erp-marketing` (`19e406b`), vyřešen 1 triviální konflikt v `aplikace.yml` | `4c98277` | ano — stejné SQL jako minule, `docs/hlaseni/faktury-tenant-izolace-2026-10-02.md`, v DB Faktur (`ctqtwahlzhyjerqulqyn`), Šéfík zatím nespustil |
| Ověření kroku 0: `node scripts/faktury-tenant-izolace.test.mjs` (OK), `tsc --noEmit` (čisté) | — | — |

## Další krok

Migrace P0 podle plánu: `integrace_pripojeni`/`integrace_tajemstvi` (registr
poskytovatelů), `kontakty`, `platebni_ucty`/`transakce`, `platby_faktury`
(párování), `predpisy_plateb`, `app.cashflow_prehled`. Pak aplikační kód
(`app/[rozsah]/finance/layout.tsx` jako deštník nad existujícím `faktury/`).

## Rozhodnutí a otázky

(zapisovat sem průběžně, podle zadání oddíl 2: „Otázky a předpoklady
zapisuj do dokumentace a pokračuj v nezávislé práci" — neptat se a čekat.)
