# Majitelů může být víc — a poslední se nesmí dát odebrat

Zadal Šéfík 1. 9. 2026.

---

## Co už funguje

Firma má **jednu roli Majitel** (v `roles` je na to jedinečný index
`(tenant_id) where is_owner`), ale **členství k ní může mít libovolně
mnoho lidí**. Víc majitelů tedy schéma unese bez jediné změny.

Přidání dalšího majitele = pozvánka s rolí Majitel. Podle pravidla
z `docs/pravidlo-neprideluj-vic.md` to smí udělat **jen jiný majitel**,
což je správně.

---

## Co chybí

**Nic nebrání tomu, aby firma zůstala bez majitele.**

Když jsou majitelé dva, jeden druhého odebere. Zůstane poslední —
a toho nic nechrání. Dá se:

- odebrat jeho členství
- přeřadit ho na jinou roli
- označit jeho zaměstnance za smazaného

Firma pak nemá majitele a **nikdo zevnitř to nespraví**, protože
přidělovat oprávnění smí jen ten, kdo je má sám. Jediná cesta ven vede
přes zásah do databáze.

---

## Pravidlo

**Ve firmě musí vždycky zůstat aspoň jeden aktivní majitel.**

Odmítne se tedy:

- odebrání členství poslednímu majiteli
- změna jeho role na jinou
- označení jeho zaměstnaneckého záznamu za smazaný, pokud je na něj
  navázaný

Hláška musí říct proč: *„Ve firmě musí zůstat aspoň jeden majitel.
Nejdřív jmenujte dalšího."*

**Ne tiché neprovedení.** Přes RLS se maže bez chyby — jen se nic
nestane. Tady to musí vyhodit chybu, jinak si člověk myslí, že to
proběhlo.

---

## Kde to hlídat

Dvě obranné linie (pravidlo 3):

- **Databáze** — spoušť nebo kontrola v politice na `memberships`.
  Tahle musí držet.
- **Aplikace** — tlačítko Odebrat se u posledního majitele nenabídne
  a je u toho vysvětlení. Tohle je pohodlí.

---

## Testy

1. Ze dvou majitelů jde jeden odebrat.
2. Poslední majitel **odebrat nejde** — vyhodí to chybu, ne ticho.
3. Poslední majitel **nejde přeřadit** na jinou roli.
4. Po odebrání prvního zbylý majitel pořád **může přidělovat**.
5. Majitel **nemůže odebrat sám sebe**, když je poslední.

---

## Co z toho nevyplývá

Kdo má být „spolumajitel" a přitom **nemá vidět mzdy**, není majitel —
majitel vidí ze zásady všechno. Takový člověk potřebuje vlastní sadu
oprávnění, ne roli Majitel.

Jestli to Šéfík takhle myslí, je to jiné zadání a řekne se to zvlášť.
