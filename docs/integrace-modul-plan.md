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
- `Choice`/`Choice QR` nikde v kódu — jen v CLAUDE.md a novém zadání.
  Veřejné API dokumenty nedostupné (stránka `choiceqr.com` vrátila 403 na
  pokus o přečtení — partnerský přístup vyžaduje přímý kontakt, který
  appka sama nesmí navazovat, zadání §1: „neposílej obchodní poptávky").
  **`ReservationProvider` kontrakt proto musí zůstat obecný (lifecycle
  rezervace: vznik/změna/zrušení/stav/počet hostů/provozovna), ne
  Choice-specifický, dokud nejsou k dispozici reálné dokumenty.**
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
- Appka NEMÁ Microsoft Graph/Gmail OAuth registraci ani IMAP schránku
  vlastní — to je skutečná externí registrace/schválení (Microsoft/
  Google vyžadují ověření aplikace), ne jen chybějící kód.
- Vzor uploadu příloh (`lib/komunikace/prilohy.ts` +
  `20260921130000_prilohy.sql`) je čistý, znovupoužitelný předpis pro
  ukládání e-mailových příloh do Storage appky, KDYBY appka převzala
  příjem e-mailu sama (místo n8n) — rozhodnutí o tomhle architektonickém
  posunu (appka vlastní IMAP/Graph/Gmail napojení vs. zůstat na n8n
  pipeline a jen rozšířit, co appka z Faktur-DB čte) **čeká na Šéfíka**,
  je to příliš velký zásah, aby se udělal jednostranně — viz „Otázky
  pro Šéfíka" níž.

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

**Ověřeno jen přes PGlite dosud** (viz níž, „Zbývá ověřit") — žádný
`db push` neproběhl, nic z tohodle nebylo potvrzeno proti reálnému
Postgresu.

## Co zbývá (prioritizovaný seznam, ne nutně v tomhle pořadí)

### P0 — architektura, bez cizích přístupů

- [ ] `PosProvider`, `ReservationProvider`, `MailProvider` TS kontrakty
      (mirror `lib/bank-provider-contract.ts`), kapability podle
      skutečně zjištěných entit (Dotypos) / obecného modelu (Choice,
      mail).
- [ ] `BankDataProvider`: zabalit Fio do kontraktu (dnes volané přímo
      jménem) — ověřit, že párování/UI nemusí znát rozdíl mezi
      providery.
- [ ] Centrální navigační položka „Integrace" (4 kategorie) —
      `lib/integrace-navigace.ts` + `app/[rozsah]/integrace/layout.tsx`
      podle vzoru `lib/marketing-navigace.ts`/`lib/faktury-navigace.ts`.
      Rozhodnutí: nechat dnešní `/finance/integrace/**` jako cílovou
      cestu pro kategorii Banka/Pokladna (nerozbíjet existující odkazy),
      nová položka jen sjednotí vstup a přidá placeholder pro
      Rezervace/E-mail (zadání: budoucí kategorie nezobrazovat jako
      funkční).
- [ ] `integrace_fronta` tabulka (claim-and-release, vzor
      `marketing_fronta`) pro budoucí webhook/e-mail příjem.
- [ ] UI pro rozdělení jedné platby na víc faktur (hromadné platby) —
      DB už to umí (žádná změna schématu), jen formulář/akce.
- [ ] `interval_synchronizace_minut` na `integrace_pripojeni` + UI +
      úprava cron úlohy, aby respektovala per-připojení interval místo
      globálních 4 h.
- [ ] Surfacing `souhlas_platny_do` v UI (countdown/upozornění na
      blížící se vypršení).

### P1 — vyžaduje externí registraci/přístup, appka zatím nemá

- [ ] Dotykačka: partnerská/test licence (appka nesmí sama žádat o
      obchodní podmínky — konkrétní otázky pro Šéfíka níž).
- [ ] Choice/Choice QR: žádná veřejná dokumentace, nutný přímý kontakt.
- [ ] Microsoft Graph / Gmail API: OAuth app registrace + schválení.
- [ ] Finbricks MULTIBANK / Salt Edge Partners: obchodní rozhodnutí,
      viz dřívější `docs/hlaseni/banka-poskytovatele-2026-10-04.md`.
- [ ] Enable Banking: aktivace u poskytovatele (appka to nemůže udělat
      sama, čeká na krok mimo appku).

### P2 — architektonické rozhodnutí čeká na Šéfíka

- [ ] E-mail/OCR faktur: appka postaví VLASTNÍ příjem (IMAP/Graph/Gmail
      + Storage dle vzoru `prilohy.ts`), nebo zůstává na n8n pipeline a
      jen se rozšíří, co appka z Faktur-DB čte/zobrazuje (rozlišení
      typů dokladu, dedup podle hashe přílohy)? Tohle je velké
      rozhodnutí — n8n pipeline dnes FUNGUJE a appka ji nesmí
      duplikovat bezhlavě.
- [ ] Víc právních subjektů pod jedním tenantem (dnes `tenant_id` ==
      právní subjekt 1:1) — potřebné, než bude „právní subjekt" ve
      formuláři Připojit banku znamenat něco jiného než firmu samu.

## Otázky pro Šéfíka (do `docs/hlaseni/otazky.md` při psaní hlášení)

1. E-mail/OCR architektura — vlastní příjem vs. rozšíření n8n pipeline
   (P2 výš).
2. Dotykačka partnerská licence — appka nesmí sama vyplnit formulář s
   obchodními podmínkami, potřebuje konkrétní zadání/rozhodnutí, kdo to
   udělá.
3. Choice/Choice QR — bez jakékoli veřejné dokumentace nejde nic víc
   než obecný kontrakt; potvrzení, že tahle kategorie zůstává
   „připraveno bez přístupu" dlouho, je v pořádku.

## Critical files

- `lib/bank-provider-contract.ts` — vzor kontraktu pro nové providery.
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
