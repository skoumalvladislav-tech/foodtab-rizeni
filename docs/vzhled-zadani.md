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

---

## 11. Pravidlo vzhledu od 19.9.2026 — mockup Dnes

Předloha: `docs/vzhled-dnes-mockup-2026-09-19.webp`. Šéfík 19.9.2026: obrazovka
Dnes má vypadat **přesně** takto — ikony, rozložení oken, banner nahoře, styl
písma — a **totéž platí jako pravidlo pro všechna další okna**.

Tohle je nejnovější a platí nad tím, co říkají starší oddíly a poznámky.
Konkrétně **obrací** druhé kolo UX redesignu (16.9.2026), které patkové
Newsreader vyhodilo z nadpisů: vracíme se k oddílu 5 výš.

### Co platí v každém novém nebo přepracovaném okně

| Oblast | Pravidlo | Kde to je |
|---|---|---|
| Písmo | Nadpisy `h1`–`h3` a **velká čísla** patkovým Newsreader. Text, tlačítka, štítky Archivo. Rukopis (`--font-rukopis`) jen na podpis „Foodtab“ a značková hesla, **nikdy na čtený text**. | pravidlo `h1, h2, h3` a `.ds-cislo` v `app/_komponenty.css`; font v `app/layout.tsx` |
| Plochy | Bílá karta `.ds-plocha`: radius 16, jemný stín, linka 1 px. Hlavička panelu = obrysová ikona + `h2` + odkaz „… →“ vpravo. | `.ds-plocha*` v `_komponenty.css`, `PanelHlava` v `dnes/prvky.tsx` |
| Ikony | **Jen** ze sdílené sady `app/[rozsah]/ikona.tsx` (`<Ikona klic="…" />`), obrys na mřížce 20×20. Chybí-li ikona, přidá se **klíč** tam a do `IkonaKlic` v `nabidka.ts` — žádné vlastní SVG na místě a **žádné emoji**. | `ikona.tsx`, `nabidka.ts` |
| Přehledová karta | Ikona v tónované dlaždici (`dobre` / `info` / `pozor` / `bad`), titulek, hodnota patkově, popis, **jedno** tlačítko dole. Hlavní (zlaté) tlačítko jen jedno na kartu. | `KpiKarta` |
| Přízvuk | Mosaz `--mosaz-sv` přes `color-mix` s kartou: vybraný den 26 %, dnešek 22–40 %, víkend 11–28 %. **Barva nikdy sama** — vždycky i text nebo tvar (oddíl 7). | `_komponenty.css` |
| Banner | `Hero` na **Dnes** (domovská obrazovka). Fotku nahrává pobočka v Nastavení → Pobočky; vlevo překryv do `--paper`, aby seděl tmavý text. Bez fotky barva pobočky, **nikdy cizí snímek**. Ostatní okna mají běžný `Nadpis` (patkový `h1`); stejný banner jinde jen na výslovný pokyn. | `Hero`, `.ds-hero*` |
| Rozvržení | Hlavní sloupec + boční panel 272 px, který začíná na úrovni karet. Uvnitř hlavního sloupce se rozhoduje podle **jeho** šířky (container query), ne podle okna. Pod 1100 px jeden sloupec. | `.ds-dnes*` |

### Co se nekreslí, dokud nejsou data

Mockup ukazuje **Rychlý přehled** (tržby dnes, online objednávky, hodnocení
Google) a u počasí větu „Ideální den na zahrádku“. Appka na to nemá zdroj
dat a **čísla ani rady se nevymýšlejí** (viz `docs/dnes-obrazovka-zadani.md`,
oddíl 6). Sekce čeká na napojení; kdo ho bude dělat, nesmí do té doby dosadit
ukázkové hodnoty.

### Co se tímhle pravidlem NEZMĚNILO

Horní lišta a boční sloupec (`components/shell`) zůstaly, jak byly. Mockup
ukazuje jiné pořadí záložek („Dnes“ jako první) a ve sloupci všechny moduly
najednou; druhé kolo UX redesignu (oddíl 4) rozhodlo, že sloupec ukazuje jen
aktivní modul. To je **samostatné rozhodnutí** a čeká na Šéfíka.

