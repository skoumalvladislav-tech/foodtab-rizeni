# Propojení s FoodTab Řízení

Marketing AI vzniká jako samostatná aplikace, ale má se stát modulem
`marketing` FoodTab Řízení. Tenhle dokument říká, co je na to v kódu
připravené už teď, jaké jsou dvě možné varianty a co se musí dopsat.

Kontext modulu ve FoodTabu: `docs/marketing-zadani.md` v kořeni
repozitáře (modul `marketing` a jeho tři oprávnění `marketing.read`,
`marketing.manage`, `marketing.publish` existují v katalogu FoodTabu od
etapy 0, migrace `20260823120100_catalog.sql`).

## 1. Proč vlastní schéma `marketing`

FoodTab má vlastní `public.tenants`, `public.branches`, `profiles`,
`memberships`, `menus`, `audit_log`. Aby se při sloučení nic
nepřejmenovávalo, bydlí všechno z Marketingu ve schématu **`marketing`**
(migrace `20260908100000_zaklad.sql`). Při vložení do FoodTabu se
`marketing.organizations` nahradí pohledem na `public.tenants` a
`marketing.venues` pohledem na `public.branches`; zbytek schématu
zůstane.

## 2. Mapování identifikátorů

| Marketing AI | FoodTab Řízení | Sloupec pro vazbu (existuje už teď) |
|---|---|---|
| `marketing.organizations` (organizace) | `public.tenants` (firma) | `organizations.foodtab_tenant_id uuid` |
| `marketing.venues` (provozovna) | `public.branches` (pobočka) | `venues.foodtab_branch_id uuid` |
| `marketing.profiles.user_id` | `auth.users.id` (stejný Supabase Auth) | přímo — obě aplikace používají Supabase Auth, ID uživatele je totéž |
| `marketing.menus` | `public.menus` / jídelní lístky | `menus.foodtab_event_id text` (ID události, ze které menu vzniklo), `menus.source = 'foodtab'` |
| časové pásmo | `branches.timezone` → `tenants.timezone` → `Europe/Prague` | `venues.timezone` → `organizations.timezone` → `Europe/Prague` (stejné pravidlo, `lib/cas.ts`) |

Oprávnění Marketingu (19 klíčů v `marketing.permissions`) jsou jemnější
než tři oprávnění FoodTabu. Navržené mapování pro variantu 2:

| FoodTab | Marketing AI |
|---|---|
| `marketing.read` | `content.read`, `media.read`, `menu.read`, `analytics.read` |
| `marketing.manage` | + `content.create`, `content.approve`, `content.schedule`, `media.manage`, `media.share`, `menu.manage`, `templates.manage`, `brand.manage`, `campaigns.manage`, `integrations.use` |
| `marketing.publish` (citlivé) | + `content.publish` |
| správa firmy ve FoodTabu (`settings.*`, `people.*`) | `integrations.manage`, `team.manage`, `audit.read`, `settings.manage` |

Mapování je návrh k odsouhlasení — FoodTab rozhoduje o přístupu jedním
místem (`app.has_access`) a Marketing také (`marketing.has_access`).
Ve variantě 2 musí zůstat **jedno** místo; buď `marketing.has_access`
bude číst členství FoodTabu, nebo se role Marketingu odvodí z rolí
FoodTabu při synchronizaci.

## 3. Dvě varianty integrace

### Varianta 1 — samostatná aplikace, SSO a deep link

Marketing běží na vlastní doméně (např. `marketing.foodtab.cz`), FoodTab
na něj odkazuje z navigace (položka modulu `marketing`). Sdílený je
Supabase Auth (stejný projekt nebo propojené projekty), takže uživatel
přihlášený ve FoodTabu je přihlášený i tady.

Co je připravené:

- `FOODTAB_APP_URL` a `FOODTAB_ALLOWED_RETURN_ORIGINS` — jediné
  povolené cíle odkazů zpět (`lib/auth/kam.ts`: `odkazDoFoodtabu`,
  `jePovolenyNavrat`). Produkční doména není v komponentách.
- Bezpečný návrat po přihlášení: `?kam=` přijímá jen relativní cestu
  s jedním lomítkem; `//host`, `/\host`, `/api/…` a `/prihlaseni` se
  odmítají (`bezpecnyCil`). Deep link z FoodTabu tedy může být
  `https://marketing.foodtab.cz/prihlaseni?kam=/cerna-perla/kalendar`.
