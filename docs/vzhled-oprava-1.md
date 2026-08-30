# Oprava 1 k zadání vzhledu

Odsouhlaseno 30. 8. 2026 po prohlídce běžící aplikace. Doplňuje
`docs/vzhled-zadani.md` — **tabulky v §4.3 a §4.4 nahrazuje ta zdejší**,
zbytek zadání platí beze změny.

Čtyři body. První je oprava mé chyby, zbylé tři jsou z původního zadání
a zatím nejsou hotové.

---

## 1. Barvy rozsahu byly moc tmavé a splývaly

Přepínání barvy je zapojené správně — `data-branch` se mění, pravidla se
chytají, tmavý režim funguje. Chyba je v odstínech, které jsem zadal.

Dal jsem všem devíti klíčům stejnou světlost 13,5 %. Při takové tmě už
oko odstín nerozezná. **Celá firma a Bernard Bar (klíč `emerald`) mají
barevnou vzdálenost 2,4** — pro oko tatáž barva. Šest dvojic z devíti
klíčů je pod hranicí rozlišitelnosti.

### Proč to neodhalila kontrolní tabulka

Protože měřila **kontrastní poměr**, a ten měří jen rozdíl světlosti.
Fialová a růžová o stejné světlosti mají poměr 1,00 a přitom je od sebe
každý pozná; naopak dvě zelené o stejné světlosti mají taky 1,00 a od
sebe je nepozná nikdo. Na otázku „poznám tyhle dvě barvy od sebe?" se
musí použít **barevná vzdálenost ΔE2000**, ne kontrast.

Obojí platí najednou a jedno druhé nenahrazuje:

| otázka | měřítko | hranice |
|---|---|---|
| Přečtu ten text? | kontrastní poměr | 4,5 (text), 3,0 (plochy) |
| Poznám ty dvě barvy od sebe? | ΔE2000 | 15 (světlý), 14 (tmavý) |

### Proč má tmavý režim nižší hranici

ΔE2000 roste s tím, jak daleko jsou barvy od sebe ve světlosti i v sytosti.
Tmavá lišta má ale obojí svázané: aby zůstala tmavá, musí mít nízkou
světlost, a v nízké světlosti se do sRGB vejde jen málo sytosti. Devět
odstínů se tam prostě nerozestoupí tak jako na světlém pozadí — je tam
míň místa.

Zvednout ΔE na 15 by v tmavém režimu šlo jedině tak, že by se lišta
zesvětlila. Tím by ale přestala být tmavá, mosazná plocha aktivní položky
by proti ní ztratila odstup a celý tmavý režim by se rozpadl. Rozlišitelnost
lišty je vodítko, čitelnost textu je podmínka — a když jde jedno proti
druhému, ustupuje vodítko.

Proto 14. Není to změkčení pravidla, ale strop, který dává sRGB
v téhle světlosti.

### Nové odstíny — světlý režim

`--rail-ink` zůstává `#f1ece0` u všech klíčů.

| klíč | `--rail` | `--rail-2` | `--rail-tlum` |
|---|---|---|---|
| `firma` | `#15241e` | `#233931` | `#87ab9f` |
| `slate` | `#141724` | `#22273a` | `#8d94b0` |
| `indigo` | `#171763` | `#24247a` | `#9c9cba` |
| `violet` | `#4d2c4d` | `#613b61` | `#cdb7cc` |
| `sky` | `#1d465e` | `#2a5974` | `#c6d1d7` |
| `teal` | `#17524e` | `#246965` | `#d5e2e1` |
| `emerald` | `#2b4e20` | `#3a642e` | `#cfdbcc` |
| `amber` | `#443419` | `#5a4726` | `#c9c0b1` |
| `rose` | `#311212` | `#481f1f` | `#b29090` |

Nejbližší dvojice v sadě: **ΔE 15,9** (bylo 2,4).
Nejhorší kontrast: text na liště 7,57, text na sloupci 5,43,
tlumený text na sloupci 4,81, plocha mosazi proti sloupci 3,00.

### Nové odstíny — tmavý režim