### Než odevzdáš okno

1. Nadpisy a čísla jsou patková, text ne.
2. Každá ikona je z `ikona.tsx`; `grep` na `<svg` a emoji v nové obrazovce nic nenajde.
3. Karty jsou `.ds-plocha` / `KpiKarta`, ne nová `const karta = {…}`.
4. Světlý **i tmavý** režim jsou vidět — tokeny, žádná barva napevno.
5. Nic nepřetéká ve 375 px (mobil) ani ve 1536 px (desktop).

## 12. Směny na telefonu — mockup z 19.9.2026

Předloha: `docs/vzhled-smeny-mobil-mockup-2026-09-19.webp` — osm obrazovek
(denní přehled, moje směny, týden, detail, přidat směnu, filtry, push,
hlasové zprávy) ze Šéfíkova zadání „Směny 2.0“.

Mobilní Směny jsou jiná **prezentace** téhož rozpisu, ne druhý rozpis: data,
oprávnění a formulář jsou společné, desktopová mřížka zůstala. Přepíná se CSS
na 640 px (tam, kde je spodní lišta), ne JavaScriptem.

| Oblast | Pravidlo | Kde to je |
|---|---|---|
| Kdo vidí co | Vedoucí (`shifts.manage`): Den · Týden · Moje. Ostatní: Moje směny + Tým dnes. Rozhoduje oprávnění, ne název role. | `smeny/mobil/mobilni-rozpis.tsx` |
| Písmo | **Odchylka od oddílu 11:** nadpisy obrazovky a dne jsou tady **bezpatkové**, protože je takhle kreslí mockup. Platí jen uvnitř `.ds-sm` (třída `ds-sm-titul`); jinde se nic nemění. | `_komponenty.css`, blok „Směny na telefonu“ |
| Jména | Nikdy lámání uprostřed slova: `overflow-wrap: normal`, nejvýš dva řádky, pak tři tečky. | `.ds-sm-jmeno` |
| Barva | Nikdy jediný nositel významu: rozpracovaná směna je čárkovaná + text „rozpracováno“; neobsazená má „?“ a text; volno má slovo. | `PilulkaSmeny`, `AvatarM` |
| Dotyk | Cíle ≥ ~44 px (dny v pruhu jsou ~39–44 × 56 — sedm dnů se vedle sebe jinak nevejde). | `.ds-sm-den` |
| Hodiny | Součet plánovaných délek bez pauzy uvnitř směny (`lib/rozpis-mobil.ts`, `minutSmeny`). Neodečítá se automatická přestávka pobočky — to je pravidlo docházky. | `lib/rozpis-mobil.ts` |
| Okna | Detail a „Přidat směnu“ jsou celoobrazovkové stránky se šipkou zpět, filtry list zdola. Formulář je **týž** `FormularSmeny` s `varianta="list"`. | `mobil/sheet.tsx`, `formular-smeny.tsx` |
| Co se nekreslí | Menu „…“ v detailu (nebylo by co dát dovnitř), filtr podle role a zaměstnance, hlasové zprávy (jiný modul, poslední obrazovka mockupu). Smazání **vydané** směny se v mockupu jmenuje „Smazat“, v appce „Zrušit“ — tak to určuje databáze (`public.smazat_smenu`): vydaná směna zůstane stát jako zrušená a lidem zmizí až vydáním rozpisu. | — |
| Push | Poslední obrazovka mockupu ukazuje push se „Potvrdit“ a „Zobrazit“. Obsah i potvrzení hotové jsou, **kanál se nezapíná** bez Šéfíka — v aplikaci je to `notifications` (zdroj pravdy) a tlačítko Potvrdit v detailu směny. | `smeny/potvrzeni.ts` |

Před odevzdáním další mobilní obrazovky ověř stejně jako oddíl 11, navíc
360 px (nejmenší telefon) a že `scrollWidth` okna se rovná jeho šířce.

## 13. Směny a Docházka na počítači — pracovní plocha manažera (19.9.2026)

