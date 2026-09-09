# Bezpečnost

Pravidla přebíráme z FoodTabu (kořenový `CLAUDE.md`, „Pravidla, která se
neporušují“) a tady je uvedeno, **kde v kódu** je každé z nich
skutečně vynucené. Co je jen plán, je označené jako plán.

## 1. Dvě obranné linie

**Row Level Security na každé tabulce** schématu `marketing` — všechny
tři migrace končí blokem `alter table … enable row level security` a
politikami. Politiky nečtou členství přímo, ale volají funkce
`marketing.is_member`, `has_access`, `can_read`, `can_write`
(`security definer`, `search_path = ''`), aby nevznikla rekurze.

**Každý dotaz aplikace běží pod rolí `authenticated` s nastaveným
uživatelem** (`lib/db/session.ts`, `withUser`): transakce začne
`set_config('role','authenticated')` a `set_config('request.jwt.claim.sub', userId)`.
Připojení k databázi je sice uživatelem z `DATABASE_URL` (`postgres`),
ale jeho práva se na data nikdy nepoužijí — jen na přepnutí role. Platí
tedy stejné politiky jako přes Supabase API.

**Aplikační kontrola** (`lib/authz.ts` → `assertAccess`, v doméně
`lib/domena/obsah.ts` → `assertAccess`) je druhá linie, ne náhrada.
Rozhodnutí samo dělá `marketing.has_access(org, právo, provozovna)`
v databázi — jediné místo.

`withService` (role `service_role`, obchází RLS) je jen pro frontu
(`lib/domena/fronta.ts`) a webhooky, kde žádný uživatel není. Výhradně
na serveru.

Lokální PGlite tohle **ověřuje také**: role `authenticated` je
v `supabase/local/00_shim.sql` založená jako `nosuperuser`, takže
`test:db` selže, když politika pustí někoho, koho nemá (scénář 1).

## 2. Rozsah z prohlížeče je návrh

Provozovna z adresy `/[provozovna]/…` se v `nacistKontext` ověří proti
`marketing.visible_venue_ids(org)`; nenalezená nebo cizí provozovna
přesměruje na `/` (pro uživatele je to totéž jako neexistující).
`branch_id`/`venue_id` z formulářů jde vždy do `has_access` s tou
provozovnou; RLS to hlídá podruhé.

## 3. Tajemství poskytovatelů

Tabulka `marketing.integration_secrets`:

- **žádný grant pro `authenticated`**, RLS zapnuté **bez politik** —
  přímý `select` skončí `permission denied` (kontrola v `test:db`,
  scénář 1),
- jediná cesta dovnitř a ven jsou funkce `store_secret`
  (`integrations.manage`), `read_secret` (`integrations.use` nebo
  `manage`, jen vlastní organizace) a `delete_secret`,
- hodnota je **šifrovaná aplikací** (`lib/providers/credentials.ts`,
  AES-256-GCM, náhodný 12bajtový IV, ověřovací tag; formát
  `v1.<iv>.<tag>.<data>`), klíč `CREDENTIALS_ENCRYPTION_KEY` (32 bajtů
  hex) je jen v prostředí serveru. Databáze i její záloha vidí jen
  ciphertext,
- vedle toho **otisk** (`fingerprint`, prvních 16 hex znaků SHA-256
  hlavní hodnoty) pro otázku „je to pořád stejný klíč?“ bez čtení,
- `key_version` a `rotated_at` pro rotaci; audit každého uložení a
  smazání spouští funkce sama (`marketing.audit`),
- v rozhraní se po uložení ukazuje jen `…abcd` (`maskovat`),
- `audit_trigger` odstraňuje sloupec `ciphertext`, kdyby se do auditu
  někdy dostal.

V demo režimu se klíč odvodí z `APP_SECRET`; v produkci
(`APP_MODE=production`) se odvození **odmítne** a klíč musí být nastavený.

## 4. Tokeny a podpisy

- **Podepsané adresy souborů** (`lib/storage/podpis.ts`): soubor se
  nepodává podle cesty, ale `/api/v1/media/{id}/soubor?exp=…&sig=…`;
  podpis HMAC-SHA256(`APP_SECRET`, `id.exp`) pokrývá ID i čas
  vypršení, porovnává se v konstantním čase (`safeEqual`). Platnost:
  6 h pro render, 24 h pro publikaci, 1 h výchozí. Prohlížeč adresu
  Storage nikdy nevidí; Supabase bucket je privátní.
