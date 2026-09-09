# Supabase — založení a nastavení

Produkční i testovací databáze, Auth a Storage běží na Supabase.
Lokálně se nic z toho nepotřebuje (PGlite, disk, demo přihlášení) —
tenhle postup je pro **testovací a ostré prostředí**.

Odkaz na dokumentaci: https://supabase.com/docs (vstupní adresa zadaná
z paměti; z vývojového prostředí nešla ověřit).

## 1. Projekt

1. Založte projekt v organizaci FoodTab, **region Frankfurt (eu-central-1)**
   — stejně jako FoodTab Řízení (závazné rozhodnutí v `CLAUDE.md`).
2. Doporučené pojmenování: `foodtab-marketing-test` a později
   `foodtab-marketing-prod`. Testovací a ostrá data **nikdy** v jednom
   projektu (viz `SECURITY.md`, oddělení prostředí).
3. Zapište si:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - anon key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - service_role key → `SUPABASE_SERVICE_ROLE_KEY` (**jen server**)
   - heslo databáze → do `DATABASE_URL`

`DATABASE_URL` použijte z karty *Connect* → **Transaction pooler**
(port 6543). Ovladač `lib/db/postgres.ts` má `prepare: false` právě
proto, že PgBouncer připravené příkazy nepodporuje. Přímé připojení
(port 5432) funguje také, ale na Vercelu s krátkými funkcemi je pooler
vhodnější.

## 2. Migrace — výhradně přes Supabase CLI

```bash
npm install -g supabase        # nebo npx supabase
cd marketing-ai
supabase login
supabase link --project-ref <ref projektu>
supabase db push
```

CLI vezme soubory ze `marketing-ai/supabase/migrations/` (čtyři migrace
z 8. 9. 2026: základ, providery, obsah, katalog) a zapíše je do
historie migrací projektu. **Nikdy je nevkládejte ručně do SQL
editoru** — bez zápisu do historie by se příště zkusily pustit znovu
a spadly by na `create schema marketing`.

Migrace **nezakládají** schéma `auth`, funkci `auth.uid()` ani role
`anon` / `authenticated` / `service_role` — na Supabase existují.
Soubor `supabase/local/00_shim.sql` je jen pro PGlite a **na Supabase
se nepouští**.

Po nasazení zkontrolujte v *Database → Advisors*, že žádná tabulka ve
schématu `marketing` nemá vypnuté RLS. Migrace ho zapínají na všech,
ale kontrola je levná.

### Vystavení schématu přes API

Aplikace k databázi nechodí přes PostgREST, ale přímo přes
`DATABASE_URL` (postgres.js) s přepnutím role na `authenticated`
v každé transakci (`lib/db/session.ts`). Schéma `marketing` **není
potřeba** přidávat do *Exposed schemas* v nastavení API — a je lepší to
nedělat, dokud pro to není důvod.

## 3. Storage — bucket `marketing-media`

1. *Storage → New bucket*: název `marketing-media`, **private** (ne
   public).
2. Název jde změnit proměnnou `SUPABASE_STORAGE_BUCKET`.
3. Žádné Storage politiky pro `authenticated` nejsou potřeba: soubory
   nahrává i čte **jen server** servisním klíčem
   (`lib/storage/supabase.ts`) a prohlížeči je podává přes podepsané
   adresy s omezenou platností (`lib/storage/podpis.ts`,
   `/api/v1/media/{id}/soubor?exp=…&sig=…`). Prohlížeč adresu Storage
   nikdy nevidí.
4. Cesty souborů jsou odvozené z ID, ne z názvů:
   `organizations/{org}/venues/{venue}/media/{yyyy}/{mm}/{assetId}/{soubor}`
   (sdílená média `organizations/{org}/shared/media/{assetId}/{soubor}`).

Limity velikosti souborů určuje aplikace (`lib/formaty.ts`,
`UPLOAD_LIMITY`: obrázek 25 MB, video 500 MB, zvuk 50 MB, PDF 30 MB).
Nastavte v bucketu *File size limit* aspoň na 500 MB, jinak Storage
odmítne velké video dřív než aplikace.

## 4. Auth — e-mail s jednorázovým kódem, bez zakládání účtů

Přihlášení je stejné jako ve FoodTab Řízení: e-mail → kód → přihlášeno.

1. *Authentication → Providers → Email*: zapnout. **Vypnout** *Confirm
   email* není potřeba; podstatné je, že aplikace volá
   `signInWithOtp({ email, options: { shouldCreateUser: false } })`
   (`app/prihlaseni/akce.ts`) — neexistující e-mail nedostane kód a
   účet **nevznikne**. Vstup je jen na pozvánku.
