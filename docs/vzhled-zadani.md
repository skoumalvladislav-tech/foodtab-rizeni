# Zadání: přebarvení rozhraní na krém a mosaz

Odsouhlaseno 28. 8. 2026. Předloha: `docs/vzhled-predloha.html` — otevři si ji
dřív, než začneš psát. Otevírá se dvojklikem, žádný server nepotřebuje.

Tohle **nahrazuje** dosavadní indigový vzhled podle
`docs/rozvrzeni-nahled.html`. Rozvržení z něj ale platí dál — mění se barvy,
písmo a několik ploch, ne struktura obrazovek.

---

## 1. Co se mění a co ne

**Mění se:**

- `app/_tokeny.css` — celá paleta
- `app/globals.css` — horní lišta a boční sloupec dostanou tmavý podklad;
  aktivní položky přejdou na mosaz; nadpisy na patkové písmo
- `app/[rozsah]/layout.tsx` — firemní úroveň dostane vlastní klíč barvy
- `app/layout.tsx` — načtení dvou písem

**Nemění se, ani když najdeš důvod:**

- `lib/authz.ts`, `lib/supabase/*` — vzhled se autorizace nedotýká
- žádná migrace, žádný zásah do databáze
- seznam klíčů v `branches.color` a jejich přidělování
- struktura obrazovek, adresy, názvy komponent
- třídy `ft-*` — přebarvují se, nepřejmenovávají

---

## 2. Proč to nepotřebuje migraci

V databázi je u pobočky uložený **klíč** (`indigo`, `amber`, …), ne odstín.
Který odstín ke klíči patří, rozhoduje výhradně CSS. Přebarvení celé aplikace
je proto změna hexadecimálních hodnot v jednom souboru.

Tohle pravidlo platí dál. Nikdy neukládej do databáze konkrétní barvu.

---

## 3. Jedna nová věc: firemní úroveň má vlastní klíč

Dneska firemní úroveň vrací `"slate"` (`app/[rozsah]/layout.tsx`, funkce
`barvaRozsahu`). Jenže `slate` je zároveň osmá barva, kterou přidělovací
spouštěč dá osmé pobočce. Ve staré indigové verzi to nevadilo — barva byla
jen tečka u názvu. V nové verzi se jí barví celá lišta i sloupec, takže by
firma a osmá pobočka vypadaly úplně stejně.

**Oprava, celá v aplikaci:**

1. V `barvaRozsahu` vracej pro firemní úroveň `"firma"` místo `"slate"`.
   Totéž na řádku, kde se skládá volba „Celá firma" do přepínače rozsahu.
2. V `_tokeny.css` přidej klíč `firma` k osmi stávajícím.
3. Do databáze nesahej. `slate` zůstává přidělitelný pobočkám.

Kdyby se někdy `firma` omylem dostala do `branches.color`, nic se nerozbije —
jen ta pobočka bude zelená jako firma. Kontrolu do databáze kvůli tomu
nepřidávej, není to bezpečnostní věc.

---

## 4. Barvy

Zdroj pravdy je předloha. Tady je stejná paleta rozepsaná pro všech devět
klíčů, protože v předloze jsou vidět jen tři.

### 4.1 Základ — světlý

```
--paper   #f6f2e9    --ink    #16211c    --line    #e4ddcc
--card    #fffdf7    --muted  #617066    --line-2  #d3c9b3
--sunken  #efe9dc    --faint  #808f84

--mosaz     #916624   text a linky v mosazi na světlém
--mosaz-sv  #d8ab4e   plocha mosazi na tmavém, text na ní #17251e

--dobre  #2c7657   --dobre-bg  #dbeee4
--pozor  #b04519   --pozor-bg  #fbe4d8
--bad    #a3241d   --bad-bg    #fbe0dd
```

### 4.2 Základ — tmavý

```
--paper   #0c1310   --ink    #e9efea   --line    #1e2b25
--card    #141d19   --muted  #93a89c   --line-2  #2a3b33
--sunken  #101815   --faint  #6b7d73

--mosaz     #d9ac54   --mosaz-sv  #eac878
--dobre  #5fc79c   --dobre-bg  #0f2b22
--pozor  #f0855a   --pozor-bg  #33170c
--bad    #f4837c   --bad-bg    #331313
```

### 4.3 Barva rozsahu — světlý režim

`--rail` je horní lišta, `--rail-2` boční sloupec, `--rail-tlum` tlumený text
na obojím. `--rail-ink` je `#f1ece0` pro všechny klíče.

