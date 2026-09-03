# Kontrola před večerním testem — 3. 9. 2026

Prošel jsem ostrou aplikaci obrazovku po obrazovce. **Jedna věc
blokuje všechno ostatní.**

---

## Blokátor: Vercel stojí na buildu z včerejšího večera

Nasazená aplikace je pořád `72afe8f` — z 2. 9. kolem osmé večer.
Všechno novější leží.

Dva důkazy, oba z živé adresy:

- `/api/uloha/zapomenuty-odchod` vrací **404** (přibylo v `cf4177b`).
- Docházka hlásí *„Jste v práci · od 11:14"*, zatímco v Praze bylo
  **17:37**. Je to čas v UTC — **oprava pásma není nasazená.**

Příčina se nezměnila: `vercel.json` s hodinovým cronem
(`0 * * * *`) je **pořád na `main`**. Na tarifu Hobby to Vercel
odmítá při nasazení, takže od `cf4177b` padá každý build a padat
bude.

**Vyprázdnil jsem `vercel.json` na `{}`** a zapsal ho na disk. Stačí
commitnout a pushnout — tím se rozjede všechno ostatní.

---

## Co je živé a funguje

| Obrazovka | Stav |
|---|---|
| **Lidé a pozvánky** | Chodí. Vystavení pozvánky, seznam, úpravy |
| **Ochrana posledního majitele** | Vidět v tabulce: „Majitel (jediný)", Smazat je zablokované |
| **Zálohy** | Výplata, storno, volba zobrazení, horní mez |
| **Pozastavení záloh** | **Hotové** — u jednotlivce i za celou firmu; hlásí „1 zaměstnanec není v nabídce, protože má pozastavené zálohy" |
| **Kiosek a QR** | QR nese celou adresu i s kódem. Ověřeno dekódováním z fotky tabletové obrazovky |
| **Rozpis směn** | Jen prohlížení, tři pohledy |

## Co čeká na nasazení

Kód je napsaný, jen se nedostal na server:

- **Oprava časového pásma.** Časy jsou o dvě hodiny vedle a **ruční
  zápis ukládá o dvě hodiny jinam**, než co se napíše.
- **Panel nedokončených** ukazuje nejstarší příchod místo otevřeného.
- **Ruční odchod bez otevřené směny** se pořád tiše „zapíše".
- **Upozornění na zapomenutý odchod.**

## Co ještě není napsané

Noční zadání z `docs/nocni-prace-2026-09-03.md`. Code na tom
nezačal — je to práce po dnešní frontě, ne místo ní.

- **Barvy zaměstnanců v kalendáři.** Proto je nevidíš. Ověřil jsem
  to i v kódu stránky: všech 24 buněk se směnami má stejné pozadí.
- **Úseky** (bar, kuchyně, provoz).
- **Zadávání směn z kalendáře.** Na Rozpisu není žádné tlačítko na
  přidání — dnes se směny nedají zadat z obrazovky vůbec.
- **Volné směny a přihlašování.**
- **Limity záloh.**

---

## Překážky, které nejsou v kódu

Tohle je potřeba udělat ručně, jinak nebude co testovat.

**Nikdo kromě tebe nemá účet.** V tabulce má „Účet: Ano" jediný
člověk. Lucie má pozvánku nepřijatou. Aby dnes někdo píchal svým
telefonem, musí nejdřív pozvánku přijmout — a to znamená rozeslat je
s dostatečným předstihem.

**Devět lidí z dvanácti má „nezadaná" sazba.** Bez sazby nevznikne
mzda ani zůstatek, takže **zálohy u nich nepůjde vyzkoušet
smysluplně** — a limit „poměr k odpracovanému" by neměl z čeho počítat.

**Pozici má jediný člověk** (Láďa — Kuchař). Rozdělení podle pozic
nebo úseků nebude na čem ukázat.

**Bernard Bar nemá zaregistrovaný tablet.** Aktivní zařízení je jen
„tablet Perla" na Černé Perle. Kdo má večer píchat v baru, nemá kde.

---

## Pořadí na dnešek

1. **Pushnout `vercel.json`** a počkat, až se nasazení rozjede.
2. **`supabase db push`** — čekají dvě migrace z dneška
   (`20260903010000`, `20260903020000`).
3. **Ověřit, že se časy narovnaly** — Docházka musí ukazovat hodinu,
   která sedí s hodinami na zdi. Do té doby **nezadávej ruční
   docházku**.
4. **Zaregistrovat tablet na Bernard Baru.**
5. **Doplnit sazby a pozice** lidem, se kterými budeš zkoušet.
6. **Rozeslat pozvánky** a nechat lidem čas je přijmout.

Body 1 až 3 nejdou přeskočit. Zbytek se dá dohnat za pochodu.
