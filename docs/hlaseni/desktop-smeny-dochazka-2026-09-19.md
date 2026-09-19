# Desktop: Rozpis směn a Docházka — zpráva k práci z 19. 9. 2026

Zadání „Desktop Směny + Docházka UX 2.0“, k tomu tři doplňky, které Šéfík
poslal za pochodu: **export měsíce do PDF a Excelu**, **průběžný součet
naplánovaných hodin za pozicí** a **menší okno pro čas směny**.

**Nasazení: jen kód. Žádná migrace, žádné zásahy do databáze.** Do produkce
jde slitím větve; nic se nespouští ručně.

## Co je hotové

**Rozpis směn (počítač)**

- Týdenní mřížka je hlavní plocha: nadpis + jeden řádek nástrojů + (jen když
  je co vydávat) úzký pruh. Na 1536 × 864 je vidět **9–10 řádků** místo
  dřívějších šesti.
- Hledání (bez ohledu na diakritiku), jedna nabídka filtrů (úsek, pozice,
  zaměstnanec, stav směny) s čipy, sbalitelné úseky s „5 lidí · 163 h“,
  součty hodin po dnech, úsecích i celkem.
- **Hodiny za pozicí u člověka** („Kuchařka · 32 h“) a v panelu při zadávání
  směny průběžně „Tento týden má naplánováno 70 h, s touhle směnou 82 h“
  (přepočítává se s člověkem, datem, časem i pauzou).
- Karta směny: vydaná / **Nevydáno** / **Změněno** — každá tvarem i slovem,
  ne jen barvou. Prázdná buňka je čistá, „+ Přidat“ až při najetí.
- Panel „Upravit směnu“ vpravo je **nemodální** (rozpis zůstává vidět, jde
  přepnout na jinou směnu), pole jsou nižší a **čas od–do je jedno krátké
  pole** (to bylo „zbytečně velké okno“). Nahoře kdo a v jakém je stavu,
  dole docházka k té směně a potvrzení upozornění. Duplikovat, smazat.
- Vydání: pruh „7 změn čeká na vydání · 1 zaměstnanec bude upozorněn“,
  **kontrola změn** (`ST 08:00–16:00 → 10:00–18:00`, kdo dostane zprávu) a
  po vydání **skutečný výsledek** (kolik zpráv odešlo, nebo co databáze
  odmítla). Import z tabulky je tlačítko v záhlaví, ne trvalá karta.
- **Export měsíce** (tlačítko Export v záhlaví): Excel (.xlsx, dva listy —
  Rozpis a Souhrn hodin po lidech) a PDF (A4 na šířku, týden na stránku,
  souhrn na konci). Nevydané směny mají hvězdičku a export to říká.
- Den a Měsíc: měsíc se teď opravdu načte celý (dřív jen sedm dní) a týden
  začíná pondělím; Den má široký sloupec se jmény a stejné značení
  nevydaných směn.

**Docházka (počítač)**

- Vedoucí s právem číst docházku vidí **živý přehled**: V práci · Čekáme ·
  Po začátku směny · Na místě dnes; seznamy Právě v práci / Ještě nepřišli /
  Odešli / Nesrovnalosti; klik na člověka otevře panel (plán dne, příchod,
  odchod, záznamy, měsíc s hodinami a hrubou mzdou **jen s právem
  `payroll.read`**). Sám se obnovuje každou minutu.
- Kiosk je jen malý stav „Kiosk aktivní“ + odkaz na zařízení. Kód z tabletu,
  jeho rotace ani kontrola se **nezměnily**.
- Vlastní píchačka zůstala pod přehledem („Moje docházka“).

## Nálezy při práci (opraveno)

1. **Karta „Vydat rozpis“ se ukazovala každému, kdo rozpis smí číst** — i
   číšníkovi, s tlačítkem „Vydat znovu“, které mu pak databáze odmítla.
   Teď jen tomu, kdo na té pobočce smí plánovat.
2. **Výsledek vydání nečetla žádná obrazovka.** Kdo rozpis vydal, viděl jen
   obnovenou stránku a nevěděl, jestli se povedlo; chybu z databáze neviděl
   vůbec. A po vydání ho to vrátilo na dnešek, ne na týden, který upravoval.
3. **Majitel bez záznamu zaměstnance na Docházce neviděl nic** než větu
   „nemáte zaměstnanecký záznam“. Přehled se teď načítá dřív.
4. Přepínač Den/Týden/Měsíc mizel na tabletu (sdílel třídu s přepínačem
   poboček, který se pod 960 px schovává).

## Rozhodnutí, která jsou Šéfíkova (nic z toho jsem nerozhodl za něj)

- **Upozornění na změnu zvoní dvakrát.** `ulozit_smenu` upozorní dotčeného
  **hned při uložení** (i rozpracované směny, tak to obnovila migrace z
  19. 9.) a **vydání rozpisu pošle ještě `rozpis.vydan`** o týchž změnách.
  `docs/upozorneni-smeny-zadani.md` přitom říká „rozpracovaný rozpis nikomu
  nezvoní“. Obrazovka proto **neslibuje, kdy komu co přijde**; říká jen, co
  vydání rozešle (číslo z databáze). Jedno z toho se musí přestat dít.