| klíč | `--rail` | `--rail-2` | `--rail-tlum` |
|---|---|---|---|
| `firma` | `#143126` | `#21483a` | `#97b4aa` |
| `slate` | `#1c2429` | `#2b363e` | `#8fa1ae` |
| `indigo` | `#18172e` | `#262444` | `#8d8cab` |
| `violet` | `#24172e` | `#372444` | `#9e8cab` |
| `sky` | `#132732` | `#203b49` | `#92a6b0` |
| `teal` | `#133232` | `#204949` | `#97b4b4` |
| `emerald` | `#133222` | `#204934` | `#97b4a6` |
| `amber` | `#36240e` | `#503619` | `#b2a495` |
| `rose` | `#2f161b` | `#45232a` | `#ab8c92` |

### 4.4 Barva rozsahu — tmavý režim

| klíč | `--rail` | `--rail-2` | `--rail-tlum` |
|---|---|---|---|
| `firma` | `#081410` | `#0e221b` | `#7c9c91` |
| `slate` | `#0b0f11` | `#13191d` | `#7c8f9c` |
| `indigo` | `#0a0913` | `#111020` | `#7e7c9c` |
| `violet` | `#0f0913` | `#1a1020` | `#8f7c9c` |
| `sky` | `#081015` | `#0e1c23` | `#7c929c` |
| `teal` | `#081515` | `#0e2323` | `#7c9c9c` |
| `emerald` | `#08150e` | `#0e2318` | `#7c9c8c` |
| `amber` | `#160f06` | `#26190a` | `#9c8d7c` |
| `rose` | `#13090b` | `#211013` | `#9c7c83` |

### 4.5 Stávající `--branch`, `--branch-fill`, `--branch-soft`

Zůstávají. Používají je obrazovky uvnitř, kde je podklad papírový — tečky
u názvu pobočky, štítky, obrysy. Přebarvi je do stejného zemitého rejstříku
jako lištu, ale drž pravidlo, které už znáš:

- text na výplni ≥ 4,5:1
- **výplň proti okolní ploše ≥ 3:1** (WCAG 1.4.11)

Ta druhá podmínka je ta, na kterou se minule zapomnělo. V tmavém režimu to
znamená středně světlou sytou výplň s tmavým textem, ne skoro černou výplň se
světlým textem.

### 4.6 Zápis v `_tokeny.css`

Struktura souboru zůstává, jen se doplní řada `firma`:

```css
[data-branch="firma"] {
  --rail: #143126; --rail-2: #21483a; --rail-tlum: #97b4aa;
  --branch: …; --branch-fill: …; --branch-soft: …;
}
```

Tmavý režim se pořád píše **dvakrát** — jednou pod `prefers-color-scheme`
se strážcem `:root:not([data-theme="light"])`, podruhé pod
`:root[data-theme="dark"]`. Důvod je v komentáři nahoře v souboru; nezkracuj to.

---

## 5. Písmo

```
nadpisy a velká čísla   Newsreader        (patkové)
rozhraní a text         Archivo           (bezpatkové)
```

Načíst v `app/layout.tsx` přes `next/font/google`, ne `<link>` — jinak se
při každém načtení stránky čeká na cizí server. Každému písmu dej skutečný
záložní seznam (`Georgia, serif` a `system-ui, sans-serif`), ať stránka není
nečitelná, když se písmo nestáhne.

Patkové písmo patří nadpisům a číslům, ne odstavcům a ne tlačítkům.

---

## 6. Plochy

### Horní lišta `.ft-topbar`

- podklad `--rail`, text `--rail-ink`, tlumený text `--rail-tlum`
- zůstává v ní: značka, záložky modulů, vyhledávání, přepínač rozsahu, ozubené kolo
- značka `Foodtab`: čtvereček `--mosaz-sv` s textem `#17251e`
- aktivní modul `.ft-mod.on`: podklad `--rail-2`, text `--rail-ink`
- vypnutý modul `.ft-mod.off`: `--rail-tlum` a přeškrtnutí — zůstává vidět,
  ale nedá se otevřít
- **vyhledávání je nové:** pole s popiskem „Hledat nebo se zeptat Gastro AI".
  Zatím jen zaměření a vzhled, žádné volání modelu. Až se bude připojovat,
  platí pravidlo 8 z `CLAUDE.md` — mzdy a docházka do modelu nejdou.

### Boční sloupec `.ft-side`