| klíč | `--rail` | `--rail-2` | `--rail-tlum` |
|---|---|---|---|
| `firma` | `#091611` | `#132921` | `#7a9f91` |
| `slate` | `#0a0c1d` | `#131730` | `#8084a3` |
| `indigo` | `#0b0b4c` | `#131360` | `#8989a9` |
| `violet` | `#381d38` | `#482948` | `#b69ab6` |
| `sky` | `#103246` | `#19415a` | `#a0b0ba` |
| `teal` | `#153f3c` | `#1f514d` | `#acc3c1` |
| `emerald` | `#182f0d` | `#254216` | `#9cb092` |
| `amber` | `#2c210d` | `#403015` | `#aba08c` |
| `rose` | `#370f0f` | `#4a1717` | `#ab8c8c` |

Nejbližší dvojice: **ΔE 14,6** (bylo 4,1 u firmy proti `slate`).
Nejhorší kontrast: text na liště 9,85, text na sloupci 7,61,
plocha mosazi proti sloupci 5,56.

Tmavý režim se dál píše dvakrát — pod `prefers-color-scheme` se strážcem
`:root:not([data-theme="light"])` a pod `:root[data-theme="dark"]`.

### Co doplnit do kontrolní tabulky

K dosavadním kontrastním kontrolám přidej **matici ΔE2000 mezi `--rail`
všech devíti klíčů**, zvlášť pro světlý a pro tmavý režim. Nejmenší
hodnota musí být nad 15 ve světlém a nad 14 v tmavém režimu — proč se
hranice liší, je o kus výš. Do zprávy napiš tu nejmenší a u které dvojice.

Spočítá to `node scripts/barvy.js`.

Barva ale pořád nesmí nést informaci sama o sobě — vedle tečky je vždycky
název. Tahle oprava dělá barvu použitelnou jako vodítko, ne jako sdělení.

---

## 2. V horní liště chybí vyhledávání a nastavení

Zadání §6 je vyžadovalo, v předloze jsou, v aplikaci nejsou. Teď je
v liště značka, moduly, přepínač rozsahu a avatar — a nic víc.
Nastavení se tím pádem nedá vůbec otevřít.

Doplň mezi přepínač rozsahu a avatar:

- **vyhledávací pole** s popiskem „Hledat nebo se zeptat Gastro AI".
  Zatím jen vzhled a zaměření, žádné volání modelu. Až se bude
  připojovat, platí pravidlo 8 z `CLAUDE.md` — mzdy a docházka do
  jazykového modelu nejdou.
- **svislý oddělovač** a **ozubené kolo** vedoucí na Nastavení.

Na mobilu se pole schová pod ikonu lupy, ozubené kolo zůstává.

---

## 3. Na žádné obrazovce není nadpis

V celé aplikaci není ani jeden `h1`. „Rozpis směn" nahoře je jen šedý
text. Má to dva důsledky:

- patkové písmo, kvůli kterému jsme Newsreader načítali, není nikde vidět
- odečítač obrazovky nemá stránku podle čeho členit, takže je pro
  nevidomého uživatele jedna souvislá plocha

Každá obrazovka dostane **jeden `h1`** — název obrazovky, Newsreader,
nad ním mosazný nadpisek verzálkami podle §6 („oči"). Podnadpisy uvnitř
`h2`. Úrovně se nepřeskakují a nevybírají se podle velikosti písma —
velikost řeší CSS.

---

## 4. Zelené štítky směn

Časy směn v rozpisu jsou v bledě zelených štítcích, které do palety
nepatří — zbytek po staré verzi. Buď je přebarvi na `--sunken`
s obrysem `--line-2`, nebo na `--branch-soft`. Zelenou `--dobre` si
nech na stav „v pořádku", ať neztratí význam.

---

## Pořadí

1. Paleta (`_tokeny.css`) — nejdřív, ostatní se do ní opře.
2. Nadpisy — dotkne se všech obrazovek.
3. Lišta: vyhledávání a ozubené kolo.
4. Štítky směn.
5. Kontrolní tabulka: kontrast **i** matice ΔE.

Commituj po krocích. A jako minule: build a lint neříkají nic o tom, co
je vidět. U vzhledu je ověřením vypočtený styl na živé stránce nebo
snímek obrazovky.
