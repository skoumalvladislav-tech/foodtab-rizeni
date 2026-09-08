# Zařazení — čísla z ostré databáze

Změřeno 8. 9. 2026 v `foodtab-test` (kde leží ostrá data) přes konektor
Supabase, čtecím dotazem. **Tohle jsou skutečná data, ne odhad.**

Nahrazuje oddíl 2 v `docs/zarazeni-opravy-zadani.md` — převod se už psát
může.

---

## 1. Co v databázi je

**Role** ve firmě Foodtab s.r.o.:

| role | práv | členů |
|---|---|---|
| Majitel *(is_owner)* | 0 | **2** |
| Bar | 10 | 1 |
| Kuchyně | 9 | 1 |
| Provozní | 29 | **0** |
| Vedoucí směny | 13 | **0** |
| Servis | 6 | **0** |
| Účetní | 2 | **0** |

**Zařazení** (`positions`):

| zařazení | aktivní | lidí |
|---|---|---|
| Barman | **ne** | 2 |
| Kuchař/ka | ano | 1 |
| Majitel/ka | ano | 1 |
| Pomocný kuchař/ka | ano | 1 |
| Číšník | **ne** | 0 |
| Číšník/servírka | ano | 0 |
| Obsluha brigáda | ano | 0 |
| Výpomoc | ano | 0 |

**Lidé** — 14 celkem, z toho **jen 4 mají účet s rolí**:

| zařazení | role | lidí |
|---|---|---|
| Majitel/ka | Majitel | 1 |
| *(žádné)* | Majitel | 1 |
| Barman | Bar | 1 |
| Kuchař/ka | Kuchyně | 1 |
| Barman | *(bez účtu)* | 1 |
| Pomocný kuchař/ka | *(bez účtu)* | 1 |
| *(žádné)* | *(bez účtu)* | 8 |

---

## 2. Šest věcí, které z toho plynou

### 2.1 Dva majitelé — potvrzeno na datech

Tvůj nález sedí. Index na jednoho majitele **zůstává zrušený.**

### 2.2 Každý člen má záznam zaměstnance

Dotaz na členy bez záznamu vrátil **prázdno**. Odpadá tím celá jedna
starost: nikdo nezůstane po převodu bez zařazení proto, že nemá kam ho
uložit.

### 2.3 Průnik by vyrobil prázdno — a tiše sebral práva

**Tohle je ta nejdůležitější oprava.**

Zařazení **Barman** mají dva lidé: jeden s rolí Bar (10 práv), druhý
bez účtu (žádná práva). Průnik přes *všechny* lidi s tím zařazením —
jak to stálo v mém zadání — je tedy **prázdná množina**. Barman by
nedostal nic, všech deset práv by spadlo do výjimek a živé pravidlo
„změna zařazení platí hned všem" by bylo mrtvé v den nasazení.

**Oprava: do průniku počítej jen lidi, kteří mají aktivní roli.**
Kdo účet nemá, do něj nevstupuje — nemá dnes žádná práva, takže o nich
nemůže rozhodovat.

Po téhle opravě vychází převod triviálně: **Barman ← práva role Bar,
Kuchař/ka ← práva role Kuchyně.** Žádná výjimka není potřeba ani jedna.

### 2.4 Neaktivní zařazení se přeskočit nesmí

**Barman má `active = false`** a přitom na něm visí člověk s rolí Bar.
Kdyby převod bral jen aktivní zařazení, ten člověk přijde o deset práv
a nikdo si toho nevšimne.

Ber **všechna** zařazení bez ohledu na `active`.

### 2.5 Čtyři role nemají členy — a přesto se nesmějí zahodit

Provozní (29 práv), Vedoucí směny (13), Servis (6) a Účetní (2) jsou
**prázdné**. Kdyby převod vytvářel zařazení jen z rolí, které někdo má,
těchhle padesát zaškrtnutých práv zmizí.

Šéfík je zítra bude potřebovat — jsou to připravené sady pro lidi,
které právě zve. **Z každé takové role udělej zařazení téhož jména
a s týmiž právy, i když ho zatím nikdo nemá.**

### 2.6 `ai.use` — past v pořadí migrací

`ai.use` sedí v ostré databázi na **pěti rolích** (Bar, Kuchyně,
Provozní, Servis, Vedoucí směny) a migrace `20260907020000_ai_use_pryc`
**ještě není nasazená.**

Kdyby se převod pustil dřív než ona, `ai.use` se zkopíruje do
`position_permissions` — a `ai_use_pryc` už ho tam neuklidí, protože
míří na `role_permissions`. Zůstalo by právo k modulu, který neexistuje.

Časové razítko to řeší samo (`20260908…` je po `20260907020000`), takže
**stačí to nerozbít**: novou migraci nedatuj dozadu a v komentáři napiš
proč.

---

## 3. Převod dat — konečná podoba

1. **Majitelé** (`roles.is_owner`, 2 lidé) → `je_majitel = true`.
   Práva se jim nepřevádějí, prochází zkratkou jako dnes.
2. **Pro každé zařazení** spočítej průnik práv lidí, kteří ho mají
   **a zároveň mají aktivní roli**. Lidi bez účtu do průniku nepatří.
   Ber i zařazení s `active = false`.
3. **Co má člověk navíc** oproti tomu průniku → výjimka `granted = true`.
   *(Na dnešních datech nevyjde ani jedna. Napiš to stejně — jednou
   vyjde.)*
4. **Pro každou roli bez členů** založ zařazení téhož jména a s týmiž
   právy. Nikoho na ně nepřiřazuj.
5. Nikomu **neměň `position_id`**. Na plánování směn se nesahá.

Závazné pravidlo z původního zadání 5.4 platí beze změny: **po převodu
má každý přesně ta práva, co dnes.** Kontrola „před a po" ve scénáři to
musí doložit, ne slíbit.

---

## 4. Co napsat Šéfíkovi do hlášení

Převod nechá v aplikaci **dvanáct zařazení** a některá vypadají jako
dvojí pojmenování téhož:

- **Barman** *(neaktivní, 2 lidé)* vedle nové role **Bar**
- **Číšník** *(neaktivní, 0 lidí)*, **Číšník/servírka** *(0 lidí)*
  a nová **Servis**
- **Majitel/ka** vedle příznaku majitele

**Neslučuj to sám.** Které je které, ví jen Šéfík — a sloučit dvě
zařazení znamená rozhodnout, kdo bude mít jaká práva. Vypiš mu ten
seznam do hlášení a nech to na něm.

---

## 5. A jedna dobrá zpráva mimo pořadí

**`20260907010000_muj_den` v ostré databázi UŽ JE.** Nasazená chybí jen
`20260907020000_ai_use_pryc`.

Takže obrazovka **Dnes** funguje a docházka po tvé opravě chodí rovnou
přes `public.muj_den`, ne přes náhradní cestu. Ta náhradní cesta tam
ale ať zůstane — je správně napsaná a příště se bude hodit.
