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

---

## 3. `/<rozsah>/ukoly` — úkoly a checklisty

**Právo:** `tasks.read` na obojí; `tasks.manage` navíc na odškrtnutí úkolu.
**Soubory:** `app/[rozsah]/ukoly/page.tsx`, `app/[rozsah]/ukoly/[beh]/page.tsx`,
`app/[rozsah]/ukoly/akce.ts`

### Dotazy — seznam

**a) `public.tasks`**

| Sloupec | Použití |
|---|---|
| `id`, `title`, `note` | zobrazení |
| `tenant_id` | `eq` |
| `branch_id` | `or(branch_id.eq.<pobocka>, branch_id.is.null)` — prázdné = celá firma |
| `status` | `eq 'open'` |
| `due_at` | řazení, zobrazení termínu |
| `priority` | řazení; `'high'` = červený pruh |

**b) `public.checklist_templates`** — `id`, `branch_id`, `name`, `department`,
`schedule`; `eq tenant_id`, `eq active = true`, `or(branch_id.eq.<pobocka>, is.null)`.

**c) `public.checklist_items`** — `id`, `template_id`; `in` podle šablon (počet položek).

**d) `business_date(p_branch)`** — RPC, provozní den pobočky.

**e) `public.checklist_runs`** — `id`, `template_id`, `status`;
`eq branch_id`, `eq business_date`, `in template_id`.

**f) `public.checklist_entries`** — `run_id`, `checked`; `in run_id` (postup).

### Dotazy — vyplňování (`[beh]`)

**g) `public.checklist_runs`** — `id`, `template_id`, `branch_id`,
`business_date`, `status`; `eq id`.
**h) `public.checklist_templates`** — `id`, `name`; `eq id`.
**i) `public.checklist_items`** — `id`, `position`, `label`, `requires_value`,
`value_type`, `value_unit`, `min_value`, `max_value`; `eq template_id`, `order position`.
**j) `public.checklist_entries`** — `item_id`, `checked`, `value_number`,
`value_text`; `eq run_id`.

### Zápisy

| Akce | Tabulka | Pole |
|---|---|---|
| Odškrtnutí úkolu | `tasks` **update** | `status='done'`, `done_at`, `done_by` = `employees.id` |
| Spuštění checklistu | `checklist_runs` **upsert** | `tenant_id`, `branch_id`, `template_id`, `business_date`; `onConflict: template_id,branch_id,business_date`, `ignoreDuplicates` |
| Zápis položky | `checklist_entries` **upsert** | `run_id`, `item_id`, `checked=true`, `value_number`, `value_text`, `employee_id`, `recorded_at`; `onConflict: run_id,item_id` |
| Uzavření | `checklist_runs` **update** | `status='done'`, `finished_at` |

Meze (`min_value`, `max_value`) a `value_type` se pro kontrolu čtou
**z databáze** uvnitř akce, ne z formuláře — jinak by si je volající přepsal.

### Vazby

- `tasks.branch_id` → `branches.id`; **prázdné = firemní úroveň**
- `tasks.done_by` → `employees.id`
- `checklist_items.template_id` → `checklist_templates.id` (`on delete cascade`)
- `checklist_runs.template_id` → `checklist_templates.id` (`on delete restrict`)
- `checklist_runs.branch_id` → `branches.id`, **NOT NULL**
- `checklist_entries.run_id` → `checklist_runs.id` (`on delete cascade`)
- `checklist_entries.item_id` → `checklist_items.id` (`on delete restrict`)
- Jedinečnost: `checklist_runs (template_id, branch_id, business_date)`,
  `checklist_entries (run_id, item_id)`

### Co stojí na RLS

- `tasks_read`: `can_read_scoped('tasks.read')` **nebo** vlastní `employee_id`
- `tasks_write`: `has_access('tasks.manage')` — proto tlačítko Hotovo jen s ním
- `checklist_runs_write` a `checklist_entries_all`: `has_access('tasks.read')`,
  tedy odškrtávat smí běžná směna, ne jen správce
- Detail běhu se neověřuje v kódu — když běh není náš, RLS vrátí prázdno
  a obrazovka řekne „nenalezen“. Rozdíl „není“ / „není váš“ se nerozlišuje.

### Odhady a co chybí

- **`value_type = 'photo'`** se vyplnit nedá — nahrávání souborů není hotové.
  Položka se zobrazí s vysvětlením a přeskočí.
- **Neúspěšná hodnota mimo meze** se projeví tím, že položka zůstane
  neodškrtnutá. Chybová hláška u políčka chybí; serverová akce vrací `void`.
- Odškrtnutý úkol z seznamu zmizí (`status = 'open'`), historie se nikde nezobrazuje.
- `nullsFirst: false` u řazení podle `due_at` — úkoly bez termínu jdou naspod.

---

## 4. `/<rozsah>/zpravy` — nástěnka

**Právo:** `communication.read` na čtení, `communication.manage` na psaní.
**Soubory:** `app/[rozsah]/zpravy/page.tsx`, `app/[rozsah]/zpravy/akce.ts`

### Dotazy

**a) `public.announcements`**

