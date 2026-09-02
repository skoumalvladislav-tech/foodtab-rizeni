# Noční práce z 2. na 3. 9. 2026

Zadal Šéfík. **Až po tom, co doběhne dnešní fronta** — pásmo (C),
panel (A), ruční odchod bez otevřené směny (B), storno deseti řádků
a QR. Tohle je práce na potom, ne místo toho.

Pět věcí. Každá je samostatně nasaditelná, takže když se někde
zasekneš, zbytek tím nepadá. Pořadí je podle závislostí, ne podle
důležitosti.

| # | Co | Šéfíkovo rozhodnutí |
|---|---|---|
| 1 | Úseky jako číselník | Nový číselník, ne jen seskupení pozic |
| 2 | Zadávání směn z kalendáře | Na dashboardu i v mobilu |
| 3 | Volné směny a přihlašování | Přihlášení **čeká na schválení** |
| 4 | Barvy a dělení kalendáře | **Přepínač** člověk / úsek |
| 5 | Limity záloh | **Poměr k odpracovanému**, s povoleným mínusem |

---

## 1. Úseky — a rovnou oprava pravidla 1

Šéfík chce dělit kalendář na bar, kuchyni, provoz. Při hledání, kam
to posadit, jsem našel, že **to tam už je — a je to špatně**:

```sql
department text not null default 'provoz'
  check (department in ('kuchyne','bar','servis','provoz','vedeni'))
```

`positions.department` z `20260823120000_foundation.sql`. Pět úseků
**napevno v kódu**. Restaurace, která chce cukrárnu nebo rozvoz, si ji
přidat nemůže — musela by se změnit migrace. To je přímé porušení
pravidla 1: *nic o provozu nepatří do kódu*.

Takže to není nová funkce, je to náprava.

**Co udělat:**

- Nová tabulka `public.sections`: `tenant_id`, `key`, `label`,
  `color`, `poradi`, `active`. `tenant_id`, RLS, politika — pravidlo 3.
- `positions.section_id` odkazem na ni, **nullable** (pozice nemusí
  mít úsek).
- Migrace **naplní `sections` z existujících hodnot** `department`
  pro každou firmu a napojí pozice. Nikdo nesmí přijít o to, co má
  nastavené.
- `department` v téhle migraci **neruš.** Nech ho ležet a zruš ho
  až v příští, po ověření v provozu. Migraci, která je nasazená,
  neupravuj — přidej novou (konvence).
- Obrazovka **Nastavení → Úseky**: založit, přejmenovat, barva,
  pořadí, zneplatnit. Zneplatnit, ne smazat — visí na tom pozice.
- Úsek, na kterém visí pozice, **nejde zneplatnit bez upozornění**;
  řekni kolik pozic a nech rozhodnout.

**Pozor:** `key` musí být jedinečný v rámci firmy, ne globálně.

---

## 2. Zadávání směn z kalendáře

Dnes se rozpis jen prohlíží. Nová směna se založí kliknutím do
kalendáře — na dashboardu i v mobilu.

**Kde:** denní a týdenní pohled. V měsíčním ne — tam se netrefíš.

**Co formulář musí umět:** kdo (nebo **nikdo** = volná směna),
pozice, datum, od–do, poznámka, pobočka.

### Sedm věcí, na kterých to spadne

**Pobočka z prohlížeče je návrh.** Ověř `branch_id` proti členství
přihlášeného — pravidlo 4. Platí i pro úpravu cizí směny.

**Oprávnění.** Použij existující právo pro správu rozpisu. Když
žádné není, přidej řádek do `permissions` — ne `if` podle názvu role
(pravidlo 2).

**Směna přes půlnoc.** `starts_at` a `ends_at` jsou `time`, takže
22:00–06:00 vypadá jako záporná délka. Musí se poznat, že končí
druhý den, a musí to sedět s provozním dnem (pravidlo 10). Napiš na
to kontrolu.

