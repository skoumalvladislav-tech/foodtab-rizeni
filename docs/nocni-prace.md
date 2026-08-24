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
