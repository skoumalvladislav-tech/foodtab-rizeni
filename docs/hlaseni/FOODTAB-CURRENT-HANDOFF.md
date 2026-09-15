# FoodTab — aktuální handoff pro novou relaci

Datum: 15. 9. 2026. Účel: bezpečné pokračování v nové/zkompaktované relaci Claude
Code bez znalosti předchozího chatu. Tenhle soubor **aktualizuj místo zakládání
dalšího** (`docs/pracovni-rezim-codea.md`, oddíl 1 — dva seznamy pravdy znamenají,
že jeden brzy lže).

## 1. Hlavní cíl a závazná pravidla

**Cíl týdne (původní):** sloučit/implementovat samostatné appky **Faktury** a
**Marketing** do FoodTabu jako moduly, podle
`docs/hlaseni/zadani-pro-ai-marketing-faktury.md`. **HOTOVO** (Faktury i
Marketing nasazené, viz body 3, 6).

**Aktuální řídicí dokument (od 15.9.2026 noc): MASTER DEVELOPMENT PROMPT**
od Šéfíka — celý produktový/technický plán FoodTabu (multi-tenant SaaS,
moduly, design systém, AI architektura/Gastro AI, testing, 14 etap).
**Není uložen jako soubor v repu** (Šéfík ho poslal přímo do chatu) —
pokud ho nová relace nemá v kontextu, požádej o jeho zopakování, než
budeš pokračovat v čemkoli mimo aktuálně rozpracované. Implementační
pořadí (sekce 85 promptu): Etapa 0 Audit → 1 Security → 2 App shell +
design systém → 3 Dnes + Owner Attention Center → 4 Provoz → 5-14
(Finance, Marketing, AI gateway, Gastro AI, Receptury, Objednávky,
cross-module intelligence, plná responzivita, regrese, release).
**Šéfík výslovně svolil autonomní noční práci** ("udělej co budeš moct
bez mého souhlasu") — ptát se jen na živou DB, merge do main, produkční
deploy, externí publikaci/objednávku, nevratné věci (přesně sekce 84
promptu). Podrobný stav dnešní noci:
`docs/hlaseni/2026-09-15-etapa-0-2-3.md` a bod 11 níž.

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
  `4225d89`). `git push` je teď spolehlivý (dřív dvakrát zamítnutý auto-mode
  klasifikátorem, od té doby prochází normálně) — pokud by v nové relaci
  selhal, zkusit znovu; pokud trvá, spustí ho Šéfík sám:
  `git push origin claude/prompt-review-jtkh74`.
  - `gh` CLI nainstalováno a **přihlášené** (účet `skoumalvladislav-tech`).
  - **PR #3 (Faktury) smergován do `main`**, 15.9.2026 16:20 —
    https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/3.
    Migrace nasazená, sekce Faktury živá v produkci (viz bod 6).
  - **PR #4 (design systém) smergován do `main`**, 15.9.2026 19:25 —
    https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/4.
    Design systém (tokeny, `components/`, AppShell, Dnes) je v produkci.
  - **PR #5 (Rozpis směn, priorita 3) smergován do `main`**, 15.9.2026 20:09 —
    https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/5.
  - **Dev server na tomhle stroji byl v této relaci mimořádně nestabilní**
    (opakovaná poškozená Turbopack cache, výjimečně dlouhé kompilace
    v řádu minut, neobjasněné ukončení procesu s exit 127) — řešeno
    smazáním `.next` a restartem, nakonec fungovalo. Netýká se kódu
    (tsc/eslint/testy čisté po celou dobu) — čistě lokální/Windows
    prostředí. Pokud se to v nové relaci opakuje: `rm -rf .next && npm run dev`.
  - **Známý, PŘEDEXISTUJÍCÍ nález:** GitHub Actions check „Migrace a scénáře"
    (workflow Databáze) padá i na `main` už minimálně od 13.9.2026 (přes 29
    scénářů `krok3`–`krok33` a `marketing8`–`marketing15`, `no rows returned
    for \gset`). Nesouvisí s Fakturami/Financemi ani s design systémem —
    jen nahlášeno, neopraveno, čeká na Šéfíka.
  - Odkaz na branch: `https://github.com/skoumalvladislav-tech/foodtab-rizeni/tree/claude/prompt-review-jtkh74`
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

