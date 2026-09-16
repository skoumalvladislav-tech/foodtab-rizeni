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
  - **PR #6 (Etapy 0/2/3 — noční autonomní práce) OTEVŘENÝ, čeká na review/merge** —
    https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/6.
    Obsahuje master audit refresh, seskupený boční panel, Owner Attention
    Center, Vzkazy dotažení. **Doporučeno vizuálně zkontrolovat před
    mergem** (viz poznámka o Browser pane nástroji v bodě 11).
  - **Dev server na tomhle stroji byl v této relaci mimořádně nestabilní**
    (opakovaná poškozená Turbopack cache, výjimečně dlouhé kompilace
    v řádu minut, neobjasněné ukončení procesu s exit 127) — řešeno
    smazáním `.next` a restartem, nakonec fungovalo. Netýká se kódu
    (tsc/eslint/testy čisté po celou dobu) — čistě lokální/Windows
    prostředí. Pokud se to v nové relaci opakuje: `rm -rf .next && npm run dev`.
  - **OPRAVENO 16.9.2026 v noci (relace Provoz):** GitHub Actions check
    „Migrace a scénáře" (workflow Databáze), padající na `main` od
    13.9.2026, byl diagnostikován a opraven — [PR #20](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/20),
    smergováno. Skutečná příčina byla jiná, než "no rows returned for
    \gset": `krok3_scenar.sql` porovnává `public.permissions` s ručně
    psaným seznamem klíčů a ten se nedoplnil o `faktury.read`/
    `faktury.manage` po sloučení Faktur (15.9.) — `ON_ERROR_STOP` zastavil
    krok3 hned na první kontrole a strhl s sebou (chybějící fixture) přes
    28 navazujících scénářů (krok4–33, marketing1–15). Druhý, nezávislý
    nález: `krok31_scenar.sql` čekal starou frázi v komentáři tabulky
    `zapomenute_odchody` ("SCHVÁLNĚ ŽÁDNÁ NENÍ"), kterou pozdější, už
    nasazená migrace (`20260913140000_drobnosti.sql`) legitimně
    přeformulovala na "PROČ CHYBÍ RLS POLITIKA" se stejným smyslem — test
    se nedoplnil. Obě opravy jsou jen v `supabase/tests/`, žádný zásah do
    migrací ani do živé databáze. Po opravě: 1302 kontrol, `VŠECHNY
    KONTROLY PROŠLY`, ověřeno dvakrát (PR i po merge do `main`).
    **Nástroj-past zjištěná cestou:** `gh run view <id> --log-failed`
    dumpuje i GitHub Actions' předvýpis zdrojového kódu kroku (barevně
    zvýrazněný `run:` blok) — řetězce jako `"CHYBÍ hláška: X"` se tam
    objeví jako SOUČÁST zobrazovaného shellového zdrojáku, ne jako
    skutečný běhový výstup. Spolehlivé je `--log` (celý log) a hledání
    `SPADLÉ SCÉNÁŘE:`/`VŠECHNY KONTROLY PROŠLY` — to jsou řádky, které
    tiskne až samo `run.sh` za běhu, ne text příkazu.
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
e34fbcd design: Ukoly a checklisty - 2 sloupce (otevrene ukoly / checklisty)
788009b design: Zalohy - 2 sloupce (tabulka hlavni, formular na strane)
3d94146 design: Dochazka - 2 sloupce pro Moje smeny / Dnes na pobocce
30ac9cb design: Vzkazy - plna prestavba na ConversationList/ChatView
fd3d81b design: Dnes - widget Tym dnes (kdo je pritomen)
cb412b8 design: Dnes - barevny nahled dnesniho rozpisu
287c842 design: Dnes - plna prestavba podle mockupu Sefika (hero, karty, 2 sloupce)
2dcbb4c design: svetla horni lista podle mockupu Sefika
a579468 Doc: handoff - radius tokeny 100% a ikony v zalozkach hotovo
dcfdfa5 design: ikony v hornich modulovych zalozkach
31d941a design: dotazeni radius tokenu 8/10/12px napric zbylymi obrazovkami
76eba8f design: radius tokeny napříč zbylými obrazovkami (priorita 10 - ostatní)
38d5e85 design: Marketing shell - radius tokeny místo pevných hodnot
3bf4fe5 design: Finance/Faktury - radius tokeny místo pevných hodnot
c5c0976 design: Lidé - radius tokeny místo pevných hodnot
2557e78 Design systém: Ukoly a Zalohy (priorita 6, 4)
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

