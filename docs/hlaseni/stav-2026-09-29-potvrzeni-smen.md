# Stav k 29. 9. 2026 — potvrzovací tabulka směn: DB, UI, testy a kontrola

## Nejdřív to podstatné

Zadání Šéfíka doslovně: „nastav aby při vydání směny se vyslala hromadná
notifikace těm lidem kterých se směna týká, zároveň možnost potvrzení
všech směn a nebo možnost nepotvrdit třeba jednu nebo více směn. chtělo
by to potvrzovací tabulku.“

Práce proběhla ve čtyřech krocích téhož dne: databáze, UI, testy a
nakonec dvě nezávislé kontroly (bezpečnost + konzistence) nad hotovým
kódem. Tenhle soubor je finální hlášení za všechny čtyři — nahrazuje
dřívější verzi, která popisovala jen UI půlku, ještě než databázová
migrace a testy vznikly.

**Nic z tohodle není commitnuté, pushnuté ani nasazené.** `supabase db
push`, `git commit`, `git push`, `gh pr` jsem záměrně nespustil — o to
se stará hlavní relace po předání.

## Co je hotové

| Co | Soubor | Stav |
|---|---|---|
| Migrace: odmítnutí jako vlastní stav, hromadné potvrzení, centrální notifikace při vydání | `supabase/migrations/20260929100000_smeny_potvrzeni_tabulka.sql` | nové |
| Potvrzovací tabulka — zaměstnanec (Potvrdit vše / jednotlivě / Odmítnout s důvodem) | `app/[rozsah]/smeny/potvrzeni/page.tsx` | nové |
| Přehled pro vedoucího „Kdo potvrdil“ (jen čtení) | tamtéž, druhá sekce | nové |
| Serverové akce (3 RPC volání) | `app/[rozsah]/smeny/potvrzeni/akce.ts` | nové |
| Dvoukrokový formulář odmítnutí (vzor storna docházky) | `app/[rozsah]/smeny/potvrzeni/odmitnout.tsx` | nové |
| Odkaz „Potvrzení směn“ v hlavičce Rozpisu (počítač) a karta na telefonu | `app/[rozsah]/smeny/rozpis.tsx`, `mobil/pohledy.tsx`, `mobilni-rozpis.tsx` | upraveno |
| Text, odkaz a vykreslení nového upozornění `smena.odmitnuta` | `lib/upozorneni-text.ts`, `lib/upozorneni-odkaz.ts`, `app/[rozsah]/upozorneni/page.tsx` | upraveno |
| Oprava rizika: `confirmed_at` je nullable (odmítnutí) — puntík a detail směny to musí filtrovat, jinak odmítnutá směna vypadá jako zelená | `lib/rozpis-desktop.ts`, `app/[rozsah]/smeny/potvrzeni-okna.ts`, `app/[rozsah]/smeny/potvrzeni.ts` | opraveno |
| CSS: karta „Tým dnes“ umí být i `<a>` | `app/_komponenty.css` | upraveno |
| Scénář DB vrstvy (65+ kontrol, mutation testing) | `supabase/tests/krok64_scenar.sql` | nové |
| Registrace do CI (workflow, `run.sh`) | `.github/workflows/*.yml`, `supabase/tests/run.sh` | upraveno |
| Test obrazovky (řádky, hlášky, RPC, přístup) | `scripts/smeny-potvrzeni.test.mjs` | nové |
| **Kontrola a opravy** (viz oddíl níž) — 2 nálezy v DB, 2 v UI, všechny čtyři reálné a opravené | migrace, `krok64_scenar.sql`, `krok32_scenar.sql`, `page.tsx`, `smeny-potvrzeni.test.mjs` | opraveno |

## Čísla — a z čeho jsou

- `npx tsc --noEmit` — **čisté, 0 chyb**, na celém projektu, po každé
  úpravě znovu.
- `node scripts/smeny-potvrzeni.test.mjs` — **VŠECHNO PROŠLO** (0 chyb),
  včetně 5 nových kontrol pro rozšířenou vstupní bránu (viz Kontrola a
  opravy, nález 3).
