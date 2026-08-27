# Noční práce 2 — rozpis, nastavení, kontrast

Doba: 2026-08-26 02:15 — 2026-08-27 02:50 (40 minut)

---

## VÝSLEDNÝ STAV NA KONCI

### Část A - ROZPIS SMĚN: 70% HOTOVO
- ✅ Přepínač 3 pohledů (Měsíc, Týden, Den) implementován
- ✅ Pohled Týden (seznam po dnech) refaktorován a funguje
- ❌ Pohled Měsíc (mřížka) — neimplementováno
- ❌ Pohled Den (časová osa) — neimplementováno

**Commitnuto:** ac9f36f — "A. Rozpis směn: přepínač 3 pohledů (měsíc, týden, den)"

**Soubory:**
- Nový: `app/[rozsah]/smeny/rozpis.tsx` (client komponenta, 265 řádků)
- Upravené: `app/[rozsah]/smeny/page.tsx` (refaktor na RozpisView)

**Poznámky:**
- Převedeny existující data a logika do RozpisView
- Opraveny server-side imports (posunDatum → client-side) 
- Build prošel (38.9s, exit code 0)

### Část B - NASTAVENÍ POBOČKY: 100% HOTOVO
- ✅ Formulář s názvem, barvou (8 opcí + náhled), časem — **JIŽ EXISTUJE**
- ✅ Zápis do branches s RLS kontrolou — **JIŽ EXISTUJE**
- ✅ Chybové hlášky — **JIŽ EXISTUJE**

**Status:** Žádné změny potřebné. Stránka je kompletní.

### Část C - KONTRASTNÍ AUDIT: 0% HOTOVO
- ❌ Ověření kontrastů — Neudělato
- ❌ Focus outlines — Neudělato
- ❌ Testování všech 8 barev — Neudělato

**Co zbývá:** Ručně otestovat (sky a amber bývají slabé), zapsat tabulku výsledků.

### Část D - DOKUMENTACE: KOMPLETNÍ
Toto je finální zpráva nočního úkolu.

---

## DATABÁZE — DOTČENÉ TABULKY

### shifts
- `id, tenant_id, branch_id, employee_id, position_id`
- `shift_date, starts_at, ends_at, status, note`
- Čtení: 133 směn za 19.8–14.9
- Poznámka: začíná "rozpis" (značka) + TYP (ranní, odpolední, atd.)

### employees
- `id, full_name` — čtení pro jména

### positions
- `id, label` — čtení pro názvy pozic

### branches
- `id, tenant_id, name, slug, color, day_starts_at`
- Čtení: seznam poboček
- Zápis: upravitPobocku() (RLS: settings.manage)

---

## TECHNICKÉ DETAILY

### RozpisView (app/[rozsah]/smeny/rozpis.tsx)
- Typ: "use client" (React component)
- Props: smeny, dnesni, konec, jmena, pozice, nazvyPobocek, rozsah
- State: view = "mesic" | "tyden" | "den"
- Logika: switch na state, renderuje příslušný pohled
- TydenView: refaktorovaný seznam po dnech (existující logika)
- Placeholder: MesicView, DenView s textem "zatím není implementován"

### Page.tsx (app/[rozsah]/smeny/page.tsx)
- Typ: Server Component
- Změny: import RozpisView, volání s props místo inline JSX
- Kontrola přístupu, načtení dat — beze změny

---

## OPRAVY BĚHEM NOCI

### Server-side imports v client komponentě (OPRAVENO)
- **Chyba:** `rozpis.tsx` importoval `posunDatum` z `lib/provozni-den.ts`
- **Řešení:** Odstraněn import, `popisDne()` počítá "zítřa" na client-side
- **Výsledek:** Build OK

---

## OVĚŘENÍ BUILDU

1. **npx tsc --noEmit** — ✅ OK
2. **npm run build** — ✅ OK (38.9s compile, exit code 0)
3. **npm run lint** — (připraveno na push)
4. **git log** — commit ac9f36f ready

---

## ZBÝVAJÍCÍ ÚKOLY (PŘÍŠTĚ)

1. Implementovat MesicView (mřížka dnů, počty chybějících)
2. Implementovat DenView (časová osa s pruhy)
3. Kontrastní audit: ověřit všech 8 barev v obou režimech
4. Final test všech pohledů
5. Push na main

---

## SCHÉMA BUDOUCÍCH POHLEDŮ

### MesicView
- Mřížka 7×6 dnů v měsíci
- V každém dni: počet směn a počet chybějících lidí
- Klikatitelné: otevřít DenView

### DenView
- Vodorovná osa: hodiny (00:00–23:59)
- Pruhy: každá směna jako barevný pruh
- Svislá čára: "teď" (aktuální čas)
- Šrafování: doby bez obsazení
- Podle docs/rozvrzeni-nahled.html (závazná předloha)

---

## AUTOMATIZACE POVOLENA
Uživatel dal souhlas: "vše nadále potvrzuji" → pokračovat bez čekání
