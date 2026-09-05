# Ověření hlavičky na telefonu — 5. 9. 2026 večer

Měřeno na **nasazené aplikaci** (Vercel, commit `829be68`), tedy na tom,
co lidem opravdu chodí — ne na kopii markupu a ne z kódu.

Postup: skutečná hlavička ze `/cerna-perla/dochazka` a skutečný
sestavený stylopis (`/_next/static/chunks/0onik0xm6.pv-.css`) vloženy do
rámu o pevné šířce, změřeno `getBoundingClientRect()` proti
`documentElement.clientWidth`.

## Výsledek: sedí

| šířka | prvků v liště | co přetéká | šířka názvu pobočky | název |
|---|---|---|---|---|
| 375 px | 2 | nic | 184 px | Restaurace Černá Perla |
| 430 px | 2 | nic | 184 px | Restaurace Černá Perla |

`scrollWidth` se rovná `clientWidth` na obou šířkách — stránka nejde
posunout do strany. Řádka modulů je na 430 px širší než okno
(512 proti 430) a **roluje**, což je záměr, ne chyba.

V nasazeném stylopisu jsem si ověřil i to pravidlo samo:

```css
@media (max-width:640px){
  .ft-side,.ft-avatar,.ft-divider,.ft-hledani,.ft-rezim,.ft-nastaveni{display:none}
}
```

a `min-width:10ch` na názvu pobočky. Je to tam, je to nasazené.

## Potvrzuju i to, na co jsi narazil sám

Přidal jsem do lišty čtyři ikony navíc (celkem šest prvků) na 375 px:

```
prvků: 6   přetéká: nic   šířka názvu: 184 → 108 px
```

**Nic nepřeteklo.** Jen se zúžil název pobočky. Takže kontrola postavená
jen na souřadnicích by šestou ikonu opravdu nechytila — přesně jak jsi
napsal. Tvoje kontrola na **počet prvků** v liště je tedy nutná, ne
navíc, a moje zadání bylo v tomhle slabé.

Za povšimnutí stojí, kde ta degradace končí: název má `min-width:10ch`,
takže se zúží jen po tuhle mez a **teprve pak** začne něco přetékat.
Mezi „přibyla ikona" a „je to vidět" je tedy široké pásmo, ve kterém se
rozhraní tiše zhoršuje. Proto ta kontrola na počet.

## Co jsem změřit nemohl

**Nepustil jsem `scripts/mobil/vyrobit.mjs`.** V mém prostředí je
zavřený přístup do npm, takže se nedají doinstalovat `react` ani
`react-dom` a skript spadne na chybějícím modulu. Neznamená to, že je
s ním něco v nepořádku — jen jsem ho neověřil.

Proto to měření obchází generátor a bere hotovou stránku z nasazení.
Mimochodem je to i silnější důkaz: neměří se, co by se vykreslilo,
ale co se lidem opravdu vykreslilo.

**Neměřil jsem na opravdovém telefonu.** Rám o pevné šířce se chová
jako rozvržení telefonu, ale `meta viewport` v něm neplatí — takže to,
co jsi objevil o `innerWidth`, se v něm neprojeví. Na tom se nic nemění:
tvůj `documentElement.clientWidth` drží v obou světech, což jsem
změřil zvlášť v Chromiu (viz `docs/rozhodnuti-dvojity-prichod.md`,
závěr).

Poslední slovo má stejně **Šéfíkův iPhone**. Až si to na něm otevře,
bude to vidět na první pohled — a jestli něco přetéká, poznáme to
z fotky během vteřiny.
