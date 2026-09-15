# Faktury — RLS na `rejection_examples` (čeká na Šéfíka)

**Datum:** 15. 9. 2026
**Kde spustit:** SQL editor projektu **`ctqtwahlzhyjerqulqyn`** (Faktury, eu-north-1) — NE FoodTab DB. Tahle
tabulka v `supabase/migrations/` foodtab-rizeni vůbec není, protože migrace tam cílí na jiný,
FoodTab projekt (`spekntcsuroqhehmjssv`). Spustit smí jen Šéfík — autonomně se `db push`/SQL
proti žádné produkční DB nikdy nepouští (CLAUDE.md, pravidlo 1).

## Nález

Živě ověřeno (`list_tables`, MCP, jen čtení):

```json
{
  "name": "public.rejection_examples",
  "rls_enabled": true,
  "rows": 0
}
```

Tabulka existuje, RLS je zapnuté, ale **nemá jedinou politiku** — proto appka (server akce
`odmitnoutAZapamatovat` v `app/[rozsah]/faktury/akce.ts`) i dřívější n8n workflow do ní tiše
nezapíšou nic, ani se to nikde nezaloguje jako chyba (insert selže potichu, appka se od toho
nikdy neodvíjí — odmítnutí faktury samotné proběhne v pořádku).

Tabulku vůbec neobsahuje ani `faktury-app/supabase/schema.sql` (nebyla tam nikdy přidaná, i
když v DB existuje) — proto tenhle SQL soubor stojí mimo tenhle repozitář jako samostatný
doklad, ne jako doplnění schema.sql v `faktury-app`.

## Oprava

Stejný vzor jako existující politika na `invoices` (`faktury-app/supabase/schema.sql:86-90`) —
appka i n8n přistupují přes stejný anon klíč, žádné rozlišení uživatelů (appka bez přihlášení,
resp. ve Foodtabu autorizace řeší appka sama, ne RLS):

```sql
alter table rejection_examples enable row level security; -- uz zapnute, pro jistotu znovu

drop policy if exists "allow all with anon key" on rejection_examples;
create policy "allow all with anon key" on rejection_examples
  for all
  using (true)
  with check (true);

comment on table rejection_examples is 'Priklady odmitnutych dokumentu pro AI (n8n) - kind/excerpt/supplier_guess/email_subject.';
```

## Po spuštění

Ověřit zápis ručně (odmítnout jakoukoli fakturu ve frontě ke schválení tlačítkem „odmítnout a
zapamatovat“) a zkontrolovat, že se v `rejection_examples` objevil nový řádek — dřív, než se na
tuhle tabulku naváže cokoli dalšího (např. budoucí AI trénink v n8n).
