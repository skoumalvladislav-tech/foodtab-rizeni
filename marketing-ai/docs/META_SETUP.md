# Připojení Instagramu a Facebooku (Meta)

Adaptér `meta_graph` (`lib/providers/social/meta.ts`) publikuje přímo
přes Meta Graph API na **Facebook Page** a **profesionální Instagram
účet** (Business nebo Creator) propojený s tou stránkou. Stejné
připojení používá i `meta_insights` pro metriky.

> **Důležité upozornění o stavu.** Adaptér je napsaný, ale **nebyl
> spuštěn proti skutečnému Meta API** — nejsou k dispozici klíče ani
> testovací aplikace. Endpointy, parametry a názvy oprávnění vycházejí
> z ustálených verzí Graph API a jsou na jednom místě v konstantě
> `META` (a ve funkcích `publishInstagram` / `publishFacebook`).
> Z vývojového prostředí **nešlo otevřít developers.facebook.com**
> (síť ho blokuje), takže odkazy níže jsou vstupní adresy dokumentace
> zadané z paměti. Před ostrým nasazením projděte oddíl
> „Co ověřit ručně“.

Vstupní adresy dokumentace (neověřené):

- https://developers.facebook.com/docs/instagram-platform/
- https://developers.facebook.com/docs/pages-api/
- https://developers.facebook.com/docs/facebook-login/
- https://developers.facebook.com/docs/graph-api/

## 1. Předpoklady na straně restaurace

1. **Facebook Page** restaurace (ne osobní profil).
2. **Instagram Business nebo Creator účet** — osobní účet přes API
   publikovat nejde. Přepnutí je v aplikaci Instagram: Nastavení →
   Typ účtu.
3. Instagram účet je **propojený s Facebook Page** (Nastavení stránky
   → Propojené účty → Instagram). Adaptér ho hledá právě přes stránku
   (`/me/accounts` s polem `instagram_business_account`).
4. Uživatel, který připojení dělá, má na stránce roli s právem
   spravovat obsah (u nového Business Manageru „Úplná kontrola“ nebo
   aspoň „Obsah“).

Bez těchto čtyř věcí `listAccounts()` vrátí stránku bez Instagramu a
publikace na Instagram skončí chybou „Chybí připojený účet“.

## 2. Meta aplikace (jednorázově, dělá FoodTab)

1. https://developers.facebook.com/ → *My Apps → Create App*, typ
   **Business**.
2. Přidat produkt **Facebook Login for Business** (varianta pro firemní
   účty; klasický Facebook Login pro tenhle případ Meta postupně
   omezuje) a **Instagram** (Instagram API with Facebook Login).
3. V nastavení Facebook Login → *Valid OAuth Redirect URIs* přidat:

   ```
   {APP_URL}/api/v1/meta/oauth/callback
   ```

   pro každé prostředí zvlášť (test i produkce; localhost jde jen přes
   HTTPS tunel).
4. *App settings → Basic*: App ID a App Secret →
   `META_APP_ID`, `META_APP_SECRET`. **App Secret nikdy do prohlížeče
   ani do gitu.**
5. Vyplnit Privacy Policy URL, Data Deletion URL a kategorii aplikace —
   bez nich App Review nepustí.

## 3. Oprávnění (`META.scopes`)

Aplikace žádá přesně tato oprávnění (z kódu):

| Oprávnění | K čemu ho adaptér používá |
|---|---|
| `pages_show_list` | seznam stránek uživatele (`/me/accounts`) |
| `pages_read_engagement` | čtení metrik příspěvků stránky |
| `pages_manage_posts` | zveřejnění na stránku (`/{page}/feed`, `/photos`, `/videos`) |
| `instagram_basic` | ID a jméno IG účtu propojeného se stránkou |
| `instagram_content_publish` | vytvoření kontejneru a publikace (`/{ig}/media`, `/media_publish`) |
| `instagram_manage_insights` | metriky IG příspěvků (`/{id}/insights`) |
| `business_management` | přístup přes Business Manager (**ověřit, jestli je opravdu nutné** — je to široké oprávnění a App Review ho zdůvodňuje hůř) |