- **Demo cookie** `ftm_demo`: `userId.exp.hmac`, 7 dní, jen v demo
  režimu; v produkci `getSession` demo cookie ignoruje.
- **Webhooky** (`overitPodpisWebhooku`): HMAC-SHA256 nad
  `timestamp.body`, okno **5 minut**, porovnání v konstantním čase,
  idempotence přes `marketing.webhook_events` (unikátní
  `provider_key + external_event_id`).
- **OAuth Meta**: `state` musí být náhodný a ověřený v callbacku (API
  v1); tokeny jdou rovnou do `store_secret`, nikdy do
  `external_account`, logu ani odpovědi.
- `X-Cron-Secret` pro `/api/v1/ulohy/zpracovat` je `APP_SECRET`.
  **K řešení:** je to master tajemství aplikace, cron/n8n by měly
  dostat samostatný `CRON_SECRET`.

## 5. Schvalování, které nejde obejít

Pravidla hlídá **databáze spouštěmi**, ne jen aplikace
(`20260908100200_obsah.sql`):

- schválení patří **přesné verzi** — `approval_requests.version_checksum`
  i `approval_decisions.version_checksum` musí sedět s
  `content_versions.checksum` (otisk z kanonického JSON obsahu,
  `lib/utils/hash.ts`), jinak `on_approval_decision` vyhodí výjimku,
- nová verze **ruší** schválení, otevřené žádosti a naplánované
  publikace (`on_content_version_insert`),
- verze je neměnná (`forbid_version_update`),
- `publish_jobs` bez platného schválení téže verze nevznikne
  (`guard_publish_job`, ověřeno v `test:db` scénář 3 přímým insertem),
- stav `approved` nejde nastavit přímo bez žádosti
  (`guard_content_status`),
- fronta před každou publikací otisk ověří **znovu**
  (`zverejnitSplatne`) a při neshodě úlohu zruší,
- čtyři oči: žadatel si vlastní žádost neschválí, pokud existuje jiný
  schvalovatel (`rozhodnout`),
- automatické publikování je vědomé nastavení kampaně
  (`campaigns.auto_publish`, výchozí `false`) — dnes ho nic nečte,
  takže **nikdy nic nepublikuje bez schválení**.

## 6. Osobní údaje a jazykový model

- E-mail a telefon spolučlenů se nečtou: granty na `marketing.profiles`
  jsou **po sloupcích** (`select (user_id, display_name, …)`); dotaz na
  `email` spadne dřív, než se dostane na řádky (test scénář 1).
- Do AI zadání (`sestavitZadani`) jde brand kit **bez** adresy,
  telefonu a webu; ze vstupů se odstraňují klíče `phone`, `address`,
  `email` (`strip`). Fakta (ceny, data, alergeny) přicházejí jen ze
  schváleného menu, model je nesmí domýšlet (systémový prompt) a
  hlásí, co chybí (`kontrolaFaktu`).
- Brief a importované menu jsou pro model **data, ne instrukce**
  (výslovně v promptu).
- Šablony s obsahem o lidech (`predstaveni_kuchare`, `reference_hosta`,
  `obsah_hosta`) mají povinný vstup „Souhlas zaznamenán“ — bez něj se
  obsah nevykreslí (`lib/sablony/katalog.ts`).
- Mazání lidí je označení (`memberships.deleted_at`), ne výmaz — kvůli
  auditu a historii schválení.

## 7. Oddělení prostředí

| Prostředí | Databáze | Přihlášení | Poskytovatelé |
|---|---|---|---|
| vývoj (dev) | PGlite `.data/pglite` | demo účty | mock / vestavěné |
| test (stage) | `foodtab-marketing-test` (Supabase, Frankfurt) | OTP, pozvánky | skutečné klíče **testovacích** účtů; Shotstack `stage`; Meta aplikace v dev módu |
| ostrý provoz (prod) | `foodtab-marketing-prod` | OTP, pozvánky | ostré klíče zákazníků |

Nikdy jedna databáze pro test i ostrá data. `APP_SECRET` a
`CREDENTIALS_ENCRYPTION_KEY` jsou v každém prostředí jiné. Demo seed do
testu ani produkce nepatří (`SUPABASE_SETUP.md`, oddíl 6). Automatické
nasazení z gitu na ostrý projekt zatím **ne** — stejné rozhodnutí jako
u FoodTabu (klíče v repozitáři až po vzniku prod projektu).

## 8. GDPR — export a mazání profilu (PLÁN)

V kódu zatím **není**. Co bude potřeba:

- **Export**: na žádost uživatele vypsat jeho `profiles` řádek,
  členství, komentáře, rozhodnutí o schválení a notifikace jako JSON.
