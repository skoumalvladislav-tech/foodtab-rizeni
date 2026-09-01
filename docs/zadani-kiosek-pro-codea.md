# Zadání pro Codea — kiosek, PIN a zálohy

Plné zadání je v `docs/kiosek-pin-zalohy-zadani.md`. Tenhle soubor
říká, v jakém pořadí to stavět, kde se zastavit a co nedělat.

---

## Nejdřív, než na tom začneš dělat

Tohle udělá Šéfík, ne ty:

1. `git add docs supabase/tests` a commit — leží tam nové zadání
   a scénář `krok5_scenar.sql`.
2. `supabase db push` — čeká osm nenasazených migrací.

Scénář krok 5 prošel proti opravdovému PostgreSQL 16, celý běh je
214 kontrol. **Než se to nasadí, na kiosku nezačínej** — stavěl bys
na osmi migracích, které v databázi ještě nejsou.

---

## Tvrdá omezení

- **`supabase db push` NE.** Migrace piš a commituj, nasazuje Šéfík.
- **Ostrá data neměň.**
- **SQL a víceřádkové bloky piš editorem, ne přes shell.** Rozbité
  uvozování už třikrát utnulo půlku testů.
- **Nedomýšlej si.** Co není v zadání, se nedělá — napiš otázku
  a jdi dál. Čtyři otázky jsou otevřené schválně (oddíl 11 zadání).
- **Každá nová tabulka:** `tenant_id`, zapnuté RLS, politika, a granty
  **vyjmenované po sloupcích**. `grant on all tables in schema public`
  zruší výjimku u kontaktů i u otisků pozvánek.
- **Commituj po každém dokončeném kroku.**

---

## Pořadí

Body 1 až 4 dělej vcelku. **Pak se zastav a napiš zprávu** — zálohy
jsou peníze a nemá smysl je stavět na docházce, které se ještě nedá
věřit.

### 1. Zařízení pobočky

Tabulka zařízení: patří pobočce, má název, **otisk servisního klíče**
(nikdy klíč sám, pravidlo 7), stav a čas odvolání.

Registrace: kdo spravuje pobočku, vygeneruje kód; kód platí krátce
a jde použít **jednou**; tablet si při něm uloží klíč.

Odvolání jedním kliknutím. Odvolané zařízení nesmí píchnout.

### 2. PIN

- Ukládá se jako **otisk se solí**. Nikdo ho nepřečte, ani majitel.
- Volí si ho zaměstnanec sám. 4–6 číslic, triviální se odmítnou.
- **Pět chyb = dočasný zámek** a záznam v auditu.
- Reset PIN **ruší**, neprozrazuje. Smí ho jen `attendance.manage`,
  jde do auditu, nový si člověk zadá sám.
- PIN **není přihlášení do aplikace**. Platí jen na registrovaném
  zařízení pobočky — nikdy z internetu, nikdy z cizího telefonu.

### 3. Kiosek

Režim v aplikaci, ne nová aplikace — PWA už je. Obrazovka ukazuje QR
měnící se každých 30–60 vteřin (odvozený z tajemství pobočky a času,
tajemství **neopustí server**) a pod ním pole na PIN.

Kiosek umí **jen** píchnout, ukázat dnešní směnu a nechat potvrdit
zálohu. Nic jiného — **ani přímým voláním rozhraní**.

### 4. Zákaz přímého zápisu docházky za sebe

Ve **stejném kroku** jako 3, ne později.

Dnes politika `attendance_insert` pouští druhou větví vlastní záznam
se `source = 'app'` a **libovolným časem**. Ověřeno na zkoušce: jde
takhle založit příchod měsíc zpátky a není nijak označený. Vede to
rovnou do výpočtu mzdy.

Po nasazení kiosku smí píchnutí vzniknout jen třemi cestami: platný
měnící se kód, PIN na registrovaném zařízení, nebo ruční zadání
s `attendance.manage` (to už je hotové).

**Zastav se tady a napiš zprávu.**

### 5. Zálohy

Nové oprávnění **„Vyplácet zálohy"** (`advances.manage`), `sensitive`.
Zvlášť od `payroll.*` — vydávat peníze a vidět mzdy jsou dvě různé věci.

Tabulka záloh: haléře jako `integer`, kladná částka, kdo vyplatil,
komu, kdy, potvrzení PINem, storno s důvodem. **Nemaže se.**
Upozornění zaměstnanci přes `notifications`, které už existují.

### 6. Zbývá k výplatě

Čtyři řádky na obrazovce výdělku a **volba firmy**, jak je počítat:
odečítat / jen ukázat / neukazovat. Výchozí **odečítat**.

Volba mění **jen zobrazení**, nikdy uložený záznam. Přepnutí nic
nepřepočítává a jde do auditu.

U řádku „zbývá k výplatě" musí být napsáno, že je to **před daněmi
a odvody**. Bez toho skončí první výplata hádkou u baru.

### 7. Ranní e-mail

Souhrn za **provozní** den (pravidlo 10), ne kalendářní. V e-mailu
počty a částky za pobočku, **jména a hodiny až v aplikaci**.

Píše ho kód, ne jazykový model (pravidlo 8). Adresáti a čas jsou
nastavení firmy. Odeslání se zaznamenává — přehled, o kterém si
majitel myslí, že chodí a on nechodí, je horší než žádný.

---

## Testy

Do `supabase/tests/` přidej scénář pro tenhle krok, ve stejném stylu
jako `krok5_scenar.sql`, a přidej ho do seznamu v `run.sh`.

**Pozor na to, na co jsi doteď narazit nemohl:** v PGlite běžíš jako
superuživatel a role `authenticated` tam není, takže se RLS ani práva
ke sloupcům neuplatní. Kontrola „kiosek nevidí mzdy" tam projde
i tehdy, kdyby je viděl. Co stojí na oprávněních, musí být ve scénáři
pod rolí `authenticated`.

Seznam kontrol je v oddílu 9 zadání. Míří na to, co **nemá** jít.

---

## Ranní zpráva

Jako minule, i když to bude vypadat hůř:

- co je hotové a commitnuté
- **co jsi NEOVĚŘIL a proč**
- na čem ses zastavil a jakou otázku to čeká
- obrazovky, na které jsi nedošel
