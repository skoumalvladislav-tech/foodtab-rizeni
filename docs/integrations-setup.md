# Integrace — co je připojené a jak to nastavit (stav 2. 10. 2026)

Povinný výstup nočního zadání (oddíl 14). Pro každou integraci platí
rozlišení ze zadání (oddíl 13, "Externí operace ověř přes sandbox/mocks..."):
**skutečný adaptér** (reálné API volání, otestováno), **CSV/ruční fallback**,
nebo **čeká na připojení** — nikdy "připojeno", dokud není ověřeno.

## Skutečně zapojené (reálné API volání)

| Nástroj | Soubor | Proměnné prostředí | Stav |
|---|---|---|---|
| Resend (e-mail) | `lib/email.ts` | `RESEND_API_KEY` | Funkční — jen pozvánky. Bez klíče appka funguje dál, pozvánku jen nepošle (nabídne odkaz ke zkopírování). |
| n8n (publikování IG/FB) | `lib/marketing-n8n.ts` | `N8N_MARKETING_URL`, `N8N_MARKETING_TAJEMSTVI` | Kód funkční a otestovaný, **provozně vypnuté** kvůli kolizi se starým workflow "Černá Perla" — rozhodnutí o zapnutí patří Šéfíkovi. |
| Anthropic Claude | `lib/marketing-ai.ts`, `lib/marketing-profil-ai.ts`, `lib/marketing-menu-ai.ts`, `lib/marketing-spojeni.ts` | `ANTHROPIC_API_KEY` (Foodtab) nebo zákaznický klíč | Funkční, tři režimy (mock/foodtab/zákaznický) podle `foodtab-ai` skillu. |
| MET Norsko (počasí) | `lib/pocasi.ts` | — (veřejné API) | Funkční, vlastní User-Agent dle ToS poskytovatele. |
| Supabase Storage | všude přes `lib/supabase/*` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Funkční, signed URL pro privátní přílohy. |
| Web Push (VAPID) | `lib/komunikace/web-push.ts` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (chybí v `.env.example` — ověř se Šéfíkem) | Standardní W3C Web Push, bez klíčů `nakonfigurovano: false`. |
| Faktury (databáze) | `lib/supabase/faktury.ts` | `FAKTURY_SUPABASE_URL`, `FAKTURY_SUPABASE_ANON_KEY` | Funkční, ale samostatný Supabase projekt bez sdíleného přihlášení — viz `docs/tenant-isolation.md`. |

## Čeká na připojení (adaptér/kód neexistuje)

| Nástroj | Co chybí | Priorita podle zadání |
|---|---|---|
| Dotykačka (POS) | Celý adaptér — žádný kód, žádná tabulka. Jen zmínka v zadání (`docs/Foodtab_Claude_Code_nocni_zadani.md:148,197,255`, odkaz `dotykacka.cz/api`). | P1 |
| Instagram/Facebook přímé OAuth | `lib/marketing-katalog.ts` sám říká „OAuth průvodce ani adaptér nejsou napsané" — publikování dnes jde jen přes n8n (cizí token). | P1 (pokud má být nativní) |
| Google Business Profile | Nulová zmínka v katalogu/schématu/UI. | P2/P3 |
| Banka (import/platby) | `banking.read` oprávnění rezervované v katalogu, nikde nepoužité. | — (čeká na rozhodnutí o rozsahu) |
| Metricool, Windsor.ai, Canva, Choice QR | Žádný výskyt v kódu ani docs mimo zadání samotné. | — |
| OpenAI, Shotstack, ElevenLabs, Meta Graph přímo, OneDrive/Google Disk | V `lib/marketing-katalog.ts` jako `podporovany: false`, `rezimy: []` — metadata k zobrazení "připravujeme", žádný kód. | P2/P3 |

## CSV/ruční fallback (funguje bez placené integrace)

- **Faktury**: ruční zadání (`/finance/faktury/nova`) pro doklady mimo
  e-mailový příjem.
- **Marketing publikování**: `rucni` režim — příspěvek se připraví, schválí,
  naplánuje, zveřejní ho člověk sám. Jediná položka v katalogu, která je
  podporovaná vždycky a nepotřebuje žádný klíč (zadání, oddíl 3.1 — "bez
  Shotstacku/n8n nelze appku používat" je výslovně zakázaný vzor).
- **AI texty**: bez klíče appka vrátí viditelně označenou ukázku (mock
  režim), ne chybu — modul funguje dál.
- **Čtení menu z fotky**: VÝJIMKA z pravidla výš — bez klíče appka vrátí
  CHYBU s návodem vložit menu textem, ne ukázku. Vymyšlené menu vypadá jako
  přečtené a nikdo to nepozná, dokud nevyjde příspěvek se špatnými cenami
  (`foodtab-ai` skill).

## Jak nastavit (lokální vývoj)

Žádný worktree v tomhle repozitáři (ověřeno ve třech) neměl `.env.local` —
appka se dosud testovala přes `tsc`/PGlite/eslint, ne přes běžící `next dev`
s reálnou databází. Pro prohlížečové testování je potřeba od Šéfíka:

1. `NEXT_PUBLIC_SUPABASE_URL` a `NEXT_PUBLIC_SUPABASE_ANON_KEY` pro
   `foodtab-test` (`spekntcsuroqhehmjssv`) — anon klíč NENÍ tajný, jde do
   prohlížeče, lze bezpečně předat.
2. Pro testování Faktur navíc `FAKTURY_SUPABASE_URL`/`FAKTURY_SUPABASE_ANON_KEY`
   (`ctqtwahlzhyjerqulqyn`).
3. Produkční klíče (RESEND_API_KEY, ANTHROPIC_API_KEY, N8N_MARKETING_*)
   nejsou nutné pro většinu lokálního vývoje — bez nich appka přejde do
   svého definovaného "bez klíče" chování (viz tabulka fallbacků výš),
   ne do chyby.

## Co tenhle dokument neověřil

Hodnoty produkčních proměnných na Vercelu/GitHub Secrets (mimo dosah
statického auditu kódu — Vercel MCP vrací 403 v této relaci). Zda jsou
VAPID klíče pro Web Push vůbec v produkci nastavené.