- `node scripts/rozpis-desktop.test.mjs`, `node scripts/upozorneni.test.mjs`
  — oba **beze změny, 0 chyb**.
- `node scripts/scenare-pglite.mjs` (celá sada, ne jen výběr) —
  **2789 kontrol, 0 selhání**. Tohle číslo je z běhu úplně
  celé sady (etapa0 → krok64 → marketing1–15), ne z cíleného výběru —
  a právě tenhle rozdíl mi jednou chytil skutečnou regresi (viz Na co
  jsem narazil).
- PGlite navíc **neověří RLS ani sloupcové granty** — o tom rozhoduje
  až CI „Migrace a scénáře“ proti PostgreSQL 16, kam jsem přístup
  neměl.
- **Schválná rozbití (mutation testing), všechna se scénářem
  krok64_scenar + etapa0 (etapa0+krok40+krok64, 146 kontrol, i celá
  sada zvlášť):**
  1. Odstranění `v_s.status = 'cancelled' or` z `odmitnout_smenu` →
     spadlo přesně na „vydaná a POTÉ zrušená směna: odmítnout nejde“
     (nová kontrola, nález 1).
  2. Odstranění `s.status <> 'cancelled'` z `potvrdit_vsechny_moje_smeny`
     → spadlo přesně na „hromadné potvrzení vydanou a POTÉ zrušenou
     směnu taky mlčky přeskočí“ (nová kontrola, nález 1).
  3. Odstranění `m.status = 'active'` z nového JOIN v
     `app.rozdil_rozpisu` → spadlo přesně na „pozastavený člen se
     v náhledu vůbec neobjeví“ (nová kontrola, nález 2).
  Po každém rozbití jsem soubor obnovil ze zálohy a `diff` potvrdil
  bezezbytkovou shodu s opraveným originálem.
- Vykreslení obrazovky naživo **bylo dodatečně ověřeno** (hlavní relace,
  po předání): headless Chrome, `npx next dev --webpack`, skutečné
  kliky přes DevTools Protocol. Desktop (1440px) v pořádku hned napoprvé.
  Na mobilu (390px) se ale ukázal REÁLNÝ problém, který žádný `tsc` ani
  `renderToStaticMarkup` test nemohl chytit: obě tabulky (Moje i Kdo
  potvrdil) byly `overflowX:auto`/`minWidth:560px` bez mobilní varianty
  — sloupce Stav a Akce (tlačítka Potvrdit/Odmítnout, hlavní smysl
  obrazovky) byly mimo viditelnou oblast (scrollWidth 807px vs.
  clientWidth 288px) bez jakéhokoli náznaku, že jde scrollovat. Opraveno
  po vzoru `.ds-vy-tabulka-obal`/`.ds-vy-karty` z `dochazka/vydelky/
  tabulka-vydelku.tsx` (24. 9.): `@container (max-width: 720px)`
  přepíná mezi tabulkou (desktop) a kartami (mobil), obě varianty se
  renderují vždy. Znovu ověřeno screenshotem na 390px a 360px — žádný
  skrytý scroll, karty ukazují stav i tlačítka rovnou. 19 nových
  kontrol v `smeny-potvrzeni.test.mjs`, mutation testing (smazání
  `@container` bloku, vyprázdnění seznamu karet) potvrdil, že testy
  díru chytí. **Poučení k zapsání:** u tabulkových obrazovek nestačí
  `renderToStaticMarkup` a testy DOM struktury — šířkově závislé
  vizuální přetečení se takhle nechytí, potřeba je živý snímek.

## Kontrola a opravy (dvě nezávislé kontroly, odpoledne 29. 9.)

Zadání: ověřit v reálném kódu čtyři nálezy (bezpečnost + konzistence),
opravit skutečné, u zamítnutých napsat proč nejsou reálné. **Všechny
čtyři se ukázaly reálné — žádný nebyl false positive — a všechny čtyři
jsem opravil.**