**Doplněno 16.–17.9.2026 relací Provoz — tenhle bod byl silně zastaralý**
(psala ho relace marketing/faktury 15.9., která do Provozu nesahala).
Od té doby proběhlo v Provozu hodně práce, mimo jiné:

- **Docházka A1 opraveno** — stornovaný příchod už nenabízí Odchod
  (`app/[rozsah]/dochazka/page.tsx`, přes `app.otevreny_prichod`/
  `public.muj_den`, s fallbackem dokud migrace nedoběhne).
- **UX redesign, druhé kolo** — kompozice/hierarchie/density napříč Dnes,
  Směny, Docházka, Vzkazy, Úkoly podle podrobné Šéfíkovy kritiky (17 bodů),
  NE jen barvy. Typografie, topbar, sidebar, kebab menu místo více
  tlačítek v řádku (`.ft-kebab`), atd.
- **Domovská obrazovka natrvalo na Dnes** (`app/page.tsx`), místo
  rozcestníku.
- **Dovoz rozpisu z Excelu přímo v Rozpisu směn** — nový maticový formát
  (dny × jména jako sloupce/řádky), rozpoznání pobočky/pozice podle
  přípony (b/p) i domovské pobočky zaměstnance, zpětné propsání šablony
  do nevydaných směn (`lib/nahrani-rozpisu-matice.ts`, `nastaveni/nahrani/
  rozpis/pruvodce.tsx`).
- **Rozpis směn: týdenní pohled seskupený podle pobočky a úseku**
  (`domovskeUseky`/`nazvyUseku` z `employees.usek_id`, ne z `position_id`
  — úsek a zařazení jsou dvě různé osy, viz `nastaveni/useky/akce.ts`).
- **Nová obrazovka Nastavení → Úseky** — CRUD, chybělo úplně (tabulka
  `useky` měla RLS, ale žádnou správu). Úsek přidán i do formuláře
  Nastavení → Lidé.
- **Trhaná směna** (pauza uprostřed) — `shifts.pauza_od`/`pauza_do`,
  checkbox ve `formular-smeny.tsx` (jednorázová výjimka z hranice mezi
  relacemi, se svolením Šéfíka), odstraněno zbytečné druhé tlačítko „+".
- **Migrace `20260916190000_prepsani_sablony_do_smen.sql` a
  `20260916200000_trhana_smena.sql` — NASAZENY 16.9.2026 večer** (Šéfík).
  Cestou se objevil a vyřešil zádrhel: `db push` nejdřív tiše neproběhl
  (nesedělo přihlášení CLI), pak spadl na `migration history` konfliktu
  (nezapsaná migrace `20260913190528` v remote historii bez lokálního
  souboru) — opraveno `supabase migration repair --status reverted
  20260913190528`, pak `db push` prošel. Ověřeno přímým dotazem do
  databáze, ne jen hlášením Šéfíka.
- **Produkční pád na `/[rozsah]/smeny` opraven** — dotaz bral nové
  sloupce `pauza_od`/`pauza_do` natvrdo, bez `sloupecNeexistuje()`
  fallbacku (na rozdíl od zavedeného vzoru jinde). Opraveno, aby stránka
  fungovala bez ohledu na pořadí nasazení migrace vs. kódu.
- **GitHub Actions „Migrace a scénáře" opraveno** — viz bod 2 a 13.
- Bezpečnostní nález TRUNCATE grantů (bod 6, 51 provozních tabulek)
  zůstává **neopravený**, čeká na rozhodnutí Šéfíka
  (`docs/granty-provoz-zadani.md`).
