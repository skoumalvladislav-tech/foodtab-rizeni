# Katalog poskytovatelů

Aplikace se nikdy neptá „je to Shotstack?“. Ptá se registru na
poskytovatele pro **kategorii** a používá jen schopnosti
(`capabilities`), které adaptér ohlásí. Tři vrstvy, které se nemíchají
(migrace `20260908100100_providery.sql`):

1. **`provider_catalog` + `provider_capabilities`** — co FoodTab umí
   nabídnout. Globální data, stejná pro všechny organizace. Řádek
   v katalogu **nic nepřipojuje**.
2. **`organization_provider_preferences`** — co si organizace (nebo
   provozovna; provozovna přebíjí) vybrala pro kategorii. Nejvýš jedna
   aktivní volba na kategorii a rozsah.
3. **`integration_connections`** — konkrétní připojený účet. Tajemství
   zvlášť v `integration_secrets` (viz `SECURITY.md`).

Data katalogu jsou v migraci `20260908100300_katalog_providery.sql`;
továrny adaptérů v `lib/providers/registry.ts` (`FACTORIES`). Test
`tests/db/run.ts` (scénář 5) hlídá, že každý řádek s
`implementation_status = 'implemented'` má továrnu a každý `planned`
ji nemá — katalog nemůže předstírat integraci, která v kódu není.

## Stav implementace — pravdivě

Tři různé věci, které se nesmí plést:

| Pojem | Znamená |
|---|---|
| **implementováno** | v kódu existuje adaptér a továrna v registru |
| **otestováno proti službě** | adaptér byl spuštěn se skutečným klíčem a skutečnou službou |
| **připravujeme** | jen položka v katalogu, bez adaptéru; v rozhraní nejde připojit |

Dnes platí: **žádný z adaptérů na externí službu (Claude, Shotstack,
Meta Graph, Meta Insights, n8n) nebyl spuštěn proti skutečné službě.**
Otestované jsou mock a vestavěné cesty (`test:db`).

## Tabulka poskytovatelů

Sloupce: doporučení (`foodtab_recommended` = Doporučeno FoodTabem,
`supported` = Jiná podporovaná možnost, `planned` = Připravujeme),
režimy připojení (`customer_managed` = zákazník má vlastní účet a klíč,
`foodtab_managed` = klíč drží FoodTab / vestavěné, `manual_export` =
bez připojení, `mock` = demo), kdo platí (`customer_pays_provider`,
`included` = v ceně aplikace, `free`).

### AI text a storyboard (`ai_generation`)

| Klíč | Název | Doporučení | Implementace | Ověřeno proti službě | Režimy | Ověření | Platí | Schopnosti |
|---|---|---|---|---|---|---|---|---|
| `anthropic_claude` | Claude (Anthropic) | doporučeno | ano — `lib/providers/ai/claude.ts` | **ne** | customer, foodtab | api_key | zákazník | text.caption, text.storyboard, text.variants, text.revise, menu.ocr |
| `internal_mock_ai` | Interní návrhář (demo) | podporováno | ano — `ai/mock.ts` | ano (mock) | mock | none | zdarma | totéž; text.revise a menu.ocr jen částečně (jen text, ne fotka) |

Claude: strukturovaný výstup přes `client.messages.parse` +
`zodOutputFormat(AiNavrhSchema)`, systémový prompt říká výslovně, že
brief a menu jsou data, ne instrukce. Model z `ANTHROPIC_MODEL` nebo
z připojení, výchozí `claude-opus-5`. Odhad nákladů
(`odhadNakladuHalere`) má ceník za milion tokenů: Opus 5 = 5/25 USD,
Sonnet 5 = 2/10, Haiku 4.5 = 1/5, Fable 5.1 = 10/50 — to odpovídá
aktuálnímu ceníku Anthropic (kontrola 9. 9. 2026), přepočet 23 Kč/USD
je jen odhad. Připojuje se: Integrace → Claude → API klíč → test
(`client.models.retrieve(model)`, nic negeneruje).

### Grafika (`image_rendering`)

| Klíč | Název | Doporučení | Implementace | Režimy | Platí | Schopnosti |
|---|---|---|---|---|---|---|
| `internal_svg_renderer` | Interní vykreslení obrázků | doporučeno | ano — `render/svg.ts` + `lib/render/svg-sablony.ts` | foodtab | v ceně | render.image, render.pdf (A4/A5 jako SVG) |