**1. (střední) Trojitě duplikovaná kontrola „je směna vydaná?“ neměla
bezpečnostní síť pro případ „vydaná, pak zrušená AŽ PO vydání“ u
`odmitnout_smenu` a `potvrdit_vsechny_moje_smeny`.** Ověřeno: nasazený
kód byl v pořádku (kontrola `status = 'cancelled'` tam je), chyběla jen
kontrola nad kontrolou. **Opraveno** — nová sekce `3b` v
`krok64_scenar.sql`: vydá se směna, zruší se přímým `update status =
'cancelled'` (stejný výsledný stav jako po `public.smazat_smenu`), a
ověří se, že obě RPC to odmítnou/přeskočí přesně jako u nevydané. Obě
schválná rozbití (viz Čísla) potvrdila, že nová kontrola díru přesně
zacelí.

**2. (střední) `vydat_rozpis`/`rozpis_nahled` počítaly i zaměstnance
s POZASTAVENÝM členstvím, ale `app.notifikovat` jim potichu nezaloží
nic — náhled a `v_zprav` tak lhaly o počtu doručených zpráv.** Ověřeno
čtením obou funkcí vedle sebe — `app.notifikovat` má `m.status =
'active'` podmínku, `app.rozdil_rozpisu` ji neměla. **Opraveno**
(varianta a z návrhu opravy): nová sekce **7b** v migraci —
`app.rozdil_rozpisu` teď žádá aktivní členství stejným JOINem jako
`app.notifikovat` (vzor napříč repozitářem — `authz.sql`,
`kdo_ma_pravo_na_pobocce` a další). Protože `rozpis_nahled` i
`vydat_rozpis` čerpají ze stejné funkce, spravily se OBĚ najednou a
zůstávají sjednocené, jak hlavička migrace slibuje. Nová sekce **1b**
v `krok64_scenar.sql` dokazuje: pozastavený člen se vydávanou směnou
se v `rozpis_nahled` vůbec neobjeví a `vydat_rozpis` za něj nenahlásí
žádnou zprávu.

> **Vedlejší nález při opravě:** tahle oprava sama rozbila existující,
> nesouvisející scénář `krok32_scenar.sql` (mazání směn, migrace z
> 9. 9.) — viz „Na co jsem narazil“ níž. Opraveno tam, ne oslabením
> nového filtru.

**3. (drobná) Vstupní brána obrazovky byla zamčená jen na
`shifts.read`, i když sekce „Kdo potvrdil“ je pro `shifts.manage`.**
Nová notifikace `smena.odmitnuta` vede vedoucího přímo sem tlačítkem
— a vedoucí s JEN `shifts.manage` (bez `shifts.read`) by narazil na
plnou stěnu „Sem nemáte přístup“, přestože právo, které ho k
notifikaci přivedlo, by mu sekci ukázalo. Ověřeno: `shifts.read` a
`shifts.manage` jsou nezávislá práva a přesně tuhle kombinaci má
Bedřich v `krok64_scenar.sql`. **Opraveno** podle vzoru „dvě práva,
jedna obrazovka“, který repozitář už používá u Záloh
(`dochazka/zalohy/page.tsx`, `advances.manage` / `payroll.read`):
vstupní brána teď pustí dovnitř `shifts.read` NEBO `shifts.manage`
aspoň na jedné pobočce; sekce „Moje“ a „Kdo potvrdil“ si právo hlídají
samy (RPC vrstva to ostatně dělala už dřív — sekce „Moje“ nikdy
nepotřebovala `shifts.read`, jen vlastnictví směny). Přidal jsem 5
nových kontrol do `smeny-potvrzeni.test.mjs`, které přesně tenhle
scénář (jen `shifts.manage`) ověřují.

**4. (drobná) Načítání přehledu pro vedoucího přes víc poboček čekalo
na každé RPC volání zvlášť (`for...of` + `await`), místo souběžně
(`Promise.all`), ačkoli analogický výpočet o pár řádků výš už
`Promise.all` používal.** Ověřeno přímo v kódu. **Opraveno** —
sjednoceno na `Promise.all` se stejným pořadím zpracování chyb (tichy
přeskok při chybě). Existující test se dvěma pobočkami (různá RPC
odpověď podle `p_branch`) prošel beze změny — potvrzuje, že chování
zůstalo stejné, jen rychlejší.

