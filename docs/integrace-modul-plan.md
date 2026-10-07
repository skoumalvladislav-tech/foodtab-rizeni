# Modul Integrace — architektura a stav (zadání 6.–7. 10. 2026)

Zdroj zadání: `C:\Users\vladi\Foodtab_Integrace_Claude_Code.md` (celý
text zkopírovaný beze zkratek do historie commitů téhle větve, první
commit s `docs/Foodtab_Integrace_Claude_Code.md` — TODO: zkopírovat
soubor do repozitáře při nejbližší příležitosti, zatím žije jen na
disku mimo repo).

Větev: `integrace-modul-centralni`, založená z `main` @ `63e166d` (PR
#106–#116, celý bankovní modul + jeho upřesnění). Worktree:
`C:\Users\vladi\foodtab-integrace`.

Tenhle dokument je živý kontrolní seznam (zadání, oddíl 1: „Průběžně
udržuj kontrolní seznam a stav rozpracované práce"). Aktualizuje se při
každé další práci na modulu, ne jen na začátku.

## Co zadání chce (shrnutí, ne náhrada originálu)

Centrální modul **Integrace** se 4 kategoriemi (pokladní systémy,
rezervace/objednávky, bankovní účty, e-mailové schránky), výměnné
adaptéry (`PosProvider`/`ReservationProvider`/`BankDataProvider`/
`MailProvider`), centrální směrování dat do cílových modulů (tabulka v
zadání, oddíl 4), trvalá fronta pro zpracování, bezpečnost/multi-tenancy
(oddíl 11), a čestné rozlišení ve výstupu mezi „produkčně ověřeno",
„sandboxově ověřeno", „připraveno bez přístupu" a „neimplementováno".

Banka: AIS pouze čtení (beze změny z dřívějšího zadání, jen upřesněno —
Finbricks MULTIBANK / Salt Edge Partners jako hlavní kandidáti, GoCardless
definitivně mimo, Fio a CSV import zůstávají jako alternativy).

## Rozhodnutí a práce 7. 10. 2026 (večer) — banka přes Salt Edge, e-mail přes IMAP

**Banka.** Enable Banking zůstalo zaseknuté u poskytovatele (manuální
aktivace, mimo appku) — appka proto prověřila alternativy. GoCardless
Bank Account Data je definitivně zavřený novým samoobslužným AIS
projektům. Finbricks i Salt Edge Partners **nejsou samoobslužné** —
obojí vyžaduje žádost o partnerský přístup/obchodní kontakt dřív, než
vůbec existuje sandbox. Tink je samoobslužný, ale pokrytí ČR bank je
nejisté. **Šéfík rozhodl (psaný pokyn 7.10.2026 večer): první bankovní
integrace jde přes Salt Edge Partner Program / Partners Account
Information API**, výslovně AIS-only (žádné platební příkazy), appka
nesmí sama podepsat placenou smlouvu ani odeslat obchodní poptávku.

Architektura je podle tohodle rozhodnutí postavená celá (seznam ČR
bank, wizard „Připojit banku", výběr účtu, stránkovaná synchronizace
pohybů, obnova zůstatků, odvolání souhlasu, podepsaný webhook jako
jediný zdroj pravdy o stavu připojení) — **ale nic z toho appka
nemohla ověřit proti živému prostředí ani sandboxu**, protože Salt
Edge vyžaduje partnerskou pozvánku, kterou appka sama nesmí vyžádat.
Detaily, otestovaný podpis webhooku a přesný seznam, co chybí pro
první reálné připojení → `docs/hlaseni/stav-2026-10-07.md`.

**E-mail.** IMAP konektor (ověření připojení + uložení zašifrovaných
přihlašovacích údajů, bez čtení zpráv) je hotový a funkční — řeší
dřívější „zatím nemohu připojit e-maily přes IMAP". Nemění nic na
otevřené otázce P2 níž (vlastní příjem vs. n8n pipeline) — konektor
jen ověřuje a ukládá schránku, nezačal nic číst.

## Audit existujícího stavu (provedeno 7. 10. 2026, 4 paralelní agenti)

### Banka — nejzralejší, ale se 4 konkrétními mezerami

- Fio: funkční, nikdy neověřeno proti živému účtu (Fio nemá sandbox).
- Enable Banking: kostra blíž produkci, ale neaktivovaná u poskytovatele
  (čeká na manuální krok u Enable Banking, mimo appku) + bere automaticky
  první vrácený účet bez výběru v UI + neukládá `providerAccountId`.
- GoCardless: definitivně vyřazený, jen matoucí zastaralý komentář
  (OPRAVENO 7.10. v `lib/integrace-fio.ts`).
- `BankDataProvider` kontrakt: odpovídá mu jen Enable Banking, Fio svoje
  funkce nezabaluje do kontraktu — volá se přímo jménem. **Nedotčeno,
  zbývá.**
- `poskytovatel` zneužitý jako unikátní klíč s náhodnou příponou
  (OPRAVENO 7.10. — živá jedinečnost teď na `platebni_ucet_id`, ne na
  textu poskytovatele).
- Přeplatky aktivně odmítané (OPRAVENO 7.10. — appka je teď ukládá a
  nahlásí `prebytek_haleru`, rozhodnutí co s penězi dál je na člověku).
- Hromadné platby (1 platba→N faktur) hotové v DB, **chybí UI** —
  `potvrditParovani` přijme jen jednu `faktura_id` na volání. **Zbývá.**
- Zrušení alokace nevracelo stav faktury ve Fakturách (OPRAVENO 7.10. —
  `zrusitAlokaci` teď best-effort přepočítá a zapíše správný stav).
- Interval synchronizace je globální (4 h cron pro VŠECHNA připojení),
  žádná konfigurace per připojení/banku. **Zbývá.**
- `souhlas_platny_do` se nikde nečte/nehlásí (žádné proaktivní
  upozornění na blížící se/odvolaný souhlas). **Zbývá.**
- Právní subjekt ≠ tenant (appka dnes `tenant_id` POUŽÍVÁ jako právní
  subjekt 1:1) — víc právních subjektů pod jedním tenantem je
  samostatná, nezačatá práce. **Vědomě mimo rozsah tohoto průchodu.**

### integrace.manage odděleno od finance.manage (OPRAVENO 7.10.2026)

Nová migrace `20261007110000_integrace_opravneni_a_sjednoceni.sql`:

- nové právo `integrace.manage` (`module_key='finance'`, aby nevyžadovalo
  nový modul a aktivaci per firma);
- zpětně dosazené všem, kdo měli `finance.manage` (funkce
  `app.integrace_manage_zpetne_dosadit()`, idempotentní, otestovaná
  schválným rozbitím v `krok89_scenar.sql`);
- `integrace_pripojeni` write policy + `integrace_uloz_tajemstvi`/
  `_precti_tajemstvi`/`_smaz_tajemstvi` teď kontrolují `integrace.manage`,
  ne `finance.manage`;
- `finance/integrace/akce.ts` + `.../banka/akce.ts` (4 akce) + obě
  `page.tsx` (`smiPsat`) přepnuté na nové právo;
- `finance/platby/prodeje/*` (CSV import tržeb) VĖDOMĖ beze změny —
  je to zápis finančních dat, ne správa napojení/tajemství.

### POS/Dotykačka — částečný zdroj existuje, žádný živý adaptér

- `public.pokladna_prodeje_denni` + `importovat_pokladna_prodeje` RPC
  existují a krmí `foodcost_beverage_prehled` — **jen přes CSV import**
  (`app/[rozsah]/finance/integrace/prodeje/**`).
- `zdroj='dotykacka_api'` je povolená hodnota v CHECK, nic ji neplní.
- Žádný `PosProvider` TS kontrakt neexistuje.
- Oficiální dokumentace (ověřeno WebFetch 7.10.2026):
  `docs.api.dotypos.com` — API v2, entity Order/OrderItem/DeliveryNote
  (prodeje), Product/Category/DailyMenu, Branch/Warehouse, Customer,
  webhook, stránkování/filtrování/sort. Partnerská licence (test/dev
  prostředí) se žádá přes formulář u Dotykačky — appka ji nemá, autentizační
  model (API klíč vs. OAuth) není z veřejné navigace jistý, musí se
  ověřit AŽ s partnerskou licencí v ruce. **Nevymýšlet endpointy —
  `PosProvider` se postaví kontraktově (kapability), konkrétní HTTP
  klient až po registraci.**
- Mantinel z dřívějšího rozhodnutí (2.10.2026, platí dál): **fyzický
  sklad/inventury se nestaví.** POS adaptér dodá tržby/prodané položky,
  ne skladové pohyby.

### Rezervace/CRM — nic neexistuje, musí se stavět od nuly

- Žádná tabulka/obrazovka rezervací hostů.
- **Upřesnění 7.10.2026: appka se NEVÁŽE na jednoho poskytovatele**
  (Choice/Choice QR byl jen jeden z kandidátů v původním zadání, ne
  rozhodnutí) — každý klient může mít jiného poskytovatele rezervací/
  objednávek. `ReservationProvider` kontrakt je proto obecný (lifecycle
  rezervace: vznik/změna/zrušení/stav/počet hostů/provozovna) od
  začátku, ne odvozený z jednoho konkrétního produktu. Konkrétní adaptér
  vzniká, až konkrétní klient přinese konkrétního poskytovatele
  s dostupnou dokumentací.
- `public.kontakty`/`kontakty_osoby` existují, ale jsou čistě B2B
  (dodavatel/odběratel/partner, firemní úroveň bez `branch_id`, žádné
  pole souhlasu) — **nepoužitelné pro hosty bez rozšíření.**
- Marketingový GDPR vzor (`consent_kinds`/`consents`,
  `20260901120000_osobni_udaje.sql`) je nejblíž použitelný vzor pro
  „marketingové oprávnění evidovat samostatně včetně původu" (zadání
  §6) — váže se ale na `profiles.user_id` (zaměstnanec), ne na externí
  kontakt/hosta. Nová CRM vrstva potřebuje analogický katalog s polem
  původu, napojený na hosty/kontakty, ne na zaměstnance.

### E-mail/OCR faktur — existuje, ale MIMO appku a mimo tuhle databázi

- OCR čtení e-mailových faktur dnes běží v **n8n, mimo repozitář**, a
  zapisuje do **odděleného Supabase projektu** (`ctqtwahlzhyjerqulqyn`,
  databáze Faktur) — appka je jen tenká čtecí/schvalovací vrstva
  (`lib/supabase/faktury.ts`, anon klíč, žádný service role).
- Dnešní uložené pole: jen `amount` (celková částka), žádné položky
  dokladu, žádné rozlišení faktura/zálohová faktura/dobropis/dodací
  list/upomínka (zadání §8 to explicitně chce).
- **Upřesnění 7.10.2026: appka napojuje e-mail PŘES NASTAVENÍ SERVERU
  (IMAP — host/port/TLS/jméno/heslo zadané klientem), ne primárně přes
  OAuth app registraci appky.** To zásadně snižuje vnější blokátor —
  appka nepotřebuje schválení u Microsoftu/Googlu k tomu, aby klient
  mohl napojit IMAP schránku svým vlastním (přednostně aplikačním)
  heslem, zašifrovaným stejně jako Fio token. `oauth_graph`/`oauth_gmail`
  zůstávají v `MailProvider` kontraktu pro klienty, které IMAP+heslo
  nepodporují (Graph/Gmail postupně vypínají prostý IMAP), ale appka
  k nim nemá vlastní OAuth registraci — ty se nestaví, dokud nebude
  konkrétní klient, který je potřebuje.
- Vzor uploadu příloh (`lib/komunikace/prilohy.ts` +
  `20260921130000_prilohy.sql`) je čistý, znovupoužitelný předpis pro
  ukládání e-mailových příloh do Storage appky, KDYBY appka převzala
  příjem e-mailu sama (místo n8n) — rozhodnutí o tomhle architektonickém
  posunu (appka vlastní IMAP napojení vs. zůstat na n8n pipeline a jen
  rozšířit, co appka z Faktur-DB čte) **čeká na Šéfíka**, je to příliš
  velký zásah, aby se udělal jednostranně — viz „Otázky pro Šéfíka" níž.

### Bezpečnost/provoz — vzory, žádná nová obecná abstrakce

- `pg_cron` zakázaný; plánování jde přes GitHub Actions →
  `/api/uloha/*` → `service_role`-only RPC. Žádný obecný queue
  framework — dva ad-hoc `*_fronta` vzory s claim-and-release
  (`notifikace_doruceni`, `marketing_fronta`). Nová integrační vrstva
  (příjem webhooků z n8n/budoucích poskytovatelů) bude potřebovat
  VLASTNÍ `integrace_fronta` ve stejném vzoru — **zbývá postavit.**
- Grant/RLS pravidla (revoke→grant, sloupcové granty, truncate) jsou
  dobře zdokumentovaná v `CLAUDE.md` a není potřeba je znovu objevovat.

## Co je HOTOVO k 7. 10. 2026 (commit `e02eda0` + migrace výš, neověřeno proti živému Postgresu)

1. Fio datum o den dřív (pražská vs. UTC půlnoc) — opraveno, testováno,
   schválně rozbito a obnoveno (`lib/integrace-fio.ts`).
2. Měna se nikdy nezapisovala do `transakce` (Fio/CSV/Enable Banking) —
   opraveno přes celé `RadekImportu`, RPC `importovat_transakce`
   přepsané na plpgsql (`20261007100000_importovat_transakce_mena.sql`).
3. CSV import byl od začátku rozbitý (camelCase/snake_case mismatch v
   RPC volání) — opraveno (`app/[rozsah]/finance/platby/import/akce.ts`).
4. `integrace.manage` oddělené od `finance.manage` (nová migrace,
   backfill, 6 upravených souborů aplikace, `krok89_scenar.sql`).
5. `poskytovatel` uniqueness bug opraven (cíl = `platebni_ucet_id`, ne
   text poskytovatele) — `krok73_scenar.sql` přepsaný na nové chování.
6. Přeplatky appka nově podporuje (`prebytek_haleru` v návratu RPC,
   UI banner na `/finance/platby`) — `krok74_scenar.sql` přepsaný.
7. Zrušení alokace platby teď přepočítá a zapíše stav faktury ve
   Fakturách (dřív zůstávalo „Uhrazeno" i po zrušení jediné platby).
8. Zastaralý/matoucí komentář o `integrace-gocardless.ts` (nikdy
   nevzniklo) opraven v `lib/integrace-fio.ts`.
9. Rezervace/pokladna reframovány obecně (žádný konkrétní poskytovatel
   jmenovaný natvrdo), `MailProvider` reframováno na IMAP jako primární
   cestu — hlavičky kontraktů + UI text (viz oddíl výš).
10. IMAP e-mailový konektor (`lib/integrace-mail-imap.ts`, akce+UI pod
    `/finance/integrace/email`) — živé ověření připojení (TLS/STARTTLS,
    přihlášení, výpis složek, odhlášení), uložení zašifrovaných
    přihlašovacích údajů. Čtení zpráv NEIMPLEMENTOVÁNO (čeká na P2
    rozhodnutí níž).
11. Salt Edge adaptér podle rozhodnutí výš — `lib/integrace-saltedge.ts`
    (seznam ČR bank, zahájení připojení přes Connect Widget, stránkovaná
    `nactiTransakceSaltEdge`, odvolání souhlasu, ověření podpisu webhooku
    RSA-SHA256), `lib/integrace-saltedge-sync.ts` (sync job po vzoru
    Fio), `app/api/integrace/saltedge/webhook` (podepsaný, autoritativní
    stav připojení) + `/vratit` (lehký, neautoritativní návrat z banky),
    UI wizard a výběr účtu v `.../banka/{akce.ts,page.tsx}`, napojeno do
    cron úlohy `banka-synchronizace`. **Postaveno, ne ověřeno** — žádný
    přístup k partnerskému API dnes appka nemá (viz oddíl výš).

**Ověřeno jen přes PGlite dosud** — žádný `db push` neproběhl, nic
z tohodle nebylo potvrzeno proti reálnému Postgresu. Commit `2e43e2b`
(větev `integrace-modul-centralni`). Ověřovací běh: PGlite celá sada
**3258 kontrol, 0 spadlých** (vč. nového `krok89_scenar.sql` a
upravených `krok3`/`krok73`/`krok74`), `tsc --noEmit` čisté, `eslint`
čisté na všech dotčených souborech, `scripts/provoz-granty.test.mjs`
čisté. Cestou se chytily a opravily dvě vlastní chyby: `integrace.manage`
chybělo v `lib/authz.ts` i v hardcoded seznamu `krok3_scenar.sql` (DB
katalog se jim rozešel, spadlo 30 scénářů kaskádou), a `krok89`
mazání `auth.users`/`profiles` v úklidu narazilo na PGlite referenční
kvirk — opraveno tak, že se (stejně jako `krok30`/`krok73`) tyhle
jednorázové testovací identity v úklidu nemažou.

**Body 9–11 (IMAP, Salt Edge) nemění žádnou migraci** — žádné nové
`krokN_scenar.sql`, PGlite počet výš se jich netýká. Vlastní ověření:
`node --experimental-strip-types --conditions=react-server
scripts/integrace-saltedge.test.mjs` (6 kontrol — platný podpis +
5 schválných rozbití podpisu webhooku, všechny OK), `tsc --noEmit`
a `eslint` čisté na celé nové dávce souborů (Salt Edge i IMAP). Nic
nebylo spuštěno proti živému Salt Edge API ani proti reálné IMAP
schránce — appka na to dnes nemá přístupy (banka) nebo klienta
(e-mail), kteří by appku ověřili v souvislosti s reálnými daty.

## Co zbývá (prioritizovaný seznam, ne nutně v tomhle pořadí)

### P0 — architektura, bez cizích přístupů

- [x] `PosProvider`, `ReservationProvider`, `MailProvider` TS kontrakty
      (commit `2e43e2b`) — kapacitní, bez vymyšlených endpointů.
- [x] `BankDataProvider`: zabalit Fio do kontraktu (commit `9c442c4`) —
      čistě aditivní (`fioProvider` export), existující volající se
      nepřepisovaly.
- [x] Čtyři kategorie na stránce Integrace, 4 kategorie zadání vidět
      (commit `2e43e2b`) — nová samostatná navigační položka/layout se
      NESTAVĚLA, protože `/finance/integrace` už existuje a je v
      `nabidka.ts` — druhý vstupní bod by byl zmatek navíc, ne
      zjednodušení.
- [x] UI pro rozdělení jedné platby na víc faktur (commit `e766d0e`) —
      „Ruční párování" + oprava `jizSparovane`, co dřív vyřazovalo
      částečně spárovanou transakci z návrhů navždy.
- [x] `interval_synchronizace_minut` na `integrace_pripojeni` + UI +
      úprava sync joblogiky (commit `cf99a57`).
- [ ] ~~Surfacing `souhlas_platny_do` v UI~~ — ODLOŽENO, ne zapomenuto:
      žádný dnešní adaptér (Fio, Enable Banking, ani nový Salt Edge)
      tohle pole ve skutečnosti NEPLNÍ (Fio token nemá zjistitelnou
      expiraci přes API, Enable Banking se nikdy neověřilo proti živé
      bance, Salt Edge consent expiraci v dokumentaci Partners API
      nevrací jako pole appka by mohla zapsat bez ověření proti živému
      účtu), takže UI by dnes ukazovalo jen „neznámé" všude — nic by
      appka tím nezlepšila, jen přidala prázdný řádek na obrazovku.
      Čeká na skutečného poskytovatele s konkrétní hodnotou k zobrazení.
- [ ] ~~`integrace_fronta` tabulka~~ — ODLOŽENO: žádný dnešní kód by ji
      nečetl ani nezapisoval (nic nepřijímá webhooky, e-mailová
      architektura není rozhodnutá) — postavit frontu bez volajícího
      je přesně ta spekulativní infrastruktura, které se appka
      vyhýbá. Staví se, až bude mít co doručovat.

### Upřesnění 7.10.2026 (Šéfík) — mění prioritu níže

- **Rezervace**: appka se neváže na jednoho poskytovatele (Choice byl
  jen kandidát, ne rozhodnutí) — každý klient může přinést jiného.
  Žádné „čeká na přístup k X" už tu nedává smysl, dokud nepřijde
  konkrétní klient s konkrétním poskytovatelem.
- **E-mail**: napojení přes NASTAVENÍ SERVERU (IMAP — host/port/TLS/
  jméno/heslo klienta), ne primárně přes OAuth app appky. Tím padá
  největší vnější blokátor (schválení u Microsoftu/Googlu) — IMAP
  konektor je teď P0/P1 práce (appka ho může postavit), ne čekání na
  externí registraci. Otevřená architektonická otázka (vlastní příjem
  vs. n8n) ale ZŮSTÁVÁ, viz P2 níž — IMAP konektor by k ní měl
  směřovat, ne ji obejít tichým druhým příjmem.
- **Pokladna**: potvrzeno — přes API nebo jinak podle možností
  konkrétního poskytovatele, žádná změna (kontrakt už byl obecný).
- **Banka**: potřebovala se „rozchodit" — produkční blokátor byl
  chybějící `INTEGRACE_KLIC_SIFRY` ve Vercelu (OPRAVENO, nastaveno a
  nasazeno 7.10.2026 se svolením, redeploy proveden a ověřen). Druhý
  blokátor (Enable Banking zaseknuté u poskytovatele) vyřešen
  rozhodnutím výměnit primárního poskytovatele za Salt Edge — viz
  oddíl „Rozhodnutí a práce 7.10.2026 (večer)" nahoře.

### P1 — vyžaduje externí registraci/přístup, appka zatím nemá

- [ ] Dotykačka: partnerská/test licence (appka nesmí sama žádat o
      obchodní podmínky — konkrétní otázky pro Šéfíka níž).
- [ ] **Salt Edge Partners**: ROZHODNUTO 7.10.2026 (Šéfík) jako první
      bankovní integrace — architektura hotová (viz „Co je HOTOVO",
      body 9–11), ale appka nemá partnerskou pozvánku a nesmí si ji
      sama vyžádat ani podepsat placenou smlouvu. Přesný seznam, co
      chybí pro první reálné připojení → `docs/hlaseni/stav-2026-10-07.md`.
- [ ] Enable Banking: DEMOVÁNO na druhou volbu (přehodnocuje se,
      nevyřazeno úplně) — appka k němu nepokročí, dokud nebude Salt
      Edge vyzkoušený. Aktivace u poskytovatele (appka to nemůže udělat
      sama, čeká na krok mimo appku).
- [ ] Microsoft Graph / Gmail API — jen pro klienty, kteří nemůžou
      použít IMAP+heslo (viz P2, IMAP je teď primární cesta).

### P2 — architektonické rozhodnutí čeká na Šéfíka

- [ ] E-mail/OCR faktur: appka postaví VLASTNÍ příjem (IMAP + Storage
      dle vzoru `prilohy.ts`), nebo zůstává na n8n pipeline a jen se
      rozšíří, co appka z Faktur-DB čte/zobrazuje (rozlišení typů
      dokladu, dedup podle hashe přílohy)? Tohle je velké rozhodnutí —
      n8n pipeline dnes FUNGUJE a appka ji nesmí duplikovat bezhlavě.
      IMAP konektor (host/port/TLS/přihlašovací údaje) je teď technicky
      bez externí registrace, ale POČKÁ na tohle rozhodnutí, ať appka
      nepostaví konkurenční pipeline bokem.
- [ ] Víc právních subjektů pod jedním tenantem (dnes `tenant_id` ==
      právní subjekt 1:1) — potřebné, než bude „právní subjekt" ve
      formuláři Připojit banku znamenat něco jiného než firmu samu.

## Otázky pro Šéfíka (do `docs/hlaseni/otazky.md` při psaní hlášení)

1. E-mail/OCR architektura — vlastní příjem (IMAP) vs. rozšíření n8n
   pipeline (P2 výš). IMAP teď nečeká na externí registraci, ale čeká
   na tohle rozhodnutí.
2. Dotykačka partnerská licence — appka nesmí sama vyplnit formulář s
   obchodními podmínkami, potřebuje konkrétní zadání/rozhodnutí, kdo to
   udělá.
3. Salt Edge partnerská pozvánka — appka nesmí sama žádat o partnerský
   přístup/podepsat smlouvu. Potřebné údaje, jakmile pozvánka existuje
   → `docs/hlaseni/stav-2026-10-07.md` (přesný seznam).

## Critical files

- `lib/bank-provider-contract.ts` — vzor kontraktu pro nové providery.
- `lib/integrace-saltedge.ts` + `lib/integrace-saltedge-sync.ts` +
  `app/api/integrace/saltedge/{webhook,vratit}/route.ts` — celá Salt
  Edge architektura, dokumentační mezery rozepsané přímo v komentářích.
- `lib/integrace-mail-imap.ts` + `app/[rozsah]/finance/integrace/email/**`
  — IMAP konektor (ověření + uložení, bez čtení zpráv).
- `supabase/migrations/20261003100000_integrace_registr.sql` +
  `20261004100000_banka_napojeni.sql` + `20261007110000_integrace_opravneni_a_sjednoceni.sql`
  — celý registr připojení/tajemství + dnešní opravy.
- `app/[rozsah]/finance/integrace/**` — dnešní UI, cíl pro novou
  navigaci, ne náhrada.
- `supabase/migrations/20261003240000_pokladna_prodeje.sql` +
  `20261004200000_foodcost_beverage.sql` — existující POS datový tok.
- `lib/supabase/faktury.ts` + `lib/faktury-types.ts` — oddělená DB
  Faktur, status konstanty (`STAV_UHRAZENO` atd.).
- `supabase/migrations/20260901120000_osobni_udaje.sql` — GDPR consent
  vzor k napodobení pro hosty/CRM.
- `supabase/migrations/20260910040000_marketing_fronta.sql` — vzor
  claim-and-release fronty.
