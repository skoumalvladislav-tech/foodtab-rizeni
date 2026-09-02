# Foodtab — pokyny pro práci na projektu

Interní systém pro řízení restaurací. Cílem je automatizovat denní rutinu:
směny, docházku, úkoly, komunikaci, receptury a jídelní lístky, později
finance, marketing a nákup, nad tím vším AI agenty.

**Foodtab nenahrazuje pokladnu.** Storyous, Dotykačka a Choice QR jsou
vstupy, na které se aplikace napojuje, ne konkurenti.

Majitel projektu není vývojář. Vysvětluj rozhodnutí česky a srozumitelně,
neschovávej kompromisy do žargonu. Vývojářský tým nastoupí až po odzkoušení
v ostrém provozu dvou provozoven — do té doby musí být kód čitelný natolik,
aby ho někdo cizí převzal bez dohledu.

## Kde je zadání

- `docs/etapa0-specifikace.md` — závazná specifikace základu
- Plná verze včetně obrázků: https://claude.ai/code/artifact/b598a3a4-45e3-446c-97ec-397fad8cf5d3
- `supabase/README.md` — jak funguje databáze a jak se zakládá firma
- `docs/vzhled-zadani.md` a `docs/vzhled-oprava-1.md` — barvy, písmo a plochy;
  oprava nahrazuje tabulky odstínů v §4.3 a §4.4 zadání
- `docs/vzhled-predloha.html` — předloha vzhledu, otevírá se dvojklikem

Když si nejsi jistý, jak se má něco chovat, hledej odpověď tam. Když tam
není, zeptej se — nedomýšlej si pravidla provozu restaurace.

## Závazná rozhodnutí

Tohle je odsouhlasené. Neměň to bez výslovného pokynu, ani když najdeš
elegantnější řešení.

| Oblast | Rozhodnutí |
|---|---|
| Databáze | Supabase Postgres, region Frankfurt. Cloudflare D1 se **opouští** |
| Framework | Běžný Next.js. Odchod z `vinext` (předverze) |
| Hosting | Hetzner + Coolify, Německo. Cloudflare jen jako DNS, TLS a ochrana |
| Multitenance | `tenant_id` v každé tabulce od začátku. Rozhraní zůstává jednofiremní |
| Moduly | `provoz` (vždy), `menu`, `finance`, `marketing`, `objednavky`. Zapínají se za celou firmu |
| Tvorba menu | Dílna na návrhy, ne úložiště. `recipes.*` a `menus.*` zůstávají v `provoz` |
| Rozsah | Dvě úrovně: firma a pobočka. Počet poboček neomezený |
| Lidé | Zaměstnanec může existovat **bez** uživatelského účtu (brigádník) |
| Přístupy | Role a oprávnění jsou data firmy, ne kód. Vstup jen na pozvánku |
| Pozvánky | E-mailem nebo SMS. Telefon je plnohodnotný přihlašovací údaj |
| Banka | Výhradně pro čtení. Nikdy platební příkazy |

## Pravidla, která se neporušují

1. **Nic o provozu nepatří do kódu.** Žádné pobočky, role, zaměstnanci,
   checklisty ani jídla napevno. Když to má zákazník moct změnit, je to
   řádek v databázi. Ukázková data patří nanejvýš do seed skriptu pro
   testovací prostředí.

2. **O přístupu rozhoduje jediné místo:** `app.has_access(tenant, oprávnění,
   pobočka)`. Nepiš vlastní kontroly stranou, nerozhoduj podle názvu role.
   Nová oprávnění se přidávají do tabulky `permissions`, ne do `if`.

3. **Dvě obranné linie.** Kontrola v aplikaci **a** Row Level Security
   v databázi. Ani jedna se nevynechává s tím, že to hlídá ta druhá. Každá
   nová tabulka dostane `tenant_id`, zapnuté RLS a politiku.

4. **Rozsah z prohlížeče je návrh, ne oprávnění.** `branch_id` z požadavku
   se vždy ověřuje proti členství přihlášeného uživatele. Jinak stačí
   přepsat jedno číslo a vedoucí baru vidí tržby celé firmy.

5. **Vypnutý modul odmítá i přímé volání svého rozhraní**, nejen položku
   v navigaci.

6. **Klíč `service_role` nikdy neopustí server.** Obchází RLS.

7. **Tokeny se ukládají jako otisk**, nikdy v čitelné podobě — pozvánky
   i servisní klíče agentů.

8. **Mzdy, docházka, kontakty a zálohy se nikdy neposílají do jazykového
   modelu.** Agent pracuje s podílem nákladů, ne se jmény a částkami.

