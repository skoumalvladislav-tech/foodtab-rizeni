# Noční práce — obrazovky provozu

Zápis toho, co jsem v noci postavil, a hlavně **co každý dotaz sahá na
databázi**. Seznamy níž jsou odvozené výhradně ze souborů v
`supabase/migrations/`. Proti skutečné databázi nejsou ověřené — na to
nemám přístup a ani jsem se o něj nepokoušel.

Sloupce jsou uvedené tak, jak je dotaz opravdu jmenuje. Kde se spoléhám
na chování Row Level Security, je to napsané zvlášť, protože to je místo,
kde se chyba projeví jako „nic se nezobrazuje“ místo hlášky.

---

## Sdílené pomůcky

### `lib/provozni-den.ts`

| Co | Detail |
|---|---|
| RPC | `public.business_date(p_branch uuid, p_at timestamptz default now())` |
| Zdroj | `supabase/migrations/20260825140000_business_date_api.sql` |
| Vrací | `date` |
| Odmítne | Pobočku cizí firmy — funkce má `and app.is_member(b.tenant_id)`, takže vrátí prázdno |

Provozní den se v kódu **nepočítá**. Když funkce vrátí prázdno, obrazovka
to musí ošetřit hláškou, ne tichým dosazením dnešního data.

---

## 1. `/<rozsah>/smeny` — rozpis

**Právo:** `shifts.read` (přes `zkusPristup` → `requireScopedAccess`)
**Soubor:** `app/[rozsah]/smeny/page.tsx`

### Dotazy

**a) Kotva týdne — RPC**

| | |
|---|---|
| Volání | `business_date(p_branch)` |
| Argument | `scope.branchId`, na firemní úrovni `ctx.branches[0].id` |

**b) `public.shifts`** — hlavní dotaz

| Sloupec | Použití |
|---|---|
| `id` | klíč v seznamu |
| `tenant_id` | `eq` — filtr firmy |
| `branch_id` | `eq` při pobočkovém rozsahu; jinak jen zobrazení |
| `employee_id` | prázdné = neobsazená směna, kreslí se jako „Neobsazeno“ |
| `position_id` | dohledání názvu pozice |
| `shift_date` | `gte` kotva, `lte` kotva + 6; řazení; seskupení po dnech |
| `starts_at`, `ends_at` | zobrazení času, řazení |
| `status` | `neq 'cancelled'`; `'planned'` se popisuje jako „zatím v plánu“ |
| `note` | volitelný dovětek |

**c) `public.employees`** — `id`, `full_name`; `in` podle `employee_id` ze směn.
Brigádník bez účtu má `user_id` prázdné a **nijak se nefiltruje** — zobrazí
se stejně jako kdokoli jiný.

**d) `public.positions`** — `id`, `label`; `in` podle `position_id` ze směn.

### Vazby

- `shifts.employee_id` → `employees.id` (`on delete set null`)
- `shifts.position_id` → `positions.id` (`on delete set null`)
- `shifts.branch_id` → `branches.id`
- Názvy poboček se neberou dotazem, ale z `ctx.branches` (`my_context`)

### Co stojí na RLS

`shifts_read` = `app.can_read_scoped(tenant_id, 'shifts.read', branch_id)`.
Dotaz `tenant_id` filtruje i sám, ale rozsah poboček nechává na politice.
Kdyby politika vracela míň, projeví se to jako prázdný rozpis, ne jako chyba.

### Odhady

- **Kotva na firemní úrovni** je provozní den *první* pobočky. Pobočky
  s různým `day_starts_at` by se mohly rozejít o den na okraji okna.
  Jedna kotva je ale lepší než počítat datum v kódu.
- `note` se zobrazuje celá. Delší poznámka rozbije řádek.

---

## 2. `/<rozsah>/dochazka` — příchod a odchod

**Právo:** žádné jedno. Stránka je otevřená každému **členovi firmy**;
`attendance.read` rozhoduje jen o tom, jestli uvidí i ostatní.
**Soubory:** `app/[rozsah]/dochazka/page.tsx`, `app/[rozsah]/dochazka/akce.ts`

### Dotazy

**a) `public.employees`** — kdo jsem

| Sloupec | Použití |
|---|---|
| `id` | vlastní zaměstnanec, klíč pro docházku |
| `branch_id` | domovská pobočka, když rozsah je firemní |
| `full_name` | zobrazení |
| `tenant_id` | `eq` |
| `user_id` | `eq` = `auth.uid()` |
| `deleted_at` | `is null` |

**b) `business_date(p_branch)`** — RPC, provozní den pobočky.
Pobočka = `scope.branchId`, jinak `employees.branch_id`.

**c) `public.attendance_events`** — moje poslední událost

| Sloupec | Použití |
|---|---|
| `id`, `employee_id`, `branch_id` | |
| `kind` | `'in'`/`'break_end'` = v práci, jinak mimo |
| `occurred_at` | `order desc`, `limit 1` |

**d) `public.attendance_events`** — dnešní stav

| Sloupec | Použití |
|---|---|
| `tenant_id` | `eq` |
| `business_date` | `eq` provozní den z RPC |
| `branch_id` | `eq` při pobočkovém rozsahu |
| `employee_id` | `eq` vlastní, když chybí `attendance.read` |
| `occurred_at` | `order asc`; poslední záznam člověka = jeho stav |

**e) `public.employees`** — `id`, `full_name` pro cizí `employee_id`.

### Zápis

`insert into public.attendance_events` s poli
`tenant_id`, `branch_id`, `employee_id`, `kind` (`'in'`/`'out'`), `source: 'app'`.

`business_date` se **nedoplňuje** — má ho na starost trigger
`trg_attendance_business_date` (`before insert`, `app.set_business_date()`).

Z formuláře jde jen `rozsah` a `druh`. Firma, pobočka i zaměstnanec se
dohledávají znovu na serveru: politika `attendance_insert` hlídá
`employee_id`, ale **pobočku ne**, takže podvržené `branch_id` z prohlížeče
by zapsalo docházku na cizí pobočku.

### Vazby

- `attendance_events.employee_id` → `employees.id` (`on delete restrict`)
- `attendance_events.branch_id` → `branches.id`, **NOT NULL**
- `employees.user_id` → `profiles.user_id`

### Co stojí na RLS

- `attendance_read`: `can_read_scoped('attendance.read')` **nebo** vlastní
  `employee_id`. Bez oprávnění tedy vrátí jen vlastní řádky i bez filtru.
- `attendance_insert`: `has_access('attendance.manage')` **nebo**
  `source = 'app'` a vlastní `employee_id`.

### Odhady

- **Pauzy** (`break_start`/`break_end`) se zapisovat nedají, jen se čtou.
  Zadání mluvilo o příchodu a odchodu.
- `occurred_at` se **nezadává**, spoléhá se na `default now()`.
- Čas se zobrazuje v zóně serveru, ne pobočky. Pro Prahu to sedí, u pobočky
  v jiné zóně by hodina neodpovídala. Provozní *den* je z databáze správně.
