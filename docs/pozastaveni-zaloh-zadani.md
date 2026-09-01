# Zadání: pozastavení výplaty záloh

Zadal Šéfík 1. 9. 2026. Doplňuje `docs/kiosek-pin-zalohy-zadani.md`,
oddíl 6.

| Otázka | Rozhodnuto |
|---|---|
| Rozsah | **U člověka i za celou firmu** |
| Účinek | **Odmítnout**, ne varovat |
| Kdo smí přepnout | Jen kdo spravuje mzdy (`payroll.manage`) |
| Vidí to zaměstnanec? | **Ano**, na své obrazovce |

---

## 1. K čemu to je

Záloha je dobrovolnost zaměstnavatele, ne nárok. Když si někdo bere
zálohy tak často, že z výplaty nezbývá, musí to jít zastavit — a musí
to jít zastavit **u toho člověka**, ne u všech.

Celofiremní vypínač je na jinou situaci: špatný měsíc, nebo než se
vyjasní, jak se zálohy budou v firmě vůbec vést.

---

## 2. Dvě úrovně, obě odmítají

- **U zaměstnance** — přepínač v Lidech u konkrétního člověka.
- **Za celou firmu** — přepínač v nastavení záloh.

Platí **přísnější z obou**: když je vypnuto za firmu, neprojde nikomu
nic, i kdyby jednotlivci pozastavené neměl.

**Pozastavení odmítá, nevaruje.** U horní meze stačí varování, protože
je to odhad — tohle je vědomé rozhodnutí o konkrétním člověku a má
platit. Kdyby šlo jen o hlášku, kterou lze odkliknout, přestane
pozastavení znamenat cokoli a nikdo nebude vědět, kdy platí.

Hláška u okénka musí říct, **co se stalo a co s tím**:

> Tomuhle zaměstnanci jsou zálohy pozastavené. Povolit je může jen
> ten, kdo spravuje mzdy.

Ne „chyba" a ne mlčení.

---

## 3. Kdo smí přepnout

**Jen `payroll.manage`** — tedy Šéfík a případně účetní.

Schválně **ne** `advances.manage`. Kdo zálohy vyplácí u okénka, si
pozastavení sám nezruší; jinak by stačilo dvakrát kliknout a celé
opatření je k ničemu. Je to stejná úvaha jako u oddělení „vydávat
peníze" od „vidět mzdy": kdo vykonává, nerozhoduje.

Přepnutí **jde do auditu** — kdo, kdy, u koho, a v jakém směru.
U peněz musí být dohledatelné i to, že se něco povolilo zpátky.

---

## 4. Zaměstnanec to vidí u sebe

Na obrazovce svého výdělku, kde už zálohy jsou:

> **Zálohy máte pozastavené.** Domluvte se s vedením.

Důvod se neuvádí — ten patří do rozhovoru, ne na obrazovku.

Proč to vůbec ukazovat: kdo to neví, přijde si k okénku a odmítnutí
zjistí před kolegy. Takhle se to dozví sám a jde se zeptat toho, kdo
o tom rozhodl.

---

## 5. Co se nesmí pokazit

- **Pozastavení nemaže historii.** Dřív vyplacené zálohy zůstávají
  v přehledech i v součtu „vyplacené zálohy" beze změny.
- **Nezasahuje do výdělku.** Odpracované hodiny a hrubá mzda se počítají
  dál stejně — pozastavené jsou jen nové výplaty.
- **Storno pořád jde.** Špatně zadaná záloha se musí dát stornovat
  i u pozastaveného člověka; jinak by se chyba nedala opravit.
- **`tenant_id`, RLS, politika** jako u všeho ostatního. Kdo nemá právo,
  přepínač nezmění ani přímým voláním rozhraní.
- Stav pozastavení **do jazykového modelu nejde** (pravidlo 8, stejně
  jako zálohy samotné).

---

## 6. Testy

Míří na to, co **nemá** jít.

1. Pozastavenému člověku **záloha neprojde** ani přímým voláním.
2. Vypnuté za firmu **neprojde nikomu**, i když jednotlivec pozastavený
   není.
3. Kdo má jen `advances.manage`, pozastavení **nezruší**.
4. Ani si ho **nenastaví** sám sobě.
5. Přepnutí je **v auditu**, oběma směry.
6. Zaměstnanec **vidí svůj** stav a **nevidí cizí**.
7. Po povolení zpátky záloha **projde**.
8. **Storno projde** i u pozastaveného člověka.
9. Pozastavení **nezměnilo** žádnou dříve vyplacenou zálohu ani součet.
