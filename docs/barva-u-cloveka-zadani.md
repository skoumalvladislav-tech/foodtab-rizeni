# Zadání: barva u člověka

Zadal Šéfík 3. 9. 2026. Vytahuje se tím dopředu půlka bodu 4
z `docs/nocni-prace-2026-09-03.md` — ta část, která se dá udělat hned.

---

## Co se dělá

**Barva u člověka jako údaj v databázi** (`employees`), nastavitelná na
obrazovce Lidé, a **kalendář ji používá**.

Barva, kterou jde nastavit, ale nikde ji není vidět, je k ničemu.
Obojí patří do jednoho kroku.

**Barva se nepočítá ze jména.** Pravidlo 1: co má zákazník moct
změnit, je řádek v databázi. Při založení člověka se přidělí volná
z palety, dá se přepsat, dá se vyprázdnit.

---

## Devět barev, dvanáct lidí — a přesto to vyjde

Paleta má **devět odstínů** a hranice odlišitelnosti je ΔE2000 **15 na
světlém a 14 na tmavém** (`scripts/barvy.js`). Lidí je dvanáct, takže
na první pohled to nevychází.

Vychází, když se ptáme správně: **barvy se nemusí lišit napříč firmou,
jen v jednom kalendáři.** A ten je vždycky za jednu pobočku — Černá
Perla má osm lidí, Bernard Bar čtyři. Obojí se do devíti vejde.

Takže:

- **Jedinečnost se hlídá v rámci pobočky**, ne firmy. Dva lidé na
  různých pobočkách můžou mít tutéž barvu a nikomu to nevadí.
- Když dojdou i tak, **nepřiděluj potichu podruhé.** Ať člověk
  zůstane bez barvy (neutrální) a je vidět, že barvy došly. Dvě různé
  Aničky ve stejné barvě jsou horší než žádná barva.
- **Barva je nepovinná.** Jméno je v rozpisu napsané; barva je pomůcka
  pro rychlé přehlédnutí, ne nositel informace.

## Pozor na barvy poboček

Pobočky mají svoje barvy z téže palety — a dnes mají **obě stejnou**
(Růžovou). Ať se barva člověka a barva pobočky nepotkají tak, že
splynou. Buď je používej na jiných místech, nebo ať se liší tvarem
(plocha vs. proužek), ne jen odstínem.

## Co musí platit

- **Nové odstíny, jestli nějaké přidáš, musí projít
  `node scripts/barvy.js`** ve světlém i tmavém režimu. Když spadnou,
  **neposouvej hranici** — vyber jiné.
- **Barva nesmí nést informaci sama.** Kdo barvy nerozliší, musí se
  všechno dočíst textem.
- Změna barvy je běžná úprava člověka — stejná oprávnění jako u
  ostatních polí, žádné nové právo.

## Testy

1. Barva se uloží a **kalendář ji ukáže**.
2. Dva lidé **na téže pobočce** nedostanou stejnou automaticky.
3. Dva lidé **na různých pobočkách** ji mít stejnou můžou.
4. Když barvy dojdou, člověk zůstane **bez barvy** a nic se
   nepřidělí podruhé.
5. Člověk **bez barvy** se v kalendáři vykreslí čitelně.
6. `node scripts/barvy.js` prochází.