9. **Mazání lidí je označení, ne výmaz** (`deleted_at`) — kvůli návaznosti
   docházky.

10. **Provozní den ≠ kalendářní den.** Účet vystavený ve 2:15 patří do
    včerejší uzávěrky. Odvozuje se z `branches.day_starts_at`.

11. **Hodina na zdi není okamžik.** Co člověk napíše do políčka
    (`2026-08-31T22:00`), nemá časové pásmo. Pásmo k tomu dodá POBOČKA
    (`branches.timezone`, jinak `tenants.timezone`, jinak
    `Europe/Prague`) a převod dělá databáze přes `at time zone` — ta
    zná pravidla letního času pro to konkrétní datum. Nikdy
    `new Date('…T22:00')`: ten řetězec se přečte v pásmu serveru,
    a ten je na Vercelu v UTC.

    Totéž obráceně při zobrazení: `getHours()` ani
    `toLocaleTimeString()` bez `timeZone` se nepoužívají. Formátuje
    se přes `lib/cas.ts`, kde je pásmo povinný údaj.

    **Ty dvě chyby se na obrazovce vyruší** — co se zadá jako 22:00, se
    jako 22:00 i ukáže — a přitom směna vyjde o dvě hodiny delší. Proto
    se ukládání a zobrazení ověřují ZVLÁŠŤ, ne jedním průchodem
    (`supabase/tests/krok14_scenar.sql` a `scripts/cas.test.mjs`).

12. **Oprava časového pásma není „jen posun času“.** Když se posune
    ruční záznam, může se v pořadí událostí dostat před jiný a spárovat
    se s něčím jiným než dřív. Délka směny se tím změní, i když se oba
    konce posunuly stejně.

    Stalo se to 2. 9. 2026: posunutý ruční příchod se dostal před
    píchnutý odchod, otevřenou směnu zavřel jiný odchod a z pěti hodin
    byla hodina a čtvrt. Nebyla to chyba té opravy, byl to její
    důsledek.

    Nikdy tedy `update … occurred_at = occurred_at + interval '2 hours'`
    s tím, že „to jen posune čas“ — a ani s poctivým převodem podle
    pásma to není bezpečné. Dopad se před zásahem spočítá **skutečnou**
    `app.worked_minutes` nad kopií dat a nejdřív se ověří, že model dá
    stejná čísla jako ostrá databáze. Viz
    `docs/rozhodnuti-stara-data-pasmo.md`.

## Prostředí — nehádej, zeptej se dokumentu

| Co | Hodnota |
|---|---|
| Supabase projekt (test) | `foodtab-test`, ref `spekntcsuroqhehmjssv`, Frankfurt, tarif Pro |
| Ostrý projekt | zatím neexistuje, vznikne jako `foodtab-prod` |
| Repozitář | `C:\Users\vladi\foodtab-rizeni`, pracovní větev `main` |
| E-mail | Resend, `smtp.resend.com:465`, odesílatel `noreply@foodtab.cz` |
| SMS brána | zatím žádná, telefon je v Auth vypnutý |
| Zálohy | denní (Pro). PITR odložený až k modulu Finance |
| Omezení sítě u databáze | odložené až po nasazení serveru u Hetzneru |

Migrace se nasazují **přes Supabase CLI** (`supabase db push`), nikdy ručním
vkládáním do SQL editoru — jinak se nezapíše historie migrací a příště by
se zkusilo pustit všechno znovu.

### Zaseknutý stylopis v Turbopacku

Když se změna v CSS neprojeví, ale na disku je správně, drží Turbopack starý
přeložený stylopis. Pozná se to tak, že se obsah souboru liší od toho, co
posílá server. Spraví to dotčení `globals.css` nebo smazání `.next/dev`.
Stalo se to už třikrát, pokaždé to stálo desítky minut hledání neexistující
chyby:

- **tři vzhledy tlačítek** — v souboru `border-color: var(--mosaz)`, ze
  serveru chodilo `border-color: #0000`, takže hlavní tlačítko nemělo obrys
  a vypadalo to jako chyba ve specificitě
- **zlom 1360 px** — moduly se nesklápěly do vlastního pruhu, protože
  v odeslaném CSS ten `@media` blok vůbec nebyl
- **zlom 960 px** — totéž u přepínače poboček

Ověřit se to dá takhle: v konzoli prohlížeče se stáhne odeslaný stylopis
a hledá se v něm pravidlo, které má být v souboru.

```js
for (const l of document.querySelectorAll('link[rel=stylesheet]'))
  console.log(l.href, (await fetch(l.href).then(r => r.text())).includes('max-width: 960px'))
```

