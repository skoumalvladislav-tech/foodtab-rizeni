# Zadání: hodinová sazba a průběžný výdělek

Zadal Šéfík 30. 8. 2026.

Každý pracovník má hodinovou sazbu. Sám si vidí, kolik má za tenhle měsíc
odpracováno a vyděláno. Kromě něj to vidí majitel a lidé s příslušným
oprávněním. Nikdo jiný.

**Tohle je nejcitlivější data, jaká v aplikaci zatím jsou.** Čtěte celé,
zvlášť oddíly 5 a 6. Než něco odevzdáte, projděte si znovu pravidlo 8
z `CLAUDE.md`.

---

## 1. Co Šéfík rozhodl

| otázka | odpověď |
|---|---|
| Chybí píchnutí příchodu nebo odchodu | Den se **nezapočítá** a u částky je vidět „3 dny bez docházky" |
| Příplatky (noční, víkend, svátek) | **Žádné.** Sazba je vždy stejná |
| Různá sazba podle pobočky | **Ne.** Jedna sazba na osobu |

Příplatky se nedělají teď, ale tabulka sazeb je má unést později bez
přepisování už zadaných dat.

---

## 2. Sazba je historie, ne jeden údaj

**Nedávejte sazbu jako sloupec do `employees`.** Když dostane někdo
1. října přidáno a sazba se přepíše, přepočítá se mu tím i září —
a nikdo si toho nevšimne, dokud se nepřijde hádat o výplatu.

Nová tabulka:

```
employee_rates
  id             uuid
  tenant_id      uuid            -- RLS, jako všude
  employee_id    uuid
  hourly_haleru  integer         -- v haléřích, ne float (CLAUDE.md)
  valid_from     date            -- od kterého provozního dne platí
  note           text            -- „přidáno po zkušební době"
  created_by     uuid
  created_at     timestamptz
```

- Zvýšení sazby = **nový řádek**, ne úprava starého.
- Řádky se nemažou. Oprava překlepu se dělá novým řádkem se stejným
  `valid_from`; platí ten poslední založený.
- Pro daný den platí řádek s nejvyšším `valid_from`, který není v budoucnu.
- Člověk bez sazby není chyba — brigádník, kterého ještě nikdo nenacenil.
  Výdělek se mu nepočítá a je u něj napsáno, že sazba chybí.

Do `permissions` přibývají dvě položky — **jako řádky v tabulce, ne jako
`if` v kódu** (pravidlo 2):

- `wages.read` — vidí sazby a výdělky ostatních
- `wages.manage` — zadává a mění sazby

**Obě se zakládají s `sensitive = true`.** Ten příznak už v tabulce je
a něco dělá: role s citlivým oprávněním nejde pozvat přes SMS, jen
e-mailem (`app.create_invitation`). U mezd to platit má.

---

## 2b. Role — a jedna past, kterou je nutné obejít

### Past: Provozní by obě oprávnění dostal sám od sebe

V `20260823120100_catalog.sql` je tenhle řádek:

```sql
insert into app.role_template_permissions (template_key, permission_key)
select 'provozni', key from public.permissions
where key not in ('agents.manage', 'settings.manage');
```

Provozní tedy dostává **všechno kromě dvou vyjmenovaných věcí**. Ve chvíli,
kdy se do `permissions` přidá `wages.read` a `wages.manage`, spadnou mu do
role taky — a nikdo si toho nevšimne, protože ten řádek napsal někdo jiný
před měsíci.

**Do výjimky se proto přidávají obě nová oprávnění:**

```sql
where key not in ('agents.manage', 'settings.manage',
                  'wages.read', 'wages.manage')
```

A připište k tomu komentář ve stejném duchu jako u pozvánek: kdo bude
příště přidávat citlivé oprávnění, musí ten seznam rozšířit taky.

### Kdo co dostane u nové firmy