| Sloupec | Použití |
|---|---|
| `id` | klíč, vazba na přečtení |
| `tenant_id` | `eq` |
| `branch_id` | `or(branch_id.eq.<pobocka>, branch_id.is.null)` — prázdné = celá firma |
| `employee_id` | jen zobrazení štítku „osobní“; výběr řeší RLS |
| `body` | text zprávy |
| `pinned` | `order desc` — připnuté nahoře |
| `author_id` | načítá se, ale jméno autora se **nedohledává** |
| `created_at` | `order desc`, zobrazení |

Limit 50 zpráv.

**b) `public.announcement_reads`** — `announcement_id`;
`eq user_id` = `auth.uid()`, `in announcement_id` podle načtených zpráv.

### Zápisy

| Akce | Tabulka | Pole |
|---|---|---|
| Přečteno | `announcement_reads` **upsert** | `announcement_id`, `user_id`; `onConflict: announcement_id,user_id`, `ignoreDuplicates` |
| Nová zpráva | `announcements` **insert** | `tenant_id`, `branch_id` (= `scope.branchId`, tedy `null` na firemní úrovni), `body`, `pinned`, `author_id` |

Úroveň nové zprávy se bere **z rozsahu v adrese**, ne z formuláře — jinak
by šlo z pobočkové adresy poslat zprávu celé firmě.

Přečtení se zapisuje **na kliknutí**, ne při vykreslení. Zápis jen proto,
že si někdo otevřel stránku, do vykreslování nepatří.

### Vazby

- `announcements.branch_id` → `branches.id` (`on delete cascade`); prázdné = firemní
- `announcements.employee_id` → `employees.id`; vyplněné = osobní zpráva
- `announcements.author_id` → `profiles.user_id`
- `announcement_reads.announcement_id` → `announcements.id` (`on delete cascade`)
- `announcement_reads.user_id` → `profiles.user_id` (`on delete cascade`)
- Primární klíč `announcement_reads (announcement_id, user_id)`

### Co stojí na RLS

- `announcements_read`: `can_read_scoped('communication.read')` **a zároveň**
  (`employee_id is null` **nebo** vlastní **nebo** `communication.manage`).
  Osobní zprávy cizích lidí tedy odfiltruje politika, ne dotaz.
- `announcements_write`: `has_access('communication.manage', branch_id)`
- `announcement_reads_own`: `user_id = auth.uid()` na čtení i zápis

### Odhady

- **Jméno autora se nezobrazuje.** `author_id` míří na `profiles.user_id`
  a dohledání by znamenalo dotaz navíc do `profiles`; zadání ho nežádalo.
- Nepřečtené se liší jen sytostí a tlačítkem, počítadlo nepřečtených není.
- Zprávu nejde upravit ani smazat, jen napsat a přečíst.
- Segment nabídky se přejmenoval z `komunikace` na `zpravy` podle zadání.

---

## Souhrn — všechno, na co se sahá

Pro ranní ověření jedním dotazem. Sloupce jsou uvedené tak, jak je jmenují
dotazy v aplikaci.

### Funkce (RPC přes PostgREST, schéma `public`)

| Funkce | Kde |
|---|---|
| `my_tenants()` | `lib/authz.ts` |
| `my_context(p_tenant)` | `lib/authz.ts` |
| `has_access(p_tenant, p_permission, p_branch)` | `lib/authz.ts` |
| `business_date(p_branch, p_at)` | `lib/provozni-den.ts` |

### Tabulky a sloupce

| Tabulka | Sloupce |
|---|---|
| `employees` | `id`, `tenant_id`, `branch_id`, `user_id`, `full_name`, `deleted_at` |
| `positions` | `id`, `label` |
| `shifts` | `id`, `tenant_id`, `branch_id`, `employee_id`, `position_id`, `shift_date`, `starts_at`, `ends_at`, `status`, `note` |
| `attendance_events` | `id`, `tenant_id`, `branch_id`, `employee_id`, `kind`, `occurred_at`, `business_date`, `source` |
| `tasks` | `id`, `tenant_id`, `branch_id`, `title`, `note`, `due_at`, `priority`, `status`, `done_at`, `done_by` |
| `checklist_templates` | `id`, `tenant_id`, `branch_id`, `name`, `department`, `schedule`, `active` |
| `checklist_items` | `id`, `template_id`, `position`, `label`, `requires_value`, `value_type`, `value_unit`, `min_value`, `max_value` |
| `checklist_runs` | `id`, `tenant_id`, `branch_id`, `template_id`, `business_date`, `status`, `finished_at` |
| `checklist_entries` | `run_id`, `item_id`, `checked`, `value_number`, `value_text`, `employee_id`, `recorded_at` |
| `announcements` | `id`, `tenant_id`, `branch_id`, `employee_id`, `body`, `pinned`, `author_id`, `created_at` |
| `announcement_reads` | `announcement_id`, `user_id` |

`branches` a `tenants` se **nedotazují přímo** — názvy poboček chodí
z `my_context()`, provozní den z `business_date()`.

### Zápisy

| Tabulka | Operace |
|---|---|
| `attendance_events` | insert |
| `tasks` | update (`status`, `done_at`, `done_by`) |
| `checklist_runs` | upsert, update |
| `checklist_entries` | upsert |
| `announcements` | insert |
| `announcement_reads` | upsert |

Všechno jde přes `lib/supabase/server.ts` pod přihlášeným uživatelem.
Servisní klíč se nikde nepoužívá.