2. *Authentication → Email Templates → Magic Link*: šablona musí
   obsahovat `{{ .Token }}` (šestimístný kód), ne jen odkaz — aplikace
   ověřuje kód přes `verifyOtp({ type: "email" })`.
3. *SMTP*: nastavte vlastní odesílatele (FoodTab používá Resend,
   `smtp.resend.com:465`, `noreply@foodtab.cz` — viz kořenový
   `CLAUDE.md`). Vestavěný odesílatel Supabase má nízký limit a končí
   ve spamu.
4. Telefon jako přihlašovací údaj je v FoodTabu zatím vypnutý (žádná
   SMS brána); tady také.
5. *Site URL* a *Redirect URLs*: adresa aplikace (`APP_URL`). Aplikace
   sice nepoužívá odkazový redirect, ale Supabase ho vyžaduje.

Účty se zakládají pozvánkou (Dashboard → *Authentication → Users →
Invite*, nebo později přes pozvánkový tok aplikace, který zatím není).
Po prvním přihlášení má uživatel `auth.users` řádek; profil
v `marketing.profiles` vzniká při založení organizace nebo přidání
do týmu.

## 5. První organizace — `marketing.create_organization`

Na prázdné databázi nikdo nikam nepatří. Založení dělá funkce
`marketing.create_organization(p_name, p_slug)` (migrace
`20260908100000_zaklad.sql`): v jedné transakci založí organizaci,
šest rolí ze šablon (`role_templates`) a členství zakladatele jako
**vlastníka** s rozsahem celé organizace.

Volat ji smí jen přihlášený uživatel (`auth.uid()` nesmí být NULL).
Zatím pro to není obrazovka; postup přes SQL editor **v testovacím
projektu**:

```sql
-- 1. zjistit ID uživatele, který se už jednou přihlásil
select id, email from auth.users where email = 'majitel@firma.cz';

-- 2. založit organizaci JAKO tento uživatel
--    (set_config nastaví to, co by nastavil JWT; role authenticated
--    zajistí, že platí RLS a granty)
begin;
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '<id z kroku 1>', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select marketing.create_organization('Černá Perla s.r.o.', 'cerna-perla');
commit;
```

Slug musí odpovídat `^[a-z0-9]+(-[a-z0-9]+)*$` (malá písmena, číslice,
pomlčky). Pak přidejte provozovnu:

```sql
insert into marketing.venues (organization_id, name, slug, color, timezone)
values ('<id organizace>', 'Černá Perla', 'cerna-perla', 'plum', 'Europe/Prague');
```

(pod stejným `set_config`, protože politika `venues_insert` chce
`settings.manage` — vlastník ho má).

Před ostrým provozem je potřeba **omezit, kdo smí `create_organization`
volat** — dnes ji může zavolat každý přihlášený a založit si vlastní
organizaci. Stejný úkol má FoodTab u `app.create_tenant`
(„Před ostrým provozem“ v kořenovém `CLAUDE.md`).

## 6. Proč demo seed do produkce NEPATŘÍ

`lib/seed/demo.ts` se spouští jen do prázdné PGlite (`lib/db/driver.ts`)
a `scripts/db-reset.ts` odmítne běžet s `DATABASE_URL`. Není to
opomenutí:

- seed zakládá **pevná ID** uživatelů a organizací
  (`00000000-0000-4000-8000-…`, `10000000-…`) a vkládá řádky do
  `auth.users` — na Supabase by to kolidovalo s Auth,
- zakládá dvě organizace s demo brand kity, ukázkovými obrázky
  („Není to fotografie jídla“) a menu s ukázkovými cenami — v ostré
  databázi by to vypadalo jako data zákazníka,
- všechna připojení nastaví na **mock** — v produkci by pak publikace
  končila `published_mock` a nikdo by si nemusel všimnout, že nic
  nezveřejňuje,
- demo účty mají adresy `example.com`; kdo by je uměl podepsat cookie
  (`APP_SECRET`), přihlásil by se bez hesla. V produkci je demo
  přihlášení vypnuté (`APP_MODE=production`), ale data by tam stejně
  neměla být.

Ukázková data patří nanejvýš do testovacího projektu, a i tam raději
ručně přes `create_organization`.

## 7. Zálohy

Tarif Pro má denní zálohy. PITR se zapíná až s modulem Finance (stejné
rozhodnutí jako ve FoodTabu). Kromě toho: `supabase db dump` do
úložiště mimo Supabase — postup je v `DEPLOYMENT.md`.

Zálohy databáze **neobsahují čitelné tokeny**: `integration_secrets`
drží jen ciphertext, klíč `CREDENTIALS_ENCRYPTION_KEY` je jen
v prostředí aplikace. Zálohujte ho zvlášť (správce hesel), jinak jsou
po obnově všechna připojení nepoužitelná.
