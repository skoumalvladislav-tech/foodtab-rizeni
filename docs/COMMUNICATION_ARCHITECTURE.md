# Provozní centrum / Komunikace — architektura

Stav: **21. 9. 2026, větev `komunikace-provozni-centrum`** (od `main` 96bc1df).
Zdroj pravdy je kód, databáze, testy a tenhle dokument — ne chat. Co se tu
tvrdí o databázi, bylo **změřeno** v `foodtab-test` (jen katalog a počty,
obsah zpráv se nečetl). Kde se tvrzení opírá jen o čtení kódu, je to řečeno.

Navazuje na `docs/HANDOFF-SMENY.md` (Směny jsou hotová závislost, ne cíl
refaktoru) a `docs/komunikace-zadani.md` (dřívější zadání, jehož rozhodnutí
platí dál, pokud tu není řečeno jinak).

---------------------------------------------------------------------

## 1. Skutečný stav před touto prací

| Oblast | Stav |
|---|---|
| Konverzace | `konverzace`, `konverzace_ucastnici`, `konverzace_zpravy`. Druhy: osobní, pobočka, mezi_pobockami, vedení, úsek. Zápis jen přes definer RPC (`poslat_zpravu`, `zalozit_rozhovor`, `oznacit_precteno`, `stornovat_zpravu`). Účastnictví = autorizace (`app.je_ucastnik`, tři větve: řádek účastníka, kanál pobočky, kanál úseku). Smazání = storno. |
| Nástěnka | `announcements` (+ `announcement_reads`), cílení firma / pobočka / úsek / pozice / člověk, `requires_acknowledgment`. Zápis přímým insertem z akce (ne RPC). |
| Hlasovky | ANO: bucket `hlasovky`, `zvuk_cesta`, `zvuk_delka_s`, záznam MediaRecorderem, max 180 s. Přepis NE. |
| Úkoly / checklisty | `tasks`, `checklist_*`. Úkol nemá vazbu na zprávu, diskusi, detail ani notifikaci. Checklist nevytváří úkol ani problém. |
| Notifikace | Tabulka `notifications` (druh + `telo` jsonb, priorita normal/important/urgent, `read_at`, `acknowledged_at`, `shift_id`). **Zakládá ji 13 míst přímým insertem** v transakci zdroje. Neexistuje jednotné vstupní místo, event log, dedupe klíč, kanály ani stav doručení. |
| Doručení podle práce | `app.doruci_se` + `app.smena_ted` (= otevřený příchod v docházce, § 78 zákoníku práce). Používá se **jen jako výpočet čtení** (`moje_rozhovory.ceka`); notifikace v aplikaci vzniká vždy hned. |
| Kanály | Jen v aplikaci. Push neexistuje (`sw.js` bez push handleru, žádné předplatné), e-mail jen pozvánky. Realtime neexistuje (publikace `supabase_realtime` je prázdná). Offline/retry neexistuje. |
| UI | `/[rozsah]/vzkazy` (seznam \| vlákno, dva sloupce, záložka Nástěnka), `/upozorneni`, zvoneček, `/ukoly`. Mobil = tytéž stránky responzivně, žádný samostatný mobile-first shell, dolní lišta bez odznaku. |
| Data | 2 konverzace, 2 zprávy, 1 oznámení, 18 notifikací, 0 úkolů — migrace jsou prakticky bez rizika ztráty dat. |

Nalezené vady, které tahle práce opravuje nebo obchází (pořadí = závažnost):

1. **Chybějící notifikace.** Trigger `upozornit_na_vzkaz` cílí jen na řádky
   v `konverzace_ucastnici`. Kanály pobočky a úseku se do účastníků zapisují až
   při prvním otevření, takže kdo kanál nikdy neotevřel, notifikaci nedostane.
2. **Slučování směn maže cizí upozornění** (`app.upozornit_smenu`: klíč
   „uživatel + druh + den“, druhá směna téhož dne smaže první). Známo z handoffu.
3. **Nový vzkaz nahradí naléhavé upozornění normálním** (slučování „nepřečtené
   téhož dne“). Vyšetřeno: je to ROZHODNUTÍ, ne vada — scénář `krok35`, oddíl 5,
   ho vyžaduje („po sloučení nese upozornění AKTUÁLNÍ prioritu, ne starou; jinak
   by byl odznak trvale poplašný“). Zachováno. Naléhavá zpráva zůstává v rozhovoru
   označená. **Výjimka po revizi (21. 9.):** naléhavé upozornění, jehož push ještě
   NEODEŠEL, se slučováním neruší (`app.zrusit_neprectene`) — jinak by ho další běžná
   zpráva nahradila čekáním na příchod a naléhavé by čekání neobešlo přesně tam, kde
   má. Odeslané naléhavé se slučuje jako každé jiné.
