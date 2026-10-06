-- ---------------------------------------------------------------------
-- Oprava DVOU nálezů z auditu bankovního modulu (6.-7. 10. 2026):
--
-- 1. Appka `mena` na `transakce` nikdy nezapisovala, takže každý import
--    (Fio i CSV) padal na `default 'CZK'` i pro cizoměnový účet. Appka
--    si měnu tiše NEDOMÝŠLELA úmyslně — prostě ji zapomněla předat.
--    `RadekImportu` (lib/finance-csv-import.ts) teď měnu nese od zdroje
--    (Fio: měna účtu z `info.currency`; CSV: volitelný sloupec Měna,
--    jinak CZK) — appka si ani teď nevymýšlí kurz/přepočet, jen předává,
--    co poskytovatel/soubor řekl.
--
-- 2. `app/[rozsah]/finance/platby/import/akce.ts` (`potvrditImport`)
--    posílalo `p_radky` jako syrové `RadekImportu[]` z klienta —
--    CAMELCASE (`castkaHaleru`, `externiId`), zatímco tahle funkce
--    čekala SNAKE_CASE (`castka_haleru`, `externi_id`). `jsonb_to_recordset`
--    klíče, co nesedí, tiše vrátí jako NULL — `castka_haleru` je
--    `not null` na `transakce`, takže KAŽDÝ CSV import od začátku
--    padal na porušení NOT NULL, ne na nějaké okrajové selhání.
--    Oprava je ve dvou částech: appka (`akce.ts`) teď posílá správné
--    klíče, a tahle funkce navíc dostala PL/pgSQL tělo (z `language sql`),
--    aby zvládla i zápis `import_davky.pocet_novych` — to dřív dělal
--    samostatný klientský `.update()`, který TICHO padal (žádný grant
--    na UPDATE `import_davky` nikdy neexistoval, appka chybu nečetla).
-- ---------------------------------------------------------------------

grant update (pocet_novych) on public.import_davky to authenticated;

create policy import_davky_update_pocet on public.import_davky for update to authenticated
  using (app.has_access(tenant_id, 'finance.manage', null))
  with check (app.has_access(tenant_id, 'finance.manage', null));

create or replace function public.importovat_transakce(
  p_tenant uuid,
  p_ucet   uuid,
  p_davka  uuid,
  p_zdroj  text,
  p_radky  jsonb
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pocet integer;
begin
  with radky as (
    select * from jsonb_to_recordset(p_radky) as r(
      datum text, smer text, castka_haleru integer, mena text,
      protistrana text, vs text, poznamka text, externi_id text
    )
  ),
  nove as (
    select r.* from radky r
    where r.externi_id is null or not exists (
      select 1 from public.transakce t
      where t.ucet_id = p_ucet and t.externi_id = r.externi_id
    )
  ),
  vlozene as (
    insert into public.transakce (
      tenant_id, ucet_id, smer, castka_haleru, mena, datum,
      protistrana, vs, poznamka, zdroj, externi_id, import_davka_id
    )
    select
      p_tenant, p_ucet, n.smer, n.castka_haleru, coalesce(n.mena, 'CZK'), n.datum::date,
      coalesce(n.protistrana, ''), coalesce(n.vs, ''), coalesce(n.poznamka, ''),
      p_zdroj, n.externi_id, p_davka
    from nove n
    returning 1
  )
  select count(*)::integer into v_pocet from vlozene;

  update public.import_davky set pocet_novych = v_pocet where id = p_davka;

  return v_pocet;
end $$;

comment on function public.importovat_transakce(uuid, uuid, uuid, text, jsonb) is
  'Hromadný zápis CSV/Fio importu s dedupem na (ucet_id, externi_id) přes '
  'anti-join, ne ON CONFLICT (transakce má pravidlo na UPDATE a '
  'PostgreSQL proto ON CONFLICT na ní odmítá úplně). Měna jde od zdroje '
  '(coalesce na CZK jen když zdroj žádnou nedal), appka ji nedomýšlí. '
  'Zapisuje i import_davky.pocet_novych ve STEJNÉ transakci (dřív to dělal '
  'samostatný klientský .update(), který tiše padal na chybějícím grantu). '
  'Vrací počet skutečně vložených řádků (bez duplicit, pro hlášení uživateli).';