Skutečný, ne mock: vrátí hotové SVG. Omezení, na které se přijde až
u publikace: Meta SVG jako `image_url` **nepřijme** — před ostrým
publikováním obrázků je potřeba převod SVG → PNG/JPEG (viz
`SOCIAL_API_LIMITS.md`). Video neumí a řekne to.

### Video (`video_rendering`)

| Klíč | Název | Doporučení | Implementace | Ověřeno | Režimy | Ověření | Platí | Schopnosti |
|---|---|---|---|---|---|---|---|---|
| `shotstack` | Shotstack | doporučeno | ano — `render/shotstack.ts` | **ne** | customer, foodtab | api_key | zákazník (stage zdarma) | render.video, render.image, render.audio_mix; render.subtitles částečně |
| `internal_mock_video` | Interní video (demo) | podporováno | ano — `render/mock-video.ts` | ano (mock) | mock, manual_export | none | zdarma | render.video **částečně** — jen storyboard JSON + titulní SVG, žádné video |

### Voice-over (`voiceover`)

| Klíč | Název | Stav |
|---|---|---|
| `elevenlabs` | ElevenLabs | **připravujeme** — bez adaptéru, nejde připojit |

### Automatizace (`workflow_automation`)

| Klíč | Název | Doporučení | Implementace | Ověřeno | Režimy | Ověření | Schopnosti |
|---|---|---|---|---|---|---|---|
| `n8n` | n8n | doporučeno | ano — `workflow.ts` | **ne** | customer, foodtab | webhook_secret | workflow.trigger, workflow.callback (jen když je base_url i secret) |
| `internal_queue` | Interní fronta úloh | podporováno | ano — `workflow.ts` | ano | foodtab | none | workflow.trigger, workflow.callback |

### Publikování (`social_publishing`)

| Klíč | Název | Doporučení | Implementace | Ověřeno | Režimy | Ověření | Platí | Schopnosti |
|---|---|---|---|---|---|---|---|---|
| `meta_graph` | Instagram + Facebook (Meta API) | doporučeno | ano — `social/meta.ts` | **ne** | customer | oauth | zdarma (App Review) | IG feed/carousel/reel/story, FB post; FB reel a publish.schedule částečně |
| `mock_publisher` | Mock publikace (demo) | podporováno | ano — `social/mock.ts` | ano (mock) | mock | none | zdarma | všechno — nic nezveřejní, stav `published_mock` |
| `manual_export` | Ruční publikace (stažení souboru) | podporováno | ano — `social/manual.ts` | ano | manual_export | none | zdarma | všechno částečně — stav `manual_export`, člověk zveřejní sám |
| `buffer` | Buffer | připravujeme | **ne** | — | — | oauth | — | — |

Schopnosti `meta_graph` v běhu závisí na připojení: bez tokenu
v režimu `customer_managed` adaptér ohlásí **prázdný** seznam a fronta
pošle publikaci do `manual_export` místo falešného „zveřejněno“.

### Analytika (`analytics`)

| Klíč | Název | Implementace | Ověřeno | Schopnosti |
|---|---|---|---|---|
| `meta_insights` | Meta Insights | ano — v `registry.ts` obal nad `createMetaPublisher().fetchMetrics` | **ne** | metrics.basic; metrics.video částečně |
| `mock_metrics` | Ukázkové metriky (demo) | ano — `ostatni.ts` | ano (mock) | metrics.basic — deterministický odhad, vždy `isEstimate: true` |

### Notifikace (`notifications`)

| Klíč | Název | Implementace | Schopnosti |
|---|---|---|---|
| `internal_notifications` | Upozornění v aplikaci | ano — `ostatni.ts` (zápis do `marketing.notifications`) | notify.push (zvonek) |
| `resend_email` | E-mail (Resend) | **připravujeme** | notify.email |

### Úložiště (`external_storage`)

| Klíč | Název | Implementace | Poznámka |
|---|---|---|---|
| `supabase_storage` | Supabase Storage | ano — továrna je jen zástupný objekt; skutečnou práci dělá `lib/storage/supabase.ts` podle proměnných prostředí | v ceně infrastruktury |
| `local_storage` | Lokální disk (vývoj) | ano — totéž, `lib/storage/local.ts` | ne pro produkci |

