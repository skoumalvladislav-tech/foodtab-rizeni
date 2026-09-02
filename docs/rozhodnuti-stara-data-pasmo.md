# Rozhodnutí: stará data se posouvat nebudou

2. 9. 2026 večer. Navazuje na `docs/odpoved-na-nalez-casu-2026-09-02.md`.

---

## Rozhodnutí

**Migrace na posun starých ručních záznamů se nepíše a nepouští.**
Místo toho se **stornuje všech deset** ručních záznamů s poznámkou do
auditu.

Důvody, v tomhle pořadí:

1. **Všech deset patří jednomu člověku — Šéfíkovi — a jsou to zkoušky
   aplikace.** Nikomu se z nich nic neplatí. Ověřeno: v srpnu a září
   nemá docházku nikdo jiný.

2. **Code sám ukázal, že ten posun není bezpečná operace.** U září
   přeskládal pořadí událostí a z pěti hodin udělal hodinu a čtvrt.
   Není to chyba opravy, je to její důsledek — ale znamená to, že se
   nedá napsat „jen posunu čas".

3. **Migrace by měla jediného zákazníka a ten mizí.** Kód je
   opravený, takže žádná další křivá data nevzniknou. Ty jediné, na
   které by migrace sáhla, se stornují.

Riskantní jednorázový zásah do mzdových dat kvůli pořádku v datech,
ze kterých se neplatí, je špatný obchod.

## Co si z toho necháváme, i když migraci nepíšeme

**Oprava časového pásma přeskládá pořadí událostí.** Když se posune
ruční příchod, může se dostat před píchnutý odchod a spárovat se
s něčím jiným než dřív. Délka směny se pak změní, i když se oba konce
posunuly stejně.

Zní to samozřejmě, když je to napsané. Nezní to samozřejmě, když
někdo za rok u jiného zákazníka napíše `update ... occurred_at =
occurred_at + interval '2 hours'` s tím, že „to jen posune čas".
Proto to tu stojí.

## Storno

- **Všech deset**, ne jen těch pět mrtvých.
- **Storno, ne `delete`** — pravidlo 9.
- Poznámka ať říká proč: *zkušební záznam z doby před opravou
  časového pásma*.
- Píchnuté záznamy (`source = 'app'`) se nechávají být. Jsou uložené
  správně; že je jich šestnáct po devatenácti vteřinách, je nepořádek,
  ne chyba.

## Čistý začátek

Skutečný čistý štít nepřinese storno, ale **`foodtab-prod`** — ten
vznikne prázdný. Do té doby je `foodtab-test` zkušebna, ve které se
zkoušelo, a tak se na jeho obsah má koukat.
