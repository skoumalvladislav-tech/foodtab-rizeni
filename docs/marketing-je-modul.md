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

**Hotovo 13. 9. 2026.** Složka je smazaná. Kdyby se z ní přece jen
něco hodilo — hlavně `docs/PRODUCT_ROADMAP.md`,
`docs/product-inspiration.md`, `docs/SOCIAL_API_LIMITS.md`,
`docs/PROVIDER_CATALOG.md` a osm hotových n8n workflow v `n8n/` —
leží to pořád v historii, v commitu `6cb7d72` a starších:

```bash
git show 6cb7d72:marketing-ai/docs/PRODUCT_ROADMAP.md
git checkout 6cb7d72 -- marketing-ai/n8n   # kdyby se měly vrátit
```

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

---

## 7. Zveřejňuje n8n, ne Foodtab

13. 9. 2026, po prověření. Doplněk k oddílu 2 — upřesňuje, co znamená
„API jen tam, kde opravdu vede ven".

### Co se zjistilo

Instagram Černé Perly **už je připojený a už se na něj publikuje** —
ne z Foodtabu, ale z n8n. Workflow „Černá Perla — denní obsah na sítě"
(`Z6wKMzqXAPUhuM19`) je aktivní a běží každý všední den v 8:00: vytáhne
denní menu, nechá OpenAI napsat text, vyrobí grafiku v Bannerbearu,
pošle e-mailem ke schválení a po schválení zveřejní přes
`graph.instagram.com` na účet `27920687187583900`. Staré příspěvky
z profilu maže.

Je to cesta „Instagram Login", ne přes facebookovou stránku. **Žádné
schvalování aplikace u Mety se tedy čekat nemusí** — dřívější odhad, že
to zdrží týdny, pro tenhle způsob neplatil.

Facebook: v n8n jsou tři přihlašovací údaje „Facebook Graph account",
ale tohle workflow ani jeden nepoužívá a na Facebook neposílá nic.

Ve Foodtabu nebylo nic: ani v repozitáři, ani v databázi.

### Rozhodnutí

**Foodtab s Instagramem nemluví.** Fronta zavolá webhook v n8n a n8n
zveřejní přístupem, který už drží.

| Kdo | Co dělá |
|---|---|
| Foodtab | rozhoduje CO a KDY — verze, schválení, fotky, plán, fronta |
| n8n | POŠLE to ven přístupem, který má |

Důvod není pohodlí. Kdyby si Foodtab zavedl vlastní přístup, byl by
týž token na dvou místech, obnovoval by se dvakrát a při odvolání by
se na jedno z nich zapomnělo.

Stávající workflow se proto osekává na „zveřejni, co přijde". Text,
schvalování a plán přebírá Foodtab.

### Čím to stojí a padá

1. **Idempotenční klíč.** Foodtab posílá `idempotencni_klic` a n8n si
   podle něj MUSÍ pamatovat, co už poslalo. Bez toho stačí, aby se
   odpověď ztratila cestou zpátky: Foodtab to vezme jako neúspěch, za
   pět minut zkusí znovu — a na Instagramu jsou dva stejné příspěvky.
   Zpátky se to vzít nedá. Zámek ve frontě tuhle díru nezavře; ten
   hlídá dva běhy Foodtabu, ne ztracenou odpověď.

2. **Firma a pobočka v každém požadavku.** Jeden webhook pro všechny
   firmy znamená, že příspěvek druhé restaurace odejde na Instagram té
   první. n8n podle nich vybírá účet a neznámou firmu odmítá.

3. **Dokud oboje běží, hrozí dva příspěvky denně.** Staré workflow
   a fronta Foodtabu o sobě nevědí. Zapínat se to smí až poté, co se
   staré workflow osekalo.

### Co je potřeba nastavit

| Proměnná | K čemu |
|---|---|
| `N8N_MARKETING_URL` | adresa webhooku v n8n |
| `N8N_MARKETING_TAJEMSTVI` | sdílené tajemství, chodí v hlavičce `x-foodtab-tajemstvi` |
| `MARKETING_KLIC_SIFRY` | 64 znaků hexadecimálně; šifrování zákaznických klíčů |

### Drobnost, která není drobnost

Přihlašovací údaj s instagramovým tokenem se v n8n jmenuje jen
„Authorization" a je typu hlavička HTTP. Takový údaj pošle hlavičku na
**jakoukoli** adresu, na kterou ho někdo připne. Kdyby ho příště někdo
omylem použil u uzlu mířícího jinam, odejde tam token k účtu. Chce to
přejmenovat na „Instagram — Černá Perla".

### Co v n8n vzniklo

Postaveno 13. 9. 2026, **neaktivní**. Stávající workflow „Černá Perla —
denní obsah na sítě" zůstalo nedotčené a běží dál.

| Co | Kde |
|---|---|
| Workflow | „Foodtab — zveřejnit příspěvek", `l9o955GDQVDBf8gc` |
| Adresa webhooku | `https://foodtab.app.n8n.cloud/webhook/foodtab-zverejnit` |
| Tabulka účtů | `foodtab_ucty`, `77Ob60K3II5QSZOa` |
| Tabulka odeslaných | `foodtab_zverejneno`, `PvDkrRLvFf8PLlwI` |

Cesta workflow: přečti požadavek → je celý? → **už jsme to poslali?**
→ najdi účet podle firmy a pobočky → vytvoř kontejner → počkej →
dozrál? → zveřejni → zapiš → potvrď. Každá slepá ulička odpovídá
srozumitelnou chybou, takže Foodtab nikdy nečeká naprázdno a fronta se
o úloze dozví, proč neodešla.

### Než se to zapne — pět kroků

1. **Vytvořit přihlašovací údaj `Foodtab do n8n`** (typ Header Auth):
   název hlavičky `x-foodtab-tajemstvi`, hodnota náhodné tajemství.
   Zakládání údaje s tajemstvím přes rozhraní nejde, musí se ručně.
2. **Přepnout ho na uzlu „Foodtab volá".** Při zakládání se tam sám
   přiřadil údaj „Authorization", což je ten instagramový — je to
   špatně, ale bezpečně: workflow by čekalo jinou hlavičku, než
   Foodtab posílá, a požadavek by odmítlo.
3. **Na třech uzlech IG vybrat údaj „Authorization"** (kontejner, stav,
   publikovat). Při zakládání se nepřipojily.
4. **Vyplnit `foodtab_ucty`** — jeden řádek: `tenant_id` a `branch_id`
   z Foodtabu, `sit` = `instagram`, `ucet_id` = `27920687187583900`.
   Bez řádku workflow odmítne a nic neodešle.
5. **Do prostředí Foodtabu** doplnit `N8N_MARKETING_URL` (adresa výš)
   a `N8N_MARKETING_TAJEMSTVI` (tajemství z kroku 1).

### A teprve pak

Zapnout se to smí až poté, co se staré workflow osekalo na „zveřejni,
co přijde" — jinak vyjdou dva příspěvky denně. Vyzkoušet se to dá
předtím nanečisto: příspěvek v režimu `demo` projde celou cestou
a nikam se neodešle.