- podklad `--rail-2`, text `--rail-ink`
- nadpisky skupin: `--rail-tlum`, verzálky, prostrkání `.15em`
- **aktivní položka `.ft-nav a.on`: podklad `--mosaz-sv`, text `#17251e`**

  Tohle je oprava proti tomu, co bylo v prvním návrhu. Tmavá mosaz s bílým
  textem dávala 3,88:1 — pod hranicí — a plocha se od sloupce skoro nelišila.
  Světlá mosaz s tmavým textem dává 7,5:1 a plocha proti sloupci nejméně
  4,7:1 u všech devíti klíčů. Neotáčej to zpátky.

- „připravujeme" položky: `--rail-tlum` a slovní značka, ne jen bledší odstín

### Obsah `.ft-main`

- podklad `--paper`, karty `--card` s obrysem `--line`
- nadpisek nad sekcí („oči"): `--mosaz`, verzálky, prostrkání, 10,5 px
- pruhy a proužky grafů: `--mosaz` na světlém, `--mosaz-sv` na tmavém

### Mobil a tablet

Chování z `docs/rozvrzeni-nahled.html` platí beze změny: pod 900 px se sloupec
sklopí do spodní lišty, moduly do vodorovného pásu pod horní lištou. Jen se
přebarví. Spodní lišta má podklad `--card`, aktivní položka `--mosaz`.

---

## 7. Co barva **nesmí** dělat

Tohle je pořád v platnosti a nová paleta na tom nic nemění:

- **Barva sama nikdy nenese informaci.** Vedle barevné tečky je vždycky
  název. Kdo barvy nerozezná, musí aplikaci ovládat úplně stejně.
- **Varování se od běžného stavu liší tvarem, ne odstínem.** Vyplněný štítek
  + ikona + slovo. Když se `--pozor` sejde s jantarovou pobočkou, nesmí se
  stát, že varování splyne s výzdobou.
- **Zaměření je vidět.** `:focus-visible` obrys `--mosaz` (na tmavém
  `--mosaz-sv`), odsazení 1 px. Nikdy `outline: none`.

---

## 8. Kontrast — jak to ověřit

Všechny dvojice v předloze jsou spočítané, ne odhadnuté. Než něco odevzdáš,
spočítej to znovu — hlavně když jsi odstín jen „trochu" posunul.

Hranice:

- text a ikony nesoucí význam: **4,5:1**
- plochy, obrysy, ovládací prvky: **3:1** (WCAG 1.4.11)
- `--faint` je jediná výjimka: 3:1, a smí nést **jen výzdobu** — oddělovače,
  tečky, dekorativní čísla. Nikdy text, který někdo potřebuje přečíst.

Zkontroluj u všech devíti klíčů, v obou režimech:

| dvojice | hranice |
|---|---|
| `--rail-ink` na `--rail` | 4,5 |
| `--rail-tlum` na `--rail` i `--rail-2` | 4,5 |
| `#17251e` na `--mosaz-sv` | 4,5 |
| plocha `--mosaz-sv` proti `--rail-2` | 3,0 |
| `--mosaz` na `--paper` i `--card` | 4,5 |
| `--muted` na `--paper` i `--card` | 4,5 |
| `--dobre` na `--dobre-bg`, `--pozor` na `--pozor-bg` | 4,5 |
| `--branch-fill` proti okolní ploše | 3,0 |

Výsledky napiš do zprávy jako tabulku s čísly. „Zkontrolováno, je to v pořádku"
nestačí — minule to takhle prošlo a neprošlo.

---

## 9. Pořadí práce

1. Písma do `app/layout.tsx`, ověř, že se stránka vykreslí i bez sítě.
2. `_tokeny.css` — celá paleta včetně klíče `firma`.
3. `layout.tsx` — firemní úroveň vrací `"firma"`.
4. `globals.css` — lišta, sloupec, aktivní položky, nadpisy.
5. Projdi všechny hotové obrazovky a najdi místa, kde zbyla stará barva
   napevno. Hledej `#` v `globals.css` mimo blok tokenů.
6. Kontrastní tabulka.
7. Porovnej se předlohou vedle sebe — stejné rozestupy, stejné velikosti písma.

Commituj po krocích, ne jedním balíkem. Kdyby se něco pokazilo, ať se dá
vrátit jen ta část.

---

## 10. Co odevzdat

- rozdíl proti `main`
- kontrastní tabulka s čísly
- seznam míst, kde jsi našel barvu napevno mimo tokeny
- seznam obrazovek, které jsi **neprošel**, když jsi na nějakou nedošel

Poslední bod ber vážně. Nedodělaná obrazovka, o které vím, je lepší než
dodělaná, o které si to jen myslím.