## Co čeká na Šéfíka

Až se tohle sloučí a nasadí, stálo by za krátký test naostro: vydat
rozpis a ověřit, že push na telefon opravdu přijde. Že odmítnutí směny
pošle upozornění vedoucímu té pobočky, a NE vedoucímu jiné pobočky. A
že pozastavenému členovi se v náhledu vydání ani nezobrazí, ani mu nic
nedojde (nález 2 výš).

## Otázky

Žádná nová formální otázka do `docs/hlaseni/otazky.md`:

- Upozornění `smena.odmitnuta` nenese jméno toho, kdo odmítl — jen
  den/čas/důvod. Text i odkaz to nepředstírají, odkazují rovnou na
  tabulku, kde jméno je.
- Okno přehledu pro vedoucího je pevných ±14 dní bez volby data —
  zadání ani vzor (`zalohy_pobocky`) číslo nedávaly.

## Na co jsem narazil a nešlo to

**Moje vlastní oprava (nález 2) rozbila starý, nesouvisející scénář.**
Přidání `m.status = 'active'` JOINu do `app.rozdil_rozpisu` (aby
sedělo s `app.notifikovat`) prošlo cíleným výběrem
(`etapa0_scenar krok40_scenar krok64_scenar`, 154 kontrol, 0 selhání) i
mutation testingem — ale teprve běh CELÉ sady (`node
scripts/scenare-pglite.mjs` bez argumentů) odhalil, že
`krok32_scenar.sql` (mazání směn, migrace z 9. 9., nesahal jsem do ní)
spadl na „zrušení čeká na vydání rozpisu“. Příčina: testovací
zaměstnanec tam má `employees` řádek s `user_id`, ale **žádný**
`memberships` řádek vůbec — dřív `app.rozdil_rozpisu` na členství
nekoukala, takže to nevadilo; po sjednocení s `app.notifikovat` ho
INNER JOIN vyfiltroval úplně. Přesně tohle je důvod, proč tenhle
scénář existuje: cílený výběr scénářů, které „souvisí“, není totéž co
celá sada — scénář, o kterém by mě nenapadlo, že se dotkne, se dotkl.
Opravil jsem to doplněním chybějící aktivní `memberships` (a
`membership_branches`) řádky do `krok32_scenar.sql`, ne oslabením
nového filtru — oslabení by jen znovu otevřelo přesně tu díru, kterou
nález 2 popisuje. Po opravě celá sada (etapa0 → krok33) prošla čistě
(995 kontrol, 0 selhání) a stejně tak celý zbytek sady až po
marketing15.

**Smart quotes při psaní `page.tsx`.** Při jedné úpravě (řešení nálezu
3) se mi do několika řádků skutečného kódu (ne komentářů) místo
rovných uvozovek `"` propsaly typografické `“ ”` — TypeScript by na
tom spadl. Chytilo se to hned při čtení souboru zpátky (byte inspekce,
`xxd`), ne až na `tsc`. Opravil jsem to cíleně po řádcích přes `sed`
s hex escapy (`\xe2\x80\x9c` / `\xe2\x80\x9d`), abych to samo znovu
nerozbil psaním dalších uvozovek — a v dalších úpravách jsem se
v jednom `Edit` volání vyhýbal míchání českých typografických uvozovek
s kódem.

## Kde jsem skončil a co zbývá

Implementace (DB + UI) je hotová, otestovaná (65+ nových DB kontrol,
vlastní test obrazovky, 19 dalších pro mobilní karty) a prošla dvěma
nezávislými kontrolami nad kódem plus dodatečným vizuálním ověřením
naživo, které samo odhalilo a nechalo opravit skutečnou mobilní chybu
(viz Čísla výš). Finální běh celé sady: **2789 kontrol, 0 selhání.**

## Nenasazoval jsem

Nic — nemám k tomu v týhle relaci ani povolení, ani přístup
(`supabase db push`, `git push`, `gh pr` záměrně nespuštěno).