**Časy jsou hodina na zdi, ne UTC.** Po dnešní opravě to platí
i tady — směna od 22:00 znamená 22:00 v pásmu té pobočky. Nedělej
si vlastní převod, použij, co vzniklo v `20260902090000`.

**Překryv u jednoho člověka.** Dvě směny naráz jsou skoro vždy
překlep. **Varuj, neodmítej** — dělené směny a záskoky existují.

**Rozpis je vydaný.** Obrazovka to hlásí. Když se po vydání přidá
směna, **lidé se to nedozvědí**, dokud se nevydá znovu. Ať je to na
obrazovce vidět: *„Rozpis je vydaný, tahle změna se k lidem
nedostala."* A tlačítko vydat znovu vedle toho.

**Mobil.** Kalendář je hustý. Na telefonu ať se klepnutím na den
otevře formulář na celou obrazovku, ne bublina, do které se nedá
trefit.

---

## 3. Volné směny a přihlašování

`shifts.employee_id` je **už dnes nullable**, s komentářem
*„Prázdné = neobsazená směna, tedy sem někoho potřebujeme."*
Datový model tedy stojí; chybí obrazovka a přihlašování.

**Šéfík rozhodl: přihlášení je zájem, ne obsazení.** Vedoucí vidí,
kdo se hlásí, a vybere. Důvod je provozní — na bar nemůžeš pustit
kohokoli, kdo byl první.

### Jak to má chodit

1. Vedoucí založí směnu bez člověka.
2. Komu se ukáže: lidem **té pobočky**, a když má směna pozici nebo
   úsek, **jen těm, kdo ji mají**. Ostatním se nenabízí; ať se
   nehlásí na to, co dělat nemůžou.
3. Člověk se přihlásí. Stav **čeká**.
4. Vedoucí schválí jednoho. Ostatní se dozvědí, že to nevyšlo.

### Nová tabulka

`public.shift_applications`: `tenant_id`, `shift_id`, `employee_id`,
`stav` (`ceka`/`schvaleno`/`zamitnuto`/`zruseno`), `created_at`,
`rozhodl`, `rozhodnuto_v`. `tenant_id`, RLS, politika.

Jedinečnost na `(shift_id, employee_id)` — dvojí přihlášení nemá
smysl.

### Čeho se bojím

**Dva vedoucí schvalují naráz.** Musí vyhrát jeden a druhý se musí
dozvědět proč, ne přepsat prvního. Uzamkni směnu při schvalování
a schválení dělej v jedné transakci s obsazením.

**Kdo se přihlásil, ať neschvaluje sám sebe.** I když má
`shifts.manage`. Ať je na to kontrola — je to přesně to, co se
zapomíná.

**Přihlášení na směnu, která se překrývá s vlastní.** Varuj hned při
přihlašování, ne až vedoucímu.

**Když se směna zruší nebo obsadí jinak**, čekající přihlášky ať
neleží ve stavu „čeká" navždy — překlop je a dej vědět.

**Volná směna není náklad.** Dokud nemá člověka, nemá sazbu. Ať se
nezapočítává do podílu nákladů a ať to nikde nevypadá, že chybí.

**Neslibuj push do mobilu**, dokud nechodí. Zvoneček a e-mail ano.

---

## 4. Barvy a dělení kalendáře

Šéfík chce **přepínač**: barvit podle člověka, nebo podle úseku.
A dělit kalendář podle úseku nebo podle pozice.

- **Volba se pamatuje u člověka**, ne za celou firmu. Provozní chce
  vidět jinak než majitel.
- **Barva člověka je řádek v databázi** (`employees`), ne funkce ze
  jména. Přiřadí se z ověřené palety při založení a jde změnit.
- **Barva úseku** je v `sections` (bod 1).

### Kde to praskne

**Nad deset lidí se barvy nerozliší.** Paleta má devět odstínů
a hranice ΔE2000 je 15 na světlém a 14 na tmavém — viz
`scripts/barvy.js`. Když je lidí víc než barev, **nepřiděluj
potichu podruhé.** Buď přidej rozlišení, které není barva
(iniciály, obrys), nebo řekni, že se barvy opakují. Dvě různé
Aničky ve stejné barvě jsou horší než žádná barva.

