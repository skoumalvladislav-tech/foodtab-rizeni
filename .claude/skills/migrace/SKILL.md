---
name: migrace
description: Napsat databázovou migraci pro Foodtab podle konvencí projektu. Použij vždy, když se zakládá nebo mění cokoli v supabase/migrations — nová tabulka, nový sloupec, změna funkce, převod dat. Zná pasti, které v tomhle repozitáři už jednou něco položily: sloupcové granty, tichý audit, pořadí razítek a chybějící druhou obrannou linii uvnitř SECURITY DEFINER funkcí.
---

# Migrace ve Foodtabu

Nejdřív si přečti `CLAUDE.md`, oddíly „Pravidla, která se neporušují"
a „Konvence". Tenhle postup je nad ně, ne místo nich.

## 1. Jméno a pořadí

`supabase/migrations/RRRRMMDDHHMMSS_nazev.sql`. **Už nasazenou migraci
nikdy neupravuj** — vždycky přidej novou.

**Pořadí razítek bývá součást zadání, ne formalita.** Stalo se to
u `ai.use`: kdyby převod na zařazení proběhl dřív než `ai_use_pryc`,
zkopírovalo by se to právo do `position_permissions` a `ai_use_pryc`
už by ho tam neuklidila — míří na `role_permissions`. Když na pořadí
záleží, **napiš to do hlavičky** a nikdy migraci nedatuj dozadu.

## 2. Hlavička říká PROČ, ne co

Co dělá, je vidět ze SQL. Do hlavičky patří důvod, odkaz na zadání
a to, co by jinak někdo za rok „opravil". Česky.

Zvlášť napiš, **co se schválně NEDĚLÁ** a proč — jinak to příští čtenář
bere jako nedodělek a doplní to.

## 3. Nový sloupec na tabulce se sloupcovými granty

**Tohle už jednou položilo celou obrazovku.** `employees` a `branches`
nemají celotabulkový `select` — granty jsou po sloupcích
(`20260901120000_osobni_udaje.sql`), aby se telefon a e-mail četly jen
průzorem. `alter table … add column` nový sloupec do výčtu **nepřidá**
a dotaz, který si o něj řekne, dostane `42501` **dřív, než se dostane
na řádky**. Nespadne sloupec, spadne stránka.

```sql
grant select (novy_sloupec) on public.employees to authenticated;
```

Stalo se to 3. 9. s `employees.color` uprostřed ostrého testu.
`employees.zalohy_pozastaveny` grant dodnes nemá — pozor, až ho někdo
přidá do selectu.

**Ověř to čtením pod rolí `authenticated`**, ne úvahou.

## 4. Nová tabulka

Vzor je `20260906030000_useky.sql`, ř. 99–137. Potřebuje:

- `id uuid primary key default gen_random_uuid()` — **kvůli auditu**:
  `app.audit_zmenu` skládá jméno řádku z `id`,
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
  — taky kvůli auditu: bez něj vyjde `v_tenant` NULL a funkce udělá
  `return null`. **Audit zmlkne TIŠE, bez chyby.**
- `enable row level security` + politika (pravidlo 3),
- **jmenovitý** `grant select, insert, update, delete … to authenticated`.
  Poslední plošný grant je z 23. 8.; co vzniklo potom, práva nemá.
- spoušť `app.audit_zmenu('nazev_entity')`.

**Nikdy nepiš nový plošný grant** — smazal by sloupcové výjimky.

`create table` **bez** `if not exists`: srážka jmen má spadnout nahlas
(CLAUDE.md, „Dvě relace v jednom repozitáři").

## 5. SECURITY DEFINER — druhá obranná linie tam NENÍ

Viz `docs/zarazeni-misto-roli-nalezy.md`, **oddíl 7b**.

Autorizační funkce jsou `security definer` a vlastní je role
s `rolbypassrls`. **Uvnitř nich se RLS neuplatní vůbec**, bez ohledu na
`force row level security`. Pravidlo 3 z CLAUDE.md tam neplatí.

Nové tělo si proto musí odfiltrovat všechno samo:

```
tenant_id = p_tenant       jinak se řádek najde u CIZÍ FIRMY
deleted_at is null         jinak práva označeného smazaného
status = 'active'          jinak práva zrušeného členství
```

**Každý filtr napiš jen jednou.** Podmínka zapsaná dvakrát „pro
jistotu" nejde shodit — vyndá se jedna a drží ji druhá, takže kontrola,
která na ni míří, je zelená vždycky. Přesně na tohle se narazilo
v `20260909100000_zarazeni_jadro.sql` a je to tam popsané.

Na **každý** z těch filtrů patří vlastní kontrola s cizí firmou.

## 6. Zásah do dat existující firmy

Šablony (`app.role_template_permissions`) řídí jen firmy, které teprve
vzniknou — `app.create_tenant` z nich udělá **kopii**. Změna šablony
se u stávajících firem neprojeví. Když se má něco změnit i jim, musí
se to smazat/zapsat **na obou místech**, a je to zásah do zákaznických
dat: napiš to nahlas.

Pozor: `20260831010000_mzdy_sazby.sql`, ř. 122–125 říká, že se do rolí
u zákazníků nesahá. Když to porušíš, **pojmenuj tu výjimku** v hlavičce.

## 7. Než to prohlásíš za hotové

```bash
node scripts/scenare-pglite.mjs      # scénáře nad PGlite
node scripts/scenare.test.mjs        # čitelnost (ztracené \echo!)
```

- Novou migraci **zapiš do `supabase/tests/run.sh`** i do kontroly
  hlášek v `.github/workflows/databaze.yml` — jinak může scénář padat,
  aniž si toho kdo všimne.
- Ke každé změně **kontrola, která umí spadnout** — použij skill
  `scenar`.
- **Nenasazuj.** `db push` spouští Šéfík na pokyn — skill `nasazeni`.
