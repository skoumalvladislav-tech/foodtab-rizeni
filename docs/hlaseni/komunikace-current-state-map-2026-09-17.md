# Komunikace / Notifikace — COMMUNICATION CURRENT STATE MAP

17. 9. 2026, v noci. Etapa A (audit) podle nočního zadání „FOODTAB —
KOMUNIKACE, VZKAZY A NOTIFIKAČNÍ CENTRUM". Účel: než se začne psát
nový kód, vědět přesně, co už existuje — zadání samo to žádá jako
první krok ("Nejdříve vytvoř krátký COMMUNICATION CURRENT STATE MAP").

**Zjištění číslo jedna: tohle NENÍ zelená louka.** Modul Komunikace byl
zadaný a z velké části postavený 3.–7. 9. 2026
(`docs/komunikace-zadani.md`, `docs/nocni-prace-komunikace-2026-09-05.md`)
a rozšířen o upozornění na směny 13. 9. 2026
(`docs/velka-prace-2026-09-08.md`). Většina toho, co noční zadání
popisuje jako cíl, už běží v produkci.

---

## 1. Co existuje a funguje

### Konverzace (chat, ne nástěnka)

`supabase/migrations/20260903100000_komunikace_zaklad.sql`,
`20260906010000_doruceni_po_pichnuti.sql`.

- **`konverzace`** (`osobni` / `pobocka` / `mezi_pobockami` / `vedeni`),
  **`konverzace_ucastnici`** (`precteno_do` — vidí jen vlastník řádku),
  **`konverzace_zpravy`** (`nalehava boolean`, storno místo mazání).
- **RLS: účastnictví je autorizace**, ne oprávnění. `app.je_ucastnik()` —
  ani majitel firmy nepřečte cizí rozhovor. Ověřeno zápornou kontrolou
  v `supabase/tests/krok*_scenar.sql` (modul komunikace má vlastní sadu).
- **Jediná cesta zápisu jsou průzory** (`zalozit_rozhovor`,
  `poslat_zpravu`, `oznacit_precteno`, `stornovat_zpravu`) — přímý
  insert na tabulky je `revoke`d.
- **Audit BEZ obsahu zprávy** (`app.audit_zpravy()` — `to_jsonb(new) -
  'text'`). Cestou se našla a opravila skutečná díra: obecná
  `app.audit_zmenu` zapisovala celý řádek včetně textu a majitel
  s `settings.manage` si tak mohl přečíst stížnost na sebe přes audit,
  i když RLS na `konverzace` mu ji právem odmítala.

### Doručení podle píchnutí (= "zadržené doručení" ze zadání)

`app.doruci_se(p_na_smene, p_konv_branch, p_nalehava)` — **jediné
místo**, kde je pravidlo "vzkazy přijdou až po píchnutí" zapsané.
`app.smena_ted()` bere pobočku z **otevřeného příchodu**
(`app.otevreny_prichod`), ne z "je přihlášený". Naléhavá zpráva
(`communication.urgent`) pravidlo obchází a jde rovnou do auditu se
jménem odesílatele — text zprávy do auditu nejde, jen počet znaků.

**Právní odůvodnění je zapsané přímo v migraci** (§ 78 ZP, judikatura
SDEU o pohotovosti vs. pracovní době) — tohle není náhodou vzniklé
škrtnutí funkce, je to podložené rozhodnutí.

`public.moje_rozhovory()` vrací pro každou konverzaci `neprectenych`
(kolik čeká) a `ceka` (kolik z toho ještě čeká na píchnutí — rozdíl je
to, co se smí ukázat). `public.ceka_na_me()` dává dvě souhrnná čísla
pro odznak — bezpečné i pro sdílený tablet, protože nesou jen počty,
ne obsah.

### "Napsat vedení"

