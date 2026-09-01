# Nálezy z kontroly v prohlížeči — 1. 9. 2026

Prošel jsem v prohlížeči to, co jsi v noci postavil, ale neviděl: Moje
údaje, informaci o zpracování, Upozornění, vydání rozpisu a ruční zápis
docházky. Proti ostrým datům, po nasazení všech osmi migrací.

**Co drží:** pruh s informací na každé stránce, „Beru na vědomí" místo
souhlasu, zástupný právní text čitelně označený, Moje údaje i s exportem
a s dobrovolným souhlasem u telefonu, prázdný stav Upozornění, panel
vydání rozpisu („od posledního vydání se nic nezměnilo, nikomu by nic
nepřišlo"), ruční zápis s povinným důvodem, obrazovky Lidé, Oprávnění,
Pobočky i Pozice.

Níž je to, co nesedí. Tři opravy a jedna poznámka do `CLAUDE.md`.

---

## 1. V ručním zápisu chybí lidé, kteří na pobočce zaskakují

**Co se stalo:** na Bernardu má Maruška ve čtvrtek směnu 14:00–22:00,
ale v nabídce „KDO" u ručního zápisu není. V nabídce jsou jen Lucka,
Světlana a Veronika.

**Proč:** `app/[rozsah]/dochazka/page.tsx` staví nabídku dotazem
`employees.branch_id = scope.branchId`. Maruška má v Lidech pobočku
**Restaurace Černá Perla** — na Bernardu jen vypomáhá.

**Proč to vadí:** ruční zápis existuje přesně pro toho, kdo se z rozpisu
vymyká. Člověk, který zaskakuje na cizí pobočce a zapomene telefon, je
nejpravděpodobnější případ ze všech — a ten v nabídce není.

**Jak to spravit:** nabídka = lidé přiřazení k pobočce **plus každý, kdo
tam má směnu** v rozumném okně (řekněme týden zpátky a týden dopředu).
Sjednotit, seřadit podle jména.

Je to podruhé, co tahle nabídka vznikla ze špatného zdroje — poprvé se
brala z dnešních událostí. Kontrola do scénáře: *„kdo má na pobočce
směnu, je v nabídce ručního zápisu, i když tam nemá domovskou pobočku."*

---

## 2. Otevřený příchod nikdo nehlídá

**Co se stalo:** obrazovka Docházka tvrdí **„Jste v práci · od 21:42"**
a hned pod tím **0 h 0 min, 0 Kč**. Příchod z minulého večera nemá
odchod, takže se nespáruje a do výdělku se nepromítne.

**Proč to vadí:** dokud byla docházka evidence, byla to nepřesnost.
Teď z ní počítáme mzdu a brzy i zálohy. Nezavřený záznam znamená
odpracovanou směnu, kterou nikdo nezaplatí — a nikdo se o tom nedozví,
protože obrazovka mlčí a součet vypadá věrohodně.

**Jak to spravit:**

- Nedokončený záznam je **vidět u toho člověka** („příchod bez odchodu,
  1. 9. 21:42 — dokončete zápis").
- Je vidět i **vedoucímu** v přehledu pobočky, protože sám si ho
  zaměstnanec dopsat nesmí.
- Do součtu se nezapočítává, ale **musí být poznat, že se něco
  nezapočítalo**. Tichá nula je horší než chyba.

**Rozhodnuto (Šéfík, 1. 9.): aplikace ho nikdy nezavírá sama.** Zůstane
otevřený a hlásí se, dokud ho někdo s právem na docházku neopraví.
Žádné dopočítání do konce provozního dne ani po dvanácti hodinách —
z vymyšleného času odchodu by se počítala mzda.

---

## 3. V datech je jméno „skoumalvladislav"

V Lidech je zaměstnanec **`skoumalvladislav`**, pobočka Restaurace Černá
Perla, OSVČ, 300 Kč/h. Není to chyba obrazovky — obrazovka ukazuje
správně, co je v databázi. Jméno vzniklo z e-mailu při zakládání firmy.

**Ostrá data neopravuj**, to si Šéfík udělá sám v Lidé → Upravit.

Co ale spravit v kódu: **při zakládání firmy se jméno nemá brát
z e-mailu.** Až se aplikace bude prodávat, přesně takhle si každý druhý
zákazník založí sám sebe jako „jan.novak". Průvodce má o jméno
a příjmení požádat a e-mail nechat e-mailem.

---

## 4. Do `CLAUDE.md`: čtvrtý příznak zaseknutého Turbopacku

Dnes to stálo hodinu. Zaseknutý Turbopack neumí jen držet starý
stylopis — **umí přestat obsluhovat celou větev adres**.

Příznak: `/[rozsah]/nastaveni/lide`, `/pobocky`, `/pozice` i `/role`
vracely **404**, zatímco `/dochazka`, `/smeny`, `/upozorneni`
a `/moje-udaje` na téže úrovni odpovídaly 200. Soubory na disku byly
v pořádku, importy taky, nikde v kódu není jediné `notFound()`.
**Smazání `.next` nepomohlo.**

Rozhodlo tohle:

```powershell
npm.cmd run build
```

Build vypsal seznam adres a všechny čtyři v něm byly — takže chyba
nebyla v kódu. A protože build přepsal celý obsah `.next`, po dalším
spuštění `npm.cmd run dev` už obrazovky chodí.

**Pravidlo:** když stránka vrací 404 a soubor přitom existuje, nehledej
chybu v kódu. Nejdřív `npm.cmd run build` — vypíše seznam adres a tím
oddělí chybu v kódu od zaseknutého vývojového serveru.

(Poznámka pro práci na Windows: v PowerShellu se musí psát `npm.cmd`
a `npx.cmd`. Verze `.ps1` neprojdou přes zákaz spouštění skriptů.)