- **Nedotčeno kvůli paralelní relaci:** `smeny/formular-smeny.tsx` (mimo
  jednu schválenou výjimku výš), `ceka-na-opravneni.tsx`,
  `pwa-registration.tsx`, `.install-help`/`.pwa-ios-help` v `globals.css`
  — sjednocení modálních oken na `Dialog`/`Drawer`, běží souběžně.

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
- **Úkoly, Zálohy** — lehké dotažení (radius tokeny), stejný vzor.
- **Lidé** (`nastaveni/lide/page.tsx`) — lehké dotažení (`formular`
  12px→`--radius-lg`, `inputPole` 10px→`--radius-sm`). Tabulka a
  akční odkazy (Upravit/PIN/Smazat) záměrně nepřestavěny na
  DataTable+kebab-menu (master prompt sekce 23) — citlivá oblast
  (lidé/PIN/oprávnění), zůstává jako samostatný TODO.
- **Finance shell** — všech 9 obrazovek Faktur (jediná sekce modulu
  Finance) přes mechanickou náhradu 14px→`--radius-lg`, 8px→
  `--radius-sm`, 999px→`--radius-full`.
- **Marketing shell** — přehledová karta + sdílený `.modul-*` rám
  (`navigace.tsx`/`globals.css`) na tokeny.
- **Priorita 10 (ostatní)** — stejná mechanická náhrada (jen
  jednoznačné shody 14px→lg a 999px→full, ne 8/10/12px, které chtějí
  vizuální rozhodnutí sm/md) napříč zbytkem Marketingu (16 obrazovek),
  Docházkou (2 panely), Nastavením (Firma/Pobočky/Zařazení/Zařízení/
  Nahrání), rozcestníkem `[rozsah]/page.tsx`, Směnami (panel výdání),
  Vzkazy (konverzace/nástěnka), Zálohami (formulář/pozastavení).