Zadání „Desktop Směny + Docházka UX 2.0“, předloha desktopového mockupu
Rozpisu (týden, panel „Upravit směnu“ vpravo). Mobilní část (oddíl 12)
se nezměnila — desktop je jiná **prezentace** týchž dat a týchž právech.

**Rozpis (týdenní mřížka je hlavní plocha):**

| Oblast | Pravidlo | Kde to je |
|---|---|---|
| Výška | Nadpis, jeden řádek nástrojů a (jen když je co vydávat) jeden úzký pruh. Mřížka zabere zbytek obrazovky a scrolluje sama v sobě; na 1536 × 864 je vidět 9–10 řádků. | `.ds-smd`, `smeny/desktop/` |
| Nástroje | `‹ 19.–25. září ›` · Dnes · Den/**7 dní**/Týden/Měsíc · hledání · Filtry. **7 dní** je výchozí a znamená sedm následujících dní od zvoleného dne (dnes = dnešek a šest dalších), **Týden** kalendářní týden od pondělí; šipky posouvají o sedm dní. Začátek okna počítá `zacatekOkna` (`lib/rozpis-konstanty.ts`) — server podle něj načítá i obrazovka podle něj kreslí, ať se nerozejdou. Hledání jde po jménu bez ohledu na diakritiku a filtruje řádky hned. | `desktop/nastroje.tsx`, `lib/rozpis-konstanty.ts`, `lib/rozpis-desktop.ts` |
| Zobrazit | Rychlá volba, co z rozpisu ukázat: **jedna pobočka** a pod ní **jeden úsek** (Plac, Kuchyně, Vedení…), plus „Všechny pobočky / Všechny úseky“. Tlačítko nese vybrané („Zobrazit │ Bernard · Plac“). Píše do týchž filtrů jako nabídka Filtry (`pobocky`, `useky`), takže se to ukáže jako čipy, počítá se do odznaku a jde to zrušit. Pobočka patří **směně**, ne člověku: kdo pracuje na dvou, má v každé jen její směny a hodiny. **Na čem se zakládá, sedí s tím, co je vidět:** je-li vybraná jedna pobočka, otevře se s ní každý formulář nové směny (tlačítko v záhlaví, „+ Přidat“ v mřížce včetně neobsazeného řádku, „+ Přidat“ v Celém měsíci) — jinak by směna vznikla na výchozí pobočce, hned ji odfiltroval rozpis a vypadalo by to, že se uložení nepovedlo. **Export** ze stejné obrazovky bere tutéž pobočku (`?pobocka=`; server si ji ověří proti pobočkám, na které člověk dosáhne). Odznak u tlačítka **Filtry** pobočku nepočítá a „Zrušit filtry“ ji nemaže — je to volba z jiné nabídky. V nabídce jsou jen pobočky, pro které se směny opravdu načítají (na pobočkovém rozsahu tedy jen ta jedna). Lidé bez směny se při výběru pobočky neukazují (nemají pobočku, na které by stáli). Nabídne se, jen když je víc poboček nebo aspoň jeden úsek. | `desktop/nastroje.tsx`, `lib/rozpis-desktop.ts` (`smenaVyhovuje`, `sestavitMrizku`) |
| Filtry | Jedna nabídka: úsek, pozice, **zaměstnanci (víc najednou, s hledáním v seznamu)**, stav směny. Aktivní jako čipy, každý člověk zvlášť. Neobsazená směna se filtrem úseku **neschová** (je to poplach), schová ji jen výslovný stav nebo zaměstnanec. | `lib/rozpis-desktop.ts` (`smenaVyhovuje`) |
| Celý měsíc vybraných lidí | Jsou-li vyfiltrovaní **jeden nebo dva lidé**, nabídne se pohled **Celý měsíc** (i odkaz „Ukázat celý měsíc“ u čipů): kalendář měsíce na každého zvlášť, dva vedle sebe od ~1200 px, jinak pod sebou. Prázdný den má „+ Přidat“ (formulář se otevře s člověkem a dnem; je-li vyfiltrovaný jeden člověk, i tlačítko „Přidat směnu“ nahoře), karta se upravuje klepnutím, vedle každého týdne jsou hodiny za týden a v hlavičce součet měsíce. Dny sousedních měsíců jsou ztlumené a nezakládá se do nich, ale jejich hodiny jsou v součtu týdne. Víc než dva lidé nebo zrušený filtr = zpět na 7 dní (v adrese `?pohled=osoby` zůstane). Přehledový „Měsíc“ (počty směn) se dál nezakládá schválně. **Zadávání celého měsíce:** u nové směny je v panelu i „Uložit a přidat další den“ — po uložení (bez varování) se rovnou otevře nový formulář se stejným člověkem, pobočkou, pozicí a časy na nejbližší den, který člověk nemá obsazený (`dalsiVolnyDen`), s větou „Uloženo: Čt 3. 9., 08:00–16:00“. S varováním se zůstane u výsledku, odkud jde „Přidat další den“ kliknout. Poznámka se neopisuje. | `desktop/mesic-lidi.tsx`, `lib/rozpis-desktop.ts` (`sestavitMesicOsoby`) |
| Prázdná buňka | Čistá. „+ Přidat“ až při najetí nebo zaměření. | `.ds-smd-pridat` |
| Karta směny | Tři stavy, každý s tvarem a slovem, ne jen barvou: vydaná (plný modrý rámeček), **Nevydáno** (přerušovaný jantarový + značka), **Změněno** po vydání (plný jantarový + značka). Původní stav je v `title` a v panelu. | `.ds-smd-smena`, `lib/rozpis-desktop.ts` (`stavSmeny`) |
| Jména | Nikdy lámání po znacích: mezi slovy nejvýš dva řádky, pak výpustka. Sloupec 196–216 px. | `.ds-smd-jmeno-text` |
| Hodiny | Za pozicí u člověka („Kuchařka · 32 h“), po dnech pod datem, po úsecích v hlavičce skupiny, celkem dole. Plánované délky bez automatické přestávky, neobsazené směny se nepočítají do lidí. Při zadávání směny formulář ukazuje průběžně „tento týden 32 h → 40 h“ — týden je kalendářní (pondělí–neděle) bez ohledu na pohled a ukáže se, jen když je celý týden načtený. | `mrizka.tsx`, `formular-smeny.tsx` |
| Pobočky | Pruh pobočky se kreslí **vždy**, i když je pobočka jediná (Šéfík 19. 9. 2026: „potřebuji zobrazit pobočku a pod ní jednotlivé úseky“) — dřív se při jedné schovával, takže po výběru pobočky v nabídce Zobrazit zmizel právě ten nadpis. Nese počet lidí a hodin jako hlavičky úseků a **dá se sbalit celý**, i s úseky pod ním. Hodiny jsou jen lidí, bez neobsazených směn — jinak by součet poboček nesouhlasil s „Celkem“ v patičce. | `desktop/mrizka.tsx`, `lib/rozpis-desktop.ts` (`PobockaMrizky`) |
| Úseky | Sbalitelné (`aria-expanded`), s počtem lidí a hodin. Neobsazené směny jsou jeden řádek nahoře, ne skupina. | `SkupinaMrizkyView` |
| Panel „Upravit směnu“ | Vpravo, **nemodální** (bez ztmavení, pod horní lištou) — rozpis zůstává vidět a jde přepnout na jinou směnu. Pole nižší než na telefonu (40 px), dva časy v jednom krátkém poli. Nahoře kdo a stav vůči vydanému rozpisu; dole docházka k té směně a potvrzení upozornění. | `components/ui/Drawer.tsx` (`nemodalni`), `desktop/hlavicka-smeny.tsx`, `desktop/panel-ke-smene.tsx` |
| Vydání | Pruh „7 změn čeká na vydání · 1 zaměstnanec bude upozorněn“ + [Zkontrolovat změny] (filtr Nevydané) + [Vydat rozpis]. Vydat otevře kontrolu: co se změnilo (`ST 08:00–16:00 → 10:00–18:00`), komu zazvoní. Číslo „komu zazvoní“ dává databáze (`rozpis_nahled`), přehled změn se skládá z týchž sloupců jako `app.rozdil_rozpisu`. Po vydání se ukáže výsledek (kolik zpráv odešlo, nebo co databáze odmítla) a vedoucí se vrátí na týž týden. | `desktop/vydani.tsx`, `zprava-vydani.tsx`, `vydani.ts` |
| Import a export | Import z tabulky je tlačítko v záhlaví (panel s průvodcem), ne trvalá karta. Export měsíce do Excelu (.xlsx) a PDF: `/api/smeny/export`, právo `shifts.manage`. **Celý měsíc na jedné stránce A4 na výšku** (Excel i PDF): dny jsou v řádcích, lidé ve sloupcích (jméno a pozice otočené o 90°), sloupec je tak široký jako čas směny, který se píše krátce („8–16“, „16–23:30“). **Úseky ani pobočky se v tabulce nekreslí** — úseky určují jen pořadí lidí; kdo pracuje na víc pobočkách, má pobočku **pod časem směny** (celým názvem, když se vejde, jinak zkratkou vysvětlenou pod tabulkou; u jedné pobočky se nepíše vůbec). Trhaná směna má pod časem drobně „pauza 15–17“. Písmo se volí největší, při kterém se měsíc vejde (9 až 6 bodů); nevejde-li se ani při 6, lidé se rozdělí na víc stránek/listů (každý s celým měsícem), nebo — je-li to méně papíru — se měsíc zlomí na druhou stránku se záhlavím znovu. Excel má listy Rozpis (přizpůsobeno na 1 × 1 stránku, záhlaví lidí otočené) a Souhrn (jméno, pozice, směny, hodiny). | `app/api/smeny/export/route.ts`, `lib/rozpis-export*.ts` |
| Písmo | Nadpis obrazovky je bezpatkový tučný (jako mobilní část a mockup); panely (`Drawer`) mají patkový nadpis podle oddílu 11. | `.ds-smd .ft-hlava h1` |