Úložiště se **nevybírá** v Integracích, ale proměnnými prostředí
(`getStorage()`); řádek v katalogu je informativní a volba
v preferencích ho nepřepne.

### Zdroj menu (`menu_source`)

| Klíč | Název | Implementace | Poznámka |
|---|---|---|---|
| `manual_menu` | Ruční zadání a import | ano — `ostatni.ts`; logika v `lib/domena/menu.ts` a `menu-text.ts` | formulář, text, fotka/PDF přes AI s `menu.ocr` |
| `foodtab_menu` | FoodTab Řízení — jídelní lístky | **připravujeme** (etapa 3) | události `menu.approved` z FoodTabu |

## Jak se poskytovatel připojuje (obecně)

1. Uživatel s `integrations.manage` (rozsah celé organizace) vybere
   v Integracích poskytovatele a režim.
2. Vznikne řádek `integration_connections` (`status = connecting`).
3. Přístupové údaje se zašifrují na serveru
   (`encryptCredentials`, AES-256-GCM) a uloží přes
   `marketing.store_secret(connection, ciphertext, fingerprint)`.
   Do `connections` se zapíše jen `secret_ref` a otisk.
4. Test připojení: `instantiateConnection(tx, id)` → `testConnection()`
   → `last_test_at`, `last_test_ok`, `external_account`,
   `granted_scopes`, `expires_at`; při úspěchu `status = connected`.
5. Volba pro kategorii: řádek v `organization_provider_preferences`
   (`connection_id` na to připojení). Provozovna může mít vlastní.
6. Odpojení: `marketing.delete_secret(connection)` → tajemství pryč,
   `status = revoked`. Obsah, publikace a historie zůstávají.

Kdo smí tajemství **číst**: `integrations.use` nebo
`integrations.manage` téže organizace (`read_secret`). Cizí organizace
nevidí ani to, že připojení existuje (RLS).

## Kdo platí

- `customer_pays_provider`: zákazník má vlastní účet u služby a platí
  přímo jí (Claude, Shotstack, n8n cloud). Aplikace zapisuje odhad
  spotřeby do `provider_usage_records` — je to **odhad, ne účtování**.
- `included`: vestavěné, v ceně aplikace (interní render, fronta,
  notifikace, Supabase Storage, ruční menu).
- `free`: služba zdarma (Meta API — ale vyžaduje App Review), mock.

Ceny v katalogu (`pricing_note`, `pricing_checked_at`) jsou orientační
s datem kontroly. Aktualizuje je správce, ne nový release.

## Jak přidat nový adaptér

Tři kroky, žádný `if` v obrazovce:

1. **Řádek v katalogu** — nová migrace
   `supabase/migrations/RRRRMMDDHHMMSS_provider_<klic>.sql`:
   `insert into marketing.provider_catalog (…)` s
   `implementation_status = 'planned'`, dokud adaptér není hotový, a
   řádky `provider_capabilities` s pravdivým `status`
   (`available` / `partial` / `planned`). Nová schopnost = nejdřív
   řádek v `marketing.capabilities`.
2. **Adaptér + továrna** — soubor v `lib/providers/<kategorie>/<klic>.ts`
   implementující rozhraní z `lib/providers/types.ts`
   (`AIProvider`, `RenderProvider`, `SocialPublisherProvider`,
   `WorkflowProvider`, `NotificationProvider`, `MetricsProvider`,
   `MenuSourceProvider`). Vrací `capabilities` **podle toho, co má
   opravdu k dispozici** (bez tokenu prázdné). Přidat do `FACTORIES`
   v `registry.ts`. Pak druhá migrace, která přepne
   `implementation_status` na `implemented`.
3. **Test** — do `tests/db/run.ts`: (a) scénář 5 už hlídá shodu
   katalogu a registru; (b) přidat kontrolu, že bez přístupových údajů
   adaptér ohlásí prázdné schopnosti a `testConnection()` vrátí
   `ok: false`; (c) že se přístupové údaje cizí organizace nedají číst.
   Kontrola má umět spadnout — rozbijte ji schválně a přesvědčte se.

Endpointy a názvy oprávnění externí služby držte **v jedné konstantě
nahoře v souboru** (vzor `META`, `ENDPOINTS`), aby se daly po ověření
proti dokumentaci upravit na jednom místě.
