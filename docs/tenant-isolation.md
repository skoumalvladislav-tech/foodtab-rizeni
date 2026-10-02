# Izolace zákazníků (multi-tenancy) — stav k 2. 10. 2026

Požadovaný výstup nočního zadání (`docs/Foodtab_Claude_Code_nocni_zadani.md`,
oddíl 14). Shrnuje, jak appka dnes odděluje data jedné firmy od druhé,
co je prokazatelně otestované, kde je mezera a co z toho je vědomé
rozhodnutí vs. nedodělek. Navazuje na `docs/finance-marketing-audit.md`
(oddíl 5 a "Nejdůležitější zjištění").

## Model

`public.tenants` (firma) → `public.branches` (pobočka, 1:N) →
`public.employees`/`profiles` (lidé). `membership.scope` rozlišuje členství
na úrovni firmy nebo jedné pobočky. Tenant **není** totéž co pobočka —
pravidlo opakované v CLAUDE.md i v kódu (`tenants` komentář: "Rozhraní je
zatím jednofiremní, ale model je připravený na víc").

Architektura je **prokazatelně multi-tenant** už od založení projektu
(23. 8. 2026) — ne dodatečná záplata. Desítky PGlite scénářů
(`supabase/tests/krok*.sql`) zakládají SKUTEČNOU druhou firmu a ověřují,
že její data nejsou vidět; běží i proti reálnému PostgreSQL 16 v CI
(`.github/workflows/databaze.yml`).

## Jak appka pozná, pro kterou firmu pracuje

1. **Nikdy se nevěří tenant_id z klienta.** `lib/firma.ts:getCurrentTenantId()`
   volá RPC `my_tenants()`, která v těle filtruje `m.user_id = auth.uid()` —
   odvozeno ze session, ne z parametru.
2. **Člen víc firem** (od 2. 10. 2026, `docs/hlaseni` commit "Přidat přepínač
   firem"): výchozí je první firma z `my_tenants()`, ale cookie `ft_firma_id`
   může nést ručně vybranou — `getCurrentTenantId()` ji přijme JEN když je
   mezi firmami, které `my_tenants()` opravdu vrátil (`prepnoutFirmu` v
   `app/firma-prepnuti.ts` dělá tutéž kontrolu před zápisem cookie). Cizí
   nebo smazané členství se tiše ignoruje, nespadne na něm.
3. **Pobočka v adrese** (`/<rozsah>/...`) se ověřuje stejně —
   `resolveScope()` odmítne cokoli, co uživatel nemá mezi `my_context()`.
4. **Dvě obranné linie na každé tabulce**: aplikační `app.has_access(tenant,
   právo, pobočka)` PŘED zápisem/čtením, a RLS politika nad tabulkou, která
   totéž ověří znovu nezávisle na tom, jestli appka udělala chybu.

## Historický nález — proč "dvě linie" není formalita

`supabase/migrations/20260925120000_prava_firma_radku.sql` dokumentuje
skutečnou cross-tenant eskalaci práv, objevenou 25. 9. 2026, **živou
v produkci 17 dní** (8.–25. 9.): `employee_permissions`/`position_permissions`
nesou vlastní `tenant_id`, ale `app.has_access`/`app.has_permission` hledaly
výjimku jen podle `employee_id`/`position_id`, BEZ shody `tenant_id` řádku
s firmou zaměstnance. Majitel firmy B, zařazený ve firmě A jako číšník, si
mohl zapsat oprávnění s `tenant_id = B` a `employee_id` = sebe ve firmě A —
a `has_access` ve firmě A to vrátilo jako platné.

> Z migrace doslova: *"Dnes se to zneužít nedalo jen proto, že ostrá
> databáze má JEDNU firmu. Pojistka nesmí stát na tom, že druhý zákazník
> ještě nepřišel."*

Oprava (dvě linie): spouště `app.hlida_firmu_zamestnance`/
`app.hlida_firmu_zarazeni` (zapíše se jen řádek, kde `tenant_id` sedí
s firmou zaměstnance) + přepsané `has_permission`/`has_access` s explicitním
`ep.tenant_id = p_tenant`. Regresní test `krok58_scenar.sql` reprodukuje
přesně tenhle útok proti reálnému PostgreSQL.

**Tohle je potřetí, co se v projektu objevila stejná třída chyby**
(SECURITY DEFINER funkce, která věří cizímu sloupci místo aby si tenant
ověřila sama) — skill `foodtab-db-security` dokumentuje i předchozí dva
případy (granty TRUNCATE/REFERENCES, přímý PostgREST zápis obcházející
RPC u checklistů).

### Hloubkový sken (2. 10. 2026)

Po historickém nálezu byl proveden sken 115 aktuálně platných SECURITY
DEFINER funkcí (checklisty, docházka/směny/výdělky, zálohy, marketing_*,
pozvánky, realtime/notifikace, přílohy, konverzace) — **žádná další
vykořistitelná díra stejného typu nenalezena**. Dva křehké (dnes bezpečné,
ale neprůhledné) vzory zůstávají k zpevnění:

- `app.zapsat_potvrzeni_zalohy` / `app.zrusit_vyzvu_k_zaloze`
  (`20260925140000_zalohy_potvrzeni.sql`) — bez `tenant_id` filtru v těle,
  bezpečné jen díky tomu, že (a) nejdou zavolat přímo (`revoke all`) a
  (b) všichni dnešní volající si tenant ověří sami PŘED voláním.
- `app.upravit_usek_dochazky` / `app.stornovat_usek_dochazky`
  (`20260927110000_dochazka_smeny_cloveka.sql`) — podobně, drží to jen
  navazující `exists` kontrola, ne filtr v těle samotné funkce.

Doporučení (zatím neprovedeno, viz "Co zbývá" níž): přidat `tenant_id`
filtr přímo do těla obou dvojic + regresní test "cizí employee_id na
existující řádek musí selhat i přes platné ID". ~121 starších funkcí
(před 14. 9. 2026) nebylo tímto skenem znovu čteno tělo po těle.

## Produkční realita vs. architektura

Produkce měla k 25. 9. 2026 **jednu firmu** (Foodtab). Přepínač firem
(viz výš) existuje od 2. 10. 2026, ale beze změny chování pro jednofiremní
uživatele — sekce se v nabídce účtu kreslí jen u člena víc firem zároveň.

## Výjimka: modul Faktury

Faktury (`app/[rozsah]/finance/faktury/*`) jsou vědomě (rozhodnutí Šéfíka
15. 9. 2026, "Možnost A") napojené na **samostatný Supabase projekt**
(`ctqtwahlzhyjerqulqyn`), ne na hlavní FoodTab databázi. Tahle databáze
nemá vlastní RLS podle tenanta (RLS je "allow all" s anon klíčem) a nemá
žádné sdílené přihlášení s FoodTabem — jediná obrana byla donedávna
FoodTabí oprávnění `faktury.read`/`faktury.manage` na OBRAZOVKU, ne izolace
DAT.

**Fáze 1 opravy (2. 10. 2026)**: `tenant_id` sloupec + aplikační filtr ve
všech dotazech/zápisech (`docs/hlaseni/faktury-tenant-izolace-2026-10-02.md`).
**Fáze 2 (RLS přes JWT claim nebo RPC vrstvu) zůstává otevřená** — tahle
databáze nemá per-tenant auth, takže klasická RLS politika založená na
`auth.uid()` tu nejde postavit bez dalšího kroku (vlastní JWT s claimem
`tenant_id`, podepsaný JWT Secretem toho projektu).

## Provider-level izolace (integrace)

Marketingové providery (Instagram/Facebook/n8n/Anthropic) mají tajemství
uložené PER TENANT v `marketing_tajemstvi` (AES-256-GCM, žádný grant pro
`authenticated`, žádný audit trigger na obsah šifry) — SECURITY DEFINER
funkce (`app.marketing_uloz_tajemstvi` apod.) si tenant dohledají SAMY
z `marketing_pripojeni.tenant_id`, ne z parametru klienta.

Foodtabí VLASTNÍ klíče (ANTHROPIC_API_KEY, RESEND_API_KEY) jsou jedna
globální proměnná prostředí pro všechny tenanty — to je podle návrhu
v pořádku (je to Foodtabí účet, ne zákaznický), ale **infrastruktura
pro budoucí zákaznické POS/bankovní klíče mimo marketing dnes
neexistuje**. Žádný obecný "provider registry" napříč kategoriemi
(POS, banka, mailbox, sociální síť) není postavený — nejblíž je
`lib/marketing-katalog.ts`, specifické jen pro marketing.

## Co ověřují testy

- `supabase/tests/krok2_scenar.sql`, `krok58_scenar.sql` a desítky dalších
  (`krok21,33,42,43,45,47-52,54,57,60,68`) — skutečná druhá firma, `count(*)
  = 0` napříč tabulkami pro cizí firmu.
- Běží v CI proti reálnému PostgreSQL 16 (`.github/workflows/databaze.yml`),
  ne jen PGlite — PGlite neověří RLS ani sloupcové granty.
- `scripts/faktury-tenant-izolace.test.mjs` (2. 10. 2026) — strukturální
  kontrola nad zdrojovým textem (žádná reálná druhá DB k dispozici v CI),
  ověřuje že každý dotaz na `invoices` filtruje `tenant_id`.
- `scripts/firma-prepnuti.test.mjs` (2. 10. 2026) — přepínač firem nevěří
  cizí hodnotě v cookie ani ve formuláři.

## Co zbývá (transparentně, podle pravidla "co nešlo")

1. **Faktury fáze 2** (RLS přes JWT/RPC) — potřebuje JWT Secret projektu
   Faktur od Šéfíka a samostatné rozhodnutí o architektuře.
2. **Dva křehké SECURITY DEFINER vzory** (zálohy, docházka) — zpevnit filtr
   do těla funkce + napsat regresní test. Nebylo v této dávce práce
   provedeno (konflikt se souběžně běžící prací na `supabase/tests/run.sh`),
   je to další krok.
3. **~121 starších SECURITY DEFINER funkcí** neprověřeno tělo-po-těle tímto
   skenem — doporučeno prioritně `20260901170000_zarizeni_pobocky.sql`
   (výdej klíčů kiosků, anon-dosažitelné) a mzdový základ.
4. **Obecný provider registry** napříč kategoriemi integrací — dnes
   neexistuje; nestavět ho preventivně bez druhého skutečného adaptéru
   (riziko špatně odhadnuté abstrakce), ale rozhodnout při přidání
   Dotykačky nebo přímého napojení na Metu.
5. **Pravidelná kontrola nad produkční DB** — cross-tenant testy běží jen
   v CI/testu, ne jako opakovaná kontrola nad ostrými daty.
