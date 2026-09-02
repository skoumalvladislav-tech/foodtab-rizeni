# Zadání: dozvědět se, že někdo přijal pozvánku

Zadal Šéfík 2. 9. 2026.

> Teď se to nikde nedovím. Zároveň by odpověď na pozvánku byla rychlá.

| Otázka | Rozhodnuto |
|---|---|
| Komu se to hlásí | Každému s právem **spravovat lidi** (`people.manage`) |
| Vyskakovací okno | **Jen když někdo čeká na oprávnění** |
| Kanály | Zvoneček **a** e-mail hned; push do mobilu později |

---

## 1. Proč to chybí

Dnes pozvánku vystavíš a tím pro tebe věc končí. Jestli ji člověk přijal
za hodinu nebo vůbec, se nedozvíš — musel bys chodit do Lidí a dívat se.
A když ji přijal **bez oprávnění**, sedí v aplikaci, která mu nic
neukazuje, a čeká, až si toho někdo všimne.

Obě strany tedy čekají na druhou. To je celý problém.

---

## 2. Co se stane při přijetí

`app.accept_invitation` na konci **založí upozornění** každému, kdo má
v té firmě `people.manage` — ne podle názvu role, ale podle práva
(pravidlo 2). Kdo pozvánku poslal, ho dostane taky; může ji poslat
někdo jiný, než kdo pak přiděluje.

Dva různé texty, protože jsou to dvě různé situace:

**Přijal a čeká na oprávnění:**
> **Láďa přijal pozvánku a čeká na oprávnění.**
> Dokud mu je nepřidělíte, v aplikaci neuvidí nic než své údaje.

**Přijal a oprávnění už má:**
> **Láďa přijal pozvánku** a má oprávnění Servis, Restaurace Černá Perla.

První je úkol, druhé je informace. Nesmí vypadat stejně.

---

## 3. Vyskakovací okno — jen když je co dělat

Při přihlášení se okno ukáže **jen tehdy, když někdo čeká na oprávnění**.
Když pozvánka oprávnění nesla, stačí zvoneček.

Proč tak úzce: okno, které se odklikává, i když není co dělat, se za
týden odklikává bez čtení. Pak přijde to jediné, na kterém záleželo,
a odklikne se taky.

Pravidla okna:

- **Vypíše všechny čekající**, ne jednoho — po víkendu jich může být pět.
- **Tlačítko vede rovnou na přidělení oprávnění** tomu člověku, ne na
  seznam lidí. Cesta ke splnění úkolu má být jedno kliknutí.
- **Zavřít jde vždycky.** Nic se tím nerozbije, jen se okno ukáže při
  příštím přihlášení — dokud lidé čekají.
- **Jakmile mají oprávnění, okno se přestane ukazovat samo.** Nic se
  neodškrtává; stav je v datech, ne v tom, jestli si to někdo přečetl.
- Ukazuje se **jednou za přihlášení**, ne při každém přechodu obrazovky.

---

## 4. E-mail hned, push až potom

**Zvoneček** — vždycky. Je to jediný kanál, který nemůže selhat.

**E-mail** — hned. Resend je ověřený a pozvánky přes něj chodí. Bez
jmen v předmětu: *„Foodtab — někdo přijal pozvánku"*, jméno až uvnitř.
Předmět e-mailu čte i ten, kdo ho nemá otevřít.

**Push do mobilu** — ne teď. Potřebuje service worker, klíče a svolení
prohlížeče, a je to samostatný kus práce. **Nepiš do rozhraní, že push
chodí, dokud nechodí.** Až se k němu dostaneme, bude to zadání zvlášť.

Kdo chce dostávat co, ať je **nastavení u člověka**, ne konstanta.
Zvoneček se vypnout nedá — to je záznam, ne oznámení.

---

## 5. Co se nesmí pokazit

- **Do jazykového modelu nejde nic z toho** (pravidlo 8).
- Upozornění je osobní údaj: `tenant_id`, RLS, politika. Každý vidí jen
  svoje — i majitel.
- **Cizí firma se o ničem nedozví**, ani když má stejné jméno člověka.
- Když se e-mail nepodaří odeslat, **zvoneček zůstane** a je vidět, že
  e-mail selhal.
- Přijetí pozvánky **nesmí spadnout kvůli upozornění**. Když se
  upozornění nepodaří založit, členství stejně vznikne — člověk se do
  firmy dostane, i kdyby se pošta rozbila.

---

## 6. Testy

1. Po přijetí má **každý s `people.manage`** upozornění; kdo ho nemá,
   nemá ani upozornění.
2. Přijetí **bez oprávnění** dá jiný text než přijetí s oprávněním.
3. **Cizí firma** upozornění nedostane.
4. Okno se ukáže, **jen když někdo čeká** — s oprávněním se neukáže.
5. Po přidělení oprávnění se okno **přestane ukazovat** bez dalšího
   zásahu.
6. Upozornění **nejde přečíst cizímu** člověku ani přímým voláním.
7. Když založení upozornění selže, **členství přesto vznikne**.