**Faktury** — **HOTOVO A ŽIVĚ OVĚŘENO (15.9.2026 večer)**, celý řetězec
funguje: kód → migrace nasazená → modul `finance` aktivní pro tenanta →
env proměnné opravené → appka ukazuje 1741+1138 skutečných faktur v
produkci. **Od 15.9.2026 večer NENÍ vlastní modul** — je to sekce uvnitř
modulu **Finance a účetnictví** (Šéfíkovo rozhodnutí), adresa `/finance/faktury`
(dřív `/faktury`). Navigace pořád `lib/faktury-navigace.ts`, jen se změnila
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
27892da Design systém: Vzkazy - lehky dotazeny (radius tokeny, jemny stin)
0a1b38b Etapa 3: Owner Attention Center na obrazovce Dnes
1bcf93b Etapa 2: bocni panel seskupeny podle vsech modulu najednou
2ccd3e2 Etapa 0: aktualizace master auditu (byl zastaraly z 14.9.)
4225d89 Design systém: tokeny, sdilena knihovna komponent, AppShell, Dnes
a8315b2 Doc: handoff - RLS oprava rejection_examples hotova a overena
235103c Doc: handoff - Faktury nasazeny, aktivovany a zive overeny s daty
262269d Doc: handoff - PR #3 otevreny, gh prihlaseno
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
- **Migrace `supabase/migrations/20260915100000_modul_faktury.sql` NASAZENA**
  (Šéfík, 15.9.2026 večer, přes SQL editor) — práva `faktury.read`/`faktury.manage`
  jsou v katalogu pod `module_key='finance'`, zapsáno i do `schema_migrations`.
- **Modul `finance` bylo navíc potřeba aktivovat per tenant** (`tenant_modules`) —
  na rozdíl od `marketing`, který aktivní byl, `finance` neměl žádný řádek
  (`is_base=false`, nikdy netogglovaný, protože předtím neměl žádný reálný
  obsah). Nastavení→Moduly v UI zatím neexistuje (`hotovo:false`), takže se
  zapnulo přímo SQL insertem do `tenant_modules` (Šéfík).
- **Živě ověřeno se skutečnými daty (15.9.2026, přes claude-in-chrome):**
  `/finance/faktury/seznam` ukazuje 1741 aktivních + 1138 archivovaných
  faktur z produkční DB. Cestou se objevil a vyřešil samostatný problém:
  produkční Vercel proměnné `FAKTURY_SUPABASE_URL`/`FAKTURY_SUPABASE_ANON_KEY`
  byly nejdřív uložené jako typ **Secret** (nejde zpětně ověřit hodnotu) a i
  po nastavení appka pořád vracela 0 faktur — anon klíč sám o sobě fungoval
  (ověřeno přímým REST dotazem), problém byl v tom, jak se proměnná dostala
  do Vercelu. Opraveno smazáním a založením znovu jako typ **Config** +
  redeploy s vypnutým „Use existing Build Cache". Přesná příčina (poškozená
  hodnota vs. stará build cache) nebyla dál zjišťována, oprava zabrala.
- **`rejection_examples`** (Faktury DB) — **OPRAVENO 15.9.2026 večer.** Politika
  `allow all with anon key` spuštěna Šéfíkem (`docs/hlaseni/faktury-rejection-examples-rls-2026-09-15.md`),
  živě ověřen zápis (odmítnutí faktury tlačítkem „odmítnout a zapamatovat" →
  ověřen nový řádek v tabulce, `created_at` 15.9.2026 18:25).
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

**AKTIVNÍ ETAPA od 15.9.2026 večer — nová priorita Šéfíka.** Podrobný
stav, co je hotové a co zbývá: `docs/hlaseni/design-system-stav-2026-09-15.md`.
Nečti tenhle bod jako historii — je to živý stav, aktualizuj ho při
další významné změně místo zakládání dalšího souboru.

**Co bylo hotové už předtím a nemění se:**
- `app/_tokeny.css` — barevné tokeny (`var(--card)`, `var(--muted)`,
  `var(--line)`, `var(--mosaz)`, `var(--bad)`/`var(--bad-bg)`,
  `var(--dobre)`/`var(--dobre-bg)`, `var(--pozor)`/`var(--pozor-bg)`,
  `var(--sunken)` atd.) — zadání v `docs/vzhled-zadani.md` +
  `docs/vzhled-oprava-1.md`. Mosaz jako hlavní akcent a `--dobre`
  (zelená) jen pro success **už seděly přesně podle nové priority**.
- Vzor vnořené navigace modulu (Marketing i Faktury sdílí): jedna položka
  v `app/[rozsah]/nabidka.ts`, vlastní `layout.tsx` + `navigace.tsx`, CSS
  třídy `.modul-*`. **`.ft-*` a `.modul-*` se NEPŘEJMENOVÁVAJÍ** — jen
  přebarvují/ladí vlastnosti (`docs/vzhled-zadani.md`).
- Konvence `hotovo: boolean` u položek navigace — nehotová obrazovka se kreslí
  jako nekliknutelný `<span class="polozka soon">` se štítkem „brzy".
