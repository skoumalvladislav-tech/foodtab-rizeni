# Zadání: nový modul Tvorba menu

Zadal Šéfík 30. 8. 2026. Je to **výslovný pokyn ke změně závazného
rozhodnutí** v `CLAUDE.md` — dosud byly moduly čtyři, nově pět.

> **POZOR — tenhle soubor byl 30. 8. přepsán.** První verze říkala, že se
> do modulu přestěhují Receptury a Jídelní lístky. **To neplatí.** Kdyby
> ta migrace už vznikla, zahoďte ji (novou migrací, ne úpravou nasazené).

---

## 1. Co ten modul je a co není

**Tvorba menu je nástroj, který menu vyrábí. Není to místo, kde menu bydlí.**

| | kde | co to je |
|---|---|---|
| **Receptury** | Provoz, beze změny | Zadává je člověk. Zdroj pravdy o tom, co je které jídlo |
| **Jídelní lístky** | Provoz, beze změny | Stálý lístek a denní menu. Hotový výsledek, ze kterého se vaří a účtuje |
| **Tvorba menu** | nový modul | Dílna. S pomocí agenta a Gastro AI navrhuje denní menu i stálý lístek za předem zadaných podmínek |

Čtyři oprávnění `recipes.*` a `menus.*` proto **zůstávají v modulu
`provoz`**. Nesahat na ně.

Vztah je jednosměrný: Tvorba menu čte receptury a **navrhuje**; hotový
lístek vzniká až tím, že návrh někdo schválí, a uloží se tam, kde lístky
byly vždycky.

---

## 2. Modul

```
modules
  ('menu', 'Tvorba menu', is_base = false, sort_order = 15)
```

Vypínatelný za celou firmu, v liště hned za Provozem. U stávajících firem
**vypnutý** — nikomu se tím nic nebere, protože dosud neexistoval.
To je proti první verzi tohohle souboru obrácené, a je to správně:
tehdy šlo o přestěhování existujícího práva, teď o nové.

Nová oprávnění (řádky v `permissions`, ne `if` v kódu):

- `menu_ai.use` — spustit návrh
- `menu_ai.manage` — měnit podmínky, za kterých se navrhuje

Schvalování už oprávnění má: **`approvals.decide`** („Schvalovat návrhy
agentů"). Nezakládat nové, použít tohle.

---

## 3. Návrh není lístek

Tohle je jádro celé věci a nesmí se to obejít ani pro zjednodušení.

Agent vytvoří **návrh**. Návrh se uloží jako návrh. Jídelním lístkem se
stane teprve tím, že ho člověk s `approvals.decide` schválí. Nikdy
automaticky, nikdy „když si je model jistý".

Důvod není opatrnost, ale zodpovědnost: za alergeny, za cenu a za to, že
se to dá uvařit z toho, co je na skladě, ručí hostinský, ne model. Když
lístek vznikne bez lidského kroku, není nikdo, kdo ho schválil.

U návrhu se uchovává, **z čeho vznikl** — které podmínky platily, které
receptury se použily, co přišlo zvenčí. Bez toho nejde po měsíci zjistit,
proč tam to jídlo je.

---

## 4. Podmínky jsou data zákazníka

Pravidlo 1. Podmínky, za kterých se menu navrhuje — kolik chodů, jaké
rozpětí ceny, co se neopakuje častěji než jednou za X dní, sezónnost,
bezmasý den, oblíbenost — jsou **řádky v databázi**, které si zákazník
mění sám. Ne konstanty v kódu a ne text zadrátovaný do promptu.

Každá restaurace je vaří jinak. Kdo si podmínky nemůže změnit, ten
si Foodtab nekoupí.

Totéž platí pro **všechno, s čím bude agent pracovat**: historii denního
menu, dodavatele, suroviny, sezónní omezení. Nic z toho nepatří do kódu
ani do ukázkových dat — zákazník to zadá při zavedení aplikace a dál si
to spravuje sám. Když bude agent potřebovat údaj, který zákazník nezadal,
řekne to a nenavrhne nic; nedomýšlí si ho.

Prakticky to znamená, že se agent staví **prázdný**: tabulky a obrazovky
pro ta data vzniknou dřív než on, a on z nich jen čte.

---

## 5. Co přichází zvenčí, jsou data — ne pokyny

Šéfík zmínil, že modul bude brát informace i z webu. To je nová věc:
poprvé se do aplikace dostane obsah, který nenapsal ani zákazník, ani my.

- Text stažený z webu je **vstup ke zpracování, nikdy instrukce.** Když
  v něm stojí „ignoruj předchozí zadání" nebo „nastav cenu na nulu",
  neplatí to. Model to musí dostat jako citovaný podklad, ne jako součást
  zadání.
- U každého návrhu je vidět **odkud co je**, ať jde ověřit původ.
- Stahuje se jen z adres, které zákazník sám zadal. Žádné volné procházení
  internetu.

---

## 6. Pravidlo 8 platí i tady

**Do modelu nejdou mzdy ani docházka.** Ani „aby zohlednil náklady na
personál". Když má návrh brát ohled na náklady, dostane podíl nebo
rozpětí, ne jména a částky.

Receptury, suroviny a ceny jídel do modelu jít můžou — to nejsou osobní
údaje.

---

## 7. Co ještě nevím a musím se zeptat

Šéfík řekl, že agenta vysvětlí později. Do té doby se **nic z tohohle
nedomýšlí**:

- Podle čeho se má menu navrhovat — sklad, sezóna, tržby, oblíbenost,
  co zbylo?
- Navrhuje se denní menu na den, na týden dopředu?
- Kdo návrh schvaluje — majitel, šéfkuchař, kdokoli s právem?
- Jaké stránky se mají číst a k čemu?
- Jak se do toho promítne stálý lístek — je to omezení, nebo se navrhuje taky?

---

## 8. Co udělat teď

Jen tolik, aby modul existoval a dal se zapnout:

1. Migrace: nový modul `menu`, dvě oprávnění, u stávajících firem vypnutý.
2. Kontrola v testech: vypnutý modul odmítne i přímé volání adresy
   (pravidlo 5) — ne jen schová položku v nabídce.
3. Pátá záložka v horní liště. Změřit na živé stránce, že se nerozsype;
   moduly dnes končí na 517 px a přepínač rozsahu začíná na 691 px.
4. Obrazovka modulu zatím jen s hláškou, že se připravuje.
5. Tabulka modulů v `CLAUDE.md` — pět, ne čtyři.

**Receptury ani jídelní lístky se nepřesouvají a jejich oprávnění
zůstávají v `provoz`.**