### Zaseknutý Turbopack umí i 404

Počtvrté, a jinak než předtím: neumí jen držet starý stylopis, **umí
přestat obsluhovat celou větev adres**.

Příznak z 1. 9. 2026 — `/[rozsah]/nastaveni/lide`, `/pobocky`, `/pozice`
i `/role` vracely **404**, zatímco `/dochazka`, `/smeny`, `/upozorneni`
a `/moje-udaje` na téže úrovni odpovídaly 200. Soubory na disku byly
v pořádku, importy taky, nikde v kódu není jediné `notFound()`.
**Smazání `.next` nepomohlo.** Stálo to hodinu.

Rozhodlo tohle:

```bash
npm.cmd run build
```

Build vypsal seznam adres a všechny čtyři v něm byly — takže chyba
nebyla v kódu. A protože build přepsal celý obsah `.next`, po dalším
`npm.cmd run dev` už obrazovky chodily.

**Pravidlo: když stránka vrací 404 a soubor přitom existuje, nehledej
chybu v kódu.** Nejdřív `npm.cmd run build` — vypíše seznam adres a tím
oddělí chybu v kódu od zaseknutého vývojového serveru.

### PowerShell na Windows

V PowerShellu se musí psát `npm.cmd` a `npx.cmd`. Verze `.ps1`
neprojdou přes zákaz spouštění skriptů.

## Rozšíření Postgresu — nepoužívej je

Supabase dává rozšíření do schématu `extensions`, lokální PostgreSQL do
`public`. Funkce se `search_path = ''` proto spadnou vždy na jednom z těch
dvou prostředí — a hádat schéma znamená mít kód, který jinde nefunguje.

Řešením není qualifikovat schéma, ale **rozšíření nepotřebovat**:

| Místo | Použij |
|---|---|
| `pgcrypto` `digest()` | vestavěná `sha256(convert_to(x,'UTF8'))` |
| `pgcrypto` `gen_random_bytes()` | dvě `gen_random_uuid()` bez pomlček |
| `citext` | `text` + ukládat malými písmeny + podmínka na sloupci |

Když opravdu nejde jinak, zeptej se — nepřidávej `create extension` sám.

## Jak spolu pracujeme

- **Ptej se jen na to, co v dokumentech není.** Rozhodnutí v tabulce výš
  a v `docs/etapa0-specifikace.md` jsou závazná, neotevírej je znovu.
- **U rizikových kroků nejdřív plán, pak práce.** Riziko = zásah do
  produkční databáze, mazání, změna oprávnění, nasazení.
- **U mechanické práce plán nechtěj** a udělej ji celou. Převod obrazovky,
  psaní CRUD, opravy typů — tam se neptej po každém souboru.
- **Commituj průběžně**, ať jde každý krok vrátit.
- Majitel projektu není vývojář. Odpovídej česky a bez žargonu.

## Konvence

