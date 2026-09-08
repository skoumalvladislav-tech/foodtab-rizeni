# Noční práce na 8. 9. — bez přístupu k Supabase

**Pravidla noci jsou stejná a fungovala:** každý krok se dá nasadit
sám, na hranici kroku se dá skončit, a **na nic se neptáš.** Otázku
o provozu zapiš do `docs/hlaseni/otazky.md`, vyber nejopatrnější
variantu, do kódu napiš `// ROZHODNOUT: …` a **jdi na jiný krok.**

---

## Co je dnes v noci jinak

**Nasazování migrací je zablokované.** Šéfíkův účet Supabase je
propojený s GitHubem a přihlášení v CLI skončilo v jiném, prázdném
účtu. Dvě migrace tak leží nenasazené:

- `20260907010000_muj_den.sql`
- `20260907020000_ai_use_pryc.sql`

**Neřeš to a nepokoušej se přihlašovat.** Vyřeší se to ráno na tom
druhém počítači.

**Z toho plyne jediné pravidlo, ale platí na všechno:**

> **Každá obrazovka musí fungovat i tehdy, když její migrace ještě
> není v databázi.** Ne spadnout, ne bílá stránka — ukázat větu, že ta
> část přibude, a zbytek obrazovky nechat funkční.

Udělal jsi to tak u „Dnes" (`app/[rozsah]/dnes/page.tsx`, řádek 137)
a je to správně. **Drž se toho i u všeho dalšího dnes v noci.** Dokud
se nasazování nerozjede, poteče do produkce kód dřív než databáze —
a nesmí to nikoho vyhodit z aplikace.

Testy pouštěj jako obvykle proti své databázi. Já je proti opravdovému
PostgreSQL prověřím, až se k databázi dostanu.

---

## Krok 1 — Docházka: jedna odpověď na otázku „jsem v práci"

**Tohle je jediná skutečná chyba v ostrém provozu a je pořád tam.**
`app/[rozsah]/dochazka/page.tsx`, řádek 428:

```typescript
const { data: posledniData } = await supabase
  .from("attendance_events")
  .select("id, employee_id, kind, occurred_at, branch_id")
  .eq("employee_id", ja.id)
  .order("occurred_at", { ascending: false })
  .limit(1);
const jsemVPraci = posledni !== null &&
  (posledni.kind === "in" || posledni.kind === "break_end");
```

Nefiltruje `stornovano_kdy` ani `uzavreno_systemem`. **Po stornu tedy
obrazovka pořád nabízí „Odchod"** a člověk si píchne odchod k záznamu,
který neexistuje.

Popsal jsi to sám v komentáři k `20260907010000_muj_den.sql` — tři
různé definice jedné otázky. Teď to spoj: **jediný zdroj pravdy je
`app.otevreny_prichod`** (`20260905010000`).

Ta funkce nemá `authenticated` grant schválně, takže na ni udělej
průzor stejným způsobem jako u `muj_den`. A **dokud průzor v databázi
není, ať docházka běží dál** po staru — jen s doplněnými filtry
`stornovano_kdy is null` a bez systémem uzavřených, ať se to chová
správně už teď.

**Zkoušku napiš na to, co je rozbité:** píchni příchod, stornuj ho,
a ověř, že obrazovka nabízí **Příchod**, ne Odchod.

---

## Krok 2 — úklid toho, co zaměstnanec vidět nemá

Z `docs/rychlost-a-pohled-zamestnance.md`, část 2. Zbytek z minula, je
to skrývání, ne nová práce — a **nepotřebuje to databázi vůbec.**

1. **Řádka vypnutých modulů** (Tvorba menu, Finance, Marketing,
   Objednávky) jen tomu, kdo má `settings.manage`. Číšníkovi nabídka
   toho, co si firma může přikoupit, nepatří — a bere místo na
   telefonu, kde je ho nejmíň.
2. **Položky „Připravujeme"** (Receptury, Jídelní lístky, Motivace)
   zaměstnanec nevidí. Slib nepatří na denní nástroj.
3. **Vzkazy do spodní lišty místo Záloh.** Zálohy potřebuje člověk
   jednou za měsíc, vzkazy každý den.

---

## Krok 3 — Nástěnka: sjednotit adresáta s úkoly

Zadání: `docs/nastenka-dokumenty-a-strediska.md`, oddíl 1. **Jen
adresáta, přílohy ne** — ty potřebují nastavit úložiště v Supabase
a tam se dnes v noci nedostaneš.

Úkoly už se zadávají na pobočku, úsek, pozici nebo člověka
(`20260906040000`). Nástěnka umí jen firmu, pobočku a člověka.
**Tentýž výběr, ideálně tatáž komponenta.**

Není to pohodlí: dva různé způsoby výběru adresáta znamenají dvě různá
místa, kde se dá udělat chyba v oprávněních — a jedno se opraví
a druhé ne.

---

## Krok 4 — Playwright do CI

Na tohle databázi nepotřebuješ vůbec a odkládá se to už týden. Stačí
skromně: **projít přihlášením, Dnes, Docházkou a Vzkazy** a ověřit, že
se stránka vykreslí a nespadne.

Hlavní přínos není v tom, co to chytí dnes. Je v tom, že až budeš
příště měnit rozhraní, poznáš rozbitou obrazovku dřív než Šéfík
v provozu.

---

## Co v noci nedělat

- **Přihlašovat se k Supabase, nasazovat, `db push`.** Ani nasucho.
- **Přílohy a úložiště.** Potřebuje to nastavení v Supabase.
- **Kiosek a prohlížeč v něm.** Samostatná úvaha.
- **Push do mobilu, doba uchování, jazykový model.** Pořád platí.

---

## Ráno

Hlášení do `docs/hlaseni/stav-2026-09-08.md`: co je hotové s commity
a soubory, na které hranici jsi skončil, čísla kontrol **a z čeho
jsou**, co čeká na Šéfíka, otevřené otázky — a hlavně **na co jsi
narazil a nešlo to.**

**A pushni.** Co není v repozitáři, to pro nás neexistuje.
