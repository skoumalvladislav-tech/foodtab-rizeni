# Zadání: přidělení PINu

Zadal Šéfík 3. 9. 2026.

> Přidat možnost přidání pinu pro píchání — jak přidělit mnou, tak aby
> si ho zvolil zaměstnanec. Každopádně pin musím vidět vždy já.

| Otázka | Rozhodnuto |
|---|---|
| Kdo PIN nastaví | **Oba** — majitel i zaměstnanec |
| Vidí ho majitel | **Jednou, ve chvíli nastavení.** Ne kdykoli potom |
| Zapomenutý PIN | **Přenastaví se**, neposílá se |
| Uložení | **Otisk se solí, beze změny.** Pravidlo 7 platí dál |

---

## 1. Proč ne „vidím ho vždycky"

Šéfík původně chtěl vidět PIN kdykoli. Po rozvaze zvolil tohle
řešení; důvod ať je zapsaný, aby se k tomu nikdo nevracel.

Na obrazovce Zálohy stojí: *„Zaměstnanec zálohu potvrdí PINem na
tabletu — tím se z ní stane doklad, ne tvrzení jednoho člověka."*

Kdyby majitel znal PIN každého, přestane to platit. Cokoli, co kdo
potvrdí PINem, může potvrdit i on — a naopak každý může říct „to jsem
nebyl já, šéf zná můj PIN". U docházky, ze které se počítají mzdy,
a u hotovosti z ruky do ruky je PIN jediný důkaz, který tam je.

A kdyby někdo získal zálohu databáze, měl by rovnou i všechny PINy.

**Řešení dává majiteli tutéž moc, jen jinou cestou:** kdykoli může
PIN přenastavit a nový hned vidí. Nemůže jen tiše používat cizí.

---

## 2. Jak PIN vznikne

### Majitel přidělí

Na obrazovce u člověka (Lidé → akce **PIN**):

- Nabídne se **vygenerovaný** PIN; jde ho přepsat vlastním.
- Po uložení se **ukáže jednou**, s větou ve stejném duchu jako
  u registrace tabletu: *„Ukáže se jenom teď. Když ho ztratíte,
  přenastavte nový — přečíst se nedá ani z databáze."*
- Vyžaduje právo **`attendance.manage`** (pravidlo 2), ne název role.

Tohle je jediná cesta, jak dát PIN **brigádníkovi bez účtu**. Těch je
dnes v aplikaci většina, takže je to ta důležitější půlka.

### Zaměstnanec si zvolí sám

V **Mých údajích**, pokud má účet. Od té chvíle ho **nevidí nikdo**.

Zaměstnanec musí poznat, v jakém je stavu:

> PIN máte nastavený *(nastaven 3. 9.)*. **Změnit** · **Zrušit**

### Přenastavení

Majitel může kdykoli. Nový PIN se ukáže jednou, starý přestane platit.

**Zaměstnanec se to musí dozvědět** — zvoneček: *„Váš PIN byl
přenastaven. Nový vám předá vedoucí."* Bez toho by šlo cizí PIN
přenastavit a používat tiše, a přesně tomu se celé tohle řešení
vyhýbá.

---

## 3. Na čem to spadne

### 3.1 Dva stejné PINy na jedné pobočce

Na kiosku se zadává **jen PIN** — žádné jméno. PIN tedy člověka
**identifikuje**. Když ho mají dva lidé stejný, píchne se ten
nesprávný.

Čtyři číslice, deset tisíc možností, dvanáct lidí — pravděpodobnost
shody je kolem sedmi promile. Malá, ale ne nulová, a projeví se to
jako záhadná docházka cizího člověka.

**Ověř nejdřív, jestli se to hlídá už dnes.** Otisky jsou solené
zvlášť pro každého, takže shodu nejde poznat porovnáním otisků —
musí se kandidát ověřit proti otiskům všech lidí té pobočky. U dvanácti
lidí je to nic.

- Při nastavení: **odmítni PIN, který už na té pobočce někdo má.**
- Při generování: vyber takový, který volný je.
- Hláška ať neprozradí čí: *„Tenhle PIN už na téhle pobočce někdo má.
  Zvolte jiný."*

### 3.2 Slabé PINy

Odmítni `0000`, `1111` a podobné, `1234` a `4321`. Ne proto, že by to
někoho zachránilo, ale protože jinak je bude mít půlka lidí a bod 3.1
začne padat pořád.

### 3.3 Co se nesmí změnit

- **Ukládá se dál jako otisk se solí.** Žádné čitelné uložení, žádné
  „zašifrované a rozšifrovatelné". Pravidlo 7.
- **Žádný průzor, který odpoví „platí/neplatí".** Dnes se PIN ověřuje
  jen uvnitř kioskových funkcí a to je schválně — jinak by se dal
  offline uhádnout.
- **Zamykání po nezdarech** (`chyb`, `zamceno_do`) zůstává.
- **Každé nastavení a přenastavení do auditu** — spoušť `trg_audit_pinu`
  už existuje. Do auditu patří **kdo** to udělal, ne jaký PIN to je.

---

## 4. Testy

1. Majitel přidělí PIN → **ukáže se jednou**, podruhé už ne.
2. Přidělený PIN **funguje na kiosku**.
3. Zaměstnanec si ho změní → **majitel nový nevidí**.
4. **Přenastavení** starý PIN zneplatní a zaměstnanec dostane
   upozornění.
5. **Dva stejné PINy na jedné pobočce nejdou nastavit.**
6. Stejný PIN na **jiné** pobočce jde — pobočky jsou oddělené.
7. **Slabý PIN se odmítne.**
8. PIN **nejde přečíst** ani přímým dotazem do tabulky, ani průzorem,
   ani majitelem.
9. Kdo nemá `attendance.manage`, **cizí PIN nenastaví**.
10. **Cizí firma** se k ničemu nedostane.
