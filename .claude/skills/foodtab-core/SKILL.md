---
name: foodtab-core
description: Architektonická páteř Foodtabu — multitenance, app.has_access, systém modulů, dvě obranné linie (app + RLS), rozsah firma/pobočka, provozní datum a časové pásmo. Použij na začátku každé práce v aplikační vrstvě nebo databázi, a kdykoli si nejsi jistý, kdo smí co vidět nebo jak se počítá provozní den. Je to zhuštěné shrnutí CLAUDE.md („Závazná rozhodnutí" a „Pravidla, která se neporušují"), ne náhrada — při rozporu platí CLAUDE.md.
---

# Architektura Foodtabu

Zdroj pravdy je `CLAUDE.md`. Tenhle skill ho jen zpřístupňuje na požádání
místo toho, aby se čet celý při každé relaci.

## Multitenance

`tenant_id` je v každé tabulce od začátku, i když rozhraní zůstává
jednofiremní. Dvě úrovně rozsahu: **firma** a **pobočka** (`branch_id`),
počet poboček neomezený. Zaměstnanec může existovat bez uživatelského
účtu (brigádník) — role a oprávnění jsou data firmy, ne kód.

## Jediné místo, které rozhoduje o přístupu

`app.has_access(tenant, oprávnění, pobočka)` v databázi. Aplikace ho
volá přes `lib/authz.ts` (`canSee`, `getContext`, `isModuleActive`) —
tenhle soubor je jediné místo v appce, kde se smí psát „smí to ten
člověk vidět?". Nová oprávnění se přidávají do tabulky `permissions`
**a** do `PERMISSIONS` v `lib/authz.ts` zároveň — rozejde-li se to,
spadne to na `supabase/tests/krok3_scenar.sql`, jinak neznámý klíč
tiše odmítá přístup.

Tři věci bez výjimky (`lib/authz.ts`, hlavička souboru):

1. **Rozsah z adresy je NÁVRH, ne oprávnění.** `branch_id` z URL se
   vždy ověřuje proti členství přihlášeného — jinak stačí přepsat
   jedno číslo v adrese.
2. **Při nejistotě se odmítá.** Spadlé spojení, neznámé oprávnění,
   prázdná odpověď — všechno znamená ne.
3. **Dvě obranné linie současně.** Kontrola v aplikaci nenahrazuje RLS
   a naopak. Každá nová tabulka dostane `tenant_id`, zapnuté RLS
   a politiku.

Detaily RLS/SECURITY DEFINER/grantů → skill `foodtab-db-security`.

## Moduly

`MODULES = ['provoz', 'menu', 'finance', 'marketing', 'objednavky']`
(`lib/authz.ts`). Zapínají se za celou firmu. `provoz` je vždy.
**Vypnutý modul odmítá i přímé volání svého rozhraní**, nejen položku
v navigaci — schovaná položka v menu není zámek.

`menu` je dílna na návrhy, ne úložiště: `recipes.*` a `menus.*`
zůstávají v `provoz`.

## Provozní datum a časové pásmo (pravidla 10–12 CLAUDE.md)

**Provozní den ≠ kalendářní den.** Účet vystavený ve 2:15 patří do
včerejší uzávěrky — hranici dává `branches.day_starts_at`. Datum se
nepočítá ručně, ptá se `app.business_date`.

**Hodina na zdi není okamžik.** Co člověk napíše do políčka
(`2026-08-31T22:00`), nemá časové pásmo. Pásmo dodává POBOČKA
(`branches.timezone`, jinak `tenants.timezone`, jinak
`Europe/Prague`) a převod dělá databáze přes `at time zone`. Nikdy
`new Date('…T22:00')` — server na Vercelu je v UTC.

Na obrazovce se formátuje výhradně přes `lib/cas.ts`
(`hodinaVPasmu`, `datumACasVPasmu`, `denVPasmu`), kde je pásmo povinný
parametr. Nikdy `getHours()` ani `toLocaleTimeString()` bez `timeZone`.

**Past:** špatné uložení a špatné zobrazení se na obrazovce dokážou
vyrušit — co se zadá jako 22:00, se jako 22:00 i ukáže, a přesto
vyjde směna o dvě hodiny jinak. Proto se ukládání a zobrazení ověřují
ZVLÁŠŤ (`supabase/tests/krok14_scenar.sql`, `scripts/cas.test.mjs`).

Oprava časového pásma u existujících dat **není „jen posun času"** —
může změnit pořadí událostí a spárování směn. Postup a incident
2. 9. 2026 → `docs/rozhodnuti-stara-data-pasmo.md`.

## Zbylá pravidla bez výjimky (CLAUDE.md, plné znění tam)

- Klíč `service_role` nikdy neopustí server.
- Tokeny (pozvánky, servisní klíče agentů) se ukládají jako otisk.
- Mzdy, docházka, kontakty a zálohy se nikdy neposílají do jazykového
  modelu — detaily a implementace → skill `foodtab-ai`.
- Mazání lidí je označení (`deleted_at`), ne výmaz.
- Nic o provozu (pobočky, role, zaměstnanci, jídla) nepatří napevno
  do kódu — je to řádek v databázi.

## Konvence pojmenování

Základní schéma (`tenants`, `branches`, `employees`, `roles`,
`permissions`, `memberships`, `audit_log`) je anglicky a společné pro
všechny moduly. Provozní moduly (docházka, zálohy, komunikace, úseky)
jsou česky (`konverzace`, `zalohy`, `useky`…). Uvnitř jednoho modulu
se jazyky nemíchají. V rozhraní se `roles` jmenují „Oprávnění"
a `positions` „Pozice", v databázi zůstávají anglicky.