- Názvy tabulek, sloupců a funkcí anglicky, `snake_case`.
- Komentáře v kódu, chybové hlášky a texty rozhraní **česky**.
- V rozhraní se `roles` jmenují **„Oprávnění"** a `positions` **„Pozice"**;
  v databázi zůstávají anglické názvy. Slovo „oprávnění" na obrazovce
  znamená vždycky tu pojmenovanou sadu (Majitel, Provozní, Servis) —
  jednotlivá práva uvnitř se tak nepojmenovávají, jsou to zaškrtávátka
  s větou („Vidět rozpis směn").
- Migrace: `supabase/migrations/RRRRMMDDHHMMSS_nazev.sql`, nikdy neupravovat
  už nasazenou migraci — vždy přidat novou.
- Každá migrace musí projít `supabase/tests/run.sh` proti čisté databázi.
- Peníze v celých haléřích jako `integer`, ne `float`.
- Časy `timestamptz`, provozní datum jako `date`.

## Testy

```bash
supabase/tests/run.sh
```

Postaví čistou databázi, pustí všechny migrace a projde bezpečnostní scénář.

Než to pustíš, vyplatí se ověřit, že jsou scénáře vůbec čitelné:

```bash
node scripts/scenare.test.mjs
```

Dvakrát po sobě odešel scénář, ve kterém se cestou ztratil jeden znak —
z `do $$` bylo `do $`, z `\echo` bylo `echo`. psql v takovém souboru
spadne někde uprostřed, zbytek kontrol neproběhne a vypadá to, že
prošly. Napodruhé to navíc zamaskovalo skutečnou díru o dvě stě řádků
níž. Kontrola neřekne, jestli scénář platí — jen že se dá přečíst.

Příčina byla pokaždé v pomocném skriptu, kterým se soubor upravoval:
v náhradním řetězci u `String.replace` má dolar zvláštní význam — `$$`
je escape pro jeden dolar a `` $` `` vloží text před shodou. Když
upravuješ soubor skriptem, používej `split().join()`.

Když přidáváš tabulku nebo oprávnění, přidej k tomu kontrolu do
`supabase/tests/etapa0_scenar.sql`. Kontrola má ověřovat, že se někdo
**nedostane** tam, kam nemá — ne jen že šťastná cesta funguje.

### Čtení tabulek a plán importu

```bash
node --experimental-strip-types scripts/tabulka.test.mjs
node --experimental-strip-types scripts/xlsx.test.mjs
node --experimental-strip-types scripts/nahrani-lidi.test.mjs
node --experimental-strip-types scripts/prideleni.test.mjs
```

Čtyři věci, které se nedají ověřit v databázi, protože se dějí dřív: čtení
CSV, čtení sešitu .xlsx a plán nahrávání (co se založí, co aktualizuje,
co přeskočí a proč) — a k tomu strop na obrazovce, tedy kterou sadu
oprávnění smím vůbec někomu přidělit.

Běží přímo Nodem bez sestavení. Proto mají soubory v `lib/` mezi sebou
importy **s příponou `.ts`** a `tsconfig.json` má
`allowImportingTsExtensions`; bez přípony Node modul nenajde.

Sešit se v testu doopravdy poskládá — ZIP i XML — a pak přečte. Kontroly
míří na to, co u cizích souborů selhává: středník místo čárky, BOM,
windows-1250, první záložka jinde než v `sheet1.xml`, vynechané buňky
uprostřed řádku, buňka se vzorcem.

### Paleta

```bash
node scripts/barvy.js
```

Čte hodnoty z `app/_tokeny.css` a `app/globals.css` — kontroluje se to, co
je opravdu v souborech, ne tabulka v zadání. Vrací 1, když něco spadne pod
hranici, takže se dá pověsit do CI.

Měří dvě různé věci a jedna druhou nenahrazuje:

| otázka | měřítko | hranice |
|---|---|---|
| Přečtu ten text? | kontrastní poměr | 4,5 text, 3,0 plochy a obrysy |
| Poznám ty dvě barvy od sebe? | ΔE2000 | **15 světlý, 14 tmavý** |

Tmavý režim má nižší hranici proto, že tmavá lišta má svázanou světlost
se sytostí: aby zůstala tmavá, vejde se do sRGB málo sytosti a devět
odstínů se tam nerozestoupí jako na světlém pozadí. Zdůvodnění je
v `docs/vzhled-oprava-1.md`.

Kontrast sám by nestačil — měří jen rozdíl světlosti. Dvě zelené o stejné
světlosti mají poměr 1,00 a od sebe je nepozná nikdo; přesně tak vznikla
původní paleta, kde měly firma a emerald vzdálenost 2,4.

## Stav prací

**Hotovo:** etapa 0 celá (firma, pobočky, lidé, role, moduly, pozvánky,
audit, RLS), provozní tabulky, autorizační vrstva v aplikaci, rozpis směn
ve třech pohledech, obrazovka Lidé a pozvánky, vzhled podle
`docs/vzhled-predloha.html` a `docs/vzhled-oprava-1.md`. Rozpis
srpen/září je nahraný se skutečnými časy.

**Následuje:** hydratační neshoda v denním pohledu — čára „teď" se počítá
na serveru i v prohlížeči, takže se hodnoty nikdy netrefí. Dál kontrola
zbylých obrazovek proti předloze, nahrávání rozpisu z Excelu a docházka
proti plánu.

**Před ostrým provozem:** omezit `app.create_tenant`, noční záloha
databáze mimo Supabase, klíče pro nasazování z GitHubu.

## Co se ruší ze starého kódu

Tyhle věci pocházejí z prototypu a při převodu jednotlivých modulů mizí.
Nestav na nich nic nového.

- `db/`, `drizzle/`, `worker/index.ts` — vazba na Cloudflare D1 a R2
- `app/api/operations/route.ts` — jeden POST s přepínačem `action`
- `app/api/access/route.ts` — `allowedBranches`, `allowedRoles` jako konstanty
- `app/dashboard.tsx` — 4 651 řádků se všemi obrazovkami a ukázkovými daty;
  rozdělit na komponenty po modulech
- funkce `aiAnswer` — odpovědi podle klíčových slov, ne skutečný model
