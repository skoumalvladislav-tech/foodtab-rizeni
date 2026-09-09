# Nasazení

Cílové prostředí: **Vercel** (aplikace) + **Supabase Frankfurt**
(databáze, Auth, Storage). FoodTab Řízení míří na Hetzner + Coolify;
Marketing AI zatím na Vercel, protože je to samostatná aplikace a
Vercel má vestavěný cron. Přesun na Coolify je možný (běžný Next.js),
jen cron by převzal n8n nebo systémový cron.

## 1. Vercel — projekt

1. *Add New → Project* z repozitáře `foodtab-rizeni`.
2. **Root Directory: `marketing-ai`** — bez toho Vercel sestaví
   FoodTab, ne Marketing. Framework preset Next.js se pozná sám.
3. Node.js verze: 22.x (`engines` v `package.json`).
4. Build command výchozí (`next build`). `next.config.ts` má
   `outputFileTracingRoot` na složku projektu, aby se do balíku
   nedostal mateřský repozitář.
5. `serverExternalPackages: ["@electric-sql/pglite", "postgres"]` —
   PGlite se v produkci nepoužije (je nastavená `DATABASE_URL`), ale
   balík zůstává v závislostech; není to chyba.

## 2. Proměnné prostředí na Vercelu

Nastavte pro **Production** a **Preview** zvlášť — preview míří na
testovací Supabase, production na ostrý. Seznam a význam je
v `SETUP.md`; produkční minimum:

| Proměnná | Production |
|---|---|
| `APP_MODE` | `production` |
| `APP_URL` | `https://marketing.foodtab.cz` (veřejná adresa) |
| `APP_SECRET` | náhodných 32+ znaků |
| `CRON_SECRET` | náhodných 32+ znaků, **jiných než `APP_SECRET`** |
| `CREDENTIALS_ENCRYPTION_KEY` | 64 hex znaků |
| `DATABASE_URL` | transaction pooler ostrého projektu |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ostrý projekt |
| `SUPABASE_SERVICE_ROLE_KEY` | ostrý projekt, **Sensitive** |
| `SUPABASE_STORAGE_BUCKET` | `marketing-media` |
| `FOODTAB_APP_URL` | adresa FoodTab Řízení |
| `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` | až po ověření (`META_SETUP.md`) |
| `ANTHROPIC_API_KEY`, `SHOTSTACK_API_KEY`, `SHOTSTACK_ENV` | jen pokud FoodTab drží klíče (`foodtab_managed`) |
| `N8N_BASE_URL`, `N8N_WEBHOOK_SECRET` | jen s n8n |

Všechna tajemství označte jako **Sensitive** (Vercel je pak nezobrazí).
`NEXT_PUBLIC_*` jsou veřejné — sem nikdy servisní klíč.

Bez `APP_SECRET` a `CREDENTIALS_ENCRYPTION_KEY` aplikace
v `APP_MODE=production` při prvním použití vyhodí chybu — je to
schválně, ne „nastavíme později“.

## 3. Supabase

Postup je v `SUPABASE_SETUP.md`: projekt, `supabase db push` z
`marketing-ai/supabase/migrations`, bucket `marketing-media`, Auth OTP
s vlastním SMTP. Migrace nasazuje **člověk z lokálního počítače**
CLI — ne workflow z GitHubu (stejné rozhodnutí jako u FoodTabu: klíče
pro automatické nasazení až po oddělení ostrých dat od testu).

## 4. Fronta — cron pro `/api/v1/ulohy/zpracovat`

Fronta (`lib/domena/fronta.ts`) neběží sama. Něco ji musí pravidelně
zavolat: `/api/v1/ulohy/zpracovat` s hlavičkou `X-Cron-Secret:
<CRON_SECRET>` nebo `Authorization: Bearer <CRON_SECRET>`. Každý běh
dokončí čekající rendery, zveřejní splatné publikace a zopakuje
selhané (nejvýš 50 úloh na běh).