- Přihlášení e-mail + kód přes Supabase OTP, `shouldCreateUser: false`
  — účty vznikají jen pozvánkou (stejně jako ve FoodTabu).

Co chybí: skutečné SSO (předání session z FoodTabu bez druhého
přihlášení) a synchronizace členství. Do té doby má člověk v Marketingu
vlastní členství založené ručně.

### Varianta 2 — rozhraní vložené do FoodTabu, společný backend

Obrazovky Marketingu se přesunou pod `app/[rozsah]/marketing/…`
FoodTabu, databáze je jedna (schéma `marketing` vedle `public`),
`organizations`/`venues` jsou pohledy na `tenants`/`branches`.

Co je připravené:

- schéma je oddělené a nekoliduje s FoodTabem,
- `withUser` (`lib/db/session.ts`) nastavuje `request.jwt.claim.sub` a
  roli `authenticated` stejně, jako to dělá Supabase — politiky RLS se
  nemusí měnit,
- `lib/domena/*` nezná HTTP ani React; dá se volat ze server actions
  FoodTabu,
- vzhled: stejné zásady (`docs/vzhled-zadani.md`), ale CSS je
  v `app/globals.css` Marketingu zvlášť — při sloučení se převezmou
  tokeny FoodTabu.

Co chybí: pohledy `organizations`/`venues` nad `tenants`/`branches`
(včetně `instead of` triggerů pro zápis, nebo zákaz zápisu), sjednocení
`has_access`, přesun obrazovek, a rozhodnutí, zda `marketing.profiles`
zůstane nebo se nahradí `public.profiles`.

Doporučení: **začít variantou 1**, protože nevyžaduje zásah do
základu FoodTabu (a základ je závazně zmrazený). Varianta 2 až po
odzkoušení v provozu.

## 4. Události `menu.*` z FoodTabu (verze 1)

Zdroj pravdy o tom, co se vaří, je FoodTab (Jídelní lístky). Marketing
z něj **čte výsledek**, nikdy nerozhoduje o jídle. Přenos je událostmi
na `POST /api/v1/webhooky/foodtab`:

| Událost | Kdy | Co Marketing udělá |
|---|---|---|
| `menu.created` (v1) | ve FoodTabu vznikl lístek | založí `marketing.menus` jako `draft`, `source = 'foodtab'`, `foodtab_event_id` |
| `menu.updated` (v1) | lístek se změnil | přepíše položky konceptu; **potvrzené** menu nepřepisuje, založí nový koncept s odkazem |
| `menu.approved` (v1) | lístek byl ve FoodTabu schválený | nastaví `status = confirmed` (bez ručního potvrzení, protože schválení už proběhlo ve FoodTabu) |

Tělo události (smlouva v `openapi/openapi.yaml`, schéma
`FoodtabMenuEventV1`):

```json
{
  "version": 1,
  "type": "menu.approved",
  "event_id": "…uuid…",
  "occurred_at": "2026-09-09T05:00:00Z",
  "tenant_id": "…uuid FoodTab…",
  "branch_id": "…uuid FoodTab…",
  "menu": {
    "external_id": "…id lístku ve FoodTabu…",
    "kind": "daily",
    "title": "Denní menu 9. 9.",
    "valid_from": "2026-09-09",
    "valid_to": "2026-09-09",
    "currency": "CZK",
    "days": [],
    "items": [
      { "category": "polevka", "name": "Hovězí vývar", "description": "", "price_cents": 4500, "allergens": ["1","3","9"], "sort_order": 0 }
    ]
  }
}
```

Mapování `tenant_id` → `organizations.foodtab_tenant_id`,
`branch_id` → `venues.foodtab_branch_id`. Neznámá dvojice → 202 a
záznam do `webhook_events` s `result = 'unmapped'`, žádná výjimka
(FoodTab nemá důvod opakovat).

Ceny přicházejí v haléřích jako `integer` (stejné pravidlo jako ve
FoodTabu), chybějící cena je `null` a nikdy se nedomýšlí.

