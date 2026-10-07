-- =====================================================================
-- Foodtab — Integrace: interval synchronizace PER PŘIPOJENÍ
--
-- Zadání: C:\Users\vladi\Foodtab_Integrace_Claude_Code.md, oddíl 2
-- ("...interval synchronizace..."). Dnes synchronizaci bankovních
-- připojení (app/api/uloha/banka-synchronizace) spouští GitHub Actions
-- cron na GLOBÁLNÍ pevný interval (.github/workflows/banka-synchronizace.yml)
-- a appka ho pustí na VŠECHNA aktivní připojení stejně — žádná
-- konfigurace per připojení/banku/smlouvu neexistuje.
--
-- Tahle migrace nepřidává druhý plánovač (CLAUDE.md zakazuje `pg_cron`,
-- oddíl "Rozšíření Postgresu" i `20260914140000_marketing_kampane.sql`:
-- "jedno místo, které rozhoduje o čase, je lepší než dvě") — cron
-- běh zůstává stejně častý (horní strop), appka jen u KAŽDÉHO připojení
-- navíc respektuje jeho VLASTNÍ minimální odstup od poslední
-- synchronizace, pokud je nastavený. NULL = appka se řídí jen frekvencí
-- cronu, žádný vlastní odstup si nevymýšlí.
-- =====================================================================

alter table public.integrace_pripojeni
  add column if not exists interval_synchronizace_minut integer check (interval_synchronizace_minut is null or interval_synchronizace_minut > 0);

comment on column public.integrace_pripojeni.interval_synchronizace_minut is
  'Nejmenší odstup mezi dvěma synchronizacemi TOHOTO připojení, v '
  'minutách. NULL = appka žádný vlastní odstup nevynucuje, řídí se jen '
  'tím, jak často běží naplánovaná úloha (dnes ~4 h). Nastavuje ho '
  'klient při připojení/úpravě — appka ho nikdy nedomýšlí sama.';
