# Zadání: pozvánky — nejdřív pozvat, oprávnění až potom

Zadal Šéfík 1. 9. 2026, když mu vystavení pozvánky spadlo na chybě
**„Zaměstnanec nebo oprávnění neexistuje (23503)"**.

> Já bych nejdříve poslal pozvánku na nějaký e-mail, a pokud člověk
> pozvánku přijme, pak bych zadal pozici, práva atd.

---

## 1. Proč to spadlo

Formulář posílá do databáze **prázdné oprávnění** (`p_role: null`) —
v kódu je u toho poznámka „Později nastavit na vybranou roli".
`app.create_invitation` ale roli **vyžaduje**, takže požadavek odmítne
dřív, než cokoli udělá.

Takže dnes **nejde pozvat nikdo**. Není to chyba dat ani nastavení.

---

## 2. Jak to má chodit

Šéfíkovo pořadí je správné a je i bezpečnější než to dnešní. Vede
totiž k tomu, že **nový člověk nedostane nic, dokud mu to někdo
vědomě nepřidělí** — místo aby se oprávnění vybíralo dopředu, poslepu,
u někoho, kdo možná pozvánku ani nepřijme.

1. Vedoucí vybere zaměstnance a **pošle pozvánku na e-mail**.
   Oprávnění se nevybírá.
2. Člověk pozvánku přijme, přihlásí se a **nevidí nic** kromě svých
   vlastních údajů a vysvětlení, že mu oprávnění zatím nikdo nepřidělil.
3. V Lidech je u něj vidět **„čeká na přidělení oprávnění"**.
4. Vedoucí mu přidělí Pozici a Oprávnění. Teprve tím se aplikace otevře.

**Oprávnění v pozvánce se neruší** — jen přestává být povinné. Kdo ví
dopředu, koho zve a na co, vybere ho rovnou a krok 4 odpadne.

---

## 3. Co je k tomu potřeba

### V databázi

- `invitations.role_id` a `memberships.role_id` **smějí být prázdné**.
- `app.create_invitation` roli **nevyžaduje**. Když zadaná je, platí
  na ni pravidlo „nikdo nepřidělí víc, než má sám"
  (`docs/pravidlo-neprideluj-vic.md`) beze změny.
- `app.accept_invitation` založí členství i **bez role**.

**Ověřit, ne předpokládat:** člen bez oprávnění nesmí projít nikam.
`app.has_access` musí u něj vracet nepravdu pro **každé** právo, a musí
to platit i při přímém volání rozhraní, ne jen v nabídce.

### Na obrazovce

- Formulář pozvánky: **Oprávnění je nepovinné**, výchozí „přidělím
  později". Nabídka je omezená stropem — kdo nemá `payroll.read`,
  nenabídne roli, která ho obsahuje.
- Seznam Lidí: sloupec s oprávněním ukazuje u takového člověka
  **„čeká na přidělení"**, ne prázdno. Prázdné políčko vypadá jako chyba.
- Po přihlášení člověk bez oprávnění vidí **vysvětlení**, ne prázdný
  rozcestník: „Účet je hotový. Zatím vám nikdo nepřidělil oprávnění —
  ozvěte se vedoucímu." Prázdná obrazovka bez věty je nejhorší možný
  první dojem z aplikace.

---

## 4. Pozvánka se musí opravdu odeslat

Dnes se **žádný e-mail neposílá**. Obrazovka jen ukáže token a napíše
„Zkopírujte token a pošlete jej pozvanému člověku". To není pozvánka,
to je domácí úkol pro vedoucího.

Co s tím:

- **Odeslat e-mail** přes Resend (`noreply@foodtab.cz`, už je nastavený).
- V e-mailu je **odkaz**, ne token: `https://…/pozvanka/<token>`.
  Nikdo nemá nic přepisovat ručně.
- Na obrazovce zůstane **odkaz ke zkopírování** jako záloha pro případ,
  že e-mail nedojde — ale jako druhá možnost, ne jako jediná.
- Když se e-mail nepodaří odeslat, **musí to být vidět**. Pozvánka,
  o které si vedoucí myslí, že odešla, je horší než chyba.
- Token se pořád ukládá **jen jako otisk** (pravidlo 7) a v čitelné
  podobě se objeví právě jednou.

---

## 5. Testy

1. Pozvánka **bez oprávnění** projde.
2. Přijatý člen **bez oprávnění nemá přístup nikam** — ani přímým
   voláním rozhraní.
3. Po přidělení oprávnění přístup **má**.
4. Provozní nepozve na oprávnění, které sám nemá (platí dál).
5. Pozvánka s citlivým oprávněním **nejde poslat přes SMS** (platí dál).
6. Neodeslaný e-mail **se pozná** — pozvánka se netváří jako doručená.

---

## 6. Pořadí

1. **Roli v pozvánce udělat nepovinnou** — tím se odblokuje zvaní vůbec.
2. Označení „čeká na přidělení" v Lidech a vysvětlení po přihlášení.
3. Odeslání e-mailu s odkazem.

Bod 1 je malý a Šéfíka odblokuje hned. Body 2 a 3 patří ke stejné věci
a mají jít krátce po sobě.