- **Volby „Pouze zaměstnanci se změnou / Všichni relevantní / Bez upozornění“
  v databázi neexistují.** Vydání vždy pošle jen dotčeným, po jedné zprávě
  na člověka. Kontrola vydání to říká jako fakt, ne jako přepínač, který by
  nic nedělal. Doplnit další volby je změna `vydat_rozpis`, tedy migrace.
- **Zaměstnanec dnes vidí rozpracovaný rozpis, jen označený** (pravidlo z
  `upozorneni-smeny-zadani.md`, tak se to i chová). Zadání „zaměstnanec
  nesmí vidět draft“ je opačné. Nechal jsem stávající pravidlo; změnit se
  dá filtrem v RLS na `shifts` (migrace), ale jde o produktové rozhodnutí.
- **„Zpoždění“ není.** Firma nemá pravidlo tolerance, takže karta se jmenuje
  „Po začátku směny“ a říká jen fakt (směna začala, příchod chybí). Chce-li
  Šéfík „pozdě po N minutách“, je to nastavení firmy (jako
  `smeny_dulezita_hodin`), ne konstanta v kódu.
- Kdo se píchl na pobočce, na kterou vedoucí `attendance.read` nemá, se mu v
  přehledu ukáže jako „ještě nepřišel“ — RLS mu ten záznam nevydá. Je to
  hranice oprávnění, ne chyba, ale je dobré ji znát.

## Ověřeno

- `scripts/rozpis-desktop.test.mjs` (83 kontrol), `dochazka-dnes.test.mjs`
  (37 kontrol, pouští se i pod `TZ=UTC` a `America/New_York`),
  `rozpis-export.test.mjs` (72), doplněná `cas.test.mjs`; stávající `rozpis-mobil`, `dochazka-stav` beze
  změny.
- **Mutační zkouška:** 17 schválných rozbití (stav vydání, rozdíl proti
  vydanému rozpisu, hledání, filtr neobsazených směn, „je v práci“ včetně
  storna a jiného provozního dne, hranice začátku směny, pásmo pobočky,
  hvězdička nevydané, CRC, escapování, xref, čeština v PDF). Nejdřív
  jedno uniklo — test „odchod z jiného provozního dne“ ve skutečnosti
  testoval jen „odchod dřív než příchod“; opraveno a rozbití pak padá.
- **Excel skutečný:** vyrobený soubor otevřel a přečetl Microsoft Excel
  (2 listy, čeština, čísla jako čísla) i vlastní čtečka importu.
  **PDF** ověřeno poppler (`pdfinfo`, vykreslení stránek) — čeština vychází
  správně. V Adobe Readeru a macOS Náhledu jsem ho neotevřel; písmo se
  nevkládá (Helvetica se znaky navíc přes `/Differences`), takže se vyplatí
  jednou se podívat.
- `tsc` (kromě `@anthropic-ai/sdk`, který v lokálním `node_modules` chybí),
  `eslint .` — 0 chyb.
- **Serverové načítání dat** (`smeny/page.tsx`, `dochazka/prehled/nacti.ts`,
  export) jsem **nespustil proti databázi** — v tomhle prostředí nejsou klíče
  k Supabase, takže snímky jsou nad vzorovými daty. Zkontroloval jsem jen
  schéma živé databáze (bez čtení dat): všech 23 sloupců, které nové dotazy
  čtou, existuje a `authenticated` je smí číst, a všech 5 funkcí
  (`rozpis_nahled`, `rozpis_stav`, `vydat_rozpis`, `employee_earnings`,
  `pobocka_ma_kiosek`) existuje. Jak dotazy odpoví přes RLS, ukáže až první
  otevření po nasazení — proto seznam níž.
- **Snímky** (skutečné komponenty nad vzorovými daty, 1536 × 864, 1440 × 900,
  1280 × 720, 1024 × 768, tablet 768, tmavý režim, telefon 390): týden,
  panel směny, kontrola vydání, filtry, hledání, sbalený úsek, Den, Měsíc,
  dvě pobočky, pohled zaměstnance, výsledek vydání, chyba, přehled Docházky
  a panel člověka.
- **Nespuštěno:** `next build` (chybí zmíněný balík; Vercel si ho nainstaluje),
  E2E přes přihlášení (Foodtab přihlašuje kódem z e-mailu).

## Po nasazení zkusit

1. Rozpis → změň někomu čas směny → v pruhu naskočí „1 změna čeká na vydání“,
   [Vydat rozpis] ukáže staré → nové a po potvrzení zprávu s číslem.
2. Export → Excel i PDF za aktuální měsíc; PDF otevřít ve vlastní čtečce.
3. Docházka jako vedoucí → přehled; klik na člověka → panel.