| role | `wages.read` | `wages.manage` |
|---|---|---|
| **Majitel** | ano | ano |
| **Účetní** | ano | ne |
| **Provozní** | ne | ne |
| Vedoucí směny, Kuchyně, Servis, Bar | ne | ne |

Majitel nepotřebuje řádek v `role_template_permissions` — dostává všechno
z aktivních modulů přes `app.has_access`, přesně jak je to popsané v komentáři
u šablon.

Účetní už `payroll.export` má, takže podklady ke mzdám vidí tak jako tak;
`wages.read` je s tím v souladu. `wages.manage` nedostává — účetní mzdy
vyplácí, nestanovuje je.

Provozní je schválně bez obojího. V malém provozu to bývá jeden člověk
a Šéfík mu právo dá sám, když bude chtít. Opačné pořadí — nejdřív dát
a pak odebírat — se u mezd nedělá.

### Stávající firmy se nepřepisují

Šablony platí pro **nově zakládané** firmy. Do rolí, které už u Šéfíka
existují, se migrací nesahá — přidělení role je podle pravidla 1 data
zákazníka, ne kód, a migrace, která mlčky rozšíří někomu oprávnění,
je přesně to, co se u mezd stát nesmí.

Prakticky to nic neblokuje: Šéfík je majitel, takže na mzdy vidí hned.
Komu dalšímu je dá, rozhodne na obrazovce **Role** — a ta tím pádem
přestává být „BRZY" a stává se z ní další úkol.

---

## 3. Výpočet

Hodiny se berou **výhradně z uzavřené docházky** — tedy z dvojic příchod
a odchod, kde je obojí zapsané.

- Rozpracovaná docházka (příchod bez odchodu) se nepočítá, dokud se
  neuzavře.
- Den se zařazuje podle **provozního dne** (`app.business_date`), ne podle
  kalendáře. Odchod ve 2:15 patří do včerejška.
- „Tenhle měsíc" znamená provozní dny od prvního do posledního dne měsíce.
- Sazba se bere ke dni směny, ne k dnešku.

Výsledek pro člověka a měsíc:

```
odpracovano_minut  integer
vydelano_haleru    integer
dnu_bez_dochazky   integer    -- dny s plánovanou směnou a bez uzavřené docházky
sazba_chybi        boolean
```

`dnu_bez_dochazky` je ten Šéfíkův požadavek: nezapočítat, ale ukázat, že se
něco nedopočítalo.

Počítá se to **v databázi**, ne v prohlížeči. Do prohlížeče jde hotové
číslo, nikdy sazba někoho jiného.

---

## 4. Co uvidí kdo

**Sám o sobě — vždycky, bez oprávnění.** Svou sazbu a svůj výdělek vidí
každý, kdo má účet a je propojený se zaměstnancem. Na vlastní mzdu není
potřeba právo.

**O ostatních — jen s `wages.read`.** Bez něj se sloupec se sazbou
v seznamu lidí vůbec nevykreslí a funkce nic nevrátí. Pozor: `people.manage`
**nestačí**. Kdo spravuje lidi, nemusí vidět na mzdy — to jsou dvě různé
role a v malém provozu to bývá dokonce jeden člověk a jeho účetní.

**Zadávat sazby — jen s `wages.manage`.**

Rozsah platí i tady: kdo má `wages.read` jen na jednu pobočku, vidí výdělky
jen jejích lidí (pravidlo 4 — `branch_id` z prohlížeče se vždy ověřuje
proti členství).

---

## 5. Bezpečnost — tohle se nesmí obejít

1. **Sazby a výdělky nikdy nejdou do jazykového modelu.** Pravidlo 8.
   Agent dostane podíl nákladů na tržbě, ne jména a částky. Když budete
   psát cokoli, co posílá data agentovi, tyhle tabulky do toho nesmí.

2. **Dvě obranné linie.** Kontrola v aplikaci **a** RLS na
   `employee_rates`. Ani jedna se nevynechá.