Dokud aplikace neprojde **App Review**, fungují oprávnění jen pro
uživatele s rolí v aplikaci (Admin / Developer / Tester) — to stačí na
vlastní testování, ne pro zákazníky. Pro Advanced Access je potřeba
ověření firmy, popis použití a video ke každému oprávnění.

## 4. Tok připojení v aplikaci

1. Uživatel s `integrations.manage` klikne v Integracích na „Připojit
   Instagram a Facebook“ → `GET /api/v1/meta/oauth/start`.
2. Server vygeneruje náhodný **`state`**, uloží ho do session (nebo
   podepsané cookie) a přesměruje na
   `https://www.facebook.com/{v}/dialog/oauth?client_id=…&redirect_uri=…&state=…&response_type=code&scope=…`
   (`metaOauthUrl`).
3. Meta vrátí `code` a `state` na `/api/v1/meta/oauth/callback`.
   Server **ověří `state`** (jinak odmítne) a vymění kód:
   - `GET /oauth/access_token?client_id&client_secret&redirect_uri&code`
     → krátkodobý token,
   - `GET /oauth/access_token?grant_type=fb_exchange_token&…`
     → dlouhodobý uživatelský token (`metaExchangeCode`).
4. `listAccounts()` zavolá `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}`.
   Uživatel vybere stránku a IG účet; každý vybraný účet se uloží do
   `marketing.social_accounts` (ID, jméno, uživatelské jméno,
   capabilities) — **bez tokenu**.
5. Tokeny se zašifrují (`encryptCredentials`) jako
   `{ access_token, page_tokens: JSON {pageId: pageToken} }` a uloží
   přes `marketing.store_secret`. Do `integration_connections` jde jen
   jméno uživatele a ID (`external_account`), udělená oprávnění a
   `expires_at`.

## 5. Nepublikační test připojení

`testConnection()` volá `/me?fields=id,name` a — když jsou nastavené
`META_APP_ID` a `META_APP_SECRET` — `/debug_token` s app tokenem
`{app_id}|{app_secret}`. Z odpovědi bere `scopes`, `expires_at` a
`is_valid`. Nic nezveřejní. Výsledek se ukládá do `last_test_at`,
`last_test_ok`, `granted_scopes`, `expires_at`.

## 6. Expirace tokenu a obnovení

- Dlouhodobý uživatelský token platí zpravidla **60 dní**; Page tokeny
  získané z dlouhodobého tokenu bývají bez expirace, ale zneplatní se
  změnou hesla, odebráním role nebo odvoláním aplikace.
- Adaptér nemá automatickou obnovu. Při chybě s kódem **190** označí
  publikaci `failed` s hláškou „Token vypršel… Připojte účet znovu“ a
  fronta nastaví obsah do stavu `connection_required`.
- Workflow `n8n/connection-health.json` (volitelné) hlídá `expires_at`
  a upozorní 7 dní předem. Bez n8n to musí hlídat člověk v Integracích.

## 7. Co adaptér umí a jak to dělá

| Formát | Volání |
|---|---|
| IG feed | `POST /{ig}/media {image_url, caption}` → čekání na `status_code=FINISHED` → `POST /{ig}/media_publish {creation_id}` |
| IG carousel | až 10× `POST /{ig}/media {image_url \| video_url, is_carousel_item=true}` → `POST /{ig}/media {media_type=CAROUSEL, children, caption}` → publish |
| IG Reel | `POST /{ig}/media {media_type=REELS, video_url, caption, share_to_feed=true}` → publish |
| IG Story | `POST /{ig}/media {media_type=STORIES, image_url \| video_url}` → publish (**jen profesionální účty**) |
| FB příspěvek s fotkou | `POST /{page}/photos {url, message}` (Page token) |
| FB text | `POST /{page}/feed {message}` |
| FB video / Reel | `POST /{page}/videos {file_url, description}` |
| FB plánování | `published=false, scheduled_publish_time=<unix>` když je termín > 10 min v budoucnu |

Kontejner se hlídá až 20× po 3 s (60 s); u delšího videa to nemusí
stačit — pak publikace skončí jako `failed` a fronta ji zopakuje.

