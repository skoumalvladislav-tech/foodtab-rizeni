# Zadání: upozornění na změnu ve směnách

Zadal Šéfík 1. 9. 2026. Rozhodl, že upozornění odchází **až při vydání
rozpisu**, ne při každé úpravě.

---

## 1. Rozpis má dva stavy

Dnes se směna uloží a tím to končí. Nově:

- **Rozpracovaný** — vedoucí plánuje, přehazuje, maže. Nikomu nic nechodí.
- **Vydaný** — vedoucí zmáčkne **Vydat rozpis** a od té chvíle je to
  závazek. Teprve tady odchází upozornění.

Zaměstnanec vidí i rozpracovaný rozpis, ale **je označený** — „rozpis se
ještě připravuje". Skrývat ho by lidi nutilo ptát se vedoucího, což je
přesně ta rutina, kterou aplikace ruší.

### Jak to poznat v datech

Každá směna si nese **stav při posledním vydání**: komu patřila, kdy
začínala a končila. Při vydání se porovná dnešek s tím záznamem a z rozdílu
vznikne zpráva.

**Zrušená směna se nesmí mazat, jen označit `cancelled`** — jinak s ní
zmizí i záznam o tom, že byla vydaná, a člověk se nedozví, že už nikam
nemusí. Filtr `status <> 'cancelled'` v aplikaci už je.

---

## 2. Jedna zpráva na člověka, ne jedna na směnu

Při vydání dostane každý dotčený člověk **jednu zprávu** se vším, co se
týká jeho:

> **Rozpis 8.–14. září — Restaurace Černá Perla**
> Přibyly 2 směny, 1 se změnila, 1 byla zrušena.
>
> - **st 10. 9.** 7:30–22:00 — nová
> - **čt 11. 9.** 7:30–22:00 — nová
> - **pá 12. 9.** ~~14:00–22:00~~ → 7:30–14:00 — změna času
> - **so 13. 9.** 7:30–22:00 — **zrušena**

Pravidla:

- **Jen jeho směny.** Nikdo se z upozornění nedozví, kdy dělá kolega
  (pravidlo 4).
- **Kdo změnu udělal, tomu nechodí** — ví o ní.
- **Když se u někoho nezměnilo nic, nedostane nic.** Druhé vydání beze
  změn nerozešle ani jednu zprávu.
- **Skloňovat**: 1 směna, 2–4 směny, 5 a víc směn.

---

## 3. Náhled před vydáním

Vydání rozešle zprávy a to se nedá vzít zpět. Proto stejný postup jako
u nahrávání z tabulky:

> **Vydat rozpis 8.–14. září?**
> Odejde 6 zpráv 4 lidem. Přibylo 5 směn, 2 se změnily, 1 zrušena.

A teprve pak potvrzení. Kdo vydává rozpis na měsíc dopředu, má vidět,
kolika lidem to zazvoní.

---

## 4. Kudy zpráva doteče

Postavit v tomhle pořadí, ne všechno najednou:

1. **V aplikaci** — zvoneček v horní liště s počtem nepřečtených,
   seznam upozornění, označení za přečtené. Tohle musí být vždycky,
   je to jediný kanál, který nemůže selhat.
2. **E-mailem** — Resend už je nastavený (`noreply@foodtab.cz`).
   Nejbližší krok.
3. **Push do telefonu** — potřebuje service worker, kterého se
   v aplikaci zatím negeneruje. Až po e-mailu.
4. **SMS** — brána zatím žádná. Neplánovat.

Každý si v Nastavení vybere, kudy chce upozornění dostávat. V aplikaci
se vypnout nedá — to je záznam, ne oznámení.

---

## 5. Kdy to nezvoní

- **Noční klid.** Kdo vydá rozpis ve dvě ráno, nemá vzbudit kuchaře.
  Zprávy mimo aplikaci se odloží na ráno. Rozmezí ať je **nastavení
  firmy**, ne konstanta (pravidlo 1).
- **V aplikaci se zapisuje hned**, odklad se týká jen e-mailu a pushe.

---

## 6. Bezpečnost

- Upozornění je **osobní údaj** — `tenant_id`, RLS, politika. Každý vidí
  jen svoje, i majitel jen svoje.
- **Do jazykového modelu nejdou** — pravidlo 8. Rozpis konkrétního
  člověka je stejně citlivý jako docházka.
- **Vydání jde do auditu**: kdo, kdy, jaké období, kolik zpráv odešlo.
- Vydat rozpis smí jen kdo má `shifts.manage` na té pobočce.

---

## 7. Co se tím zároveň vyřeší

Až se bude rozpis nahrávat z Excelu, nahraje se jako **rozpracovaný**.
Nikomu nic nezazvoní, vedoucí si ho prohlédne a vydá. Kdyby upozornění
chodila při každé změně, jedno nahrání by rozeslalo desítky zpráv.

---

## 8. Testy

1. Vydání beze změn **nerozešle nic**.
2. Zaměstnanec dostane **jen své** směny — cizí se v jeho upozornění
   neobjeví ani jménem.
3. Ten, kdo změnu udělal, **upozornění nedostane**.
4. Zrušená směna se v upozornění **objeví jako zrušená**, ne že zmizí.
5. Kdo nemá `shifts.manage`, rozpis **nevydá** — ani přímým voláním.
6. Upozornění cizího člověka se přes API **nedá přečíst**.
7. Změna času u vydané směny se po dalším vydání ohlásí jako **změna**,
   ne jako nová směna.