4. **Celotabulkový `UPDATE` na `notifications`.** Přihlášený si smí přepsat
   `telo`, `druh`, `priorita` i `acknowledged_at` svých řádků; potvrzení je tedy
   nedůvěryhodné a nový sloupec by si mohl přepsat také.
5. **`kdo_nepotvrdil` je definer bez kontroly práva** (hlídá to jen UI).
6. **`zalozit_rozhovor`** u osobních a mezipobočkových rozhovorů kontroluje jen
   shodu firmy. Zpřísnění (jen kolegové z mých poboček) jsem zkusil a **vrátil**:
   rozhovory mezi pobočkami jsou zamýšlené (`krok24` oddíl 7, `krok25` oddíl 3)
   a osobní rozhovor dvou kolegů z různých poboček je běžná věc. Kdo smí komu
   psát, zůstává rozhodnutí pro Šéfíka; výběr příjemců proto nabízí všechny kolegy
   s účtem a řadí „moji pobočku“ nahoru (`komu_muzu_psat`).
7. Zvoneček počítá `notifications` + nepřečtené vzkazy + nástěnku, takže
   `vzkaz.novy` a `oznameni.nova` se počítají dvakrát.

---------------------------------------------------------------------

## 2. Cílová architektura

```
DOMÉNOVÁ UDÁLOST                (změna směny, nový vzkaz, nové oznámení, přidělený úkol …)
   │  volá ji producent (trigger / RPC) v transakci zdroje
   ▼
app.notifikovat(...)            ← JEDINÉ vstupní místo, security definer
   1. příjemce   aktivní člen firmy s účtem? (definer nemá RLS → filtruje sám)
   2. preference kategorie (vzkazy / nástěnka); urgentní se nepotlačuje
   3. priorita   low | normal | important | urgent
   4. slučování  dedupe_key (nepřečtené téže věci se nahradí, počet se sčítá,
                 priorita je vždy ta poslední — krok35 oddíl 5)
   5. záznam     notifications  ← vždy, i mimo směnu (je to záznam, ne rušení)
   6. kanál      app.zaradit_doruceni  → notifikace_doruceni (push …)
   │
   ▼
notifikace_doruceni             stav: ceka_na_smenu → k_odeslani → odeslano | selhalo | nedostupny
   │  odesílá worker (server, service_role) — NIKDY v transakci zdroje
   ▼
push / e-mail (provider interface)
```

### 2.1 Priority

| Priorita | V aplikaci | Externí kanál (push) | Poznámka |
|---|---|---|---|
| `low` | tichý záznam | nikdy | nepočítá se do odznaku |
| `normal` | záznam | jen na směně; mimo směnu čeká | |
| `important` | záznam, zvýrazněný | jako normal (čeká na směnu) | smí vyžadovat potvrzení |
| `urgent` | záznam | okamžitě, i mimo směnu | jen `communication.urgent`, potvrzení před odesláním, audit |

### 2.2 Pracovní doba

„Na směně“ = **otevřený příchod v docházce** (`app.smena_ted`), ne rozpis.
Tohle pravidlo má právní odůvodnění (§ 78 ZP, migrace 20260906010000) a
nedefinuje se podruhé. Rozpis směn se do doručování nezapojuje; změnit to
je rozhodnutí pro Šéfíka a zasáhlo by `moje_rozhovory`, `doruci_se` i kiosek.

* **Záznam v aplikaci vzniká vždy hned.** Kdo si mimo směnu sám otevře aplikaci,
  zprávy přečíst smí (`komunikace-zadani.md`); notifikace v seznamu není rušení.
* **Externí kanál** (push) mimo směnu čeká. Po příchodu na směnu worker
  `uvolnit_cekajici`: jedna čekající se pošle sama, více se sloučí do jednoho
  souhrnu „Čekají na vás N zpráv“ (počet se čte z `telo.pocet`).
