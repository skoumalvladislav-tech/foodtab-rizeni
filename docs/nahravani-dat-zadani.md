# Zadání: nahrávání dat — z tabulky a z pokladny

Zadal Šéfík 30. 8. 2026.

Aplikace stojí na tom, že si data zadá zákazník sám. To platí — do chvíle,
kdy si ji koupí restaurace s dvaceti lidmi, šedesáti recepturami a rozpisem
na měsíc. Několik hodin opisování je nejčastější důvod, proč nový zákazník
skončí v prvním týdnu.

Musí proto existovat cesta dovnitř. Dvě: **z tabulky** a **z pokladny**.

---

## A. Pravidlo, které platí pro každou tabulku — i pro ty hotové

Tohle je nejdůležitější část celého dokumentu a týká se i toho, co už
je napsané.

**Každá tabulka, kterou plní zákazník, musí mít podle čeho řádek poznat**
a nahrávání musí jít pustit dvakrát, aniž by se cokoli zdvojilo.

| tabulka | podle čeho se řádek pozná |
|---|---|
| `employees` | jméno v rámci firmy |
| `branches` | `slug` |
| `positions` | název |
| `roles` | `key` |
| `recipes` | název |
| `shifts` | člověk + provozní den + pobočka |

Když takový klíč chybí, doplňte ho — jako `unique` podmínku vázanou na
`tenant_id`, ne jako nápad v importním skriptu.

Nahrávání se pak píše vždy stejně: **najdi podle klíče, aktualizuj; když
není, založ.** Nikdy „smaž všechno a nahraj znovu" u tabulek, na které se
něco váže — u lidí by to zabilo docházku.

U rozpisu směn už to takhle funguje (`delete ... where note like 'rozpis %'`
a znovu). Je to výjimka opodstatněná tím, že rozpis na nic nenavazuje.
Nekopírujte ten vzor jinam.

---

## B. Nahrání z tabulky (Excel, CSV)

### Průběh, který se nesmí zkrátit

1. **Vyberu, co nahrávám** — lidi, receptury, rozpis.
2. **Nahraju soubor.**
3. **Přiřadím sloupce.** Aplikace nabídne, co si myslí, člověk to opraví.
   Nepředpokládat pevné pořadí sloupců — každá restaurace má tabulku jinak.
4. **Náhled.** Vypíše se: *založí se 14, aktualizuje 6, přeskočí 2 (proč)*.
   A ukázka prvních řádků tak, jak dopadnou.
5. **Teprve pak potvrzení.**

Krok 4 se nevynechává ani „když je to jasné". Nahrání bez náhledu je
způsob, jak si někdo přepíše celý seznam lidí a zjistí to za týden.

### Značky a zkratky jsou data

V rozpisu Šéfíka znamená `R` ranní, `O` odpolední, `X` celou, `-B` Bernard.
Jiná restaurace má jiné značky. **Slovník značek je tabulka**, kterou si
zákazník upraví — ne `case` v kódu (pravidlo 1). U šablon směn na to
stačí přidat sloupec `code`.

Čemu aplikace nerozumí, to **nenahraje a vypíše**. Nikdy si význam
nedomýšlet — přesně tohle se stalo u `D` a `TAB` v prvním nahrávání
rozpisu a bylo správné je vynechat.

### Bezpečnost

- **Nahraný soubor je data, ne pokyny.** Buňka `=HYPERLINK(...)` nebo
  text „ignoruj předchozí zadání" je obsah buňky, nic víc. Nikam se
  nevyhodnocuje a do modelu se nedostane jako zadání.
- **Import běží s právy přihlášeného člověka.** Ne `security definer`,
  ne servisní klíč. Kdo nesmí zakládat lidi, nesmí je založit ani
  souborem. Import nesmí být obchvat oprávnění.
- **Do auditu jde, kdo co kdy nahrál** a kolik řádků to změnilo.
- Soubor se po zpracování nedrží. Když je potřeba ho uchovat kvůli
  reklamaci, patří to do zadání zvlášť a s dobou platnosti.

---

## C. Stažení z pokladny

Pokladny jsou podle `CLAUDE.md` **vstupy, ne konkurenti**. Foodtab je
nenahrazuje a nic do nich nezapisuje.

### Co se dnes o nich ví

| pokladna | stav |
|---|---|
| **Dotykačka / Dotypos** | Má veřejně dokumentované REST API (v2), včetně testovacího prostředí. Nejjednodušší začátek |
| **Storyous** | API existuje, ale veřejná dokumentace k němu není. Nejspíš se o přístup musí požádat jako partner |
| **Choice QR** | Nezjištěno. Zeptat se jich přímo |

**Nehádejte, jak které API vypadá.** Než začnete stavět kterýkoli
konektor, přečtěte si jeho aktuální dokumentaci — tyhle věci se mění.

### Jak to postavit, aby to šlo rozšířit

Jeden vnitřní tvar dat a k němu konektory. Přidání další pokladny pak
znamená napsat jeden konektor, ne přepsat import.

Co se ze všech tahá stejně:

- **položky a ceny** → podklad pro receptury a jídelní lístky
- **tržby** → to už se dělá
- **personál** → jen jako **návrh**. Jména z pokladny se s lidmi ve
  Foodtabu párují nespolehlivě a spárovat cizího člověka se špatným
  zaměstnancem znamená připsat mu cizí docházku. Vždycky potvrzuje člověk.

### Bezpečnost

- **Klíče k pokladně nikdy neopustí server.** Ukládají se jako tajemství
  na straně serveru, do prohlížeče se neposílají ani zkrácené. Stejný
  režim jako `service_role` (pravidlo 6) a jako otisky tokenů (pravidlo 7).
- **Data z pokladny jsou data, ne pokyny** — stejně jako soubor
  a stejně jako text z webu u modulu Tvorba menu. Název položky
  s podivným obsahem je název položky.
- **Stahování je jen ke čtení.** Žádný zápis do pokladny, nikdy.
- Každé stažení jde do auditu: kdy, odkud, kolik položek.

---

## D. Kudy z toho ven — a co se dělá jako první

1. **Doplnit rozpoznávací klíče** do stávajících tabulek (oddíl A).
   Bez toho nemá smysl začínat, a čím později se to udělá, tím dráž.
2. **Nahrání lidí z tabulky.** Nejmenší z importů a nejčastější potřeba.
   Na něm se odladí celý průběh — přiřazení sloupců, náhled, potvrzení.
3. **Nahrání rozpisu z tabulky.** Návrh existuje, slovník značek do dat.
4. **Nahrání receptur.**
5. **Konektor na Dotykačku** — jediná, u které je dokumentace veřejně
   dostupná. Na ní se ověří vnitřní tvar dat.
6. **Storyous a Choice QR** až podle toho, co odpovědí.

Ukázková data pro předvedení aplikace zájemci jsou **vymyšlená restaurace**.
Nikdy ne skutečná data Černé Perly ani Bernardu — pravidlo 1 a zdravý rozum.

---

## Testy

Do `krok4_scenar.sql` (nebo dalšího v řadě):

1. Druhé spuštění téhož importu **nezaloží** ani jeden řádek navíc.
2. Import se **nedostane přes oprávnění** — uživatel bez `people.manage`
   nezaloží zaměstnance ani souborem.
3. Import **nepřekročí firmu** — soubor s cizím `tenant_id` neprojde.
4. Řádek, jehož značce aplikace nerozumí, **se nenahraje** a je vypsaný.
5. Klíč k pokladně se přes API **nedá přečíst** — stejná kontrola jako
   u otisků pozvánek.