- **Dotaženo (16.9.2026, na výslovnou žádost „podívej se i na ostatní
  soubory"):** zbylé hodnoty 8/10/12px sjednoceny na tokeny podle
  jasného opakovaného vzoru (vstupní pole 8/10px→`--radius-sm`,
  vedlejší/sunken karty 12px→`--radius-md`) napříč 36 dalšími soubory
  — teď **nulové pevné hodnoty radiusu** v celé appce mimo
  `formular-smeny.tsx` (patří paralelní relaci). **Ikony v horních
  modulových záložkách doplněny** — 3 nové tvary (`mince`/`praporek`/
  `vozik`) ve stejném stylu jako zbytek sady, mapované podle klíče
  modulu v `GlobalTopbar.tsx`. Živě ověřeno desktop i mobil.
- **Pivot 16.9.2026 dopoledne:** Šéfík po živé kontrole řekl „apka
  není vůbec podobná foto výše" a poslal znovu referenční mockup
  (bohatý dashboard s hero bannerem, pozdravem, 4 kartami, 3sloupcovým
  rozvržením). Ujasněno přes AskUserQuestion: (1) top-lišta má být
  SVĚTLÁ podle mockupu (byla tmavá jako panel) — **hotovo**; (2) čísla
  bez zdroje dat (tržby/objednávky/hodnocení) — Šéfík řekl „mám/seženu
  zdroj dat", **zůstávají nepostavená, čekají na něj**; (3) Dnes —
  „ano, plná přestavba" — **hotovo včetně obou dřív odložených kusů**.
  Detaily viz body 4 a 5 (commity `2dcbb4c`…`fd3d81b`).
- **Dnes je teď kompletní podle mockupu** (mimo blokované položky):
  hero s pozdravem/datem/barvou pobočky (bez fotky — appka nemá
  skutečný snímek té které restaurace, cizí stock by lhal), 4
  přehledové karty (Docházka/Další směna/Vzkazy/Úkoly, reálná data),
  Owner Attention Center, píchací formulář beze změny, barevný náhled
  dnešního rozpisu (`--osoba`/`data-osoba`, stejný vzor jako Rozpis
  směn), widget Tým dnes (`X/Y přítomno`, jen vedení, **bez nové
  migrace** — znovupoužívá existující `nedokoncena_dochazka` RPC se
  stejným dnem místo 30denního okna), Rychlé akce (permission-gated
  odkazy). Živě ověřeno světlý/tmavý režim i mobil 375px.
- **Stále blokováno na Šéfíkovi:** Tržby dnes / Online objednávky /
  Hodnocení Google / počasí — čekají na zdroj dat, ne na vymyšlená
  čísla. Hero fotka provozovny — appka nemá odkud vzít skutečný
  snímek.
- **Pokračování 16.9.2026 odpoledne** (Šéfík: „pokračuj intenzivně,
  dnes potřebuji dodělat vzhled dle zadání a dále dodělat modul
  provoz"). Ujasněno přes AskUserQuestion: Vzkazy ConversationList/
  ChatView + další obrazovky ve stylu Dnes — **NE** stavba chybějících
  funkcí (Receptury/Jídelní lístky/Motivace zůstávají BRZY, mimo
  rozsah). Commity `30ac9cb`…`e34fbcd`:
  - **Vzkazy — plná přestavba na ConversationList/ChatView** (master
    prompt sekce 21, poslední konkrétní dluh v Provozu). Nová sdílená
    komponenta `SeznamRozhovoru` (`app/[rozsah]/vzkazy/
    seznam-rozhovoru.tsx`), stejná na `/vzkazy` i `/vzkazy/
    [konverzace]`. Nad 900px stojí seznam vlevo + vlákno vpravo vedle
    sebe (`.ds-vzkazy-split`), pod 900px jen jedno z obou podle
    stránky (`data-zobrazit`) — žádný klientský stav, pořád se
    přepíná adresou. Nástěnka (druhá záložka) beze změny.
  - **Docházka, Zálohy, Úkoly — 2sloupcové rozvržení** pro dvojice
    rovnocenných sekcí (Moje směny/Dnes na pobočce; tabulka/formulář;
    Otevřené úkoly/Checklisty). Docházka je rozsáhlý bezpečnostně
    citlivý soubor (mzdy) — zásah byl záměrně jen prezentační
    (auto-fit grid), žádná byznys logika/dotaz/oprávnění se neměnily.
  - **Rozpis směn záměrně nedotčen** — je to `"use client"` komponenta
    sdílená s `formular-smeny.tsx`, na kterém právě pracuje paralelní
    relace (sjednocení modálů); navíc je to široká tabulka/kalendář,
    kde by 2sloupcové vynucení UX zhoršilo, ne zlepšilo.
  - **Lidé plná DataTable+kebab-menu přestavba** — pořád nezapočato,
    zůstává jako TODO (citlivá oblast PIN/oprávnění, samostatná práce).
  - Etapy 4(zbytek)-14 z master promptu (Finance rozšíření, Marketing
    dokončení, AI gateway, Gastro AI, Receptury/Menu, Objednávky,
    cross-module intelligence, plná responzivita, bezpečnostní
    regrese, release) — nezapočaty, velké samostatné bloky práce,
    nezačínat bez zvláštního zadání.
- **Vizuální ověření živě HOTOVO** (16.9.2026 ráno, na žádost Šéfíka
  „zkontroluj vzhled živě"). Příčina včerejšího `ERR_FAILED` nalezena:
  **zastaralý PWA service worker na `localhost:3000`** zachytával
  requesty a shazoval CSS chunky konkrétně v sandboxu Browser pane
  nástroje — odregistrování service workeru + smazání cache (`caches
  .keys()`/`delete`) problém okamžitě vyřešilo. Nesouviselo s kódem,
  potvrzeno. Živě zkontrolováno a v pořádku: Dnes (Owner Attention
  Center — „633 faktur je po splatnosti", živá data, o jednu víc než
  včerejších 632), Rozpis směn, Docházka, Vzkazy, Úkoly, Lidé (formulář
  vizuálně, tabulka přes DOM), Finance/Faktury, Marketing — seskupený
  boční panel, tmavý topbar, amber/zlatý akcent, radius/stín na
  kartách. Navíc zkontrolován **tmavý režim** (dobrý kontrast, akcent
  zůstává) a **mobilní šířka 375px** (sbalený topbar, rolovatelné
  modulové záložky, spodní lišta) — obojí v pořádku. Jediný nález byl
  falešný poplach: `scrollIntoView()` z vlastního testování zaskočil
  obsah za dvojici sticky lišt, čerstvé načtení stránky ukázalo správné
  vykreslení.
- Navazující úloha (založena, ne součást téhle etapy, běží souběžně
  v jiné relaci): sjednotit 3 ruční implementace modálního okna
  (`smeny/formular-smeny.tsx`, `ceka-na-opravneni.tsx`,
  `pwa-registration.tsx`) na nový `Dialog`/`Drawer`. **Nesahat na tyhle
  tři soubory a na `app/globals.css` v oblasti `.install-help`/
  `.pwa-ios-help` — patří té druhé relaci**, může být rozpracované.

## 12. Rozpracovaná etapa

**Faktury sloučení je hotové** (kód, migrace, RLS, živě ověřeno), žádný
otevřený bod. **Aktivní je design systém** (bod 11, zadáno 15.9.2026
večer) — nadace hotová, **celá explicitní priorita 1–10 z master
promptu je teď hotová** (AppShell, Dnes, Rozpis směn, Docházka, Vzkazy,
Úkoly, Lidé, Finance shell, Marketing shell, ostatní obrazovky).
Zbývá: hodnoty 8/10/12px (chtějí ruční rozhodnutí sm/md, ne sed),
ikony v horních záložkách, plné přestavby Vzkazy/Lidé (viz bod 11),
a **vizuální ověření živě** — dnešní/noční práce se nedala odzkoušet
kvůli nástroji (bod 11), zůstává jako první krok příští relace. Marketing
Krok 4 (renderer) a Krok 5 E2E zůstávají blokované (bod 13), nesouvisí
s design systémem, nikdo na nich aktivně nepracuje.

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
7. ~~GitHub Actions „Migrace a scénáře"~~ — **OPRAVENO 16.9.2026**, viz bod 2.

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
5. ~~Prošetřit selhávající GitHub Actions check „Migrace a scénáře"~~ —
   **OPRAVENO 16.9.2026** (relace Provoz, PR #20), viz bod 2.

## 16. Doporučený další krok (přesně)

**Faktury jsou kompletně hotové, nasazené, RLS opravená a živě ověřené**
(15.9.2026 večer) — na Fakturách samotných není žádný další nutný krok.

**Design systém** (bod 11/12): priorita 1–10 z master promptu hotová,
radius tokeny 100% pokrytí, ikony v záložkách doplněné, Dnes plně sedí
na mockupu, **a modul Provoz je teď vizuálně dotažený** (commity
`2dcbb4c`…`e34fbcd`, pushnuté na `origin`, živě ověřeno včetně tmavého
režimu a mobilu). Doporučený postup pro další relaci:
1. **Až Šéfík sežene zdroj dat** (POS pro tržby, Google Business API
   pro hodnocení, weather API pro počasí) — napojit „Rychlý přehled"
   a widget počasí na Dnes. Do té doby nevymýšlet čísla.
2. **Lidé — plná DataTable+kebab-menu přestavba** (master prompt
   sekce 23) — jediná zbývající plná přestavba v Provozu, odloženo
   kvůli citlivosti (PIN/oprávnění), samostatná práce.
3. Stejný „vzhled podle mockupu" pohled na moduly MIMO Provoz
   (Finance/Faktury, Marketing, …) — mockup, který Šéfík poslal,
   ukazoval jen Dnes; Provoz teď dotažený je, ale nikdo neověřil, jestli
   mají sedět na nějaký konkrétní vzhled i tyhle. Zeptat se, než se
   předělává něco, co už možná sedí.
4. Etapy 4(zbytek)-14 z master promptu — velké samostatné bloky,
   nezačínat bez zvláštního zadání/kontextu, který v tomhle handoffu
   možná chybí (master prompt sám existuje jen v chatu, viz bod 1).

**Souběžně běží samostatná relace** na sjednocení 3 ručních modálních
oken (`smeny/formular-smeny.tsx`, `ceka-na-opravneni.tsx`,
`pwa-registration.tsx`) na sdílený `Dialog`/`Drawer` — nesahat na tyhle
tři soubory ani na `app/globals.css` v oblasti `.install-help`/
`.pwa-ios-help` z jiné relace souběžně, ať nevzniknou konflikty.

**Nezávisle, kdykoli:** Marketing Krok 4 (potřebuje jiné prostředí než
tenhle Windows stroj) nebo Krok 5 E2E (potřebuje Šéfíkovo rozhodnutí) —
obojí nezávislé na design systému i na sobě navzájem.