* **Urgentní** obchází čekání. Odesílatel musí mít `communication.urgent`,
  v UI potvrdí, že upozorní i mimo směnu, a odeslání jde do `audit_log`
  (`komunikace.nalehava_zprava`, bez textu).
* Notifikaci změny směny **nevytváří UI Směn**; vzniká z události ve
  `ulozit_smenu` → `app.upozornit_smenu` → `app.notifikovat`. Text „ZMĚNA SMĚNY
  … Původně … Nově … Změnil: …“ skládá jen prezentační vrstva
  (`lib/upozorneni-text.ts`) z holých údajů v `telo`.

### 2.3 Co je schválně jinak, než by se čekalo

* **Realtime jen nad `notifications`.** Každá nová zpráva/oznámení/úkol už
  vyrábí notifikace příjemcům, takže jediná tabulka s jednoduchou politikou
  (`user_id = auth.uid()`) stačí jako „zvonek“, který řekne stránce, ať se
  osvěží. `konverzace_zpravy` se do publikace NEDÁVÁ: RLS přes definer funkci
  `app.je_ucastnik` by se vyhodnocovala pro každého odběratele u každé zprávy.
* **Odesílání push mimo transakci.** Selhání pošty nesmí shodit `ulozit_smenu`
  ani `poslat_zpravu`. Záznam se zapíše v transakci, odešle ho worker.
* **Push/e-mail jsou providery.** Bez klíčů (VAPID) zůstává stav `nedostupny`
  a UI to říká — nepředstírá se doručení.
* **AI návrh úkolu ze zprávy** je v této etapě **pravidlový** (lokální
  funkce bez modelu). CLAUDE.md pravidlo 8 a `komunikace-zadani.md` zakazují
  posílat obsah komunikace jazykovému modelu; napojení modelu je rozhodnutí
  Šéfíka a vyžaduje uzavřený vstupní typ (skill `foodtab-ai`). Návrh se vždy
  ukáže k úpravě a úkol vznikne až potvrzením.
* **Přepis hlasovek** je provider interface se stavem „nedostupný“. Claude API
  nemá zvukový vstup; potřebuje jiného dodavatele, klíč a DPA.

---------------------------------------------------------------------

## 3. Databázový plán (jen přírůstkový, nasazuje Šéfík)

Migrace jdou v pořadí a **nikdy se nepouštějí autonomně** (`db push` je vždy
ruční). Před nimi čekají tři migrace Směn (`20260920100000`, `…120000`, `…130000`).
Kód tolerantně čte starší schéma (vzory `sloupecNeexistuje`, `funkceNeexistuje`),
protože Vercel nasazuje z `main` hned a migrace až potom.

**A. `20260921100000_notifikacni_sluzba.sql`** — scénář `krok42`
* `notifications`: `priorita` rozšířena o `low`; nové sloupce `zdroj_typ`,
  `zdroj_id`, `dedupe_key`; **sloupcový grant** — `authenticated` smí měnit
  jen `read_at` a `acknowledged_at`.
* `app.notifikovat`, `app.zrusit_neprectene`, `app.zaradit_doruceni`,
  `app.uvolnit_cekajici` (+ `public.uvolnit_cekajici_notifikace` jen pro service_role).
* `push_odbery`, `notifikace_doruceni` (bez grantu pro anon/authenticated),
  `push_odber_ulozit` / `push_odber_zrusit` (jen vlastní zařízení).
* Producenti přepojeni **v téže migraci**: `upozornit_na_vzkaz_trg` (nově i členové
  kanálů pobočky a úseku), `upozornit_na_oznameni_trg`, `app.upozornit_smenu`
  (klíč = konkrétní směna, „Změnil“ v `telo`).

**B. `20260921110000_provozni_centrum.sql`** — scénář `krok43`
* `tasks`: `zprava_id`, `konverzace_id`, `zdroj`; trigger `tasks_vazba_zpravy`
  (vazba jen na rozhovor téže firmy, jehož je člověk účastníkem); trigger
  `upozornit_na_ukol` (druh `ukol.pridelen`).
* `konverzace_zpravy`: `typ` (`zprava`/`system`), `objekt_typ`/`objekt_id`,
  `klient_id` + unikátní index. `poslat_zpravu` má 7. parametr `p_klient_id`
  (starý podpis se DROPuje).
* `zalozit_ukol_ze_zpravy`, `komu_muzu_psat`, `lide_v_rozhovoru`,
  `jmena_osobnich_rozhovoru`; oprava `kdo_nepotvrdil` (kontrola práva).