**Docházka (vedoucí s `attendance.read` na pobočce vidí živý přehled):**

| Oblast | Pravidlo | Kde to je |
|---|---|---|
| Karty | V práci · Čekáme (směna ještě nezačala) · Po začátku směny (příchod chybí) · Na místě dnes. **Žádné „Zpoždění“** — firma nemá pravidlo tolerance, takže by to byl vymyšlený práh. | `lib/dochazka-dnes.ts` |
| „Je v práci“ | Jedna definice = `app.otevreny_prichod` (nestornovaný, systémem neuzavřený příchod bez pozdějšího odchodu v témže provozním dni). Nikdy podle poslední události. | `lib/dochazka-dnes.ts` |
| Čas na místě | Od příchodu do odchodu (u lidí v práci do teď), bez odečtu přestávek — stejné číslo, které si člověk čte o sobě. Mzdy počítá `app.worked_minutes`. | `pritomnostOsoby` |
| Seznamy | Právě v práci · Ještě nepřišli · Odešli · Nesrovnalosti (směna skončila bez příchodu). Kdo se píchl mimo rozpis, má značku. | `dochazka/prehled/` |
| Panel člověka | Plán dne, příchod, odchod, na místě, záznamy dne; **Tento měsíc** (hodiny, hrubá mzda) jen s `payroll.read` — bere se z `employee_earnings`, ne z vlastního počtu. | `prehled/detail.tsx`, `detail-akce.ts` |
| Kiosk | Jen malý stav „Kiosk aktivní“ a odkaz na zařízení (s `settings.manage`). Kód z tabletu, jeho rotace ani kontrola se nezměnily. | `prehled/prehled.tsx` |
| Obnovování | Přehled se sám obnovuje každou minutu (jen na viditelné záložce). | `prehled/auto-obnova.tsx` |
| Vlastní píchačka | Zůstává pod přehledem („Moje docházka“). Majitel bez záznamu zaměstnance přehled vidí taky. | `dochazka/page.tsx` |

Před odevzdáním další desktopové obrazovky ověř: snímky 1536 × 864 (mřížka
zabírá většinu, viditelných 8–10 řádků), 1280, 1024 a tablet 768, tmavý
režim, a že telefon (oddíl 12) vypadá stejně jako předtím.
