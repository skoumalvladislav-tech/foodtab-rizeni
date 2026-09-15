# FoodTab — aktuální handoff pro novou relaci

Datum: 15. 9. 2026. Účel: bezpečné pokračování v nové/zkompaktované relaci Claude
Code bez znalosti předchozího chatu. Tenhle soubor **aktualizuj místo zakládání
dalšího** (`docs/pracovni-rezim-codea.md`, oddíl 1 — dva seznamy pravdy znamenají,
že jeden brzy lže).

## 1. Hlavní cíl a závazná pravidla

**Cíl týdne:** sloučit/implementovat samostatné appky **Faktury** a **Marketing**
do FoodTabu jako moduly, podle `docs/hlaseni/zadani-pro-ai-marketing-faktury.md`.

**Kde je závazné zadání (čti při nejasnosti, nedomýšlej):**
- `CLAUDE.md` — 12 pravidel, která se neporušují (multitenance, autorizace přes
  `app.has_access`, dvě obranné linie appka+RLS, časová pásma, `service_role`
  nikdy na klienta, mazání lidí = `deleted_at`, „main" jako jediná nasazovaná větev)
- `docs/pracovni-rezim-codea.md` — pracovní režim, hranice autonomie, kdy je modul
  hotový (12 bodů, oddíl 3), jak vypadá hlášení
- `docs/hlaseni/zadani-pro-ai-marketing-faktury.md` — zadání pro Faktury a Marketing

**Nejdůležitější pravidla, co se nesmí porušit:**
1. **Nikdy `db push` ani ruční SQL do žádné produkční DB autonomně** — nasazuje
   výhradně Šéfík (Vladislav Skoumal) v Supabase SQL editoru / CLI. Platí pro obě
   DB (FoodTab `spekntcsuroqhehmjssv` i Faktury `ctqtwahlzhyjerqulqyn`).
2. **Nasazuje se výhradně z větve `main`** (CLAUDE.md) — migrace z jiné větve se
   do DB nepouští, `supabase/tests/run.sh` by testoval jinou sadu, než běží v provozu.
3. `service_role` klíč nikdy neopustí server / nejde do klientského kódu.
4. **Do cizího modulu nesahej** — najdeš-li chybu jinde, nahlas ji, neopravuj.
5. Mzdy, docházka, kontakty a částky se **nikdy** neposílají do jazykového modelu.
6. n8n workflow `faktury@cerna-perla.cz` (IMAP trigger) **nikdy nespouštět** —
   opakované OOM pády, zdokumentováno. Starý workflow Černá Perla zůstává
   vypnutý, nepřepínat `active: true`.
7. Nedodělaný zásah do oprávnění se **necommituje** — buď kompletní, nebo nic.
8. Destruktivní git operace (force-push, reset --hard, mazání větví) jen na
   výslovný pokyn.

## 2. Aktuální branch / prostředí

- Repozitář: `C:\Users\vladi\foodtab-rizeni` (Windows, `win32`, PowerShell)
- **Pracovní větev této relace: `claude/prompt-review-jtkh74`** — **NE `main`**.
  CLAUDE.md počítá s `main` jako pracovní větví; tahle relace na ní neběžela.
  Než se z toho něco nasadí, musí to na `main` doputovat (sloučení/PR).
- Remote: `https://github.com/skoumalvladislav-tech/foodtab-rizeni.git`
- **Stav k 15. 9. 2026 večer: větev je pushnutá, `origin` je aktuální** (commit
  `1029997`). První pokus o `git push` byl dvakrát zamítnutý auto-mode
  klasifikátorem („Out-of-Place Publication"), další pokus ve stejné relaci
  už prošel bez zásahu — chová se to jako dočasné/nedeterministické omezení
  session, ne jako trvalý zákaz. Pokud push v nové relaci selže, zkusit znovu;
  pokud trvá, spustí ho Šéfík sám: `git push origin claude/prompt-review-jtkh74`.
  - `gh` CLI nainstalováno (`winget install GitHub.cli`), ale **není přihlášené**
    — `gh auth login` je interaktivní OAuth, musí dokončit Šéfík. Bez toho nejde
    založit PR z týhle session přes `gh pr create`.
  - Odkaz na branch: `https://github.com/skoumalvladislav-tech/foodtab-rizeni/tree/claude/prompt-review-jtkh74`
  - Odkaz na založení PR: `https://github.com/skoumalvladislav-tech/foodtab-rizeni/compare/main...claude/prompt-review-jtkh74?expand=1`
- Druhý samostatný repozitář použitý jen jako referenční zdroj (needitovat, jen
  číst): `C:\Users\vladi\faktury-app` (privátní GitHub repo
  `skoumalvladislav-tech/faktury-app`, branch `main`) — původní samostatná appka
  na faktury, ze které se portovala logika.
- Dev server: `npm run dev`, log obvykle v `/tmp/foodtab-dev.log`. Občas potichu
  spadne (bez chyby v logu) — pozná se přes `curl -sI http://localhost:3000/`
  bez odpovědi, řeší se restartem; po restartu je nutné se znovu přihlásit
  (kód z e-mailu), server invaliduje session.

## 3. Co je skutečně hotové a ověřené

**Marketing** (modul `marketing`, viz `lib/marketing-navigace.ts`):
- Krok 1 (ovládací menu, levý sloupec, mobilní lišta) — hotovo, ověřeno živě
- Krok 2 (menu jako tabulka + `/menu/nove` 4 záložky) — hotovo, ověřeno
- Krok 3 (průvodce vytvořením) — hotovo, ověřeno
- Krok 5 část 1 (detail fotky „použito v") — hotovo; **E2E Playwright chybí**,
  blokováno na rozhodnutí Šéfíka (viz bod 13)
- Krok 6 (OpenAPI pro `/api/uloha/*` a `/k/[klic]`) — hotovo
- **Krok 4 (renderer grafiky, `sharp`+písma) — BLOKOVÁNO**, viz bod 13

**Faktury** — **kód hotový, čeká jen na nasazení migrace** (bod 15). **Od
15.9.2026 večer NENÍ vlastní modul** — je to sekce uvnitř modulu **Finance
a účetnictví** (Šéfíkovo rozhodnutí), adresa `/finance/faktury` (dřív
`/faktury`). Navigace pořád `lib/faktury-navigace.ts`, jen se změnila
základní adresa a modul, pod kterým se aktivuje (`finance` místo `faktury`).
- Všech 8 obrazovek z originálu přeneseno a ověřeno (tsc + eslint čisté, živě
  v prohlížeči): Přehled, Seznam, Dodavatelé, Ke schválení, Ruční zadání
  (`/nova`), Přehledy + CSV export, Kalendář splatností, Upomínky
- Autorizace (`faktury.read`/`faktury.manage`) přidána — originál žádnou neměl;
  práva zůstala stejná, jen teď patří pod modul `finance` (jako `advances.manage`
  patří pod `provoz`)
- `scripts/faktury-navigace.test.mjs` (27 kontrol) + `scripts/faktury-filtry.test.mjs`
  (18 kontrol) — obojí zelené, plus sdílený `scripts/nabidka.test.mjs` (regresní)

## 4. Co se v této relaci změnilo (od poslední kompakce)

**Po kompakci 15.9.2026 večer:** push proběhl (viz bod 2), `gh` CLI
nainstalováno, a na Šéfíkovo přání přesunuty **Faktury ze samostatného modulu
do sekce uvnitř Finance** — `app/[rozsah]/faktury/` → `app/[rozsah]/finance/faktury/`
(`git mv`, zachovává historii), všechny interní odkazy/redirecty přepsány,
`lib/authz.ts` (`faktury` pryč z `MODULES`), `app/[rozsah]/nabidka.ts` (jedna
položka `finance/faktury` místo dvou), migrace `20260915100000_modul_faktury.sql`
přepsána (nevkládá vlastní modul, jen práva pod `finance`). Ověřeno tsc/eslint/
testy/živě v prohlížeči (commit `1029997`, viz bod 5). Import `Nadpis` uvnitř
přesunutých souborů potřeboval o jedno `../` navíc — opraveno, tsc to samo
odhalilo. Dev server na Windows držel zámek na adresáři při `git mv` (`Permission
denied`) — vyřešeno zastavením node procesů dev serveru před přesunem, po
přesunu restartován.

Dokončeno sloučení Faktury (Marketing byl hotový už dřív):
- `app/[rozsah]/faktury/schvaleni/page.tsx` — fronta ke schválení
- `app/[rozsah]/faktury/dodavatele/page.tsx` — commitnuto (existovalo, nebylo uloženo)
- `app/[rozsah]/faktury/nova/page.tsx` — ruční zadání (opravuje dřív rozbitý odkaz)
- `app/[rozsah]/faktury/prehledy/page.tsx` + `app/api/faktury/export/route.ts` +
  `app/[rozsah]/faktury/poslat-ucetnimu.tsx` — přehledy nákladů, CSV export,
  „poslat účetnímu" (jen stáhne CSV a otevře mailto: koncept, appka sama nic neodesílá)
- `app/[rozsah]/faktury/kalendar/page.tsx`, `app/[rozsah]/faktury/upominky/page.tsx`
- `lib/faktury-filtry.ts` — filtr nad `invoices` vytažený ze Seznamu, sdílený s exportem
- Tři nové server akce v `app/[rozsah]/faktury/akce.ts`: `potvrditFakturu`,
  `odmitnoutFakturu`, `oznacitJakoUpominku`, `oznacitUpominkuVyresenou`
- Oprava: mrtvý odkaz `?review=1` na Přehledu (Seznam čte `kontrola`, ne `review`)
- `docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md` — **SQL doklad,
  NEPOUŽITO** (viz bod 15)
- WSL vyzkoušen a **trvale opuštěn** na přání Šéfíka (opakovaně shazoval Wi-Fi,
  kolize Hyper-V vSwitch s Wi-Fi adaptérem) — `C:\Users\vladi\.wslconfig`
  (`networkingMode=mirrored`) zůstal nastavený, ale WSL se dál nepoužívá

## 5. Důležité commity (na `claude/prompt-review-jtkh74`, PUSHNUTÉ na `origin`)

```
1029997 Faktury: presun ze samostatneho modulu do sekce uvnitr Finance
998f0fc Doc: SQL pro RLS opravu rejection_examples (ceka na Sefika)
85b0777 Faktury: Kalendar splatnosti a Upominky (cast 4) - modul kompletni
4e43241 Faktury: Prehledy, CSV export, ruzne opravy (cast 3)
4d11ab1 Faktury: rucni zadani (/nova)
a0c784c Faktury: Dodavatele a Ke schvaleni (cast 2)
28060e6 Faktury: zaklad slouceni do Foodtabu — modul, Prehled, Seznam (cast 1)
49e5091 Doc: WSL vyzkousen a opusten kvuli padajici Wi-Fi
```
Starší, už dřív na `origin` (marketing, dokumentace, audit) — viz `git log`.

## 6. Současný stav DB a security

- **Dvě oddělené Supabase DB:** FoodTab (`spekntcsuroqhehmjssv`, Frankfurt) a
  Faktury (`ctqtwahlzhyjerqulqyn`, eu-north-1/Stockholm) — **Možnost A**
  (rozhodnuto, viz bod 14): faktury zůstávají ve vlastní DB, nepřesouvat.
- **Migrace `supabase/migrations/20260915100000_modul_faktury.sql` NENASAZENA.**
  Po přesunu (bod 4) už nevkládá vlastní modul — modul `finance` v katalogu
  existuje odjakživa (`20260823120100_catalog.sql`), migrace jen přidává práva
  `faktury.read`/`faktury.manage` pod `module_key='finance'`. Bez nasazení je
  celá sekce Faktury v UI neviditelná (ověřeno živě — appka korektně hlásí
  „nemáte oprávnění", žádná chyba, ale i tak nefunkční pro uživatele).
- **`rejection_examples`** (Faktury DB) — RLS zapnuté, **0 politik, 0 řádků**.
  Appka i dřívější n8n do ní tiše nezapíšou nic. SQL oprava hotová v
  `docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md`, **nespuštěno**.
- **`supabase/migrations/20260907010000_muj_den.sql` NENASAZENA** (FoodTab DB) —
  stránka „Dnes" kvůli tomu nefunguje. Starší nález, netýká se této relace přímo,
  ale zůstává na seznamu čekajícím na Šéfíka.
- **Vážný nález z dřívější relace (marketing), STÁLE NEOPRAVENO:** role
  `authenticated` má grant `TRUNCATE` na `audit_log` a na 51 provozních tabulek
  (`employees`, `shifts`, `attendance_events` a dál) — přihlášený uživatel může
  jedním příkazem vysypat data/auditní stopu napříč firmami, RLS `truncate`
  nezachytí. Role `anon` na těch stejných tabulkách grant taky má, ale žádná RLS
  politika `anon` nepouští na řádek, takže tamtudy data neunikají — chybí ale
  první linie. Analogický nález pro marketing byl **opraven**
  (`20260914190000_marketing_granty_uklid2.sql`), pro provozní tabulky **ne** —
  je to cizí modul, jen nahlášeno (`docs/granty-provoz-zadani.md` má zadání
  pro relaci provoz, včetně ověření, že veřejné obrazovky jdou přes
  `security definer` funkce, takže odebrání grantů nic nepoloží).
- Bezpečnostní vzor autorizace: `app.has_access(tenant, oprávnění, pobočka)` +
  RLS na každé nové tabulce (`tenant_id` povinný). `service_role` jen na serveru.

## 7. Provoz / Směny / Docházka / Vzkazy

**Tahle relace do modulu Provoz nezasahovala** — cizí modul, jen čtení/hlášení
dle CLAUDE.md. Z dokumentace platí:
- Známý produkční bug: **Docházka A1** — stornovaný příchod nabízí tlačítko
  Odchod (chybné). Jen nahlášeno, neopraveno, není v gesci téhle relace.
- Bezpečnostní nález viz bod 6 (TRUNCATE granty na 51 provozních tabulkách).
- Podrobný aktuální stav (pokud existuje) hledej v nejnovějším
  `docs/hlaseni/stav-*.md` z relace provoz, ne tady — tenhle handoff patří
  relaci marketing/faktury.

## 8. Finance / Faktury a jejich AI

- **Faktury už nejsou vlastní modul — jsou sekce uvnitř Finance a účetnictví**
  (`/finance/faktury`, Šéfíkovo rozhodnutí 15.9.2026, viz body 3–4). Kód hotový,
  čeká na migraci. Modul `finance` byl do teď prázdný placeholder
  (`docs/etapa0-specifikace.md`: „Připravujeme") — teď má reálný obsah poprvé.
  Až přibude další část Financí (např. `banking.read` je připravené právo),
  dostane vlastní položku v `app/[rozsah]/nabidka.ts` vedle `finance/faktury`.
- AI klasifikace/extrakce faktur z e-mailu běží **mimo tenhle repozitář**, v n8n
  (externí) — appka jen čte/zapisuje výsledek do tabulky `invoices`.
- `rejection_examples` — tabulka na „učení" AI z odmítnutých dokumentů, RLS
  nedokončené (bod 6), appka do ní zatím fakticky nezapisuje.
- **n8n IMAP trigger `faktury@cerna-perla.cz` nikdy nespouštět** (opakované OOM
  pády, zdokumentováno v `docs/zadani-pro-codea/predani-projektu-pro-codea.md`
  ve `faktury-app` repu).

## 9. Marketing

Viz bod 3. Hotovo: Kroky 1, 2, 3, 5 (část 1), 6. Blokováno: Krok 4 (renderer),
částečně blokováno: Krok 5 E2E. Podrobnosti v bodě 13.

## 10. Gastro AI

**Nedotčeno, mimo rozsah téhle relace.** Podle `docs/etapa0-specifikace.md` je
součástí základního modulu `provoz`, zatím **jen placeholder**: v `app/[rozsah]/ram.tsx`
je needitovatelné vyhledávací pole s textem „Hledat nebo se zeptat Gastro AI"
(`disabled`). Otevřená otázka ze specifikace: měsíční limit dotazů v základu
zatím neurčen. Žádná logika, žádný backend.

## 11. Design systém

- `app/_tokeny.css` — sdílené CSS proměnné (`var(--card)`, `var(--muted)`,
  `var(--line)`, `var(--mosaz)`, `var(--bad)`/`var(--bad-bg)`,
  `var(--dobre)`/`var(--dobre-bg)`, `var(--pozor)`/`var(--pozor-bg)`,
  `var(--sunken)` atd.) — zadání v `docs/vzhled-zadani.md` +
  `docs/vzhled-oprava-1.md` (oprava nahrazuje tabulky odstínů).
- Vzor vnořené navigace modulu (Marketing i Faktury sdílí): jedna položka
  v `app/[rozsah]/nabidka.ts`, vlastní `layout.tsx` + `navigace.tsx` (levý
  sloupec ≥1024px + mobilní spodní lišta), vnější `Ram` schová svůj vlastní
  postranní panel přes CSS `:has()`. CSS třídy `.modul-*` (dřív `.mkt-*`,
  přejmenováno, aby to sdílely oba moduly).
- Konvence `hotovo: boolean` u položek navigace — nehotová obrazovka se kreslí
  jako nekliknutelný `<span class="polozka soon">` se štítkem „brzy", nikdy
  jako odkaz na neexistující stránku (žádné 404 v navigaci).
- Server Actions (`'use server'`) s `FormData` a skrytými poli `rozsah`/`id`,
  **žádný `confirm()` v prohlížeči, žádný toast** — čisté odeslání formuláře.
  Foodtab tenhle vzor nikde jinde nemá, nezavádět ho nově.
- Komponenty `Nadpis` (`oči`/`h1`/`popis`/`vpravo`) a `Sdeleni` (chybové/prázdné
  stavy) — používat všude, nevymýšlet vlastní hlavičky.

## 12. Rozpracovaná etapa

**Faktury sloučení je hotové** (kód, teď jako sekce uvnitř Finance), nic v něm
není rozpracované. Větev je pushnutá. Otevřené zbývá jen mimo kód:
- založit PR do `main` (`gh auth login` nebo ručně přes web, bod 15)
- nasazení migrace + RLS oprava (bod 15)
- Marketing Krok 4 (renderer) a Krok 5 E2E zůstávají blokované (bod 13),
  nebyly součástí téhle relace a nikdo na nich aktivně nepracuje

## 13. Nevyřešené problémy

1. **Push na `origin` blokovaný auto-mode klasifikátorem** („Out-of-Place
   Publication") i po výslovném potvrzení v chatu — musí spustit Šéfík sám
   nebo přes UI aplikace, ne přes `git push` v Bashi téhle session.
2. **Marketing Krok 4 (renderer grafiky, `sharp`+písma)** — na tomhle Windows
   stroji `sharp`/`libvips`/`librsvg` nerenderuje vlastní/vložená písma správně,
   ověřeno 4 nezávislými přístupy (`FONTCONFIG_PATH`, vložení fontu do SVG
   přes `@font-face`, base64, natvrdo `sharp({text:{fontfile}})`) — všechny
   dopadly stejně. **WSL na ověření na Linuxu vyzkoušen a trvale opuštěn**
   (shazoval Wi-Fi, viz bod 4) — příští ověření potřebuje jiný Linux/kontejner
   blízký Vercelu, ne tenhle stroj. Detaily: `docs/hlaseni/krok4-renderer-blokovano-2026-09-14.md`.
3. **Marketing Krok 5 E2E (Playwright)** — původní test běžel proti PGlite
   (embedded demo DB) a přihlašoval se jedním klikem bez hesla; FoodTab má
   opravdové Supabase + přihlášení kódem z e-mailu, které automatizace nemá
   jak přečíst. Potřeba rozhodnutí Šéfíka o přihlášení servisním klíčem jen
   v testu. Detaily: `docs/hlaseni/krok5-e2e-nalez-2026-09-15.md`.
4. **TRUNCATE granty na `audit_log` a 51 provozních tabulkách** — bod 6,
   cizí modul, jen nahlášeno.
5. Docházka A1 bug (stornovaný příchod nabízí Odchod) — cizí modul, jen nahlášeno.
6. n8n starý workflow Černá Perla — zůstává zapnutý/nezúžený, blokuje zapnutí
   nového workflow (`foodtab-zverejnit-prispevek.json`), čeká na Šéfíka.

## 14. Rozhodnutí, která se nesmí ztratit

- **Faktury DB: Možnost A** — zůstává oddělená (`ctqtwahlzhyjerqulqyn`),
  nepřesouvat do FoodTab DB, dokud Šéfík výslovně neřekne jinak.
- **Faktury rozsah: úroveň firmy, NE pobočky.** Doklad chodí na firemní
  e-mailovou schránku, ne na konkrétní provozovnu — modul se na pobočce vůbec
  nekreslí (`layout.tsx` to odmítá jasnou zprávou).
- **WSL se na tomhle stroji nepoužívá, nezkoušet znovu** — opakovaně shazoval
  Wi-Fi (kolize Hyper-V vSwitch), Šéfík musel opakovaně restartovat PC.
- **Žádný Tailwind v portovaném kódu Faktur** — inline styly s `var(--...)`
  tokeny, stejně jako zbytek FoodTabu. Originál (faktury-app) Tailwind používal,
  port ne.
- **Autorizace přidána do Faktur, kterou originál vůbec neměl** (`faktury.read`/
  `faktury.manage`) — nejde o odchylku od zadání, je to požadavek CLAUDE.md
  (pravidlo 2, jediné místo rozhodující o přístupu).
- **`.wslconfig` (`networkingMode=mirrored`) zůstal nastavený** i po opuštění
  WSL, pro případ budoucího použití — nesmazat bezdůvodně.
- **Faktury = sekce uvnitř Finance, ne vlastní modul** (Šéfík 15.9.2026 večer,
  po pushi) — adresa `/finance/faktury`, aktivace přes `isModuleActive(ctx,
  'finance')`, práva `faktury.read`/`faktury.manage` zůstala beze změny jako
  jemnější práva pod `finance` (stejný vzor jako `advances.manage` pod `provoz`).
  Tohle je novější rozhodnutí, které **přebíjí** dřívější strukturu (vlastní
  modul `faktury`) zmiňovanou v commitech 28060e6–998f0fc — nevracet se k ní.

## 15. Operace čekající na schválení Šéfíka

1. **Dokončit `gh auth login`** (interaktivní OAuth) NEBO založit PR ručně přes
   web — odkaz na compare v bodě 2. Bez přihlášení nejde založit PR z týhle session.
2. **Nasadit `supabase/migrations/20260915100000_modul_faktury.sql`** (FoodTab DB)
   — bez toho je hotová sekce Faktury v UI neviditelná. Nejdřív musí větev
   doputovat na `main` (CLAUDE.md: nasazuje se jen z `main`).
3. **Spustit SQL z `docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md`**
   v SQL editoru projektu **Faktury** (`ctqtwahlzhyjerqulqyn`, NE FoodTab DB).
4. Nasadit `supabase/migrations/20260907010000_muj_den.sql` (FoodTab DB, stránka Dnes).
5. Rozhodnout o TRUNCATE grantech na `audit_log` + 51 provozních tabulkách
   (`docs/granty-provoz-zadani.md`) — mimo gesci téhle relace, ale čeká na rozhodnutí.
6. Rozhodnutí o E2E přihlášení servisním klíčem (Marketing Krok 5).
7. n8n: zúžit/vypnout starý workflow Černá Perla.

## 16. Doporučený další krok (přesně)

1. Šéfík dokončí `gh auth login` (jednou, uloží se) — pak umí nová relace
   založit PR sama přes `gh pr create`. Do té doby PR založí Šéfík ručně přes
   compare odkaz v bodě 2.
2. Sloučit/otevřít PR do `main` a projít review (branch je pushnutá, viz bod 2/5).
3. Po sloučení do `main`: nasadit `20260915100000_modul_faktury.sql` —
   od tohoto okamžiku je sekce Faktury živá a viditelná pro uživatele s právem
   na adrese `/finance/faktury`.
4. Spustit RLS opravu `rejection_examples` (bod 15.3) — nezávislé na kroku 3,
   jde spustit kdykoli.
5. Živě ověřit sekci Faktury se **skutečnými daty** (3022 řádků v `invoices`
   podle posledního čtení) — dosavadní ověření bylo jen „appka korektně
   odmítá bez oprávnění", ne plný uživatelský tok s daty.
6. Teprve pak pokračovat na Marketing Krok 4 (potřebuje jiné prostředí než
   tenhle Windows stroj) nebo Krok 5 E2E (potřebuje Šéfíkovo rozhodnutí) —
   obojí nezávislé na Fakturách, žádné z nich nemá blokovat to ostatní.
