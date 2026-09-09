---
name: scenar
description: Napsat kontrolu nebo scénář ve Foodtabu tak, aby uměl spadnout, a ověřit to schválným rozbitím. Použij vždy, když vzniká nová kontrola — v supabase/tests, ve scripts/*.test.mjs i kdekoli jinde — nebo když se hlásí, kolik kontrol prošlo. Zná pasti, na kterých v tomhle repozitáři kontroly mlčky procházely nad rozbitým kódem.
---

# Kontrola, která umí spadnout

> Kontrola, která projde nad rozbitým kódem, je horší než žádná.
> Žádná je vidět; tahle se tváří jako důkaz.

To je nejdražší poučení tohohle projektu. Chytlo nás to nejmíň
šestkrát a pokaždé jinak.

## 1. Jak se scénáře pouštějí

```bash
node scripts/scenare-pglite.mjs                    # všechny
node scripts/scenare-pglite.mjs krok30_scenar      # vybrané
node scripts/scenare.test.mjs                      # čitelnost
node scripts/scenare-poradi.test.mjs               # pořadí
```

**Co PGlite NEOVĚŘÍ, a je to důležitější než co ověří:** běží jako
jediný uživatel a je to superuživatel. `set role authenticated` tam
nedělá to co na Supabase, takže **RLS se z velké části neuplatní**
a sloupcové granty vůbec. Kontroly typu „cizí firma to nevidí" tam
můžou projít i nad rozbitou politikou.

**Zelený běh odsud není důkaz, že je hotovo.** Rozhoduje workflow
Databáze proti PostgreSQL 16.

## 2. Kontrola musí sáhnout na výstup

Nesmí si testovanou hodnotu sestavit vedle podle toho, co jsi zamýšlel
— to ověřuje vlastní záměr, ne kód.

- Vykresli skutečnou komponentu a čti z hotového HTML.
- U SQL **spusť scénář**, ne jen nasaď migraci. `create function` bez
  zavolání neověří nic.
- Když se logika nedá spustit (je zavřená v serverové komponentě),
  **vytáhni ji do čisté funkce** v `lib/` — přesně proto vznikl
  `lib/dochazka-stav.ts`.

Pozor na vyřezávání ze zdrojáku: když kontrola nejdřív něco vyřízne
a teprve pak se ptá, **musí vedle sebe mít kontrolu, že to vyříznutí
uspělo.** Prázdný vstup je jinak vždycky „všechno v pořádku".

## 3. Povinné: rozbij to schválně a podívej se

Napsat kontrolu a nechat ji projít neznamená nic. **Rozbij to, co má
hlídat, pusť sadu, přesvědč se, že spadne — a vrať to.**

Tři pravidla, každé zaplacené:

**a) U souhrnné kontroly rozbij DVĚMA způsoby.** První rozbití shodí
tu nejbližší konkrétní kontrolu a o souhrnné („po převodu má každý
přesně ta práva, co dnes") neřekne nic. Zeptej se: *jaká chyba projde
všemi konkrétními kontrolami a chytí ji jen tahle?*

**b) Podmínka napsaná dvakrát nejde shodit.** Filtr zapsaný „pro
jistotu" na dvou místech drží i po vyndání jednoho — kontrola nad ním
je pak zelená, ať je v těle cokoli. Nech tu, která něco drží, druhou
zruš, a ověř to vyndáním.

**c) Kontrola smí spadnout jen nad chybou.** Když spadne nad *správným*
chováním, neměkč ji — **zuž jí rozsah a napiš proč**. (Stalo se
u převodu: brigádník bez účtu po převodu „má" práva svého zařazení, což
je záměr — porovnání proto běží jen nad lidmi s účtem a živým členstvím.)

## 4. Čísla, která se dají porovnat

Kontroly se počítají z `NOTICE`, které vypisuje `pg_temp.check`, ne
z počtu příkazů — scénáře volají kontroly i uvnitř `do $$`, což je
jeden příkaz s libovolným počtem kontrol. Počítání příkazů dávalo 782
místo 929.

**Když hlásíš „X kontrol prošlo", řekni Z ČEHO to číslo je.** Číslo,
které nejde porovnat s během `run.sh`, je horší než žádné.

## 5. Psaní scénáře — na co se naráží

- **Každý scénář dostane čisté sezení.** `run.sh` pouští každý vlastním
  psql: žádná zděděná role, prázdné `pg_temp`, žádné proměnné.
- **`\gset` nad NULL proměnnou nezaloží** — obal `coalesce(x::text,'')`.
  Nad prázdným výsledkem spadne.
- **Do `do $$` bloků se `:'promenna'` nedostane** — předej ji přes
  `set_config('test.…')`, a nastav ji **dřív**, než ji někdo čte.
- **Ztracené zpětné lomítko**: z `\echo` se stane `echo` a psql spadne
  uprostřed. `scenare.test.mjs` to najde.
- **Posun přes půlnoc dělej o víc než 24 hodin** (26, ne 20) — jinak
  test platí jen dopoledne.
- **Uklízej po sobě**; `run.sh` na konci porovnává počty řádků.
- Pozor na unikát na normalizované jméno zaměstnance.
- Nový scénář **zapiš do `run.sh` i do `databaze.yml`**.

## 6. Kontrola, která zůstane zelená a přestane měřit

Nebezpečnější než ta, co spadne. Vzniká, když se změní model pod
kontrolou, která se ptá na starou tabulku. Po každé větší změně se
zeptej: **měří tahle kontrola pořád to, co měřila?**