**Nové barvy musí projít `node scripts/barvy.js`.** Světlý i tmavý
režim. Když spadnou, nezvyšuj hranici — vyber jiné odstíny.

**Barva nesmí nést informaci sama.** Kdo barvy nerozliší, musí se to
dočíst textem. Úsek ať je i napsaný, ne jen obarvený.

**Obě pobočky mají dnes stejnou barvu** (Růžová). To si Šéfík
přepne sám v nastavení — do kódu to nepatří —, ale při zkoušení
s tím počítej, ať netestuješ na datech, kde se nedá nic poznat.

---

## 5. Limity záloh

Šéfíkovo zadání: *„nastavovat u jednotlivců limit výše zálohy a nebo
celkový limit i do mínusu."* Vybral **poměr k odpracovanému**.

**Model u člověka, dvě čísla:**

- **Podíl z odpracovaného** — kolik smí mít vyplaceno vůči tomu, co
  má za tenhle měsíc oddělané. Výchozí ať je nastavení firmy, u
  člověka se dá přebít.
- **Povolený mínus** — o kolik smí jít pod nulu. Tím se řeší
  „i do mínusu": začátkem měsíce nemá nikdo nic oddělané, a přesto
  potřebuje na nájem.

Obojí v **haléřích jako `integer`**, ne float.

### Mez varuje, neodmítá — a to se nemění

Na obrazovce Zálohy už dnes stojí: *„Mez jen varuje, nikdy neodmítne
— o penězích rozhoduje majitel, ne aplikace."* **Nový limit se chová
stejně.** Ukáže, že se překračuje, o kolik, a nechá rozhodnout.

Jediné, co odmítá, je **pozastavení** — to už existuje a je to jiná
věc.

### Co musí být vidět dřív, než se klikne

Ne až potom. U formuláře na výplatu ať stojí:

> Oddělal 12 400 Kč · vyplaceno 8 000 Kč · **zbývá 1 200 Kč do meze**

A když se překračuje, tak o kolik a proti čemu.

### Traps

**„Oddělané" ber z `app.worked_minutes`** a sazby, ne z vlastního
počítání. Po dnešku je to číslo, kterému se dá věřit — jiné si
nevyráběj.

**Který měsíc?** Podle provozních dnů, ne kalendářních (pravidlo 10).

**Do jazykového modelu z toho nejde nic** — pravidlo 8. Ani jména,
ani částky, ani meze.

**Změna meze do auditu**, jako volba zobrazení záloh.

---

## Co platí pro všech pět

- **Nic o provozu do kódu.** Úseky, barvy, meze — všechno řádky
  v databázi (pravidlo 1).
- **Každá nová tabulka:** `tenant_id`, zapnuté RLS, politika
  (pravidlo 3).
- **Nová oprávnění do `permissions`**, ne do `if` (pravidlo 2).
- **Rozsah z prohlížeče je návrh** (pravidlo 4).
- **`supabase db push` nepouštěj**, migrace nasazuje Šéfík.
- **Do produkčních dat nezasahuj.**
- **SQL piš editorem, ne přes shell.**
- Ke každé nové tabulce a oprávnění **kontrola, která ověřuje, kam
  se někdo nedostane** — ne že šťastná cesta funguje.

### A jedna věc k tomu, jak dnešek dopadl

Dvakrát dnes prošly kontroly u něčeho, co v nasazené aplikaci
nefungovalo. Než u kteréhokoli z těchhle pěti bodů napíšeš
„ověřeno", zeptej se: **sáhla ta kontrola na to, co uvidí uživatel?**
Ne na řetězec vedle, ne na záměr — na výstup.

Ohlas každou odchylku od zadání, i tu, na kterou by se nikdo
nezeptal. Dnes jsi to udělal a bylo to k něčemu.
