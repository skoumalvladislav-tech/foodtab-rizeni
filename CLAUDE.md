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

8. **Mzdy a docházka se nikdy neposílají do jazykového modelu.** Agent
   pracuje s podílem nákladů, ne se jmény a částkami.

9. **Mazání lidí je označení, ne výmaz** (`deleted_at`) — kvůli návaznosti
   docházky.

10. **Provozní den ≠ kalendářní den.** Účet vystavený ve 2:15 patří do
    včerejší uzávěrky. Odvozuje se z `branches.day_starts_at`.

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
Když přidáváš tabulku nebo oprávnění, přidej k tomu kontrolu do
`supabase/tests/etapa0_scenar.sql`. Kontrola má ověřovat, že se někdo
**nedostane** tam, kam nemá — ne jen že šťastná cesta funguje.

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
