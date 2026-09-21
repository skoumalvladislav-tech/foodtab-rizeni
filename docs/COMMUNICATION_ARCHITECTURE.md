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
3. **Nový vzkaz přepíše naléhavý.** Slučování „nepřečtené téhož dne“ maže
   i nepřečtenou *urgentní* notifikaci a nahradí ji normální.
4. **Celotabulkový `UPDATE` na `notifications`.** Přihlášený si smí přepsat
   `telo`, `druh`, `priorita` i `acknowledged_at` svých řádků; potvrzení je tedy
   nedůvěryhodné a nový sloupec by si mohl přepsat také.
5. **`kdo_nepotvrdil` je definer bez kontroly práva** (hlídá to jen UI).
6. **`zalozit_rozhovor`** u osobních a mezipobočkových rozhovorů kontroluje jen
   shodu firmy — kdokoli s modulem Provoz může přidat libovolného zaměstnance.
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
                 vyšší priorita se nikdy nesníží)
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
ruční). Kód tolerantně čte starší schéma (vzory `sloupecNeexistuje`,
`funkceNeexistuje`), protože Vercel nasazuje z `main` hned a migrace až potom.

**A. `20260921100000_notifikacni_sluzba.sql`**
* `notifications`: `priorita` rozšířena o `low`; nové sloupce `zdroj_typ`,
  `zdroj_id`, `dedupe_key`; **sloupcový grant** — `authenticated` smí měnit
  jen `read_at` a `acknowledged_at`.
* `app.notifikovat` (definer, `revoke` od všech mimo definery) + `app.zaradit_doruceni`
  + `app.uvolnit_cekajici` (jen service_role).
* `push_odbery`, `notifikace_doruceni` (bez grantu pro anon/authenticated).
* Producenti přepojeni **v téže migraci** (nikdy „starý insert + nová služba“):
  `upozornit_na_vzkaz_trg` (nově i členové kanálů pobočky a úseku),
  `upozornit_na_oznameni_trg`, `app.upozornit_smenu` (klíč = konkrétní směna).
* Těla funkcí vycházejí ze **živé** databáze (`pg_get_functiondef`), ne
  z nejstarší migrace — dvakrát už novější migrace přepsala objekt podle
  staršího stavu.

**B. `20260921110000_provozni_centrum.sql`** (viz oddíl 5)
* `tasks`: `zprava_id`, `konverzace_id`, `zdroj`, `updated_at`, priorita `low`…`urgent`.
* Typ zprávy (`system`) a odkaz na objekt pro události v konverzaci.
* RPC: `zalozit_ukol_ze_zpravy`, `komu_muzu_psat`, zpřísněné `zalozit_rozhovor`,
  oprava `kdo_nepotvrdil`.
* Idempotence odesílání: `konverzace_zpravy.klient_id` + unikátní index,
  parametr `poslat_zpravu(…, p_klient_id)` (starý podpis se DROPuje).

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

Přílohy (fotky, dokumenty), vyhledávání ve zprávách, doba uchování zpráv,
konfigurovatelné tiché hodiny, e-mailový kanál upozornění, model pro návrh
úkolu, přepis hlasu. Každé je v `NOCNI-REPORT-KOMUNIKACE.md` zařazeno do
HOTOVO / ČÁSTEČNĚ / PŘIPRAVENO / NEHOTOVO / EXTERNÍ ZÁVISLOST podle toho, co
v repozitáři opravdu je.
