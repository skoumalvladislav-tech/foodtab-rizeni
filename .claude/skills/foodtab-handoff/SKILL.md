---
name: foodtab-handoff
description: Jak napsat předávací dokument, ze kterého nová relace Claude Code naváže bez čtení celé historie chatu — jen krátký soubor, git log a testy. Použij na konci relace, kdy práce zdaleka nekončí a bude pokračovat jinde nebo jindy, nebo když Šéfík řekne "napiš to tak, ať se na to dá navázat". Liší se od skillu hlaseni: hlášení zapisuje, co se STALO za tu směnu; předávací dokument říká nové relaci, co má DĚLAT DÁL a s jakými mantinely.
---

# Předávací dokument

Konkrétní, fungující vzor je `docs/hlaseni/navazujici-prompt.md`
(14. 9. 2026, pokrývá dva souběžné projekty). Tenhle skill popisuje,
co ho dělá funkčním, aby se dal vzor zopakovat i pro jiný stav práce.

## Proč to není totéž co hlášení

`docs/hlaseni/stav-RRRR-MM-DD.md` (skill `hlaseni`) je záznam jedné
směny — co se udělalo, na co se narazilo, jaká čísla z čeho jsou.
Píše se pokaždé a hromadí se.

Předávací dokument je jiný artefakt: **shrnutí aktuálního stavu +
konkrétní instrukce pro relaci, která nemá v kontextu nic z týhle
konverzace.** Nepřepisuje hlášení, odkazuje na ně. Píše se, jen když
práce reálně přechází na jinou relaci nebo jinou dobu — ne po každém
kroku.

## Ze tří věcí se skládá nová relace, ne z chat historie

1. **Krátký soubor** (tenhle dokument) — orientace a mantinely.
2. **`git log`** — co se skutečně stalo, s hashi.
3. **Testy** (`supabase/tests/run.sh`, `scripts/*.test.mjs`) — co
   dnes prokazatelně funguje.

Předávací dokument proto **necituje celé soubory ani nekopíruje
kód** — odkazuje na cestu a řádek, ne na obsah. Když se obsah změní,
odkaz zůstává platný, citace by zestárla.

## Kostra, podle vzoru `navazujici-prompt.md`

```
# Navazující prompt — stav a co dál

## Stav aplikace (k <datum>)
### Nasazeno v DB          (tabulka: migrace | co | stav)
### Aplikační vrstva        (tabulka: soubor | co | stav)
### Co funguje              (prověřeno JAK — snímek obrazovky, test)

## Co ještě chybí
(tabulka s ID bodů, prioritou 🔴/🟡, a cestou v kódu — přebírá
 číslování z hlášení, nevymýšlí nové)

## Migrace čekající na nasazení
(seznam souborů + "nasazuje Šéfík, ne push")

## Prompt pro příští relaci
```

## Co musí obsahovat blok „Prompt pro příští relaci"

Tohle je nejdůležitější část — je to text, který se dá **doslovně
vložit** jako první zpráva nové relace. Musí být samostatně čitelný,
protože nová relace nečetla nic z tohohle chatu:

1. **Kde jsou projekty/repozitáře**, ne jen jejich jména.
2. **Bezpečnostní pravidla zopakovaná nahlas**, i ta, co jsou
   v CLAUDE.md — nová relace CLAUDE.md sice dostane, ale kritické
   mantinely (nasazuje Šéfík, ne push; žádný destruktivní SQL bez
   schválení; SECURITY DEFINER nemá druhou linii) se v předávacím
   dokumentu neztrácí spoléháním na to, že si je někdo znovu přečte
   celé.
3. **Co dělat jako první** — jeden konkrétní krok s cestou k souboru
   a řádkem, ne obecné „pokračuj v práci".
4. **Pořadí zbytku práce**, s explicitní poznámkou, kde se dá
   zastavit (u tohohle vzoru: na hranici každého písmene A/B/C/D).
5. **Co NEdělat** — vlastní seznam, ne jen odvozený z pravidel výš.
   U příkladu: nespouštět konkrétní IMAP trigger, nemazat řádky bez
   náhledu, nezapínat konkrétní workflow.
6. **Pravidla kódu**, pokud se v projektu liší od výchozích zvyklostí
   (u Foodtabu: bez komentářů, pokud „proč" není neobvyklé; žádné
   abstrakce navíc; každou kontrolu rozbít schválně; zelený build není
   důkaz vykreslení — potřeba snímek).

## Kdy psát předávací dokument místo hlášení

- Kontext relace se blíží limitu a práce zjevně bude pokračovat jinde.
- Šéfík výslovně řekne, že navazuje jiná relace nebo on sám za pár dní.
- Souběžně běží víc projektů/modulů (`foodtab-release`, „Dvě relace
  v jednom repozitáři") a je potřeba jeden vstupní bod pro obojí.

Jinak stačí běžné hlášení (skill `hlaseni`) — psát předávací dokument
po každé relaci by ho zbytečně nafouklo a příští čtenář by nevěděl,
která verze je aktuální. **Když se předávací dokument doplňuje
později, oprav i stará tvrzení, která přestala platit** — stejné
pravidlo jako u hlášení.