**C. `20260921120000_realtime_upozorneni.sql`**
* Do publikace `supabase_realtime` se přidává jen `notifications` (tolerantně
  k prostředí bez publikace).

**D. `20260921130000_prilohy.sql`** — scénář `krok44` (volitelná; nic na ní nestojí)
* Kbelík `prilohy` (soukromý, 10 MB, jpeg/png/webp/pdf), tabulka
  `konverzace_prilohy` (RLS: čte účastník rozhovoru; **bez zápisového grantu**).
* Politiky úložiště: select a insert přes `app.je_ucastnik`, delete jen sirotka;
  žádná update (soubor pod odkazem, který už někdo má, se nesmí tiše změnit).
  Cestu `firma/rozhovor/soubor` rozebírá tentýž parser jako u hlasovek.
* `pripojit_prilohu` — jediná cesta, kudy příloha vznikne: jen autor zprávy,
  do 10 minut od odeslání, ne ke stornované zprávě, cesta patří tomuto
  rozhovoru i firmě, soubor v úložišti opravdu je, nejvýš 5 na zprávu.

**E. `20260922100000_checklist_ukol.sql`** — scénář `krok45`
* `tasks`: `checklist_run_id`, `checklist_item_id` (obojí nepovinné —
  problém se může týkat jedné položky, nebo celého běhu). `zdroj = 'checklist'`
  hodnotu už znala migrace B, jen se nepoužívala.
* Trigger `tasks_vazba_checklistu` — přímý zápis vazby nesmí připnout úkol
  k checklistu jiné pobočky nebo firmy; kontroluje se jen NOVĚ zapsaná vazba
  (cizí klíč `on delete set null` při smazání běhu/položky vazbu jen ruší).
* `zalozit_ukol_z_checklistu` — pobočka jde vždy z BĚHU, ne od volajícího
  (checklist na rozdíl od rozhovoru pobočku má vždy); deleguje na `zadat_ukol`
  (adresát, termín, právo `tasks.manage`) a zapíše vazbu.
* UI: tlačítko „Nahlásit problém“ na obrazovce checklistu (u položky i za
  celý běh) vede na formulář, ze kterého vznikne úkol — bez návrhu (checklist
  nemá text zprávy, ze kterého by šlo něco poznat). Detail úkolu ukazuje
  „Odkud úkol je“ i pro checklist, stejně jako pro zprávu.

Těla funkcí vycházejí ze **živé** databáze (`pg_get_functiondef`), ne z nejstarší
migrace — dvakrát už novější migrace přepsala objekt podle staršího stavu.

**Kompatibilita.** Tabulky `konverzace*`, `announcements`, `notifications`
se nepřejmenovávají ani nepřepisují. Adresy `/vzkazy`, `/vzkazy/[konverzace]`,
`?zalozka=nastenka` a přesměrování `/zpravy`, `/rozhovory` zůstávají.
`konverzace_zpravy.nalehava` je generovaný sloupec — nesahá se na něj.

---------------------------------------------------------------------

## 4. Oprávnění a soukromí

* RLS na každé nové tabulce; `revoke … truncate`, `revoke` od `anon` hned v migraci
  (test `scripts/provoz-granty.test.mjs`).
* Definer funkce nemají druhou linii: **tenant, členství, modul a právo si
  filtrují samy** (paměť „definer funkce nemá druhou linii“).
* `precteno_do` a obsah zpráv nevidí ani majitel; audit zpráv text neobsahuje
  a **nové sloupce s obsahem (přepis, text úkolu ze zprávy) se do auditu nedávají**.
* Notifikace nenese text zprávy ani jméno odesílatele — jen ID a údaje
  (`telo`). Push proto nikdy neprozradí obsah na zamčené obrazovce.
* Pravidlo 8: mzdy, docházka, kontakty, zálohy se nikdy neposílají modelu.

---------------------------------------------------------------------

## 5. UI

Podle přiloženého vizuálu (desktop tři sloupce, mobil obrazovky 1–8).

* **Provozní centrum** = záložky *Přehled · Komunikace · Úkoly · Checklisty ·
  Nástěnka* nad stávajícími trasami (`/dnes`, `/vzkazy`, `/ukoly`,
  `/vzkazy?zalozka=nastenka`); nic se nepřesouvá, jen se sjednotí navigace.
