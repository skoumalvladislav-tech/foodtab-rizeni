# Návrh zkrácení CLAUDE.md — 14. 9. 2026

Sepsáno na zadání auditu prostředí Claude Code (ne aplikačního kódu).
**Tohle je jen návrh. `CLAUDE.md` nebyl nijak upraven** — rozhoduje
Šéfík, tenhle dokument mu jen připraví podklad k rozhodnutí.

## Proč

`CLAUDE.md` má dnes 575 řádků (≈ 28 kB) a čte se **celý na začátku
každé relace**. Část je pravidlo, které platí skoro pořád (kdo smí co
vidět, jak se počítá provozní den, co se nesmí porušit) — tam patří.
Část je historické vyprávění o konkrétní nehodě (co se stalo 3. 9.,
proč, jak se to poznalo) — to je cenné poučení, ale nemusí se to číst
v každé relaci, stačí ho mít po ruce, když je potřeba. Cíl zkrácení
není přijít o obsah, ale přestat ho platit token cenou při každém
spuštění, když se čte jen zlomek.

## Princip návrhu

U každé části, která se stěhuje, **v CLAUDE.md zůstává krátké
pravidlo** (1–3 řádky) a odkaz na to, kde je zbytek — ne úplné
smazání. Stěhuje se vyprávění (proč, jak se na to přišlo, celý
příklad), ne samotné pravidlo. Bezpečnostně kritická pravidla (viz
níže „db push", SECURITY DEFINER) mají pořád aspoň jednořádkovou
připomínku přímo v CLAUDE.md, aby na ně nová relace nemusela nejdřív
sáhnout na skill.

---

## Část A — co ZŮSTÁVÁ v CLAUDE.md beze změny

Tohle jsou pravidla, která se použijí prakticky v každé relaci, jsou
krátká, a stěhování by ušetřilo málo tokenů za cenu horší
dostupnosti.

| Oddíl CLAUDE.md | Rozsah | Proč zůstává |
|---|---|---|
| Úvod („Foodtab — pokyny pro práci") | ř. 1–13 | identita projektu, jak mluvit s majitelem — nutné vždy |
| „Kde je zadání" | ř. 15–25 | ukazatele na závazné dokumenty, krátké |
| „Závazná rozhodnutí" (tabulka) | ř. 27–44 | architektonická rozhodnutí, na která se odkazuje odjinud |
| „Pravidla, která se neporušují" č. 1–11 | ř. 48–102 | jádro bezpečnosti a časových pravidel — krátká, používaná téměř v každé relaci |
| „Prostředí" (tabulka) | ř. 118–126 | projekt Supabase, e-mail, zálohy — fakta potřebná okamžitě |
| „Migrace se nasazují přes CLI" | ř. 128–130 | 3 řádky, zabraňuje ruční editaci v SQL editoru |
| „PowerShell na Windows" | ř. 180–183 | 2 řádky, potřeba u každého shellového příkazu na tomhle stroji |
| „Jak spolu pracujeme" | ř. 201–210 | kdy se ptát, kdy ne — řídí chování v každé relaci |
| „Konvence" — pojmenování (`snake_case`, čeština/angličtina po modulech) | ř. 256–277 | používá se při psaní jakéhokoli SQL nebo textu rozhraní |
| „Konvence" — jméno migrace, `run.sh` povinnost | ř. 278–280 | 3 řádky, univerzální |
| „Konvence" — peníze a časy (`integer`, `timestamptz`) | ř. 334–335 | 2 řádky, univerzální |
| „Co se ruší ze starého kódu" | ř. 565–575 | krátký seznam, brání stavění na mrtvém kódu |

**Jedna úprava i v téhle skupině:** pravidlo 12 („Oprava časového
pásma není jen posun času") je z celé dvanáctky jediné čistě
vyprávěcí — celý incident z 2. 9. 2026 už navíc **existuje** v
`docs/rozhodnuti-stara-data-pasmo.md` (57 řádků). Navrhuji zkrátit
pravidlo 12 v CLAUDE.md na tohle (zachovává zákaz, ztrácí jen
zopakování toho, co je v odkazovaném souboru):

> **12. Oprava časového pásma není „jen posun času".** Může se tím
> přeskládat pořadí událostí a změnit spárování směn, i s poctivým
> převodem podle pásma. Dopad se před zásahem spočítá skutečnou
> `app.worked_minutes` nad kopií dat a ověří proti ostré databázi.
> Incident a celý postup: `docs/rozhodnuti-stara-data-pasmo.md`.

---

## Část B — co se STĚHUJE

Pro každý řádek platí: obsah nemizí, jen se přesouvá tam, kde ho
najde relace, která ho zrovna potřebuje.

### B1. Turbopack — zaseknutý stylopis a 404

**Odkud:** ř. 132–178 (46 řádků, dvě samostatné nehody s CSS a s
routováním).
**Kam:** `docs/potize-vyvojoveho-serveru.md` — **soubor už je vytvořený
a obsahuje celý text beze změny** (jen „PowerShell na Windows" zůstal
záměrně na obou místech, je krátký a potřeba často).
**Co zůstává v CLAUDE.md:** jeden řádek —
> Vývojový server (Turbopack) umí uváznout na starém CSS i vrátit
> 404 na existující cestě. Než hledáš chybu v kódu, zkus
> `npm.cmd run build` — postup a příznaky: `docs/potize-vyvojoveho-serveru.md`.

### B2. Rozšíření Postgresu — nepoužívej je

**Odkud:** ř. 185–199 (15 řádků).
**Kam:** skill `foodtab-db-security` (vytvořen, oddíl „Rozšíření
Postgresu — nepoužívej je" — text zachován).
**Co zůstává v CLAUDE.md:**
> Nepoužívej rozšíření Postgresu (`pgcrypto`, `citext`…) — Supabase
> a lokální PostgreSQL je dávají do jiného schématu. Náhrady a důvod:
> skill `foodtab-db-security`.

### B3. „Dvě relace v jednom repozitáři"

**Odkud:** ř. 212–252 (41 řádků — dva incidenty ze 3. 9. a čtyři
pravidla z nich odvozená).
**Kam:** skill `foodtab-release` (vytvořen, oddíl „Jedna relace,
jedna větev — ale databáze je jen jedna" — obsah zachován včetně obou
incidentů).
**Co zůstává v CLAUDE.md:**
> Víc relací může pracovat souběžně nad stejnou databází.
> **Nasazuje se výhradně z `main`.** Nová tabulka `create table` bez
> `if not exists`. Provoz a marketing mají oddělenou číselnou řadu
> scénářů. Do cizího modulu nesahej. Celé odůvodnění a oba incidenty:
> skill `foodtab-release`.

### B4. Sloupcové granty, výchozí práva Supabase, TRUNCATE

**Odkud:** ř. 281–332 (52 řádků — tři samostatné incidenty:
`employees.color` 3. 9., `marketing_tajemstvi` 13. 9., `audit_log`
TRUNCATE 14. 9.).
**Kam:** skill `foodtab-db-security` (vytvořen, obsahuje všechny tři
v plném znění).
**Co zůstává v CLAUDE.md:**
> Nový sloupec na tabulce se sloupcovými granty (`employees`,
> `branches`) potřebuj vlastní `grant select (sloupec)` — jinak
> spadne celá stránka, ne jen sloupec. Nová tabulka dostane granty
> pro `anon`/`authenticated` automaticky od Supabase, i když jí je
> migrace nedá — tabulka, kam nikdo nesmí, potřebuje výslovné
> `revoke all`, a zvlášť `revoke truncate` (obchází RLS). **Stav k
> 14. 9.: provozních 51 tabulek tohle ještě nemá** — zadání
> `docs/granty-provoz-zadani.md`. Celý příběh a dopad:
> skill `foodtab-db-security`.

### B5. „Testy" — kontrola, co umí spadnout (duplicitní se skillem `scenar`)

**Odkud:** ř. 366–391 („Každá nová kontrola musí umět spadnout — a
musíš to vidět", 26 řádků).
**Zjištění:** tenhle oddíl už **existuje prakticky doslovně** ve
skillu `.claude/skills/scenar/SKILL.md`, oddíl 3 („Povinné: rozbij to
schválně a podívej se") — včetně stejných tří příkladů (`krok9`,
kontroly QR, `readonly`/React). Tohle není přesun, je to **odstranění
duplicity** — dnes se ta samá věc čte dvakrát, jednou v CLAUDE.md
a jednou (na požádání) ve skillu.
**Co zůstává v CLAUDE.md:**
> Kontrola, která projde nad rozbitým kódem, je horší než žádná —
> rozbij schválně to, co má kontrola hlídat, a přesvědč se, že
> spadne. Postup a tři nehody, které se tímhle chytily: skill `scenar`.

### B6. „Testy, které závisí na kalendáři" a „`\gset` nad prázdnou hodnotou"

**Odkud:** ř. 393–475 (83 řádků — dva incidenty s pevným datem/
posuvným oknem, jeden s posunem kratším než den, dva s `\gset` nad
NULL).
**Zjištění:** skill `scenar` má k tomuhle dnes jen stručné odrážky
(„Posun přes půlnoc dělej o víc než 24 hodin", „`\gset` nad NULL
proměnnou nezaloží"), ne celé odůvodnění a příklady. **Doporučuji
tenhle text doplnit do skillu `scenar` jako nový oddíl** — protože jde
o úpravu existujícího skillu (ne o nový, net-new soubor), nedělal jsem
to sám, ale text níže je připravený ke vložení beze změny:

<details>
<summary>Text k vložení do <code>.claude/skills/scenar/SKILL.md</code> (klikni pro rozbalení)</summary>

```markdown
## 7. Testy, které závisí na kalendáři

**Kontrola nesmí platit jen část dne nebo jen některé dny.** Test,
který dneska projde a zítra spadne, je horší než rovnou rozbitý:
rozbitý se opraví, tenhle se „opraví sám" a příště se na tu červenou
nikdo nepodívá.

Chytlo nás to dvakrát a pokaždé jinak:

**1. Pevné datum v posuvném okně** — `krok5_scenar`, 5. 9. 2026,
opraveno v `bbd5c9f`. `krok4` zakládal otevřený příchod na PEVNÉM datu
(`2026-09-03`), `krok5` k tomu měřil přes POSUVNÉ okno
`current_date - 7 … current_date`. Vycházelo to jen 4. 9., kdy oba dny
splynuly; od 5. 9. padalo a od 11. 9. by se to samo „vyléčilo".

**2. Posun kratší než den** — `krok23_scenar`, 6. 9. 2026. Otevřený
příchod se posouval o dvacet hodin zpátky a kontrola tvrdila, že je to
jiný kalendářní den — dvacet hodin zpátky je jiný kalendářní den jen
do 20:00. Opraveno na **26 hodin**.

Pravidla:

1. **Posun přes půlnoc dělej o víc než 24 hodin.** `26 hours` je jiný
   kalendářní den vždycky.
2. **Nemíchej pevné datum s posuvným oknem** ve dvou scénářích, co na
   sobě staví.
3. **Datum si nepočítej sám, ptej se `app.business_date`.**
4. **Než napíšeš posun v hodinách nebo dnech, zeptej se: platí to
   i ve 23:50? A za týden?**

## 8. `\gset` nad prázdnou hodnotou proměnnou nezaloží

Chytlo nás to taky dvakrát: `krok17_scenar` 4. 9. 2026 (`08acdcc`)
a `krok28_scenar` 6. 9. 2026. `\gset` nad sloupcem, který vyjde NULL,
proměnnou **nenastaví na prázdno — nechá ji nedefinovanou**. Další
řádek, který ji použije, spadne na `syntax error at or near ":"`.

```sql
-- ŠPATNĚ: vydano_kdy je před vydáním NULL
select vydano_kdy as vyd_pred from public.rozpis_stav(…) \gset

-- SPRÁVNĚ
select coalesce(vydano_kdy::text, '') as vyd_pred from public.rozpis_stav(…) \gset
```

**Kdykoli dáváš do `\gset` sloupec, který může být prázdný, obal ho**
— typicky vše, co znamená „ještě se nestalo" (`vydano_kdy`,
`stornovano_kdy`, `done_at`).

**Místní běh nad PGlite tohle schová** — pomocná vrstva si NULL
převádí na prázdný řetězec sama, takže scénář projde lokálně a spadne
až proti opravdovému PostgreSQL.
```

</details>

**Co zůstává v CLAUDE.md** (po vložení textu výš do skillu):
> Test, který platí jen v některou hodinu nebo jen některý den, je
> horší než rozbitý — posun přes půlnoc dělej o víc než 24 hodin,
> datum vždy z `app.business_date`. `\gset` nad NULL proměnnou
> nezaloží — obaluj `coalesce(x::text, '')`. Podrobnosti a čtyři
> nehody: skill `scenar`.

### B7. „Čtení tabulek a plán importu" a „Paleta"

**Odkud:** ř. 477–525 (49 řádků).
**Kam:** skill `foodtab-e2e` (vytvořen, oba oddíly zahrnuty).
**Co zůstává v CLAUDE.md:** nic — tenhle text je čistě popis toho,
jaké skripty existují a jak se pouští, což patří do skillu o testech,
ne do pravidel, která se čtou pokaždé. Případný nový čtenář najde
odkaz v sekci „Testy" (viz B5/B6 výš), kde CLAUDE.md bude po zkrácení
odkazovat na `foodtab-e2e` obecně.

### B8. „Stav prací" — postup práce, ne pravidlo

**Odkud:** ř. 526–563 (38 řádků: „Hotovo", „Následuje", „Před ostrým
provozem", „Klíče pro nasazování z GitHubu").
**Zjištění:** první tři pododdíly jsou momentka stavu prací, která
**zestárne při první další relaci** — a projekt už má místo pro
aktuální stav: `docs/hlaseni/stav-RRRR-MM-DD.md` (nejnovější) a
`docs/FOODTAB-MASTER-AUDIT-2026-09-14.md`. `docs/pracovni-rezim-codea.md`
to říká výslovně: *„Nezakládej APP_AUDIT.md ani BLOCKERS.md, ta
hlášení už tu roli mají. Dva seznamy pravdy znamenají, že jeden brzy
lže."* CLAUDE.md se tomu vlastnímu pravidlu dnes samo zpronevěřuje —
drží třetí seznam pravdy.

Poslední pododdíl („Klíče pro nasazování z GitHubu") je jiná věc —
**bezpečnostní pravidlo, ne stav**, a je (skoro doslovně) duplicitní
se skillem `nasazeni`, oddíl „Proč to nedělá automat" — a nově i se
skillem `foodtab-release`.

**Co zůstává v CLAUDE.md** (nahrazuje celý oddíl „Stav prací"):
> Aktuální stav prací se **nedrží v CLAUDE.md** — je v nejnovějším
> `docs/hlaseni/stav-RRRR-MM-DD.md` a `docs/FOODTAB-MASTER-AUDIT-*.md`.
> Dva seznamy pravdy znamenají, že jeden brzy lže.
>
> **Nasazuje Šéfík, ne push ani CI.** GitHub Actions nasazovací
> klíče (`SUPABASE_ACCESS_TOKEN` aj.) se záměrně nezavádí, dokud
> ostrá data leží v projektu `foodtab-test` — „bezpečné, protože
> nenastavené" není pojistka. Podmínka na vrácení a celý postup:
> skill `nasazeni`, skill `foodtab-release`.

---

## Přehled dopadu

| | Řádků dnes | Po návrhu | Kam šel zbytek |
|---|---|---|---|
| CLAUDE.md celkem | 575 | odhadem **≈ 260–280** | skills `foodtab-db-security`, `foodtab-release`, `foodtab-e2e`, `scenar` (doplnění), `docs/potize-vyvojoveho-serveru.md` |

Odhad je konzervativní (počítá s tím, že se u každé stěhované části
nechá 2–5řádkový pahýl s odkazem, ne úplné smazání). Skutečná úspora
při čtení na začátku relace je vyšší, než ukazuje počet řádků —
CLAUDE.md se čte vždy celý, skill jen když ho relace potřebuje.

## Co s tímhle návrhem dál

1. Šéfík rozhodne, které body z části B schvaluje — může jednotlivě,
   nemusí najednou.
2. Skills `foodtab-db-security`, `foodtab-release`, `foodtab-e2e`
   a soubor `docs/potize-vyvojoveho-serveru.md` **už existují** a mají
   obsah — schválením v CLAUDE.md se nic nemusí dopisovat, jen se
   z CLAUDE.md smaže to, co se přesunulo.
3. Bod B6 vyžaduje ještě jeden krok navíc — vložit připravený text do
   existujícího `.claude/skills/scenar/SKILL.md` (nedělal jsem to sám,
   je to zásah do skillu, který už relace aktivně používají).
4. Až se CLAUDE.md zkrátí, stojí za to znovu přečíst konvence
   pojmenování (Část A) — je to teď nejdelší kus, co v souboru zbyde,
   a nezkoumal jsem, jestli by šel zhustit beze ztráty.