`zalozit_rozhovor(p_druh := 'vedeni', p_adresat := 'vedouci' | 'majitel')`.
**Účastníci se u tohohle druhu NEPŘEDÁVAJÍ z prohlížeče — odvozují se
na serveru** z `role_permissions`/`is_owner`. `majitel` vidí jen
majitelé, `vedouci` jen ten, kdo má `people.manage` na domovské
pobočce odesílatele. Přesně to, co zadání žádá ("Zpráva nesmí být
automaticky dostupná vedoucímu pobočky, pokud podle permission modelu
nemá být příjemcem").

Otevřená otázka zapsaná přímo v migraci (ne zapomenutá, jen
nerozhodnutá): u člověka na dvou pobočkách se "vedoucí" bere z domovské
pobočky, ne z té, kde zrovna je.

### Priorita zpráv

Dnes **binární** (`nalehava boolean`), ne třístupňová
(NORMAL/IMPORTANT/URGENT ze zadání). `communication.urgent` je
samostatné právo (ne `communication.manage`) — posílat nástěnku a
budit lidi ve dvě ráno jsou dvě různé pravomoci.

### Notifikační centrum (existuje, jmenuje se "Upozornění")

`app/[rozsah]/upozorneni/page.tsx` + tabulka `public.notifications`
(`20260901130000_vydani_rozpisu.sql`). RLS: každý vidí jen svoje —
ani majitel cizí (dozvěděl by se, kdo kdy dělá).

**Event-driven, ale bez formálního event-logu** — zápis do
`notifications` běží přímo v triggerech/průzorech nad zdrojovou
tabulkou, ne přes samostatnou frontu/outbox:

| Zdroj | Kde | Druhy |
|---|---|---|
| Směny | `app.upozornit_smenu()`, volané z `ulozit_smenu`/`smazat_smenu` | `smena.nova`, `smena.zmenena`, `smena.odebrana`, `smena.zrusena` |
| Nástěnka | trigger `upozornit_na_oznameni` na `announcements` | `oznameni.nova` |
| Vzkazy | trigger `upozornit_na_vzkaz` na `konverzace_zpravy` | `vzkaz.novy` |
| Marketing | (jinde v repu) | `marketing.zadost`, `marketing.publikace_selhala`, … |
| Docházka | (jinde) | `dochazka.zapomenuty_odchod` |
| Lidé/PIN/pozvánky | (jinde) | `pozvanka.prijata`, `opravneni.prideleno`, `pin.prenastaven` |

Tohle **pokrývá většinu katalogu událostí ze zadání (SHIFT_CHANGED,
SHIFT_CANCELLED, URGENT_MESSAGE per naléhavost, DIRECT_MESSAGE,
BRANCH_ANNOUNCEMENT, MARKETING_APPROVAL_REQUIRED, PUBLISHING_FAILED)
— jen ne jako jmenovaný `enum`, ale jako řetězec `druh`.**
TASK_ASSIGNED/TASK_CHANGED/TASK_DUE_SOON/CHECKLIST_REQUIRED,
APPROVAL_REQUIRED, INVOICE_REVIEW_REQUIRED, INVOICE_OVERDUE —
**neověřeno, jestli píšou do `notifications`** (mimo rozsah dnešního
auditu, dopsat příště).

**Slučování (dedup/coalescing) už existuje** — přesně to, co zadání
žádá v bodě 36 ("nevytvářej notification spam"): `app.upozornit_smenu`
smaže nepřečtené téhož `(user_id, druh, den)` a nahradí novým. Osm
změn jednoho dne → jedno upozornění.

**Obrazovka `/upozorneni`** už umí: nepřečtené vs. přečtené vizuálně
odlišené, "označit všechny za přečtené", **hluboký odkaz na konkrétní
objekt** (přesně požadavek zadání "Notification musí linkovat přímo na
konkrétní objekt") — tlačítka jako "Doplnit odchod", "Přidělit
oprávnění", "Otevřít frontu ke schválení" vedou rovnou na
předvyplněné místo, ne obecně na modul.

**Zvoneček v `GlobalTopbar.tsx`** ukazuje počet nepřečtených (`9+` při
přetečení) — ale odkazuje na celou stránku `/upozorneni`, ne na
vysouvací panel/dropdown, jak zadání navrhuje v bodě 15.

### Potvrzení důležité změny (acknowledgement)

Existuje, ale **jen pro nástěnku**, ne pro upozornění obecně:
`announcements.requires_acknowledgment` + `public.kdo_nepotvrdil()`
(`20260913120000`, `20260913130000`). Notifikace (`public.notifications`)
mají jen `read_at` — **žádné `acknowledged_at`**. Zadání (bod 12)
chce SENT/DELIVERED/READ/ACKNOWLEDGED explicitně i pro **změnu
směny** ("[Potvrdit změnu]") — tohle dnes NEEXISTUJE.

### Vzkazy — UX

`app/[rozsah]/vzkazy/` — `page.tsx` (seznam rozhovorů +
`SeznamRozhovoru`), `[konverzace]/page.tsx` (vlákno), `nastenka.tsx`
(druhá záložka), `akce.ts`. Desktop split-view (`.ds-vzkazy-split`,
seznam vlevo ~320–360px / vlákno vpravo nad 900px, jedno z obou pod
900px podle adresy) — **přesně odpovídá požadavku zadání bodu 16**,
postavené v tomhle repu 16.9.2026 (redesign druhého kola). Filtry
Vše/Nepřečtené/Přímé/Pobočky/Vedení — **odpovídá bodu 16 doslova**.

---

## 2. Co je opravdu jinak, než zadání navrhuje (vědomé rozhodnutí, ne díra)

- **Quiet hours jsou vázané na směnu, ne na hodiny na hodinách.**
  Zadání (bod 25) navrhuje `22:00–07:00`. Tenhle modul místo toho váže
  doručení na **skutečnou přítomnost v práci** (`app.smena_ted`) — cílenější
  a právně podloženější (viz výš), ale nepokrývá case "člověk má
  směnu v 23:00" (tam by klasické quiet hours zprávu schovaly, tohle
  ji naopak doručí, protože je na směně). **Rozhodnutí pro Šéfíka**,
  jestli má vedle tohohle vzniknout i klasické hodinové okno, nebo
  jestli tohle řešení stačí.
- **Notifikační centrum je celá stránka, ne dropdown panel z
  zvonečku.** Funkčně rovnocenné, vizuálně jiné, než ukazuje mockup
  v zadání (bod 15).
- **Žádný formální event-log/outbox** (zadání bod 9, 29). Zápis běží
  v téže transakci jako zdrojová událost (`security definer` funkce/
  trigger) — to je ve skutečnosti SILNĚJŠÍ záruka doručení než
  outbox s async zpracováním (nemůže se "ztratit mezi update a
  notifikací", protože je to jeden příkaz), ale není to
  znovu-přehratelný log a nepodporuje retry/idempotency pro EXTERNÍ
  kanály (protože žádný externí kanál zatím není, viz níž).

---

## 3. Co opravdu chybí

1. **Třístupňová priorita (NORMAL/IMPORTANT/URGENT).** Dnes jen
   `nalehava boolean` u zpráv a žádná priorita u `notifications`
   vůbec. Zadání to chce jako řídicí prvek doručení, ne jen barvu.
2. **Konfigurovatelná naléhavost změny směny podle blízkosti data**
   (zadání bod 10: "Nevymýšlej časovou hranici naslepo... navrhni ji
   jako konfigurovatelné business pravidlo"). Dnes všechny `smena.*`
   notifikace mají stejnou váhu bez ohledu na to, jestli je změna za
   hodinu nebo za tři týdny.
3. **Acknowledgement (potvrzení) u změny směny.** Existuje jen pro
   nástěnku. Zadání to chce explicitně i pro `smena.zmenena`/
   `smena.zrusena` s "[Potvrdit]" tlačítkem a přehledem, kdo potvrdil.
4. **Uživatelské nastavení upozornění** (zadání bod 24) — žádná
   obrazovka, kde by si člověk zapnul/vypnul kategorie (Přímé zprávy,
   Změny mých směn — to poslední navíc podle zadání NESMÍ jít vypnout).
5. **Hlasové zprávy + AI přepis** (body 19–21) — neexistuje vůbec.
   Composer ve vzkazech dnes umí jen text.
6. **E-mailový kanál pro upozornění** (Resend je v projektu nastavený
   pro jiné účely — pozvánky, kód pro přihlášení — ale žádné
   upozornění z `notifications` dnes e-mail neposílá).
7. **Notifikační centrum jako vysouvací panel** místo celé stránky
   (kosmetický rozdíl proti mockupu, ne funkční mezera).
8. **Neověřeno** (mimo rozsah tohoto auditu): jestli Úkoly/Checklisty/
   Faktury/Schvalování zapisují do `notifications` u všech událostí,
   které zadání jmenuje (TASK_ASSIGNED, CHECKLIST_REQUIRED,
   APPROVAL_REQUIRED, INVOICE_REVIEW_REQUIRED, INVOICE_OVERDUE) — bod
   pro další průchod.

---

## 4. Doporučené pořadí zbývající práce

Zadání samo (bod 37) navrhuje Etapy A–I. Na základě týhle mapy:

1. ~~Acknowledgement pro změnu směny~~ — **HOTOVO, NENASAZENO
   17.9.2026 v noci.** Migrace `20260917010000_potvrzeni_zmeny_smeny.sql`
   (`notifications.acknowledged_at`), pravidlo "který druh vyžaduje
   potvrzení" na jednom místě (`lib/upozorneni-text.ts`,
   `vyzadujePotvrzeni` — jen `smena.zmenena`/`smena.zrusena`), tlačítko
   "Potvrdit" na `/upozorneni`, degraduje gracefully dokud migrace
   nedoběhne. Ověřeno CI proti čisté databázi ([draft PR #24](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/24),
   `VŠECHNY KONTROLY PROŠLY`, 1302 kontrol) — **PR zůstává draft,
   nemerguje se bez schválení Šéfíka** (bod 41 zadání).
   **Vědomě nehotové:** pohled VEDOUCÍHO "kdo potvrdil" (zadání bod
   12 — "Anna ✓ potvrzeno 18:42, Petr čeká, Karel nedoručeno").
   `notifications` dnes nemá `shift_id`, jen `telo->>'den'` (datum),
   takže nejde spolehlivě dohledat "kdo všechno má potvrdit TUHLE
   konkrétní směnu" napříč lidmi — jen zaměstnanec vidí a potvrzuje
   svoje vlastní řádky. Přidat `shift_id` je samostatný krok.
2. **Třístupňová priorita** — rozšířit `nalehava boolean` na `priorita
   text check (in 'normal','important','urgent')` (migrace, ne
   přepis) a promítnout do `app.doruci_se`. Dotýká se víc míst,
   větší, ale pořád izolovaný kus.
3. **Konfigurovatelná časová hranice naléhavosti u směn** — vyžaduje
   rozhodnutí Šéfíka o výchozí hodnotě (hodiny do směny), ne jen kód.
4. **Uživatelské nastavení upozornění** — nová obrazovka +
   tabulka/sloupce pro preference, s tím, že "Změny mých směn" musí
   zůstat nevypnutelné (zadání to říká výslovně).
5. **Hlasové zprávy** — největší samostatný blok (nahrávání, storage,
   AI přepis pipeline), vlastní etapa.
6. **E-mailový kanál** — navazuje na 1–3, potřebuje rozhodnutí, které
   `druh` upozornění si e-mail zaslouží.

Etapy 7–8 (bod 8 výš, ověření pokrytí Úkolů/Faktur) můžou proběhnout
kdykoli mezi ostatním jako rychlá kontrola, ne implementace.

**Doplněno 17.9.2026 v noci, druhý noční běh (zadání "KOMUNIKACE /
VZKAZY 2.0"):** kanál úseku (department channel) — dosud v
`20260906020000_odvozene_kanaly.sql` výslovně odloženo jako
"rozhodnutí pro Šéfíka" — je **HOTOVO, NENASAZENO**. Migrace
`20260917030000_kanal_useku.sql`, mirror `kanal_pobocky` přesně
(`public.kanal_useku`, `app.je_ucastnik` rozšířené o třetí odvozenou
větev podle `employees.usek_id`, `moje_rozhovory` rozšířené o
`muj_usek` CTE). UI: tlačítko "+ Otevřít kanál úseku" ve
`vzkazy/page.tsx`, filtr "Úsek". Scénář `krok34_scenar.sql` ověřuje
klíčovou věc — úsek je vlastnost ČLOVĚKA, ne pobočky (stejný úsek na
jiné pobočce čte, jiný úsek na stejné pobočce ne). CI zeleno
(`VŠECHNY KONTROLY PROŠLY`, 1321 kontrol) po dvou opravách přímo
v testu (kolize UUID s krok26, chybná kontrola "nepřečtené" testovaná
na autorovi zprávy místo na jiném čtenáři). [Draft PR #31](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/31)
— **zůstává draft, nemerguje se bez schválení Šéfíka.**

Další v pořadí (bod 2 výš): třístupňová priorita.

**Doplněno 17.9.2026 v noci, pokračování (bod 2 — třístupňová
priorita):** **HOTOVO, NENASAZENO.** Migrace
`20260917040000_priorita_zprav.sql` — `konverzace_zpravy.priorita`
(normal/important/urgent) jako rozšíření, `nalehava` zůstává jako
ODVOZENÝ sloupec (`generated always as priorita = 'urgent'`), takže
se s ním nemůže rozejít a všechno staré (RLS, `moje_rozhovory`,
`kiosek_zpravy`, `app.doruci_se`) čte beze změny dál. `app.doruci_se`
se záměrně NEMĚNÍ — mimo směnu doručí jen `urgent`, `important` je
jen vizuální/řadicí váha. `poslat_zpravu` dostala `p_priorita` navíc;
CI odhalilo, že `CREATE OR REPLACE` s přidaným parametrem nestačí
(stará i nová signatura zůstanou vedle sebe a dvouargumentové volání
spadne na "is not unique") — opraveno výslovným `DROP FUNCTION`
staré signatury napřed. `notifications.priorita` se u `vzkaz.novy`
přebírá ze zprávy. UI: composer má výběr priority místo zaškrtávátka,
vlákno rozlišuje 3 úrovně barvou okraje (`--warn` urgent, `--info`
important). Scénář `krok35_scenar.sql`, CI zeleno po dvou opravách
(chybějící DROP, a `zalozit_rozhovor` čeká `employees.id` ne
`profiles.user_id`). [Draft PR #32](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/32)
(staví na #31) — **draft, nemerguje se bez schválení.**

**Doplněno stejnou noc (bod 4 — uživatelské nastavení upozornění):**
**HOTOVO, NENASAZENO.** Migrace `20260917050000_nastaveni_upozorneni.sql`
— tabulka `notification_preferences` (tenant_id, user_id, kategorie,
povoleno), RLS `user_id = auth.uid()`, žádná RPC obálka. Dvě
kategorie: `vzkazy`, `nastenka` — obě informativní. **Směny se
NEDAJÍ vypnout strukturálně**: CHECK na sloupci `kategorie` zná jen
tyhle dvě hodnoty, `app.upozornit_smenu()` `app.upozorneni_povoleno`
vůbec nevolá — není to "checkbox v UI chybí", je to "taková kategorie
neexistuje". Vypnutí zastaví jen NOVÉ upozornění, nesahá na už
doručené nepřečtené (ověřeno scénářem — stejné `id` přežije). UI:
`/[rozsah]/upozorneni/nastaveni`. Scénář `krok36_scenar.sql`, CI
zeleno napoprvé. [Draft PR #33](https://github.com/skoumalvladislav-tech/foodtab-rizeni/pull/33)
(staví na #32) — **draft, nemerguje se bez schválení.**

**Tři draft PR na sobě (#31 → #32 → #33), všechny CI-zelené, žádný
nemergovaný.** Zbývá z doporučeného pořadí: bod 3 (konfigurovatelná
hranice naléhavosti — vyžaduje rozhodnutí Šéfíka o výchozí hodnotě,
nejde udělat autonomně), bod 5 (hlasové zprávy — největší samostatný
blok, vlastní etapa), bod 6 (e-mailový kanál).

**Skutečná chyba nalezená a opravená při stavbě bodu 5, zpětně i v #32
a #33 (ne nová práce v samostatné PR, protože šlo o opravu, ne
funkci):** `/vzkazy/[konverzace]/page.tsx` četl sloupec `priorita`
přímo, bez tolerance na to, že v ostré databázi ještě může být jen
starý `nalehava boolean` — kód a databáze se nasazují NEZÁVISLE
(Vercel nasadí kód z `main` hned po mergi, migrace čeká na ruční
`db push`). Po mergi #32 samotné by tahle stránka spadla KAŽDÉMU, dokud
by migrace neproběhla. Opraveno stejným vzorem jako `upozorneni/page.tsx`
(`acknowledged_at`) — dotaz se při „sloupec neexistuje" zopakuje se
starým sloupcem. Nalezeno při stavbě navazující práce, ne testem
(scénáře běží proti čerstvě zmigrované databázi) — je to mezera
v pokrytí testy, zapsáno jako zjištění pro příště.

**Doplněno stejnou noc, pokračování (bod 5 — hlasové zprávy, BEZ AI
přepisu):** **ROZHODNUTÍ ŠÉFÍKA 17.9.2026 v noci** — Claude API nemá
vstup pro zvuk (jen text/obrázky/PDF), AI přepis by potřeboval nového
dodavatele (Whisper API, Deepgram, Google Speech-to-Text…) s vlastním
klíčem a náklady. Šéfík zvolil: nahrávání a přehrávání ANO, přepis NE
(zatím). **HOTOVO, NENASAZENO.** Migrace `20260917060000_hlasove_zpravy.sql`
— `konverzace_zpravy.zvuk_cesta`/`zvuk_delka_s`, sloupec `text`
uvolněný na prázdný (zpráva má text NEBO zvuk, aspoň jedno). Soukromý
kbelík `hlasovky`, mirror `20260913170000_marketing_ulozne.sql`
(cesta `tenant/konverzace/soubor`, politika `app.je_ucastnik` — stejné
právo jako čtení zprávy samotné, ne zvlášť vymyšlené). `poslat_zpravu`
dostala `p_zvuk_cesta`/`p_zvuk_delka_s` — a POPRVÉ výslovně DROPuje
starou signaturu před `CREATE OR REPLACE` (nález z #32: přidání
parametru samotné nestačí, nechá vedle sebe dvě funkce). Navíc
kontrola, že cesta k hlasovce sedí s konverzací, na kterou se posílá
— storage politika sama křížové přiřazení nepokryje. UI: `HlasovkaNahravac`,
jediný klientský ostrůvek v celém vlákně (MediaRecorder, mikrofon jde
jen z prohlížeče), nahrává/přehrává přes podepsané odkazy. Scénář
`krok37_scenar.sql`. Ověřeno `tsc --noEmit`, `eslint` a `next build`
bez chyby; SQL scénář ověří CI.

**Body 7–8 (ověření pokrytí Úkolů/Faktur) provedeny — jen kontrola,
beze změny kódu:**

- `grep` po `create trigger` nad `public.tasks`/`public.checklist_items`
  nenašel NIC. Žádná spoušť, žádný zápis do `notifications` odjinud
  (prohledáno i `app/`, `lib/` — jediné čtení/zápisy `notifications` jsou
  na obrazovce Upozornění a v topbaru).
- `lib/upozorneni-text.ts` (jediné místo, které `druh` formátuje na
  větu) zná jen: `smena.*`, `oznameni.nova`, `vzkaz.novy`,
  `marketing.*`, `dochazka.zapomenuty_odchod`, `pozvanka.prijata`,
  `opravneni.prideleno`, `pin.prenastaven`. Žádný `ukol.*`/`task.*`,
  `checklist.*` ani `faktura.*`/`schvaleni.*` (mimo marketing) tam
  není.
- Topbarový odznak (`app/[rozsah]/layout.tsx`, ř. ~209–237) sčítá
  `notifications` + nepřečtené vzkazy + nepřečtenou nástěnku — bez
  úkolů a faktur. **Kdo dostane přidělený úkol nebo mu čeká faktura
  ke schválení, se o tom nedozví odjinud než otevřením té konkrétní
  obrazovky.** Není to poloviční implementace, která by tiše
  nefungovala — je to úplná absence, dřív jen neověřená.
- **Záměrně NEIMPLEMENTOVÁNO dnes v noci**: přidat `task.prideleny`/
  `faktura.ceka_na_schvaleni` apod. znamená rozhodnout O ČEM se
  upozorňuje (každé přiřazení úkolu? jen blížící se termín? každá
  faktura, nebo jen nad limit?) a to je produktové rozhodnutí pro
  moduly Úkoly/Faktury, které tahle noc nezkoumala do hloubky — psát
  to bez pochopení jejich vlastních konvencí by riskovalo notification
  spam nebo špatně mířené upozornění. Zapsáno jako zjištění, ne
  dopsáno narychlo.

---

## 5. Co se NEDĚLÁ bez dalšího zadání

Podle bezpečnostní brány nočního zadání (bod 41): žádný merge do
`main`, žádný `supabase db push`, žádné produkční tajemství/proměnné,
žádná externí aktivace SMS/e-mailu se skutečnými uživateli — tahle
mapa a navazující implementace zůstávají na samostatné větvi, dokud
Šéfík výslovně nepotvrdí.