- Server Actions s `FormData` a skrytými poli `rozsah`/`id`, žádný `confirm()`
  v prohlížeči — pro potvrzovací dialogy teď existuje sdílený `Dialog`
  (viz níž), ale server-action odeslání formuláře zůstává stejné.
- `Nadpis` (`oči`/`h1`/`popis`/`vpravo`) a `Sdeleni` (celostránkové
  chybové/prázdné/no-access stavy) — pořád platí, používat dál.

**Nově v téhle etapě (design systém, 15.9.2026 večer):**
- **`Ram` (`app/[rozsah]/ram.tsx`) NEEXISTUJE, smazán.** Nahrazen
  `components/shell/AppShell.tsx` (+ `GlobalTopbar`/`ModuleSidebar`/
  `MobileBottomNav`) — stejné chování, jen rozdělené na pojmenované
  soubory. `app/[rozsah]/layout.tsx` teď importuje `AppShell` odtud.
- Nová škála tokenů: `--radius-sm/md/lg/full`, `--shadow-sm/-lg`
  (`--shadow` zůstává), vínový akcent `--vino`/`-sv`/`-ink`/`-soft`
  (druhotný, ověřeno kontrastem i ΔE2000).
- Nová sdílená knihovna `components/ui/` (17 komponent — Badge, Button,
  Card, Avatar, Input, Tabs, EmptyState/ErrorState, Skeleton,
  StatusIndicator, MetricCard, ActionCard, DropdownMenu, Dialog, Drawer,
  Toast+ToastProvider, DataTable). Žádný nový balíček. `EmptyState`/
  `ErrorState` doplňují `Sdeleni`, nenahrazují ho — `Sdeleni` je pro
  celostránkové/blokující stavy, ty nové pro místo uvnitř obsahu s akcí.
- **`ToastProvider` zapojen v `app/layout.tsx`** — appka teď MÁ sdílený
  toast systém (`useToast()` z `components/ui/Toast.tsx`), na rozdíl od
  dřívějšího stavu. Nepoužívat ho ale místo existujícího vzoru
  server-action + `revalidatePath`/`redirect`, kde už funguje.
- Nová CSS jen tam, kde inline styl nestačí: `app/_komponenty.css`,
  třídy `.ds-*` (odlišené od `.ft-*`/`.modul-*`).
- Dokončeno (první noc): AppShell, Dnes, Rozpis směn, Docházka —
  živě ověřené.

**Noc 15.→16.9.2026 (master prompt, Etapy 0/2/3):**
- **Boční panel PŘESTAVĚN** — už se nepřepíná podle vybraného modulu.
  Ukazuje VŠECHNY moduly najednou jako seskupené sekce s nadpisem
  (Provoz/Finance a účetnictví/Marketing/Nastavení), přesně podle
  schváleného mockupu Šéfíka. `components/shell/AppShell.tsx` teď má
  `skupiny: SkupinaNavigace[]` misto jedno-modulového `sloupec`.
  **Skutečná chyba nalezena a opravena cestou:** hodnotový import
  `NAZVY_MODULU` z `nabidka.ts` do klientského `AppShell` stahoval
  `lib/authz.ts` → `next/headers` do prohlížeče (buildovací chyba, ne
  cache) — opraveno předáním `nazvyModulu` jako prop ze serveru.
  Mobilní spodní lišta zůstává kontextová na aktuálním modulu (mockup
  mobil neřešil, dlouhý seznam by se tam nevešel).
- **Owner Attention Center na Dnes** — nová sekce „Co potřebuje vaši
  pozornost", jen pro `jeVedeni(ctx)`. Zdroje: `nedokoncena_dochazka`
  RPC (stejná jako Docházka) a faktury ke kontrole/po splatnosti
  (stejný dotaz jako Finance/Faktury/Přehled). **Jen reálná data** —
  appka nemá zdroj pro tržby/počasí/hodnocení z mockupu, ty tam
  vědomě chybí. Živě ověřeno: „632 faktur je po splatnosti" sedí na
  Financích/Fakturách/Přehledu.
- Vzkazy — lehké dotažení (radius/stín), NE plná ConversationList/
  ChatView přestavba (master prompt sekce 21) — to je větší,
  samostatná práce, zůstává v ZBÝVÁ.
- **Zbývá:** Úkoly, Lidé, Zálohy, Finance shell, Marketing shell,
  ostatní moduly — v tomhle pořadí. Ikony v horních modulových
  záložkách (mockup je má). Etapy 4(zbytek)-14 z master promptu
  (Finance rozšíření, Marketing dokončení, AI gateway, Gastro AI,
  Receptury/Menu, Objednávky, cross-module intelligence, plná
  responzivita, bezpečnostní regrese, release) — nezapočaty, velké
  samostatné bloky práce, nezačínat bez zvláštního zadání.
