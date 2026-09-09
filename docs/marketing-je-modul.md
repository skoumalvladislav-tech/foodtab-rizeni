# Rozhodnutí: marketing je modul Foodtabu, ne vlastní aplikace

9. 9. 2026. Ruší se stavba samostatné aplikace „FoodTab Marketing AI“
(složka `marketing-ai/`) a nahrazuje ji modul uvnitř Foodtabu.

> **Poznámka k tomuhle souboru.** Šéfík rozhodnutí sdělil v zadání
> a odkázal na tuhle cestu, ale soubor v repozitáři nebyl — ani na
> `main`, ani na žádné větvi. Je proto sepsaný podle toho zadání
> a podle toho, co se dalo ověřit v kódu a v databázi. Kdyby existovala
> Šéfíkova vlastní verze, platí ona a tahle se přepíše.

---

## 1. Rozhodnutí

**Marketing je modul Foodtabu. Jedno přihlášení, jedna databáze, jeden
vzhled.**

Použije se **nový** modul postavený jako `marketing-ai/`. Starý modul
(migrace `20260903040000_marketing_tabulky.sql`) se opouští — ověřeno,
že je prázdný.

Ověření z 9. 9. 2026 proti `spekntcsuroqhehmjssv`:

| tabulka | řádků |
|---|---|
| `marketing_settings` | 0 |
| `marketing_integrations` | 0 |
| `marketing_photos` | 0 |
| `marketing_templates` | 0 |
| `marketing_posts` | 0 |

Nezahazuje se tedy nic, co by kdokoli zadal.

## 2. Co se ruší a co platí

**Ruší se** — všechno, co v samostatné aplikaci existovalo jen proto,
že stála vedle Foodtabu:

| Ruší se | Proč |
|---|---|
| Vlastní projekt Supabase | Jedna firma, jedna databáze. Marketing musí vidět na jídelníček a pobočky přímo, ne přes API. |
| Vlastní aplikace (`marketing-ai/`) | Druhý Next.js projekt vedle prvního znamená dvojí nasazení, dvojí závislosti a dvojí údržbu. |
| Vlastní přihlášení a demo režim | Uživatel se přihlašuje jednou. Demo účty a PGlite byly berlička pro aplikaci bez Foodtabu. |
| Vlastní API v1 pro rozhraní | Obrazovka a databáze jsou na stejném serveru. HTTP mezi nimi je zbytečná vrstva, která jen umí selhat. |
| Vlastní vzhled a tokeny | Vzhled je jeden — `docs/vzhled-zadani.md` a `docs/vzhled-oprava-1.md`. |

**Platí:**

| Platí | Konkrétně |
|---|---|
| Databáze | `spekntcsuroqhehmjssv` (`foodtab-test`), schéma `public` |
| Obrazovky | `app/[rozsah]/marketing` |
| Přihlášení a kontext | Stávající sezení Supabase, `public.my_context` |
| Oprávnění | `marketing.read`, `marketing.manage`, `marketing.publish` — existují od `20260823120100_catalog.sql`, nová se nezakládají |
| Hosting | Vercel (jako zbytek Foodtabu) |

**API zůstává jen tam, kde opravdu vede ven** — n8n a poskytovatelé
(webhooky, OAuth Meta, cron fronty). Nic z toho neobsluhuje obrazovku.

## 3. Úklid po starém modulu

Dvě věci, jinak by po opuštěném modulu zůstaly tiché zbytky:

1. **Migrace, která zahodí pět prázdných tabulek.** `marketing_settings`,
   `marketing_integrations`, `marketing_photos`, `marketing_templates`,
   `marketing_posts`. Modul `marketing` ani jeho tři oprávnění se
   neruší — ty jsou z `20260823120100_catalog.sql` a nový modul je
   používá dál.

2. **`supabase/tests/marketing1_scenar.sql` přepsat, nebo zrušit.**
   Scénář dnes testuje právě těch pět tabulek. Kdyby zůstal, byl by to
   přesně případ ze skillu `scenar`, oddíl 6: *kontrola, která zůstane
   zelená a přestane měřit*. Přepisuje se na kontrolu proti návratu —
   že tabulky opravdu nejsou a že modul a jeho práva dál platí.

## 4. Co se převádí a v jakém pořadí

Převod je velký a dělá se po částech, aby šla každá vrátit:

1. úklid (oddíl 3),
2. schéma: tabulky do `public` s `tenant_id`/`branch_id`, českými názvy
   podle konvence provozních modulů, RLS přes `app.has_access`,
   jmenovité granty, spoušť `app.audit_zmenu`,
3. obrazovky v `app/[rozsah]/marketing` — server komponenty přes
   `zkusPristup` a `seznam`/`jeden`/`pruzor`, akce jako server actions,
4. poskytovatelé a rozhraní ven (n8n, Meta, Claude, Shotstack, převod
   SVG na PNG),
5. **až úplně nakonec** smazat `marketing-ai/` a její stopy
   (`tsconfig.json`, `eslint.config.mjs`, odstavec v README). Dřív ne —
   je to předloha, ze které se převádí.

## 5. Co se tím mění proti samostatné aplikaci

Věci, které se převodem nedají zachovat jedna k jedné. Ať to za rok
nikdo nebere jako nedodělek:

- **Vlastní tabulka organizací a členství mizí.** Firma je `tenants`,
  pobočka `branches`, člověk `employees` + `memberships`. Marketing si
  je nezakládá znovu.
- **Vlastní role a oprávnění mizí.** Rozhoduje `app.has_access(firma,
  právo, pobočka)` — jediné místo (pravidlo 2). Tři marketingová práva
  už v katalogu jsou.
- **Rozsah je firma nebo pobočka**, ne „organizace a provozovna“ zvlášť.
  Řídí se `[rozsah]` v adrese, ověřeným proti členství (pravidlo 4).
- **Šifrovaná tajemství poskytovatelů** zůstávají — jsou to zákaznické
  klíče, ne provozní data. Ukládají se jako otisk a čitelný klíč
  neopustí server (pravidla 6 a 7).
- **Pozvánky k založení organizace** (`create_founder_invitation`) se
  nepřevádějí. Firmu ve Foodtabu zakládá `app.create_tenant`, a jeho
  omezení je vedené zvlášť v „Před ostrým provozem“.
- **Vlastní e-mail, úložiště a fronta** se nepřevádějí zvlášť — použije
  se Resend, Supabase Storage a fronta Foodtabu.

## 6. Nasazení

**Nenasazuje se odsud.** `supabase db push` pouští Šéfík z `main`
(skill `nasazeni`, CLAUDE.md — „Nasazuje Šéfík, ne push“).