* **Desktop `/vzkazy/[konverzace]`:** seznam konverzací | vlákno | panel
  „O konverzaci“ (účastníci, sdílené soubory, rychlé akce, související úkoly,
  systémové události).
* **Zpráva → úkol:** akce u zprávy otevře formulář s pravidlovým návrhem
  (název, termín, komu); úkol vznikne až potvrzením, do konverzace přibude
  systémová událost a odkaz zpět na zprávu.
* **Mobil:** Dnes (přehled komunikace), seznam, chat s hlasovkou, zpráva → úkol,
  detail úkolu, checklist, nástěnka, výběr příjemců. Dolní lišta dostane odznak.
* Prezentační komponenty berou jen data přes props, takže se dají vykreslit
  i v dočasném náhledu (`app/nahled/`, nepatří do Gitu) pro snímky obrazovky.

---------------------------------------------------------------------

## 6. Testy

* Čisté funkce v `lib/` + `scripts/*.test.mjs` (`node --experimental-strip-types`).
* SQL scénáře `supabase/tests/krokN_scenar.sql` (další volné: 42), registrace
  v `run.sh` **i** v `.github/workflows/databaze.yml`. PGlite (`scripts/scenare-pglite.mjs`)
  RLS ani granty neověří — rozhoduje workflow „Databáze“ na PR (PostgreSQL 16).
* Každá kontrola se ověřuje **schválným rozbitím** (paměť „rozbít to dvěma
  způsoby“): přidat druhý insert do triggeru, vyhodit filtr tenanta, změnit
  podmínku pracovní doby — a zjistit, že scénář spadne.

---------------------------------------------------------------------

## 7. Co je záměrně mimo tuto etapu

Vyhledávání ve zprávách, doba uchování zpráv,
konfigurovatelné tiché hodiny, e-mailový kanál upozornění, model pro návrh
úkolu, přepis hlasu. (Přílohy — fotky, PDF — a checklist → úkol původně mezi
nimi byly a nyní jsou v migracích D a E.) Každé je v `NOCNI-REPORT-KOMUNIKACE.md` zařazeno do
HOTOVO / ČÁSTEČNĚ / PŘIPRAVENO / NEHOTOVO / EXTERNÍ ZÁVISLOST podle toho, co
v repozitáři opravdu je.

---------------------------------------------------------------------

## 8. Stav implementace (kde co je)

| Kus | Kde |
|---|---|
| Notification Service (SQL) | `20260921100000_notifikacni_sluzba.sql`, `supabase/tests/krok42_scenar.sql` |
| Provozní centrum (SQL) | `20260921110000_provozni_centrum.sql`, `krok43_scenar.sql` |
| Doménová logika | `lib/komunikace/*` (návrh úkolu, přepis, vlákno, příjemci, web push, text push), `lib/upozorneni-text.ts` |
| Testy logiky | `scripts/komunikace.test.mjs`, `scripts/upozorneni.test.mjs`, `scripts/web-push.test.mjs` |
| UI | `app/[rozsah]/vzkazy/**`, `app/[rozsah]/ukoly/ukol/[id]`, `app/[rozsah]/provozni-centrum/*`, `components/shell/ZivaAktualizace.tsx` |
| Přílohy (SQL) | `20260921130000_prilohy.sql`, `krok44_scenar.sql` |
| Přílohy (logika a UI) | `lib/komunikace/prilohy.ts`, `vzkazy/[konverzace]/{priloha-pridat.tsx,akce-prilohy.ts}`, zobrazení ve `vlakno-zprav.tsx` a v panelu |
| Checklist → úkol (SQL) | `20260922100000_checklist_ukol.sql`, `krok45_scenar.sql` |
| Checklist → úkol (UI) | `ukoly/[beh]/problem/{page.tsx,formular-problem.tsx}`, akce `zalozitUkolZChecklistu` v `ukoly/akce.ts`, „Nahlásit problém“ na `ukoly/[beh]/page.tsx`, „Odkud úkol je“ v `ukoly/ukol/[id]/detail-ukolu.tsx` |
| Push (odesílač, plánovač, service worker, zapnutí na zařízení) | `app/api/uloha/notifikace-push`, `.github/workflows/notifikace-push.yml`, `public/sw.js`, `upozorneni/nastaveni/push-prepinac.tsx` |

Podrobnosti, co je hotové a co ne, jsou v `NOCNI-REPORT-KOMUNIKACE.md`.