3. **Přes API se nečte celá tabulka.** Stejně jako u pozvánek: `select *`
   nad sazbami skončí chybou. Aplikace dostane úzké funkce v `public`:
   - `public.my_earnings(p_tenant uuid, p_month date)` — vlastní výdělek
   - `public.employee_earnings(p_tenant uuid, p_month date, p_branch uuid)`
     — výdělky lidí, na které mám právo
   - `public.set_rate(...)` — založí nový řádek sazby

4. **Každá změna sazby jde do auditu** — kdo, kdy, z kolika na kolik.
   U mezd se dřív nebo později někdo zeptá „kdo to změnil".

5. **Klíč `service_role` se toho nedotkne.** Obchází RLS.

---

## 6. Jak to napsat na obrazovku

Tohle není kosmetika. Lidé si to číslo přečtou jako slib.

- **Vždycky napsat, že je to hrubá mzda.** Ne „Vyděláno 18 400 Kč", ale
  **„Hrubá mzda za srpen — orientačně"**. Odvody, zálohy, srážky ani
  příplatky v tom nejsou.
- Pod částkou vypsat, z čeho vyšla: `84 h 30 min · 220 Kč/h`.
- Když chybí docházka: **vyplněný štítek se slovem**, ne jen jiný odstín —
  „3 dny bez docházky" (pravidlo o tvaru, ne barvě). A skloňovat:
  1 den, 2–4 dny, 5+ dnů.
- Když chybí sazba: „Sazba není zadaná" a nic nepočítat. Nikdy nula Kč —
  nula vypadá jako výsledek, ne jako chybějící údaj.
- Částky v celých korunách, v databázi haléře.

Kde to je:

- **Lidé** (`nastaveni/lide`): sloupec Sazba, jen s `wages.read`. Úprava
  jen s `wages.manage`, formulář zakládá nový řádek s `valid_from`.
- **Docházka** (`dochazka`): dlaždice s výdělkem za tenhle měsíc, vedle
  odpracovaných hodin, a u vlastního záznamu průběžný součet za měsíc.
  Původně to mělo být na Mých směnách — ta obrazovka se ale do Docházky
  sloučila, takže obojí patří sem.

---

## 7. Testy

Nový `supabase/tests/krok4_scenar.sql`. Kontroly musí ověřovat, že se
někdo **nedostane** tam, kam nemá:

1. Číšník **nevidí** sazbu kolegy — ani přes `employee_earnings`,
   ani přímým dotazem na `employee_rates`.
2. Číšník **vidí** svou vlastní sazbu i výdělek, bez jakéhokoli oprávnění.
3. Uživatel s `people.manage`, ale bez `wages.read`, **nevidí** sazby.
4. Vedoucí s `wages.read` jen na Bernardu **nevidí** výdělky lidí z Perly.
5. `select * from employee_rates` jako `authenticated` **selže**.
6. Výdělek se počítá jen z uzavřené docházky — rozpracovaný příchod
   částku nezvýší.
7. Zvýšení sazby uprostřed měsíce **nezmění** dny před `valid_from`.
8. Den, který provozně patří do včerejška (odchod ve 2:15), se počítá
   do včerejšího měsíce, když je to přelom.

Bod 7 a 8 jsou ty, na kterých se to obvykle láme.

---

## 8. Pořadí

1. Migrace: `employee_rates`, obě oprávnění, RLS a politiky.
2. Výpočetní funkce v `app`, průzory v `public`.
3. `krok4_scenar.sql` — a spustit, než se napíše jediný řádek rozhraní.
4. Sloupec Sazba na obrazovce Lidé.
5. Dlaždice výdělku pro sebe.
6. Audit změn sazby.

Bod 3 před bodem 4 schválně. Když se rozhraní napíše dřív, testuje se
pak proti tomu, co kód dělá, ne proti tomu, co má dělat.
