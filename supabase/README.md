# Databáze Foodtabu

Jediný zdroj pravdy je Supabase Postgres. Cloudflare D1 se opouští — složka
`drizzle/` a `db/schema.ts` patří ke starému modelu a při převodu rozhraní
zmizí.

## Migrace

| Migrace | Obsah |
|---|---|
| `20260823115000_drop_legacy.sql` | Odstraní starou tabulku `user_access` a její triggery |
| `20260823120000_foundation.sql` | Firma, pobočky, pozice, lidé, role, moduly, pozvánky, audit |
| `20260823120100_catalog.sql` | Katalog modulů a oprávnění, šablony rolí |
| `20260823120200_authz.sql` | Autorizační funkce a Row Level Security |
| `20260823120300_tenant_setup.sql` | Založení firmy, vytváření a přijímání pozvánek |
| `20260823130000_provoz.sql` | Směny, docházka, úkoly, checklisty, komunikace, receptury, lístky, motivace |
| `20260824190000_fix_tenant_delete.sql` | Oprava: firma nešla smazat — trigger na základní modul blokoval kaskádu |

Starší migrace (`20260818`–`20260820`) patří k rušenému modelu. Nechávají se
v repu kvůli historii; `drop_legacy` je bezpečně uklidí i tam, kde už byly
nasazené.

**Nasazenou migraci nikdy neupravujte.** Vždy přidejte novou.

## Jak to zapnout v Supabase

1. Projekt zakládejte **v regionu Frankfurt (eu-central-1)**. Region nejde
   změnit později.
2. Migrace pouštějte v pořadí podle názvu — `supabase db push`, nebo ručně
   v SQL editoru.
3. V nastavení autentizace zapněte **přihlašovací odkaz na e-mail**. Telefon
   se zapne, až bude vybraná SMS brána. Hesla se nepoužívají.
4. Nastavte **vlastní SMTP**. Vestavěný mailer Supabase posílá jen na adresy
   členů týmu, takže bez toho nejde otestovat pozvánky.
5. Zálohy: na tarifu Pro běží denní automaticky. PITR je odložený (100 USD
   měsíčně), místo něj se počítá s noční kopií mimo Supabase.

Servisní klíč (`service_role`) patří výhradně na server. Do prohlížeče se
nesmí dostat nikdy — obchází Row Level Security.

## Jak se zakládá firma

Na prázdné databázi nikdo nikam nepatří. První průchod je:

```sql
-- jako přihlášený uživatel
select app.create_tenant('Foodtab s.r.o.', '12345678');
```

V jedné transakci vznikne firma, základní modul, sedm rolí ze šablon,
členství zakladatele v roli Majitel a jeho zaměstnanecký záznam.

Pozvánka vrací token **právě jednou** — v databázi zůstane jen jeho otisk:

```sql
select * from app.create_invitation(
  p_tenant   => '…',
  p_role     => '…',
  p_channel  => 'email',          -- nebo 'sms'
  p_contact  => 'kuchar@…',
  p_scope    => 'branch',
  p_branches => array['…']::uuid[]
);

-- na straně pozvaného, po přihlášení
select app.accept_invitation('…token…');
```

Role s citlivým oprávněním (finance, mzdy, správa lidí, nastavení) nejde
pozvat přes SMS. Přenesení čísla na cizí SIM je reálný útok a telefon navíc
koluje po provozovně.

## Jak se rozhoduje o přístupu

Jedna funkce, kterou volá aplikace i politiky databáze:

```sql
app.has_access(tenant_id, 'shifts.manage', branch_id) → boolean
```

Vrátí true, jen když platí všechno současně:

- modul, do kterého oprávnění patří, je pro firmu aktivní,
- role oprávnění obsahuje (majitel má vše z aktivních modulů),
- rozsah členství pokrývá pobočku — `branch_id = NULL` znamená firemní
  úroveň a vyžaduje rozsah `tenant`,
- členství je aktivní.

Další funkce:

| Funkce | K čemu |
|---|---|
| `app.has_permission(tenant, perm)` | Má oprávnění kdekoli ve firmě |
| `app.can_read_scoped(tenant, perm, branch)` | Čtení obsahu, který visí na firemní i pobočkové úrovni |
| `app.visible_branch_ids(tenant)` | Pobočky, na které uživatel vidí |
| `app.is_member` / `app.is_owner` | Rychlé kontroly |
| `app.business_date(branch, timestamp)` | Provozní den pobočky |

## Dvě pravidla, která platí ve všech provozních tabulkách

**`branch_id IS NULL` znamená firemní úroveň.** Úkol, zpráva nebo receptura
bez pobočky patří celé firmě a vidí ji každý s příslušným oprávněním.
Jídelní lístek je výjimka — ten je vždy pobočkový, proto tam `branch_id`
nesmí být prázdné.

**Lidé se odkazují přes `employees`, ne přes `profiles`.** Zaměstnanec
existuje i bez uživatelského účtu, takže brigádník jde zařadit na směnu,
aniž by se kdy přihlásil. `employees.user_id` je proto volitelné.

## Provozní den

Restaurace zavírá po půlnoci. Účet vystavený ve 2:15 patří do **včerejší**
uzávěrky, ne do dnešní.

```sql
select app.business_date(branch_id, now());
```

Odvozuje se z `branches.day_starts_at` (výchozí 05:00). **Nikdy nepoužívejte
`current_date` napřímo** — tržby a docházka by přestaly sedět s pokladnou
a nikdo měsíce nepřijde na proč. U docházky se doplňuje sama triggerem.

## Test

```bash
supabase/tests/run.sh
```

Postaví čistou databázi, pustí všechny migrace a projde dva scénáře.
Přesný počet kontrol schválně neuvádíme — s každou migrací se mění
a zastaralé číslo v dokumentaci mate víc, než pomáhá. Aktuální stav
vypíše samotný běh.

- `etapa0_scenar.sql` — založení firmy, pobočky, pozvánky e-mailem i SMS,
  rozsah vedoucího, cizí uživatel, neměnnost auditu, smazání firmy
- `krok2_scenar.sql` — provozní den, směny včetně brigádníka bez účtu,
  docházka, checklist s hodnotou, komunikace napříč úrovněmi, ceny, body

Totéž běží při každé změně v `supabase/` na GitHubu
(`.github/workflows/databaze.yml`), takže není potřeba mít lokálně
PostgreSQL ani Docker.

Soubor `00_harness.sql` napodobuje `auth.users` a `auth.uid()` pro lokální
běh. V Supabase je dodává platforma a **tenhle soubor se tam nikdy nepouští**
— proto testy proti Supabase nefungují a ověřuje se tam jinak (viz níže).

### Ověření na skutečném Supabase

```sql
-- 1. v dashboardu Authentication → Users vytvořit uživatele
-- 2. zkontrolovat, že mu trigger založil profil
select * from public.profiles;

-- 3. vydávat se za něj a založit firmu
select set_config('request.jwt.claims',
                  json_build_object('sub', '<user-uuid>')::text, true);
set local role authenticated;
select app.create_tenant('Foodtab s.r.o.', '12345678');
```

## Co ještě chybí

- Servisní identity agentů: `agent_identities`, `agent_runs`, `agent_actions`
- Mzdové sazby (`employee_wages`) a účetní exporty
- Napojení pokladny (`pos_*`) a bankovního účtu (`bank_*`)
- Moduly Finance, Marketing a Objednávky — zatím existuje jen jejich rámec
- Zákaz zakládání firmy komukoli přihlášenému (`app.create_tenant` je dnes
  otevřený; před ostrým provozem omezit)
