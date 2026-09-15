---
name: foodtab-marketing
description: Modul Marketing ve Foodtabu — schéma, oprávnění marketing.read/manage/publish, navigace (lib/marketing-navigace.ts), obsahová pipeline a stav obrazovek. Použij při práci na čemkoli pod app/[rozsah]/marketing/, lib/marketing-*.ts, nebo když se řeší, co je v marketingu hotové a co ne.
---

# Modul Marketing

Marketing je plnohodnotný modul Foodtabu od rozhodnutí Šéfíka
9. 9. 2026 (`docs/marketing-je-modul.md`). Aktuální stav vždy ověř
v `docs/FOODTAB-MASTER-AUDIT-2026-09-14.md` (nebo novějším auditu) —
tenhle skill je mapa souborů a pravidel, ne snímek stavu, který by
tu zastarával.

## Oprávnění

`marketing.read`, `marketing.manage`, `marketing.publish`
(`lib/authz.ts`, `PERMISSIONS`). Modul se zapíná/vypíná za celou
firmu (`isModuleActive(ctx, 'marketing')`) — vypnutý modul odmítá
i přímé volání, ne jen položku v navigaci (`foodtab-core`).

## Schéma a bezpečnost

19 tabulek `marketing_*`, RLS všude. Granty byly dvakrát dodatečně
uklizeny — `20260913180000_marketing_granty_uklid.sql` (revoke pro
anon/authenticated) a `20260914190000_marketing_granty_uklid2.sql`
(revoke truncate). Než píšeš novou `marketing_*` tabulku, přečti
skill `foodtab-db-security` — týhle třídy chyby se tu stalo dvakrát.

## Navigace (implementováno 14. 9. 2026, krok 1 zadání)

Vzor je závazně převzatý ze samostatné původní aplikace
(`marketing-ai/app/[provozovna]/navigace.tsx`, commit `6cb7d72`,
před smazáním `d8a0b73`; referenční kód dál dostupný přes
`git show 6cb7d72:marketing-ai/...`).

- `lib/marketing-navigace.ts` — čistá funkce `sestavNavigaci(rozsah,
  smi, cekajici)`, žádné React, žádné IO. Filtruje položky podle
  oprávnění a skládá spodní lištu (5 zkratek, doplňovaná dalšími
  v pořadí, bez duplicit). `aktivniKlic()` vybírá aktivní položku
  nejdelší shodou cesty.
- `app/[rozsah]/marketing/layout.tsx` — server komponenta, natáhne
  kontext (`getContext`, `canSee`, `isModuleActive`) a počet čekajících
  ke schválení (`marketing_schvaleni`, `stav = 'ceka'`). Chyba
  z počítadla se polkne na 0, ať kvůli chybějící migraci nespadne celý
  modul.
- `app/[rozsah]/marketing/navigace.tsx` — klientská komponenta,
  vykreslí levý sloupec (od 1024 px) a spodní lištu.

**Schovaná položka v navigaci není zámek** — každá obrazovka si
přístup ověřuje sama přes `app.has_access` (`foodtab-core`,
pravidlo 5).

## Content pipeline — kde co je

| Soubor | Co |
|---|---|
| `lib/marketing.ts` | základní typy a sdílené pomůcky |
| `lib/marketing-ai.ts` | AI návrh textu příspěvku — viz `foodtab-ai` |
| `lib/marketing-menu-ai.ts` | čtení menu z fotky/PDF — viz `foodtab-ai` |
| `lib/marketing-menu-text.ts` | čtení menu ze strukturovaného textu (bez modelu) |
| `lib/marketing-kalendar.ts`, `-kampane.ts`, `-schvalovani` (v akce.ts) | kalendář, kampaně, schvalovací fronta |
| `lib/marketing-kanaly.ts`, `-n8n.ts`, `-odeslani.ts` | kanály publikování, napojení na n8n |
| `lib/marketing-media.ts`, `-obrazek.ts` | mediální knihovna, práce s obrázky |
| `lib/marketing-katalog.ts`, `-sablony.ts` | katalog a šablony obsahu |
| `lib/marketing-klice.ts` | zákaznické API klíče (šifrované v `marketing_tajemstvi`) |
| `lib/marketing-audit.ts` | tým, role, audit log modulu |
| `lib/marketing-odkazy.ts` | UTM a zkracování odkazů |
| `lib/marketing-pruvodce.ts` | průvodce prvním spuštěním |
| `lib/marketing-formaty.ts`, `-text.ts` | formátovací a textové pomůcky |
| `lib/marketing-navigace.ts` | navigace (výše) |

Testy k modulu: `scripts/marketing-*.test.mjs` (Node) a
`supabase/tests/marketingN_scenar.sql` (DB, vlastní číselná řada
oddělená od provozu — `foodtab-release`).

## Otevřené resty (ověř datum v master auditu)

K 14. 9. 2026 podle `docs/FOODTAB-MASTER-AUDIT-2026-09-14.md`:
chybí průvodce vytvořením (3 módy — priorita P1), renderer grafiky
SVG→PNG přes `sharp` (P1), detail fotky s podepsanými adresami (P2),
E2E v Playwrightu (P2), stahování metrik ze sítí (P3, chybí připojený
účet), n8n pro Facebook na straně n8n (Foodtab to od 14. 9. umí, n8n
strana ne). Zadání pro další kroky: `docs/zadani-marketing-pro-codea.md`
a `docs/hlaseni/zadani-pro-ai-marketing-faktury.md`.

## Pravidlo o cizím modulu

Provoz a marketing můžou běžet ve dvou relacích zároveň nad stejnou
databází. **Do cizího modulu nesahej** — najdeš-li chybu v tom
druhém, nahlas ji a nech ji tomu, kdo ho píše. Branching a testovací
kázeň pro souběh dvou relací → skill `foodtab-release`.
