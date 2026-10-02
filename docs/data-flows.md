# Společný datový model a tok událostí — stav k 2. 10. 2026

Povinný výstup nočního zadání (oddíl 4 a 14). Mapuje, které vazby ze
zadání ("firma → provozovna → středisko; kontakty...; faktury...; platební
účty...; receptury...; sklady...; inventury...; směny...; kampaně...")
dnes OPRAVDU existují, a jaký je dnešní "katalog událostí" ve smyslu
zadání. Čti spolu s `docs/finance-marketing-audit.md` (plné zjištění po
oblastech) — tenhle dokument je jen průřez napříč moduly.

## Vazby — co existuje

| Vazba ze zadání | Existuje? | Kde |
|---|---|---|
| firma → provozovna → středisko | Firma→provozovna ano. **Středisko ne** — nejblíž je `branches`, žádná třetí úroveň pod pobočkou. | `tenants`, `branches` |
| kontakty a dodavatelé | **Ne jako jednotný CRM.** Dodavatel existuje jen jako volný text (`invoices.supplier`) ve Fakturách. | — |
| faktury a položky | Ano, ale bez položkového rozpadu (`invoices` je řádek dokladu, ne hlava+položky) a v oddělené DB (viz `docs/tenant-isolation.md`). | Faktury DB |
| platební účty a transakce | **Ne.** `invoices.status` je textový štítek, žádná tabulka transakcí/plateb ani přiřazení platby k faktuře. | — |
| produkty pokladny | **Ne.** Žádný POS adaptér (Dotykačka) ani tabulka prodejů. | — |
| suroviny a nákupní balení | **Založeno 2. 10. 2026** (tahle dávka práce, běží na pozadí) — `public.ingredients`, `public.ingredient_purchase_prices`. | nová migrace `20261002100000_sklad_suroviny_zaklad.sql` |
| receptury a verze | Receptury ano (`recipes`/`recipe_ingredients`), **verze ne** — jen `active` příznak, žádné historické verzování obsahu. | `supabase/migrations/20260823130000_provoz.sql` |
| sklady a pohyby | **Ne — a nebude.** ROZHODNUTÍ ŠÉFÍKA (2. 10. 2026): sklad a fyzické inventury dělá pokladní systém (Dotykačka), Foodtab si je nemá duplikovat. Skutečná spotřeba půjde přes budoucí Dotykačka adaptér, ne přes vlastní tabulky. | uzavřeno |
| inventury | **Ne — a nebude** (totéž rozhodnutí). | uzavřeno |
| směny a skutečná docházka | Ano, dobře rozpracováno — `shifts` (plán) vs. `attendance_events` (skutečnost), historické sazby. | `20260823130000_provoz.sql`, `20260831010000_mzdy_sazby.sql` |
| rozpočty | **Ne.** Žádná tabulka rozpočtů/forecastu nikde v repozitáři. | — |
| kampaně, příspěvky, kanály, výsledky | Ano, marketing modul je nejrozpracovanější oblast — kalendář, schvalování, fronta publikací, UTM/odkazy. | `supabase/migrations/20260909*`, `lib/marketing-*.ts` |

**Shrnutí**: provozní vrstva (lidé, směny, docházka, komunikace, checklisty)
a marketingová vrstva jsou hluboko rozpracované a dobře otestované. Finanční/
skladová vrstva (gastro ERP ve smyslu zadání) byla k 1. 10. 2026 prakticky
nulová mimo samotné Faktury — tahle noc začala zakládat jen první kus
(katalog surovin + nákupní ceny).

## Peníze — jednotky a zaokrouhlení

Důsledně **celé haléře** (`integer`/`smallint` sloupce `*_haleru`) napříč
mzdami, docházkou i novým katalogem surovin — žádné `float` součty. Nová
migrace surovin navíc ukládá odvozenou cenu za jednotku jako
`numeric(18,6) generated always as (...)` — stored, ne počítaná při čtení,
aby šla později verzovat nezávisle na změně vstupů.

## Katalog událostí — co zadání chtělo vs. co existuje

Zadání (oddíl 4) chce "dokumentovaný katalog událostí": *faktura potvrzena,
platba přiřazena, prodej importován, inventura uzavřena, docházka schválena,
receptura změněna, kampaň publikována.*

**Reálný mechanismus existuje** — `app.notifikovat(p_tenant, p_user, p_druh,
...)` (`supabase/migrations/20260921100000_notifikacni_sluzba.sql:308`) je
JEDINÉ vstupní místo pro upozornění; producenti (triggery, RPC) ho volají
ve VLASTNÍ transakci zdroje, nikdo jinde nezakládá `notifications` přímo.
Je to databázová fronta + worker (cron, `app/api/uloha/notifikace-push`),
ne distribuovaná infrastruktura — přesně jak zadání doporučuje ("Nezaváděj
distribuovanou infrastrukturu, pokud postačí databázová fronta a worker").

Skutečně existující druhy (`p_druh`) k 2. 10. 2026 — žádný z nich NENÍ
ten, co zadání vyjmenovává jako příklad, protože finanční/skladová vrstva
pod nimi dosud neexistovala:

| Existující druh | Zdroj |
|---|---|
| `vzkaz.novy`, `oznameni.nova` | komunikace |
| `ukol.pridelen` | provozní centrum |
| `checklist.prideleno`, `checklist.blizi_se_termin`, `checklist.po_terminu`, `checklist.problem`, `checklist.dokonceno`, `checklist.vyzaduje_kontrolu` | checklisty |
| `zaloha.potvrzena`, `zaloha.potvrzena_za_vas` | zálohy |

**Chybí zcela** (protože chybí i data pod nimi): `faktura.potvrzena`,
`platba.prirazena`, `prodej.importovan`, `inventura.uzavrena`,
`receptura.zmenena`, `kampan.publikovana`. Jediný kousek, který by šel
připravit hned (`receptura.zmenena`), nebyl do téhle dávky práce zahrnut
— receptury dnes nemají ani `updated_at` trigger, natož verzování, na
které by se "změna" dala navázat smysluplně.

**Doporučení pro navazující práci**: až vznikne tabulka plateb/faktur
s doménovým stavem (ne jen textový štítek), noví producenti recyklují
STEJNOU funkci `app.notifikovat` — nevzniká nový mechanismus, jen nové
hodnoty `p_druh`.

## Externí ID, idempotence, checkpointy

Zadání (oddíl 4) žádá "externí ID, unikátní klíče, checkpointy, transakce
a idempotenci" pro aktualizace z integrací. Dnes se tenhle vzor používá
důsledně tam, kde integrace existuje:

- Marketingová fronta publikací: `idempotencni_klic` na úloze,
  `for update skip locked`, `max_pokusu` — `app/api/uloha/marketing-fronta`.
- Cron joby obecně: concurrency groups v GitHub Actions + idempotence
  uvnitř každého RPC (viz `docs/finance-marketing-audit.md`, oddíl 6).
- **Chybí tam, kde integrace sama chybí** — POS import, bankovní import
  nemají dnes žádnou cestu, natož checkpointy.

## Co tenhle dokument neřeší

Detailní návrh chybějících tabulek (platby, rozpočty) — to je rozsah
navazující práce, ne shrnutí dnešního stavu. Sklad/pohyby/inventury
záměrně vynechány (rozhodnutí Šéfíka, viz tabulka výš).
Prioritizace je v `docs/finance-marketing-audit.md`, sekce "Priority
souhrn".
