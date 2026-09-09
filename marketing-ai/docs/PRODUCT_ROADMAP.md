# Plán produktu — etapy 1 až 3

Etapy odpovídají zadání (samostatná aplikace → propojení → plné
vložení do FoodTabu). U každé je napsáno, co je **v kódu hotové** a
co **zbývá** — stav k 9. 9. 2026.

## Etapa 1 — samostatná aplikace, demo režim, jádro tvorby

Cíl: celá cesta „zadání → návrh → náhled → schválení → plán →
publikace“ funguje bez jediného klíče, s viditelně označeným demem,
a s adaptéry připravenými na skutečné služby.

### Hotové

**Databáze** (4 migrace, RLS všude)

- organizace, provozovny, profily, katalog oprávnění (19), šablony
  rolí (6), role a členství s rozsahem organizace/provozoven, audit,
  `create_organization`, ochrana posledního vlastníka
- katalog poskytovatelů, schopnosti, volby organizace/provozovny,
  připojení, šifrovaná tajemství přes funkce, sociální účty, záznamy
  využití, webhook události
- média (sbírky, soubory, tagy, dedup otiskem, přesun jen s
  `media.share`), brand kit, šablony a jejich verze, výchozí šablony
  provozovny, menu (dny, položky, potvrzení), kampaně, obsah, verze,
  varianty, komentáře, žádosti o schválení a rozhodnutí, render a
  publish úlohy s idempotencí, publikace, metriky, automatizace,
  nápady, notifikace, UTM
- spouště: nová verze ruší schválení; verze neměnná; schválení jen na
  přesný otisk; publish job bez schválení nevznikne; povolené přechody
  stavů; audit kritických tabulek

**Doménová logika** (`lib/domena`)

- obsah: založení, nová verze s otiskem, duplikace, obnovení verze,
  AI zadání bez kontaktů, návrh a přepracování, výběr varianty, žádost
  o schválení s kontrolou podkladů, rozhodnutí se čtyřma očima, render
  (synchronní i asynchronní), plánování s ověřením schopností
  publisheru, přesun termínu, zrušení plánu
- fronta: dokončení renderů, publikace splatných, retry
  s exponenciálním odstupem (1, 2, 4, 8, 16 min, strop 30), dead letter,
  `manual_export` místo falešné automatizace, notifikace
- média: nahrání s kontrolou typu a velikosti, rozměry z hlavičky,
  duplicita, archivace, hero, přesun/kopie, úprava licenčních polí
- menu: ruční, z textu (deterministický parser cen, alergenů, dnů),
  z fotky/PDF přes AI s `menu.ocr`, potvrzení blokované položkami
  k doplnění, sedm odvozených výstupů z jednoho menu
  (`ODVOZENE_Z_MENU`)
- UTM odkazy a QR (SVG)

**Poskytovatelé** — 16 továren v registru; rozhraní v `types.ts`;
šifrování; ověření podpisu webhooků. Mock a vestavěné cesty otestované;
Claude, Shotstack, Meta, n8n implementované, **neotestované proti službě**.

**Šablony** — 47 gastro šablon jako data (`lib/sablony/katalog.ts`):
10 menu, 20 akcí a kampaní, 12 průběžných, + provozní hlášky; SVG
render se zalamováním, minimální velikostí písma a rozdělením dlouhého
menu na slidy (test scénář 6).

**Aplikace** — přihlášení (demo / OTP), rozcestník, shell s navigací
a přepínačem provozoven, přehled provozovny, zástupný průvodce,
stránka „bez organizace“. Autorizační vrstva, session, bezpečný návrat.

**Obrazovky** — 23 stránek: přihlášení, rozcestník, průvodce prvním
nastavením, přehled, tvorba (rychlý režim, průvodce, kampaňový režim),
detail obsahu s náhledem a verzemi, mediální knihovna, menu a import,
šablony, kalendář, schvalování, kampaně a automatizace, publikované,
analytika, brand kit, upozornění, integrace, tým/role/audit.

**API v1** — health, úlohy, návrh obsahu, analytika, test integrací,
soubory, Meta OAuth, webhooky; smlouva v `openapi/openapi.yaml`
a `tests/unit/openapi.test.ts` hlídá, že sedí s kódem.

**Testy** — `test:db`: 95 kontrol v osmi scénářích proti čisté PGlite
s RLS (osmý jsou schválně vyvolané poruchy), `npm test`: 41
jednotkových, `test:e2e`: 4 průchody Playwrightem na rozměru 390×844.

### Zbývá v etapě 1

- **Převod SVG → PNG/JPEG** pro publikaci obrázků. Meta SVG nepřijme,
  takže dokud tohle není, jde skutečná publikace obrázku jen přes
  Shotstack nebo ruční export. V demo režimu to nevadí, na ostrém
  účtu je to podmínka.
- **Omezení `marketing.create_organization`** — dnes ji smí zavolat
  každý přihlášený. Před ostrým provozem jen na pozvání.
- **Samostatný `CRON_SECRET`** — dnes se spadne na `APP_SECRET`,
  což znamená jedno tajemství na dvě různé věci.

## Etapa 2 — ostré služby a první zákazníci

Cíl: dva zákazníci (Černá Perla, Bernard Bar Tábor) publikují
skutečně, s vlastními účty.

- ověření všech „Co ověřit ručně“ (Meta, Shotstack, n8n) a spuštění
  adaptérů proti službám, Meta App Review
- `foodtab-marketing-test` a `-prod` na Supabase, nasazení na Vercel,
  cron, zálohy, obnova nanečisto (`DEPLOYMENT.md`)
- OAuth Meta se `state`, výběr Page + IG, expirace tokenů a upozornění
- Meta Insights → `metric_snapshots`, obrazovka analytiky se
  skutečnými čísly (dnes jen mock odhad)
- voice-over (`elevenlabs`) a e-mailové notifikace (`resend_email`)
  jako první „připravujeme“ položky, pokud o ně bude zájem
- GDPR export/mazání profilu, retence (`SECURITY.md`)
- rate limity, monitoring, Error Workflow v n8n

## Etapa 3 — vložení do FoodTab Řízení

Cíl: Marketing jako modul `marketing` ve FoodTabu, menu bez ručního
zadávání.

- události `menu.created / updated / approved` v1 z FoodTabu, adaptér
  `foodtab_menu`, endpoint `/api/v1/webhooky/foodtab`
  (`FOODTAB_INTEGRATION.md`)
- varianta 1 (SSO, deep link) → po odzkoušení varianta 2 (pohledy
  nad `tenants`/`branches`, sjednocení `has_access`, přesun obrazovek)
- mapování oprávnění `marketing.read/manage/publish` ↔ 19 oprávnění
  Marketingu — rozhodnutí Šéfíka
- Buffer nebo jiný plánovač jako alternativa k přímému Meta API,
  pokud se App Review ukáže jako překážka pro menší zákazníky
- AI agenti nad marketingem (podíl nákladů, ne jména a částky —
  pravidlo 8 FoodTabu)

## Co se rozhodlo a nemění se

- schválení je vázané na otisk verze a hlídá ho databáze
- nikdy automatická publikace bez schválení; `auto_publish` je vědomé
  nastavení kampaně
- demo/mock je vždy viditelně označené (`published_mock`, štítky,
  hláška v přehledu)
- katalog nepředstírá adaptér, který v kódu není
- ceny, data a alergeny jen ze schváleného zdroje; AI je nedomýšlí
- kontakty a adresy nechodí do jazykového modelu
