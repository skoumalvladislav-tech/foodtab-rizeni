# Noční práce na 7. 9. — „Dnes", úklid pohledu zaměstnance, dokumenty

**Pravidla pro noc jsou stejná jako minule a fungovala:** každý krok
se dá nasadit sám, na hranici kroku se dá skončit, a **na nic se
neptáš.** Když narazíš na rozhodnutí o provozu, zapiš otázku do
`docs/hlaseni/otazky.md`, vyber nejopatrnější variantu, napiš do kódu
`// ROZHODNOUT: …` a **pokračuj na jiném kroku.** Čekání na odpověď
v noci znamená ztracenou noc.

---

## Krok 0 — než začneš (pět minut)

**Pushni to, co máš.** Osm commitů z přihlašování leží u tebe;
`origin/main` je pořád na `eed1bba`. Šéfík si dnes večer nastavil
šablonu e-mailu, kód mu chodí — ale na nasazené aplikaci je pořád
stará obrazovka s jediným polem na e-mail, takže **nemá kam ten kód
napsat.** Ověřil jsem to na nasazené verzi.

**A oprav `krok28_scenar.sql`, řádek 176:**

```sql
select ok as ok_spatny, coalesce(zpravy::text, '') as zpravy_spatny
from public.kiosk_zpravy_pinem(:'tablet', '000000') \gset
```

`\gset` nad sloupcem, který je NULL, proměnnou **vůbec nezaloží** —
nenastaví ji na prázdno, nechá ji nedefinovanou, a další řádek spadne
na `syntax error at or near ":"`. U špatného PINu je `zpravy` prázdné,
takže se to trefilo přesně tam. **V PGlite to nevidíš**, serializuje
prázdné hodnoty jinak.

Ověřeno u mě proti opravdovému PostgreSQL: bez opravy padá celý
scénář, s ní **projde 912 kontrol**.

**Je to podruhé, co ta past chytla** — poprvé v `krok17` 4. 9. Přidej
proto do `CLAUDE.md` k oddílu o testech:

> **`\gset` nad sloupcem, který může být NULL, se vždycky protahuje
> přes `coalesce`.** Proměnná se jinak nezaloží a další řádek spadne
> na záhadnou syntaktickou chybu. V PGlite se to neprojeví.

---

## Krok 1 — obrazovka „Dnes" (hlavní práce noci)

Zadání je hotové: **`docs/dnes-obrazovka-zadani.md`**, 114 řádků. Čti
ho celé. Je nezačaté od 4. září a je to **největší chybějící věc pro
zaměstnance** — dnes číšník po přihlášení přistane na rozcestníku
s šesti tlačítky a cedulí o osobních údajích, místo aby viděl, kdy mu
začíná směna a jestli má píchnuto.

### Co k tomu přibylo od 4. září a patří to tam

Zadání je starší než tenhle týden. Doplň do „Dnes" i tohle — všechno
už v aplikaci existuje, jde jen o zobrazení:

- **Kolik zpráv na mě čeká** (z `app.doruci_se`). Po píchnutí příchodu
  se doručí; před ním ať je vidět jen počet, ne obsah.
- **Moje dnešní úkoly** — z `tasks`, ty adresované mně, mé pozici, mému
  úseku nebo celé pobočce. Po termínu označené, ne schované.
- **Nepřečtené z Nástěnky i Rozhovorů dohromady**, jedno číslo.

### Co tam naopak nepatří

Mzdy a sazby ostatních, rozpis celé pobočky, cokoli, na co člověk nemá
právo. **Rozhoduje se podle práv, ne podle názvu role** (pravidlo 2).

---

## Krok 2 — úklid toho, co zaměstnanec vidět nemá

Z `docs/rychlost-a-pohled-zamestnance.md`, část 2. Je to skrývání, ne
nová práce — dohromady možná hodina:

1. **Řádka vypnutých modulů** (Tvorba menu, Finance, Marketing,
   Objednávky) ať se kreslí jen tomu, kdo má `settings.manage`.
   Číšníkovi nabídka toho, co si firma může přikoupit, nepatří — a bere
   místo na telefonu, kde je ho nejmíň.
2. **Položky „Připravujeme"** (Receptury, Jídelní lístky, Motivace) ať
   zaměstnanec nevidí. Slib nepatří na denní nástroj.
3. **Právo „Používat Gastro AI"** odškrtni u rolí Servis, Bar a Kuchyně
   — ten modul neexistuje.
4. **Rozhovory do spodní lišty místo Záloh.** Zálohy potřebuje člověk
   jednou za měsíc, zprávy každý den.

---

## Krok 3 — Nástěnka: dokumenty a úseky

Zadání: **`docs/nastenka-dokumenty-a-strediska.md`**. Šéfík upřesnil,
co tam bude věšet: provozní pokyny a řády, akce a události, fotky
z provozu. **Osobní dokumenty lidí tam nepatří** a je to v zadání
napsané natvrdo.

Pořadí uvnitř kroku:

1. **Adresát Nástěnky sjednotit** s úkoly — firma, pobočka, úsek,
   pozice, člověk. Tentýž výběr, ideálně tatáž komponenta.
2. **Přílohy** — neveřejný bucket, podepsané odkazy s krátkou
   platností, povolené typy `pdf/jpg/png/heic`, strop 10 MB a 5 souborů
   na zprávu. **Kdo nesmí číst zprávu, nesmí stáhnout ani soubor** —
   a ověřuje se to při každém stažení.
3. **„Beru na vědomí"** jako volitelný příznak u oznámení, se seznamem
   jmen, kdo nepotvrdil.
4. **Jeden vchod na zprávy** — jedna položka v nabídce, uvnitř záložky
   Nástěnka a Rozhovory.

Když dojde čas, skonči po bodu 1 nebo 2. Body 3 a 4 se dají udělat
samostatně kdykoli později.

---

## Co v noci nedělat

- **Kiosek a browser klienta v něm.** Všiml sis ho správně, ale je to
  samostatná úvaha a v noci se do ní nepouštěj.
- **`checklist_entries`** a to přepisování záznamů. Jen ať to zůstane
  v hlášení.
- **Playwright do CI.** Až po tomhle všem.
- **Push do mobilu, přílohy u rozhovorů, doba uchování, jazykový
  model.** Pořád platí.

---

## Ráno

Hlášení do `docs/hlaseni/stav-2026-09-07.md`: co je hotové s commity
a soubory, na které hranici jsi skončil, čísla kontrol **a z čeho
jsou**, co čeká na Šéfíka, otevřené otázky — a hlavně **na co jsi
narazil a nešlo to.** Minule to byla nejcennější část celého hlášení.

**A pushni.** Dvakrát po sobě se stalo, že ráno byla hotová práce jen
na tvém disku — a co není v repozitáři, to pro nás dva neexistuje.
