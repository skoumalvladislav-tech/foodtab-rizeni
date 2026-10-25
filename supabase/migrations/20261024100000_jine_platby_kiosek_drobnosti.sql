-- Jiné platby — kiosek na telefonu: drobnosti po nasazení (24. 10. 2026)
--
-- Zbylé nízké nálezy z ověření 674659b (#151):
--   1. jedinečný název telefonu na pobočce hlídá DATABÁZE, ne jen
--      registrace (dvě souběžná spárování nebo přejmenování by prošla);
--   2. zrušený doklad v přehledu telefonu ukazoval „0 fotek“ — zrušení ve
--      Financích fotky deaktivuje, telefon je ale poslal;
--   3. úklid nepřipojených souborů z kiosku (soubory nahrané přes
--      podepsanou adresu, ke kterým nedošlo dokončení) — funkce pro úlohu
--      /api/uloha/kiosek-uklid a záznam v plánu úloh. Na pg_cron nic
--      nestojí: úlohu volá GitHub Actions (kiosek-uklid.yml) a jde
--      spustit i ručně.

-- ---------------------------------------------------------------------
-- 1. Jedinečný název telefonu na doklady na pobočce
-- ---------------------------------------------------------------------
-- Finance poznají, odkud doklad přišel, jen podle názvu zařízení. Platí
-- pro aktivní telefony na doklady (ucel = 'doklady'). Tablety Docházky
-- se schválně nehlídají: tablet, který ztratí klíč, se dnes páruje znovu
-- pod stejným názvem bez odvolání starého — index by to zastavil.
--
-- Registrace (app.registrovat_zarizeni_s_ucelem) duplicitu odmítá od
-- nasazení 20261022100000 s hezkou hláškou; index zavře souběh dvou
-- spárování a přejmenování přímým zápisem. Kdyby přesto v datech
-- duplicita byla, migrace spadne TADY a řekne proč — ne na indexu.
do $$
declare
  v_dup integer;
begin
  select count(*) into v_dup
    from (select 1 from public.branch_devices
           where stav = 'active' and ucel = 'doklady'
           group by tenant_id, branch_id, lower(btrim(nazev))
          having count(*) > 1) x;
  if v_dup > 0 then
    raise exception 'Aktivní telefony na doklady se stejným názvem (poboček: %) — před nasazením jeden z nich v Nastavení → Zařízení odvolejte.', v_dup
      using errcode = 'unique_violation';
  end if;
end $$;

create unique index branch_devices_telefon_nazev
  on public.branch_devices (tenant_id, branch_id, lower(btrim(nazev)))
  where stav = 'active' and ucel = 'doklady';

comment on index public.branch_devices_telefon_nazev is
  'Aktivní telefon na doklady má na pobočce jedinečný název (Finance podle něj poznají autora dokladu). '
  'Tablety Docházky se nehlídají.';

-- ---------------------------------------------------------------------
-- 2. Přehled telefonu: zrušený doklad nemá „0 fotek“
-- ---------------------------------------------------------------------
-- Zrušení ve Financích (jine_platby_zrusit) fotky deaktivuje, aby šly
-- připojit k novému záznamu. Telefon je ale poslal — u zrušeného dokladu
-- se proto počítají i neaktivní fotky z tohoto telefonu. Jinak platí
-- dál: jen fotky tohoto telefonu a jen aktivní (odebranou ne).
create or replace function public.jine_platby_kiosek_dnes(p_klic text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  d     public.branch_devices;
  v_den date;
begin
  d := app.jp_kiosek_zarizeni(p_klic);
  v_den := app.business_date(d.branch_id, now());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'cas', x.vytvoreno,
             'fotek', x.fotek,
             'oznaceni', x.kiosek_oznaceni,
             'stav', case
                       when x.stav_kontroly = 'zruseno' then 'zruseno'
                       when x.stav_trzby in ('zapsano', 'propojeno') then 'zpracovano'
                       when x.stav_kontroly = 'zkontrolovano' then 'zkontrolovano'
                       when x.fotek = 0 then 'bez_fotky'
                       else 'prijato'
                     end)
           order by x.vytvoreno desc)
      from (select z.vytvoreno, z.kiosek_oznaceni, z.stav_kontroly, z.stav_trzby,
                   (select count(*) from public.jine_platby_soubory f
                     where f.zaznam_id = z.id and f.zarizeni_id = d.id
                       and (f.aktivni or z.stav_kontroly = 'zruseno'))::integer as fotek
              from public.jine_platby z
             where z.zarizeni_id = d.id and z.tenant_id = d.tenant_id and z.branch_id = d.branch_id
               and z.vytvoreno > now() - interval '2 days'
               and app.business_date(d.branch_id, z.vytvoreno) = v_den
             order by z.vytvoreno desc
             limit 50) x
  ), '[]'::jsonb);
end $$;

revoke all on function public.jine_platby_kiosek_dnes(text) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_dnes(text) to service_role;

-- ---------------------------------------------------------------------
-- 3. Úklid nepřipojených souborů z kiosku
-- ---------------------------------------------------------------------
-- Vrátí cesty souborů, které úloha smaže přes Storage API (SQL delete na
-- storage.objects se nepoužívá). Sirotek je soubor v kbelíku jine-platby:
--   * bez vlastníka (nahrál ho kiosek přes podepsanou adresu — soubor
--     přihlášeného tu nikdy není),
--   * pod záznamem z kiosku (zdroj = 'kiosek'; cesta sedí na firmu,
--     pobočku i záznam),
--   * starší než 3 hodiny a se záznamem starším než 3 hodiny — připojit
--     se dá jen do 2 hodin od založení, takže ho už nikdo nepřipojí,
--   * a nic na něj neukazuje (žádný řádek v jine_platby_soubory).
-- Mimochodem uklidí náhrobky (jine_platby_kiosek_uklid) starší než den,
-- jejichž soubor už v úložišti není.
create function public.jine_platby_kiosek_sirotci(p_limit integer)
returns setof text
language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from public.jine_platby_kiosek_uklid u
   where u.vytvoreno < now() - interval '1 day'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'jine-platby' and o.name = u.cesta);

  return query
    select o.name
      from storage.objects o
      cross join lateral app.jine_platby_cesta(o.name) c
      join public.jine_platby z
        on z.id = c.zaznam_id and z.tenant_id = c.tenant_id and z.branch_id = c.branch_id
     where o.bucket_id = 'jine-platby'
       and o.owner is null
       and o.created_at < now() - interval '3 hours'
       and z.zdroj = 'kiosek'
       and z.vytvoreno < now() - interval '3 hours'
       and not exists (select 1 from public.jine_platby_soubory s where s.cesta = o.name)
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit, 500), 1000));
end $$;

revoke all on function public.jine_platby_kiosek_sirotci(integer) from public, anon, authenticated;
grant execute on function public.jine_platby_kiosek_sirotci(integer) to service_role;

-- Plán úlohy pro pg_cron (až ho Šéfík zapne) — stejný jako
-- .github/workflows/kiosek-uklid.yml; scripts/planovac.test.mjs hlídá shodu.
-- Jednou denně ve 03:35 UTC, adresa má maxDuration 60 s → limit 90 s.
insert into app.planovac_ulohy (uloha, plan_utc, limit_sekund) values
  ('kiosek-uklid', '35 3 * * *', 90);