**`CRON_SECRET` je vlastní tajemství, ne `APP_SECRET`.** Jedno tajemství
nemá sloužit dvěma věcem — `APP_SECRET` podepisuje cookie a adresy
médií. Když `CRON_SECRET` chybí nebo je kratší než 16 znaků, cron cesta
se **nezapne**: volání bez přihlášení dostane 401. Není to výpadek, je
to schválně.

**Vercel Cron** — v repozitáři je `marketing-ai/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/v1/ulohy/zpracovat?automatizace=1", "schedule": "*/5 * * * *" },
    { "path": "/api/v1/analytika/synchronizovat", "schedule": "0 4 * * *" },
    { "path": "/api/v1/integrace/test-vse", "schedule": "0 5 * * *" }
  ]
}
```

Vercel posílá **GET** a hlavičku `Authorization: Bearer <CRON_SECRET>`
přidá sám, jakmile je proměnná nastavená — nic dalšího se nenastavuje.
Interval 5 minut; na tarifu Hobby dovoluje Vercel jen denní cron, pak
je nutný n8n nebo tarif Pro.

**Tlačítko v aplikaci** spustí frontu taky, ale jen pro organizace
přihlášeného uživatele a jen když má právo publikovat. Pozorovatel
frontu nespustí a cizí firmě do ní nesáhne.

**n8n** — `n8n/scheduled-social-publish.json` volá totéž každých
5 minut (`N8N_SETUP.md`).

Termíny: publikace naplánovaná na 18:00 se zveřejní při prvním běhu
fronty po 18:00, tedy nejpozději v 18:05. Kdo potřebuje přesněji,
zkrátí interval.

## 5. Domény a Cloudflare

DNS, TLS a ochrana přes Cloudflare (stejně jako FoodTab), režim
DNS-only nebo proxy — proxy je v pořádku, aplikace nespoléhá na IP
klienta. Callbacky (`/api/v1/webhooky/*`, `/api/v1/meta/oauth/callback`)
a podepsané adresy médií musí projít — nezapínejte na nich Bot Fight
Mode ani challenge, Shotstack a Meta jsou „boti“.

## 6. Zálohy a obnova

- **Supabase denní zálohy** (tarif Pro). PITR až s modulem Finance.
- **Vlastní dump mimo Supabase**, aspoň týdně:

  ```bash
  supabase db dump --linked -f zaloha-$(date +%F).sql
  supabase db dump --linked --data-only -f zaloha-data-$(date +%F).sql
  ```

  uložit do úložiště mimo Supabase (Hetzner Storage Box, šifrovaně).
- **Storage**: soubory v bucketu Supabase zálohou databáze nejsou.
  `supabase storage` CLI nebo `rclone` proti S3 endpointu bucketu,
  stejný interval.
- **Klíče**: `CREDENTIALS_ENCRYPTION_KEY` a `APP_SECRET` do správce
  hesel. Bez `CREDENTIALS_ENCRYPTION_KEY` jsou po obnově všechna
  připojení nečitelná (zákazníci by museli klíče zadat znovu).

**Obnova:** nový projekt Supabase → `supabase db push` (schéma) →
`psql < zaloha-data.sql` → nahrát soubory do bucketu → stejné proměnné
prostředí (stejný šifrovací klíč!) → ověřit `GET /api/v1/health` a
jednu podepsanou adresu média.

Zkuste obnovu **jednou nanečisto** do testovacího projektu dřív, než
bude potřeba doopravdy.

## 7. Oddělení prostředí

| | Vercel | Supabase | Klíče |
|---|---|---|---|
| Preview (větve, PR) | automaticky | `foodtab-marketing-test` | testovací |
| Production (`main`) | ručně povýšit / auto z `main` | `foodtab-marketing-prod` | ostré |

Ostrá data a testovací data nikdy v jednom projektu. Nasazuje se
z `main`; větve druhé relace (`marketing`) se nejdřív slijí.

## 7b. První organizace a pozvánky pro další

`marketing.create_organization` smí zavolat každý přihlášený účet — u
Supabase i přímo přes PostgREST, mimo aplikaci. Aby si v ostré databázi
nemohl kdokoli založit vlastní firmu, platí:

* **První** organizaci na prázdné databázi lze založit bez pozvánky.
  Přihlaste se svým účtem a zavolejte funkci se dvěma parametry —
  třetí (token) nechte prázdný.
* **Každou další** jen na pozvánku vystavenou na e-mail zakladatele.
  Pozvánku vystaví servisní role (SQL editor Supabase):

  ```sql
  select marketing.create_founder_invitation('sef@nova-restaurace.cz', 'Nová restaurace', 14);
  ```

  Vrácený token si opište — v databázi leží **jen jeho otisk** a už se
  nikdy nezobrazí. Platnost 14 dní, jedno použití.

Tabulka `marketing.founder_invitations` nemá pro roli `authenticated`
žádné oprávnění: přihlášený uživatel do ní nevidí ani pozvánku
nevystaví.

## 7c. Písma pro převod obrázků

Vykreslené SVG se před publikací převádí na PNG (Instagram ani Facebook
SVG nepřijmou). Sazbu dělá fontconfig zabalený uvnitř `sharp` a písma
jsou v repozitáři: `marketing-ai/assets/fonty` (Archivo a Newsreader,
licence OFL, licenční texty tamtéž).

Do nasazeného balíčku se dostanou přes `outputFileTracingIncludes`
v `next.config.ts`. Kdyby tam chyběla, render **skončí chybou**
a napíše proč — místo aby rozeslal příspěvky vysázené cizím písmem.
Vlastní nastavení písem jde vnutit proměnnou `FONTCONFIG_PATH`
(složka se souborem `fonts.conf`).

## 8. Kontrolní seznam před ostrým provozem

Databáze a přístup

- [ ] `supabase db push` proběhlo, historie migrací sedí se složkou
- [ ] Advisors: žádná tabulka `marketing.*` bez RLS
- [ ] první organizace založená (na prázdné databázi to jde bez pozvánky), každá další jen přes `marketing.create_founder_invitation` — viz níž
- [ ] první organizace a provozovny založené, vlastník se přihlásí OTP
- [ ] demo seed **není** v databázi (`select count(*) from marketing.organizations where is_demo`)

Tajemství

- [ ] `APP_MODE=production`, `APP_SECRET`, `CRON_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` nastavené, každé jiné a jiné než v testu
- [ ] `SUPABASE_SERVICE_ROLE_KEY` jen jako Sensitive, ne v `NEXT_PUBLIC_*`
- [ ] klíče zálohované ve správci hesel

Poskytovatelé

- [ ] Meta: verze Graph API, oprávnění a endpointy ověřené proti dokumentaci (`META_SETUP.md`, „Co ověřit ručně“), App Review hotové nebo zákazníci na `manual_export`
- [ ] Shotstack: `v1` klíč, callback dosažitelný, testovací render proběhl
- [ ] Claude: test připojení proběhl, `ANTHROPIC_MODEL` platný
- [ ] n8n (pokud je): `/healthz` dostupné, tajemství shodné, Error Workflow nastavený
- [ ] po prvním renderu zkontrolovat, že výstupní médium je `image/png` (ne `image/svg+xml`) — kdyby se do balíčku nedostala složka `assets/fonty`, render skončí chybou a řekne to

Provoz

- [ ] `CRON_SECRET` nastavené a cron na `/api/v1/ulohy/zpracovat` běží (Vercel nebo n8n), v logu je vidět každých 5 minut
- [ ] `GET /api/v1/health` vrací 200
- [ ] `APP_URL` veřejně dosažitelná, podepsaná adresa média jde otevřít zvenčí a po vypršení vrací 403
- [ ] Cloudflare nepřekáží callbackům
- [ ] jedna publikace na testovací účet zákazníka proběhla v ostrém prostředí a v Integracích ukazuje skutečný stav
- [ ] záloha + obnova vyzkoušené nanečisto
- [ ] `npm run check` zelený na commitu, který se nasazuje (s vědomím, že `npm test` a `test:e2e` dnes nemají složky)
