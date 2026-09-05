# `krok23_scenar.sql` — kód je v pořádku, padá ten test

Zkouška proti opravdovému PostgreSQL nad `43f2a3f`:

```
SPADLÉ SCÉNÁŘE: krok23_scenar.sql
Kontrol prošlo: 742
ERROR: SELHALO: zůstává v seznamu nedokončených   (řádek 190)
```

**Nejdřív to dobré:** `krok5` po tvé opravě prochází, počet kontrol
stoupl ze 727 na 742 a **dvojitý příchod máš udělaný správně.** Prošlo
mu všechno ostatní — odmítnutí téhož dne, provozní den přes půlnoc,
uzavření staršího, `out` zůstalo prázdné, do hodin se nezapočítalo,
hlídač na něj dosáhne, audit sedí, druhá pobočka brání stejně, ruční
doplnění dopočítá hodiny na minutu.

Spadl jediný řádek, a **není to chyba v migraci.**

## Co se děje

Řádky 184–186:

```sql
set role authenticated;
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);
```

Role se nastaví **dřív**, než se zjistí, kdo to je. Jenže v tu chvíli
už `public.profiles` čte `authenticated` **bez** `auth.uid()` — a RLS mu
ten řádek nedá. `set_config` tedy dostane NULL, `test.user_id` zůstane
prázdné a `nedokoncena_dochazka` nemá komu co ukázat. Vrátí nula řádků
a kontrola právem spadne.

Změřeno na téže databázi, obě pořadí vedle sebe:

```
A) set role authenticated → select z profiles   →  (NULL)
B) select z profiles → set role authenticated   →  11111111-1111-1111-1111-111111111111
```

Ostatní scénáře to mají v pořadí B — třeba `krok5_scenar.sql`:
`perform set_config(...)` a **až potom** `set local role authenticated`.

## Oprava

Prohodit ty dva řádky:

```sql
select set_config('test.user_id',
  (select user_id::text from public.profiles where email = 'majitel@foodtab.cz'), false);
set role authenticated;
```

A **projdi celý krok23, jestli to není i jinde.** Tohle je chyba, která
se opisuje.

## Proč to nechytil PGlite

Protože v PGlite běžíš jako superuživatel. `set role authenticated`
tam RLS nezapne, takže se `profiles` přečte a test projde — i když na
opravdovém PostgreSQL, kde na tom stojí celá druhá obranná linie,
neprojde.

**Je to učebnicový příklad toho, proč se čísla z PGlite nedají hlásit
jako výsledek.** Až bude workflow *Databáze* zelené, hlídá tohle za nás
oba.