- **Vizuální screenshoty se dnes v noci nepodařilo pořídit** — Browser
  pane nástroj měl opakovaně `ERR_FAILED` na CSS requestech (server
  sám CSS servíruje správně, ověřeno přímo `curl`). Nesouvisí s kódem.
  **Zkontrolovat vzhled živě jako první věc v nové relaci/ráno.**
- Navazující úloha (založena, ne součást téhle etapy, běží souběžně
  v jiné relaci): sjednotit 3 ruční implementace modálního okna
  (`smeny/formular-smeny.tsx`, `ceka-na-opravneni.tsx`,
  `pwa-registration.tsx`) na nový `Dialog`/`Drawer`. **Nesahat na tyhle
  tři soubory a na `app/globals.css` v oblasti `.install-help`/
  `.pwa-ios-help` — patří té druhé relaci**, může být rozpracované.

## 12. Rozpracovaná etapa

**Faktury sloučení je hotové** (kód, migrace, RLS, živě ověřeno), žádný
otevřený bod. **Aktivní je design systém** (bod 11, zadáno 15.9.2026
večer) — nadace (tokeny + `components/ui/` + `components/shell/`) hotová,
AppShell a Dnes hotové, **zbývá 8 obrazovek z priority**: Rozpis směn,
Docházka, Vzkazy, Úkoly, Lidé, Finance (shell), Marketing (shell),
ostatní moduly. Žádná z nich je rozbitá — jen zatím nevyužívá novou
knihovnu. Marketing Krok 4 (renderer) a Krok 5 E2E zůstávají blokované
(bod 13), nesouvisí s design systémem, nikdo na nich aktivně nepracuje.

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
- **Design systém: doplňovat, ne přepisovat** (Šéfík 15.9.2026 večer). Mosaz
  jako hlavní akcent a zelená jen pro success už seděly — nepřebarvovat je
  znovu. `.ft-*`/`.modul-*` třídy se nepřejmenovávají. Nové sdílené
  komponenty žijí v `components/ui/` a `components/shell/` (nová složka,
  appka dřív žádnou neměla) — `Nadpis`/`Sdeleni` zůstávají, nenahrazují se.

## 15. Operace čekající na schválení Šéfíka

**Faktury (nasazení + RLS oprava) i design systém (PR #4) KOMPLETNĚ HOTOVO
a v `main`.** Aktuálně čeká:

1. Nasadit `supabase/migrations/20260907010000_muj_den.sql` (FoodTab DB, stránka Dnes).
2. Rozhodnout o TRUNCATE grantech na `audit_log` + 51 provozních tabulkách
   (`docs/granty-provoz-zadani.md`) — mimo gesci téhle relace, ale čeká na rozhodnutí.
3. Rozhodnutí o E2E přihlášení servisním klíčem (Marketing Krok 5).
4. n8n: zúžit/vypnout starý workflow Černá Perla.
5. Prošetřit selhávající GitHub Actions check „Migrace a scénáře" —
   padá na `main` už dny, nesouvisí s Fakturami/Financemi ani design systémem.

## 16. Doporučený další krok (přesně)

**Faktury jsou kompletně hotové, nasazené, RLS opravená a živě ověřené**
(15.9.2026 večer) — na tomhle projektu není žádný další nutný krok.

**Design systém (aktivní etapa, PR #4 už v `main`):**
1. Pokračovat v pořadí ze `docs/hlaseni/design-system-stav-2026-09-15.md`:
   Rozpis směn → Docházka → Vzkazy → Úkoly → Lidé → Finance (shell) →
   Marketing (shell) → ostatní moduly. Používat `components/ui/*` a
   `components/shell/*`, ne vymýšlet nové vzory — kde komponenta chybí,
   doplnit ji do `components/ui/`, ne psát inline duplicitně.
2. **Souběžně běží samostatná relace** na sjednocení 3 ručních modálních
   oken (`smeny/formular-smeny.tsx`, `ceka-na-opravneni.tsx`,
   `pwa-registration.tsx`) na sdílený `Dialog`/`Drawer` — nesahat na tyhle
   tři soubory z jiné relace souběžně, ať nevzniknou konflikty.
3. Po každé obrazovce ověřit desktop+mobil stejně jako u AppShellu/Dnes
   (tsc, eslint, node testy, živě v prohlížeči).
4. Po dokončení celé priority: aktualizovat
   `docs/hlaseni/design-system-stav-2026-09-15.md` a tenhle handoff.

**Nezávisle, kdykoli:** Marketing Krok 4 (potřebuje jiné prostředí než
tenhle Windows stroj) nebo Krok 5 E2E (potřebuje Šéfíkovo rozhodnutí) —
obojí nezávislé na design systému i na sobě navzájem.
