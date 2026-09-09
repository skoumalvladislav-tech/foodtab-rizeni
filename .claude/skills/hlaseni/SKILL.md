---
name: hlaseni
description: Napsat hlášení o stavu prací na Foodtabu do docs/hlaseni/. Použij na konci každé směny práce, při předávání, nebo když se hlásí, co je hotové a co ne. Drží formát, který se v projektu ustálil — včetně toho, že se v něm nahlas píše, na co se narazilo a co NEŠLO.
---

# Hlášení ve Foodtabu

Píše se do `docs/hlaseni/stav-RRRR-MM-DD.md`. Čte to majitel projektu,
který **není vývojář** — česky, bez žargonu, kompromisy neschovávat.

Vzor, který se osvědčil: `docs/hlaseni/stav-2026-09-08.md`.

## Kostra

```
# Stav k <datum> — <jedna věta, o čem ten den byl>

## Nejdřív to podstatné
## Co je hotové          (tabulka: co | commit | čeká na db push)
## Čísla — a z čeho jsou
## Co čeká na Šéfíka
## Otázky
## Na co jsem narazil a nešlo to
## Kde jsem skončil a co zbývá
## Nenasazoval jsem
```

## Co v něm musí být

**Commity u každé hotové věci.** Bez hashe se to nedá dohledat.

**Čísla A Z ČEHO JSOU.** Ne „všechny kontroly prošly", ale
*„952 kontrol, PGlite (944 + 8 nových v krok31); 946 proti PostgreSQL"*.
A u čísel z PGlite vždycky připsat, že **neověří RLS ani sloupcové
granty** — rozhoduje workflow Databáze.

**Schválná rozbití.** Kolik jich bylo a že každé spadlo na té kontrole,
na kterou mířilo. Když jsi rozbil jednu věc dvěma způsoby, napiš proč.

**Na které hranici jsi skončil.** Když jsi skončil uprostřed kroku,
řekni to rovnou — nedodělaný krok je horší než chybějící.

## Oddíl „na co jsem narazil a nešlo to"

**Tohle je nejcennější část hlášení a nesmí chybět.** Patří sem:

- co jsi zkusil a zahodil, i s důvodem (třeba test, který nešel
  spustit kvůli aliasu `@/` a řetězu až na `next/headers`),
- co jsi **nedodal** z toho, co zadání chtělo, a proč — ne omluvou,
  ale důvodem („špatný počet u věty *kdo to uvidí* je horší než žádný"),
- **co ses o sobě dozvěděl špatně**: číslo, které nesedělo, tvrzení,
  které neplatilo. Když to opravuješ, oprav i důvod, ne jen číslo.
- obrazovky, které jsi **neviděl vykreslené**.

## Rozhodnutí Šéfíka

Zapisují se do textu jako citovaný blok, na místo, kterého se týkají:

```
> **ROZHODNUTÍ ŠÉFÍKA (8. 9.): …** Důvod přijatý, nepředělává se.
```

Když se tím něco uzavírá, napiš to („Tenhle bod zadání §4 je tím
uzavřený").

## Otázky

Do `docs/hlaseni/otazky.md`, ne do hlášení — v hlášení jen odkaz a jedna
věta. U každé otázky: **kdy vznikla, co jsem vybral a proč, a co se
změní, když to má být jinak.** V kódu k tomu `// ROZHODNOUT:`.

Pravidlo noci i dne: **na nic se neptáš a nečekáš** — vybereš
nejopatrnější variantu a jdeš dál.

## Než to odevzdáš

- **Pushni.** Co není v repozitáři, to pro nás neexistuje.
- Projdi hlášení, jestli si **neodporuje** — když se něco udělalo,
  nesmí to jinde pořád stát jako úkol.
- Když se hlášení doplňuje později, oprav i **stará tvrzení**, která
  přestala platit (typicky „čeká na `db push`").
