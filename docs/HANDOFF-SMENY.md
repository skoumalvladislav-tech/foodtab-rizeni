# HANDOFF — Rozpis směn

Stav k 21. 9. 2026, `main` = `87fb7a6` (PR #54–#58). Stručný technický stav pro
další práci; historii vývoje hledej v Gitu. **Zdroj pravdy je kód, databáze,
migrace a testy — tenhle soubor jen ukazuje, kam se dívat.**

## Stav

**Hotovo a nasazeno na `main` (Vercel Production `success`):**

- Rozpis na počítači: týden / 7 dní / den / měsíc / celý měsíc 1–2 lidí, filtry,
  „Zobrazit“ (pobočka + úsek), pruh vydání, panel ke směně, kontrola změn před
  vydáním. Telefon: denní přehled, týden, moje směny, detail směny.
- Export měsíce do Excelu a PDF (A4 na výšku, jedno sdílené dělení lidí na
  stránky pro oba formáty: `lib/rozpis-rozlozeni.ts`).
- Puntík u času směny: červený (nevydáno) / žlutý (vydáno, nepotvrzeno) / zelený
  (vydáno a potvrzeno), legenda v liště nad mřížkou.
- Skutečné potvrzení směny zaměstnancem (tlačítko v detailu na telefonu).
- Nastavení → Směny (nabízet výběr zařazení ve formuláři nové směny).
- Opravy: Dnes nepadá u účtu bez domovské pobočky, nabídka Export se zavírá.

**Kód je nasazený, ale tři migrace ještě nejsou v databázi** (nasazuje je Šéfík,
ne relace; k 20. 9. 2026 večer nebyly v `foodtab-test`, ověř
`list_migrations`): `20260920100000_stav_potvrzeni_smen` (zrušena hned další),
`20260920120000_potvrzeni_smen`, `20260920130000_nastaveni_smeny`. Bez nich aplikace
funguje: vydané směny nemají puntík a lišta říká „Potvrzení zatím nejsou
k dispozici“; výběr zařazení se nabízí jako dřív.

## Architektura

- **Stránka:** `app/[rozsah]/smeny/page.tsx` (server: načte okno směn, lidi,
  úseky, pozice, práva, vydání, potvrzení) → `rozpis.tsx` (`RozpisView`, klient,
  přepíná desktop a mobil) → `desktop/*` (`mrizka`, `mesic-lidi`, `nastroje`,
  `panel-ke-smene`, `vydani`, `hlavicka-smeny`) a `mobil/*`.
- **Formulář směny:** `formular-smeny.tsx` → server akce `smena.ts`
  (`ulozitSmenu`, `smazatSmenu`) → SQL `ulozit_smenu` / `smazat_smenu`.
- **Čistá logika (bez Reactu, testovaná Nodem):** `lib/rozpis-desktop.ts`
  (stav směny, filtry, mřížka, puntík, platnost potvrzení), `lib/rozpis-mobil.ts`,
  `lib/rozpis-konstanty.ts` (pohledy), `lib/smeny-formular.ts` (zařazení ve
  formuláři), `lib/rozpis-export.ts` (model exportu), `lib/rozpis-export-xlsx.ts`,
  `lib/rozpis-export-pdf.ts`, `lib/rozpis-rozlozeni.ts`, `lib/xlsx-zapis.ts`,
  `lib/pdf-zapis.ts`.
- **Potvrzení:** `potvrzeni.ts` (server akce: `nactiStavSmeny`, `potvrditSmenu`,
  `potvrditZmenuSmeny`), `potvrzeni-okna.ts` (načtení potvrzení za okno, stránkuje
  po 1000), `mobil/detail.tsx` (tlačítko).
- **Vydání rozpisu:** `vydani-data.ts`, `panel-vydani.tsx`, `desktop/vydani.tsx`,
  server akce `vydani.ts`.
- **Export:** `app/api/smeny/export/route.ts` (`?rozsah&mesic&format&pobocka`).
- **Nastavení:** `app/[rozsah]/nastaveni/smeny/` (page + akce), navigace v
  `app/[rozsah]/nabidka.ts`.
- **Provozní den:** `lib/provozni-den.ts` (`provozniDen(branchId)` → RPC
  `business_date`); provozní den pobočky začíná v `branches.day_starts_at`.

## Databáze

Relevantní tabulky: `shifts` (směna; `employee_id` prázdné = neobsazená; `status`
`planned|confirmed|cancelled`; snapshot posledního vydání `published_at`,
`published_employee_id`, `published_starts_at`, `published_ends_at`,
`published_status`; trhaná směna `pauza_od`, `pauza_do`), `employees` (`user_id`
prázdné = bez účtu, `position_id` = zařazení, `usek_id` = úsek, `branch_id` =
domovská pobočka, může být prázdná), `useky`, `positions`, `sablony_smen`,
`notifications` (`druh`, `telo`, `shift_id`, `read_at`, `acknowledged_at`,
`priorita`), `smeny_potvrzeni` (nová, viz níž), `tenant_settings`
(`smeny_dulezita_hodin`, `smeny_zarazeni_ve_formulari`).

Funkce: `ulozit_smenu` (12 parametrů, zakládá i mění a volá `app.upozornit_smenu`),
`smazat_smenu` (nevydanou smaže, vydanou zruší `status='cancelled'`),
`vydat_rozpis` / `rozpis_nahled` / `rozpis_stav` / `app.rozdil_rozpisu` (rozdíl proti
vydanému stavu; jediné místo, které říká, co je „nová“, „změněná“, „zrušená“),
`potvrdit_smenu(tenant, směna, den, od, do, pauza_od, pauza_do)`,
`nastavit_smeny_formular`, `nastavit_dulezitou_zmenu_smeny`, `stav_potvrzeni_smeny`
(po jedné směně, pro vedoucího), `muj_den`, `business_date`.

**Migrace Směn (chronologicky):** `20260823130000_provoz` (shifts),
`20260901130000_vydani_rozpisu`, `20260903030000_zadavani_smen`,
`20260903060000_sablony_smen`, `20260909080000_mazani_smen`,
`20260909140000_zrusit_vydanou_smenu`, `20260913100000_upozorneni_smeny`,
`20260916200000_trhana_smena`, `20260917010000_potvrzeni_zmeny_smeny`,
`20260919120000_smeny_upozorneni_obnoveni`, `20260920100000_stav_potvrzeni_smen`
(ruší 20260920120000), `20260920120000_potvrzeni_smen`, `20260920130000_nastaveni_smeny`.
Scénáře: `supabase/tests/krok40_scenar.sql` (potvrzení), `krok41_scenar.sql`
(nastavení), starší `krok17`, `krok32`, `krok39`.

## Oprávnění

- `shifts.read` (scoped) — čtení směn (`shifts_read`: `app.can_read_scoped`).
- `shifts.manage` na pobočce — zápis směn, vydání rozpisu, čtení potvrzení
  (`shifts_write`, politika `smeny_potvrzeni_read`).
- `settings.manage` — Nastavení → Směny, Šablony, Úseky, Firma.
- Zaměstnanec potvrzuje jen **svou** směnu: `potvrdit_smenu` je `security definer`,
  ověří firmu, modul `provoz` + členství (`app.modul_zapnuty`), že směna patří
  volajícímu, že je vydaná a od vydání beze změny a že znění z obrazovky sedí
  s databází. Vlastní chyby mají kódy `PT403` (nesmíš) a `PT409` (nesedí stav).
- `smeny_potvrzeni`: RLS čte člověk své a vedoucí **současné** pobočky směny;
  tabulka nemá žádný grant na zápis.
- Dvě obranné linie: aplikace ověřuje (`zkusPristup`, `hasAccess`), databáze znovu.

## Události (jak se směna vytváří, mění, ruší)

1. **Uložení** (`ulozit_smenu`): vloží nebo upraví řádek v `shifts` a **hned**
   `app.upozornit_smenu` zapíše `notifications` (`smena.nova` / `smena.zmenena`,
   `telo` = den, od, do a při změně `puvodni_*`) člověku s účtem, kterého to
   nezadal sám. **Upozornění tedy vzniká při uložení konceptu, ne při vydání.**
   Nepřečtená upozornění téhož druhu a dne se slučují (viz Známé problémy).
2. **Vydání** (`vydat_rozpis(tenant, pobočka, od, do)`): jedna `notifications`
   (`rozpis.vydan`) na člověka se všemi jeho změnami a nastaví snapshot `published_*`.
3. **Zrušení** (`smazat_smenu`): nevydaná se smaže, vydaná dostane
   `status='cancelled'` a lidem zmizí až vydáním rozpisu.
4. **Potvrzení:** změnu člověk potvrdí u upozornění (`acknowledged_at`,
   `potvrditZmenuSmeny`), směnu tlačítkem (`potvrdit_smenu` → `smeny_potvrzeni`,
   záznam nese opis: pobočka, den, časy, pauza; platí, dokud se směna shoduje).
5. **Import z Excelu** (`nastaveni/nahrani/rozpis`) mění `shifts` přímým zápisem a
   upozornění nevytváří.

## Integrace

- **Dnes** (`app/[rozsah]/dnes/page.tsx`): `muj_den` (`v_praci`, `od_kdy`,
  `pobocka`, `provozni_den`) a přímé čtení `shifts`. `provozni_den` je `null`, když
  účet nemá domovskou pobočku — Dnes to řeší záložním provozním dnem z vybrané
  (nebo první) pobočky.
- **Docházka:** `smeny/dochazka-smeny.ts` (plán vs. skutečnost u směny),
  `provozniDen()`.
- **Zaměstnanci:** `employees` (zařazení, úsek, účet); směna nese `employee_id`.
- **Pobočky:** `branches` (`day_starts_at`, `timezone`, zkratky se počítají z názvů).
- **Role:** viz Oprávnění; Nastavení → Lidé a Zařazení.

## Důležité pro Komunikaci

- **Notifikace změny směny:** už existuje jako `notifications` s `druh`
  `smena.nova` / `smena.zmenena` / `smena.zrusena` / `smena.odebrana`, `shift_id`
  a `telo` (`den`, `od`, `do`, `puvodni_den`, `puvodni_od`, `puvodni_do`), text a
  odkaz skládá `lib/upozorneni-text.ts` (`zmenaSmeny`, `odkazNaSmenu`,
  `vyzadujePotvrzeni`). Vzniká uvnitř `ulozit_smenu`, ne přes doménovou událost —
  nová Notification Service ji musí buď převzít, nebo tuhle cestu nahradit, ale
  **nesmí vzniknout dvakrát**.
- **Je zaměstnanec právě v práci?** `muj_den().v_praci` = otevřený příchod
  (`app.otevreny_prichod`), tedy docházka, ne rozvrh. Pro cizího zaměstnance ho
  z aplikace číst nejde (funkce je „můj“ den); pro doručování bude potřeba
  služba nad `app.otevreny_prichod(tenant, employee)`.
- **Nejbližší směna:** `select … from shifts where employee_id = X and status <>
  'cancelled' and shift_date >= provozni_den order by shift_date, starts_at`;
  provozní den z `business_date(branch)`.
- **Potvrzení změny:** upozornění `acknowledged_at` (`potvrditZmenuSmeny`) a
  potvrzení směny `smeny_potvrzeni` (`potvrdit_smenu`). Tlačítko „Potvrdit“ v
  notifikaci má volat obojí (`potvrdit_smenu` se zněním, které člověk vidí).
- Zaměstnanec **bez účtu** (`employees.user_id` prázdné) nedostane nic a nemá jak
  potvrdit; puntík se u něj nekreslí.

## Známé problémy

- **Dvanáct testovacích skriptů padá; sedm z nich (ověřeno na nezměněné `main`, ne kvůli
  Směnám): `barvy-lidi` a `rozpis` (Drawer.tsx: `react-dom` se nepřepíše),
  `email` a `marketing-klice` (server-only import z klientského modulu),
  `nahrani-rozpisu` (`zdroje.pozice`), `prihlaseni` (chybí `app/[rozsah]/ram.tsx`), `sablony` (chybí
  export `prepsatCasyDoSmen`). Dalších pět (`marketing-ai`, `marketing-menu-ai`, `marketing-fronta`,
  `marketing-n8n`, `marketing-nastroje`) padá při běhu taky (chybí mimo jiné balíček
  `@anthropic-ai/sdk`, který chybí i `tsc` — dvě chyby v `lib/marketing-*ai.ts`); na `main` jsem je neověřoval. Žádný z nich není napojený na `npm test` (skript v
  `package.json` není), pouští se ručně.
- **Lokální dev server (Windows) občas neumí sestavit CSS** (`tailwindcss: E.map is
  not a function`); rozhoduje Vercel build. `.next` po pádu smazat.
- **`app.upozornit_smenu` slučuje nepřečtená upozornění podle (uživatel, druh, den)
  bez ohledu na směnu** — druhá směna téhož dne smaže upozornění první (člověk na
  dvou pobočkách v jeden den). Před stavbou Komunikace opravit.
- Hromadné „Označit vše za přečtené“ přečte i upozornění na směny; proto se
  potvrzení směny **nečte** z `notifications`.
- Člověk s vyplněným `user_id`, ale bez aktivního členství, nemůže potvrdit a
  v mřížce zůstane žlutý.
- Tlačítko „Potvrdit směnu“ na telefonu není ověřené end-to-end (potřebuje
  přihlášení a nasazenou migraci).
- V repozitáři nejsou E2E testy (Playwright); mřížka i telefon se ověřují ručně
  (dočasný náhled `app/nahled/`, do Gitu nepatří).
- Export: pauza se v Excelu nedá zmenšit, u 20+ lidí s pauzami bývá písmo menší
  než v PDF; zlomy řádků u lámaného měsíce si Excel určí sám.

## Testy (co bylo skutečně spuštěno, 20.–21. 9. 2026)

- Čistá logika: `scripts/rozpis-export.test.mjs`, `rozpis-desktop.test.mjs`,
  `rozpis-mobil.test.mjs`, `xlsx.test.mjs`, `smeny-formular.test.mjs`,
  `scenare.test.mjs` — všechny zelené. Spuštění:
  `node --experimental-strip-types scripts/<název>.test.mjs`.
- SQL: `node scripts/scenare-pglite.mjs` — 1463 kontrol zelených (PGlite je jediný
  superuživatel, RLS a granty neověří). Proti opravdovému PostgreSQL 16 běží
  workflow „Databáze“ na každém PR (RLS `krok40`: vedoucí Perly vidí Perlu a ne
  Bar, přímý zápis do `smeny_potvrzeni` spadne na právech) — zelené.
- Záměrná rozbití (mutace) kódu i SQL: puntík 16/16, potvrzení SQL 16/17
  (přežilo jedno, které chytá jen skutečný PostgreSQL), nastavení 9/9, export
  14/14; všechna zachycena.
- `tsc` (mimo dvě známé chyby s `@anthropic-ai/sdk`) a `eslint` bez chyb.
- Vercel build a preview zelené u všech PR; Production nasazení `success`.
- Prohlížeč (headless Edge nad dočasným náhledem): mřížka světle i tmavě, měsíc dvou
  lidí, 1280 px, zaměstnanec bez legendy, Excel v opravdovém Excelu (COM) a PDF přes
  poppler. **Neověřeno:** formulář se schovaným zařazením v prohlížeči (dev server
  nesestavil CSS), tlačítko potvrzení na telefonu.
- Produkce po opravě Dnes: v logu Supabase žádná chyba `invalid input syntax for
  type date` po 16:41 UTC 20. 9.
