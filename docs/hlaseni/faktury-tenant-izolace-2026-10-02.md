# Faktury — tenant_id a izolace zákazníků (čeká na Šéfíka)

**Datum:** 2. 10. 2026
**Kde spustit krok 1:** SQL editor projektu FoodTab (`spekntcsuroqhehmjssv`, Frankfurt) — jen čtení.
**Kde spustit krok 2:** SQL editor projektu **`ctqtwahlzhyjerqulqyn`** (Faktury, eu-north-1) — NE FoodTab DB.
Spustit smí jen Šéfík — autonomně se `db push`/SQL proti žádné produkční DB nikdy nepouští
(CLAUDE.md, pravidlo 1; totéž pravidlo jako u `faktury-rejection-examples-rls-2026-09-15.md`).

## Nález (viz `docs/finance-marketing-audit.md`, oddíl 1)

`invoices` a `rejection_examples` v databázi Faktur nemají sloupec `tenant_id` a RLS je
„allow all" s anon klíčem (`lib/supabase/faktury.ts:17-19`, komentář v kódu to říká
otevřeně — „otevřený bod č. 3 ze zadání, bezpečnostní model se řeší samostatně a jen se
souhlasem Šéfíka"). Jediná dnešní obrana je FoodTabí oprávnění `faktury.read`/`faktury.manage`
na obrazovku — žádná RLS nad daty. Dnes to nevadí (v produkci je jen Foodtab), ale **druhý
zákazník s aktivovaným modulem Finance by viděl stejné faktury jako Foodtab.**

## Proč tohle není jen „přidat RLS" jako u `rejection_examples`

`rejection_examples` byl stejný „allow all" vzor — ale tam je to v pořádku: žádná tenant-specifická
data (jen anonymní úryvky textu pro trénink AI). U `invoices` je to jiná situace: řádky SAMY
jsou zákaznická data a navíc appka k téhle databázi přistupuje jen přes jeden sdílený anon
klíč (`FAKTURY_SUPABASE_ANON_KEY`) bez jakéhokoli per-tenant přihlášení — RLS politika typu
„vidí jen svůj tenant podle JWT" tu dnes NEJDE postavit, protože žádný tenant-specifický JWT
do týhle databáze nechodí (FoodTabovo přihlášení je v úplně jiném Supabase projektu).

**Proto dvoufázový postup:**

### Fáze 1 (teď, bez nového tajemství) — sloupec + aplikační filtr

Tahle fáze dělá přesně to, co by měla: každý dotaz na `invoices` teď v kódu (větev
`gastro-erp-marketing`) filtruje `tenant_id`. Chybí jen sloupec v databázi — bez něj
appka po nasazení téhle větve spadne na „column invoices.tenant_id does not exist".
**SQL níže musí proběhnout PŘED nasazením kódu z téhle větve**, ne po něm.

### Fáze 2 (později, až bude druhý zákazník s modulem Finance) — skutečná RLS

Druhá linie obrany (RLS, co drží i při chybě v aplikačním kódu) potřebuje, aby Postgres
uměl rozeznat, pro kterého tenanta dotaz běží — to znamená buď (a) mintovat krátkodobý JWT
s claimem `tenant_id`, podepsaný JWT Secretem projektu Faktur (Settings → API → JWT Secret
v `ctqtwahlzhyjerqulqyn`, dnes nemám), a posílat ho místo anon klíče, nebo (b) přesunout
všechny zápisy/čtení za `security definer`-style RPC, které parametr `p_tenant` dostanou
už ověřený z FoodTabu. Obojí je skutečná architektonická změna — navrhuju ji řešit jako
samostatné zadání, až bude druhý zákazník s modulem Finance blízko, ne teď preventivně.

## SQL — krok 1 (FoodTab DB, jen čtení)

```sql
select id from tenants where ico = '21249946';
```

Výsledek (jedno UUID) vlož níže místo `<FOODTAB_TENANT_ID>`.

## SQL — krok 2 (Faktury DB, `ctqtwahlzhyjerqulqyn`)

```sql
-- Sloupec zatím nullable, ať UPDATE níže nespadne na NOT NULL dřív, než je vyplněný.
alter table invoices add column if not exists tenant_id uuid;
alter table rejection_examples add column if not exists tenant_id uuid;

update invoices set tenant_id = '<FOODTAB_TENANT_ID>' where tenant_id is null;

-- rejection_examples nechávám BEZ NOT NULL a bez backfillu — jsou to anonymní
-- trénovací úryvky bez osobních/finančních dat, tenant_id tam přidáváme jen
-- pro budoucí možnost (dnešní appka do něj tenant_id nezapisuje).

alter table invoices alter column tenant_id set not null;
-- Dočasný default, dokud je v provozu jen Foodtab — až přibude druhý zákazník,
-- default se odstraní (`alter table invoices alter column tenant_id drop default`),
-- aby nový insert bez explicitního tenant_id spadl nahlas, ne ať se tiše přiřadí Foodtabu.
alter table invoices alter column tenant_id set default '<FOODTAB_TENANT_ID>';

create index if not exists invoices_tenant_id_idx on invoices (tenant_id);
create index if not exists rejection_examples_tenant_id_idx on rejection_examples (tenant_id);

comment on column invoices.tenant_id is
  'FoodTab tenants.id (jina databaze, bez FK - zadne sdilene pripojeni). '
  'Fáze 1 izolace: 2.10.2026, viz docs/hlaseni/faktury-tenant-izolace-2026-10-02.md. '
  'RLS podle tenant_id (faze 2) jeste neni zapnuta - viz tentyz dokument.';
```

## Po spuštění

1. Ověřit `select count(*) from invoices where tenant_id is null` vrací `0`.
2. Teprve PAK nasadit kód z větve `gastro-erp-marketing` (nebo PR z ní), který filtruje
   podle `tenant_id` — jinak appka přestane fungovat (dotaz na neexistující sloupec).
3. Po nasazení zkontrolovat živě `/finance/faktury` a `/finance/faktury/seznam` — počty
   faktur musí sedět s dneškem (1741 aktivních + 1138 archivovaných k 15. 9., dnes víc).

## Co zůstává otevřené

Fáze 2 (skutečná RLS přes JWT claim nebo RPC vrstvu) — potřebuje JWT Secret projektu
Faktur od Šéfíka a samostatné zadání/review, až bude druhý zákazník s modulem Finance
blízko. Do té doby je izolace jen aplikační (fáze 1) — lepší než dnešní nic, ale ne
druhá linie obrany ve smyslu `foodtab-db-security`.