**Stav:** tabulka `menus` má sloupce `source = 'foodtab'` a
`foodtab_event_id`, katalog má položku `foodtab_menu` jako
„připravujeme“, `MenuSourceProvider.fetchMenus` je v rozhraní jako
volitelná metoda. Endpoint `/api/v1/webhooky/foodtab` se píše v rámci
API v1; adaptér `foodtab_menu` zatím **není**. Je to etapa 3
(`PRODUCT_ROADMAP.md`).

## 5. Ověření mezi službami (service-to-service)

Stejný mechanismus jako u n8n (`lib/providers/workflow.ts`,
`overitPodpisWebhooku`):

```
X-FoodTab-Timestamp:       unixové sekundy
X-FoodTab-Signature:       hex(HMAC-SHA256(FOODTAB_WEBHOOK_SECRET, timestamp + "." + body))
X-FoodTab-Idempotency-Key: event_id
```

- Tajemství `FOODTAB_WEBHOOK_SECRET` je společné pro FoodTab a
  Marketing, drží se jen v prostředí obou serverů (u FoodTabu jako
  servisní klíč agenta — otisk, ne čitelná hodnota, pravidlo 7).
- Podpis pokrývá časovou značku i tělo — nejde vzít podepsané tělo a
  poslat ho s jinou značkou.
- Porovnání v konstantním čase.

Kód `FOODTAB_WEBHOOK_SECRET` dnes **nečte** — počítá s ním API v1.

## 6. Ochrana proti přehrání a idempotence

1. **Časové okno 5 minut** (300 s) — starší nebo budoucí značka se
   odmítne. Hodiny obou serverů musí být synchronizované (NTP);
   při větším rozdílu všechno padá na 401 a je to vidět hned.
2. **`marketing.webhook_events`** s `unique (provider_key,
   external_event_id)` — `event_id` události se zapíše před
   zpracováním; druhé doručení téže události (opakování FoodTabu po
   timeoutu) narazí na unikátní index a vrátí 200 bez práce.
   Tabulka nemá žádný grant pro `authenticated`; zapisuje se pod
   `withService`.
3. `signature_ok` v `webhook_events` se zapisuje i u odmítnutých
   událostí, aby byl vidět pokus.
4. `result` a `processed_at` říkají, co se s událostí stalo
   (`created`, `updated`, `confirmed`, `unmapped`, `ignored`).

Opačným směrem (Marketing → FoodTab, např. „příspěvek zveřejněn“)
zatím nic neposíláme; kdyby se to hodilo, platí stejný podpis a
FoodTab si vede vlastní evidenci událostí.

## 7. Co je v kódu připravené už teď — shrnutí

| Připraveno | Kde |
|---|---|
| vlastní schéma `marketing`, `foodtab_tenant_id`, `foodtab_branch_id` | `20260908100000_zaklad.sql` |
| stejný model přístupu (jedno místo, role jako data, RLS na všem, rozsah z prohlížeče je návrh, mazání lidí označením) | `marketing.has_access`, `lib/authz.ts` |
| stejný Supabase Auth, OTP bez zakládání účtů | `lib/auth/session.ts`, `app/prihlaseni/akce.ts` |
| bezpečný odkaz zpět a povolené originy | `lib/auth/kam.ts` |
| čas s povinným pásmem, stejné pravidlo pásma provozovny | `lib/cas.ts` |
| `menus.source = 'foodtab'`, `foodtab_event_id` | `20260908100200_obsah.sql` |
| položka katalogu `foodtab_menu` (planned) | `20260908100300_katalog_providery.sql` |
| ověření podpisu s časovým oknem a idempotence webhooků | `lib/providers/workflow.ts`, `marketing.webhook_events` |
| smlouva události `menu.approved` v1 | `openapi/openapi.yaml` |

| Chybí | Poznámka |
|---|---|
| endpoint `/api/v1/webhooky/foodtab` | API v1 se píše souběžně |
| adaptér `foodtab_menu` | etapa 3 |
| SSO / předání session | varianta 1 |
| synchronizace členství a mapování oprávnění | rozhodnutí Šéfíka |
| pohledy `organizations`/`venues` nad `tenants`/`branches` | varianta 2 |
| odesílání událostí z FoodTabu (strana FoodTabu) | patří do větve `marketing` FoodTabu, ne sem |