- **Smazání**: `profiles` anonymizovat (display_name → „Odstraněný
  uživatel“, e-mail a telefon → NULL), členství označit `deleted_at`,
  autorství (`created_by`, `decided_by`, `author_id`) **ponechat jako
  ID** kvůli auditu — ID samo bez profilu není osobní údaj. Účet
  v Supabase Auth smazat.
- **Hosté**: aplikace zatím nemá žádnou tabulku s kontakty hostů;
  než vznikne, potřebuje vlastní zadání (souhlas, retence, co nesmí
  k modelu) — viz `docs/marketing-zadani.md`, oddíl 6.
- Meta App Review vyžaduje **Data Deletion URL** — bude to endpoint,
  který na callback od Meta smaže `social_accounts` a tajemství
  daného uživatele (`delete_secret`).

## 9. Retence

| Data | Dnes | Plán |
|---|---|---|
| `audit_logs` | bez mazání (`authenticated` má jen `select`) | 24 měsíců, pak agregace |
| `webhook_events` | bez mazání | 90 dní |
| `notifications` | bez mazání | 90 dní po přečtení |
| `provider_usage_records` | bez mazání | 24 měsíců |
| média | archivace `archived_at`, soubor zůstává | po 12 měsících v archivu smazat soubor i řádek, pokud nemá publikaci |
| verze obsahu | neměnné, bez mazání | ponechat (historie schválení) |
| render výstupy `hotove` | bez mazání | 6 měsíců po publikaci |

Kde je hotový výstup zveřejněný, zůstává kvůli dohledatelnosti („co
přesně jsme zveřejnili a kdo to schválil“).

## 10. Evidence licencí médií

`marketing.media_assets` má sloupce:

| Sloupec | Význam |
|---|---|
| `author` | kdo fotku pořídil / dodal |
| `license` | za jakých podmínek se smí použít (např. „vlastní“, „licence agentury X do…“, „interní demo — bez licence k publikaci“) |
| `consent_note` | souhlas zobrazených osob (kdo, kdy, jak) |
| `usable_until` | do kdy se smí použít (`date`) |
| `ai_generated`, `ai_edited` | značení AI obsahu (regulace označování) |

Ukládají se při nahrání (`nahratMedium`) a při úpravě (`upravitMedium`).
Demo obrázky mají výslovně `license = 'Interní demo — bez licence
k publikaci'`. **Plán:** publikace média po `usable_until` a bez
`consent_note` u fotek lidí má fronta odmítnout — dnes to nekontroluje.

## 11. Co NIKDY nelogovat

- API klíče, tokeny, `page_tokens`, `ciphertext`, `CREDENTIALS_ENCRYPTION_KEY`,
  `APP_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`,
  `N8N_WEBHOOK_SECRET`, `FOODTAB_WEBHOOK_SECRET`,
- celé podepsané adresy souborů (`sig=`), OAuth `code` a `state`,
- hlavičky `Authorization`, `x-api-key`, `X-FoodTab-Signature`,
- e-mail a telefon uživatelů (ani v chybových hláškách),
- obsah briefu a menu v logu externí služby (jde do modelu, ne do logu),
- odpovědi Meta a Shotstack **celé** — `response` v `publish_jobs` a
  `render_jobs` je záměrně jen to, co adaptér vrátí (ID, stav), ne
  surová odpověď s tokeny.

Chybové hlášky pro uživatele říkají „připojení selhalo“, ne hodnotu
klíče. `MetaError` a `popisChyby` (Claude) vrací jen typ chyby.

## 12. Známé mezery (k řešení před ostrým provozem)

1. `marketing.create_organization` může volat každý přihlášený.
2. `X-Cron-Secret = APP_SECRET` — zavést samostatný `CRON_SECRET`.
3. Callback Shotstacku se neověřuje podpisem — endpoint musí výsledek
   potvrdit vlastním dotazem, ne věřit tělu.
4. Webhook Meta (`/api/v1/webhooky/meta`) — ověřit `X-Hub-Signature-256`.
5. GDPR export/mazání — jen plán.
6. Kontrola `usable_until` / `consent_note` při publikaci — jen plán.
7. Rate limit na přihlášení a na `/api/v1/…` — aplikace nemá vlastní;
   Supabase Auth má limit na OTP, zbytek musí hlídat Vercel/WAF.
8. `response` u publikací ukládá `raw_response` do `publications` —
   ověřit, že adaptér Meta nevrací nic citlivého (dnes vrací jen ID).