Média se Meta předávají **odkazem** (`image_url`, `video_url`,
`file_url`) na podepsanou adresu aplikace
`{APP_URL}/api/v1/media/{id}/soubor?exp&sig` s platností 24 h. Proto
musí být `APP_URL` veřejně dosažitelná a soubor musí být v podporovaném
formátu. Vestavěné vykreslení proto vrací **PNG** (u objemných
obrázků JPEG) — SVG by Meta nepřijala. SVG zůstává jen u tiskových
formátů A4/A5, které se nikam nepublikují.

Rate limit: chybové kódy 4, 17, 32, 613 nebo HTTP 429 → `retry` za
15 minut; fronta má vlastní exponenciální odstup a strop `max_attempts`
(5), pak `dead_letter`.

## 8. Co ověřit ručně před ostrým nasazením

Projděte proti aktuální dokumentaci a upravte **jen konstanty v kódu**
(`META` v `meta.ts`, `FORMATY` v `lib/formaty.ts`):

1. **Verze Graph API** — v kódu `v21.0` (`META_GRAPH_VERSION`). Meta
   verze každé čtvrtletí vydává a po ~2 letech vypíná. Nastavte
   nejnovější podporovanou a ověřte, že všechna volání níže v ní
   existují.
2. **Názvy oprávnění** v `META.scopes` — zvlášť `business_management`
   (nutné?) a zda pro Instagram přes Facebook Login stále platí
   `instagram_basic` + `instagram_content_publish` +
   `instagram_manage_insights`, nebo zda Meta přešla na jiné názvy.
3. **Facebook Login for Business** vs. klasický Facebook Login — který
   produkt je pro Business aplikace vyžadovaný a jaký je správný
   `config_id`/dialog (kód používá klasický `dialog/oauth`).
4. **OAuth endpointy**: `/oauth/access_token` pro výměnu kódu a
   `grant_type=fb_exchange_token` pro dlouhodobý token; formát odpovědi
   (`expires_in`).
5. **`/me/accounts`** a pole `instagram_business_account{id,username,name}`
   — zda se IG účet stále získává přes stránku.
6. **Instagram Content Publishing**: parametry `media_type` (`REELS`,
   `STORIES`, `CAROUSEL`), `is_carousel_item`, `share_to_feed`,
   `children`, hodnoty `status_code` (`FINISHED`, `ERROR`, `IN_PROGRESS`,
   `PUBLISHED`, `EXPIRED`), a zda Story přes API vyžaduje další
   oprávnění nebo typ účtu.
7. **Limit publikací** — v kódu `igPublishLimitPer24h = 50`; ověřit
   aktuální hodnotu a to, zda platí na kontejnery nebo publikace, a
   jak zjistit spotřebu (`/{ig}/content_publishing_limit`).
8. **Pages API**: `/{page}/photos {url,message}`, `/{page}/feed`,
   `/{page}/videos {file_url,description}` a parametry plánování
   (`published`, `scheduled_publish_time` — omezení 10 min až 30 dní?).
9. **Insights**: názvy metrik `reach,impressions,likes,comments,shares,saved`
   pro IG (některé metriky Meta přejmenovala/zrušila, např.
   `impressions` → `views`) a `post_impressions,post_impressions_unique,post_engaged_users`
   pro FB.
10. **Chybové kódy** používané pro retry (4, 17, 32, 613, 190).
11. **Formáty médií**: povolené MIME/rozměry pro `image_url`
    (JPEG; PNG?), délka a rozlišení Reels, poměry stran — proti
    `lib/formaty.ts`.
12. **App Review**: seznam požadovaných podkladů a zda testovací
    publikace na vlastní účet jde bez review (role Tester).
13. **Webhook `/api/v1/webhooky/meta`** — jestli se použije
    (Meta posílá aktualizace stavu videí a odvolání oprávnění;
    vyžaduje ověřovací `hub.challenge` a podpis `X-Hub-Signature-256`).

Dokud tohle neproběhne, považujte připojení Meta za **neotestované** a
nechte zákazníkům režim `manual_export` (stažení souboru a textu), který
funguje vždy.
