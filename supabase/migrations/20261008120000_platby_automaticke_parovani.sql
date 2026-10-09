-- Automatické párování plateb s fakturami
--
-- Šéfík 8. 10. 2026: „faktury se mají automaticky přesunout do uhrazených
-- ve chvíli spárování s platbou z výpisu z účtu, a nebo přesunout ručně."
--
-- Dosud se párování potvrzovalo VŽDY lidským klikem (komentář tabulky
-- `platby_faktury`). Teď se po synchronizaci banky / importu výpisu samo
-- potvrdí jen to, co je JEDNOZNAČNÉ (stejný VS a přesná částka, jediná
-- faktura a jediná platba — pravidlo `vybratAutomatickaParovani`
-- v lib/finance-parovani.ts). Všechno ostatní zůstává návrhem.
--
-- Úloha běží jako service_role (bez přihlášeného uživatele), takže
-- `app.potvrdit_alokaci_platby` (chce `app.has_access`) použít nejde.
-- Proto samostatná funkce JEN pro service_role, ještě přísnější: platba
-- i faktura musí být bez jakéhokoli dosavadního párování a částka musí
-- sedět na haléř s platbou i fakturou.

alter table public.platby_faktury
  add column zpusob text not null default 'rucne'
    check (zpusob in ('rucne', 'automaticky'));

comment on column public.platby_faktury.zpusob is
  '''rucne'' = potvrdil člověk (potvrdil), ''automaticky'' = jednoznačná shoda '
  'po synchronizaci banky (VS + přesná částka, jediný kandidát). Zrušit jde obojí.';

comment on table public.platby_faktury is
  'Párování transakce (hlavní DB) s fakturou (oddělená DB Faktur, '
  'faktura_id je volný text — FK mezi databázemi nejde postavit). '
  'Jistota >= 0.9 se navrhne; potvrzuje člověk, kromě JEDNOZNAČNÉ shody '
  '(VS + přesná částka, jediná faktura i platba), kterou od 8. 10. 2026 '
  'potvrdí úloha sama (zpusob = ''automaticky'').';


create function app.automaticky_sparovat_platbu(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer
)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_hash_transakce bigint := hashtextextended(p_transakce::text, 0);
  v_hash_faktura   bigint := hashtextextended(p_faktura, 0);
  v_branch         uuid;
  v_castka_transakce integer;
begin
  if p_castka_haleru <= 0 or p_castka_haleru <> p_castka_faktury_celkem then
    return false;
  end if;

  -- Stejné pořadí zámků jako app.potvrdit_alokaci_platby — souběh s ručním
  -- potvrzením téže platby/faktury se srazí na zámku, ne v datech.
  if v_hash_transakce <= v_hash_faktura then
    perform pg_advisory_xact_lock(v_hash_transakce);
    perform pg_advisory_xact_lock(v_hash_faktura);
  else
    perform pg_advisory_xact_lock(v_hash_faktura);
    perform pg_advisory_xact_lock(v_hash_transakce);
  end if;

  select u.branch_id, t.castka_haleru into v_branch, v_castka_transakce
    from public.transakce t
    join public.platebni_ucty u on u.id = t.ucet_id
   where t.id = p_transakce and t.tenant_id = p_tenant and t.smer = 'vydaj'
     -- Jen platba, která skutečně přišla z banky — ruční zápis nebo pokladnu
     -- si může kdokoli s financemi napsat sám a fakturu by tím „zaplatil".
     and t.zdroj in ('fio_api', 'bankovni_agregator', 'csv_banka');

  if v_castka_transakce is null or v_castka_transakce <> p_castka_haleru then
    return false;
  end if;

  -- Cokoli už spárovaného (i částečně, i jinou cestou) = už to není
  -- jednoznačné. Rozhodne člověk.
  if exists (select 1 from public.platby_faktury
              where stav = 'potvrzeno'
                and (transakce_id = p_transakce or (tenant_id = p_tenant and faktura_id = p_faktura))) then
    return false;
  end if;

  -- Člověk tohle párování už jednou zrušil (stav 'zamitnuto') — automatika
  -- ho nesmí vracet pořád dokola.
  if exists (select 1 from public.platby_faktury
              where transakce_id = p_transakce and faktura_id = p_faktura and stav = 'zamitnuto') then
    return false;
  end if;

  insert into public.platby_faktury (tenant_id, transakce_id, faktura_id, castka_haleru, jistota, stav, potvrzeno_kdy, zpusob)
  values (p_tenant, p_transakce, p_faktura, p_castka_haleru, 1, 'potvrzeno', now(), 'automaticky');

  perform app.audit(p_tenant, 'finance.platba_alokovana_automaticky', 'platby_faktury', p_faktura, v_branch,
                    null, jsonb_build_object('transakce_id', p_transakce, 'castka_haleru', p_castka_haleru));
  return true;
end $$;

comment on function app.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer) is
  'Jen pro úlohu (service_role): potvrdí JEDNOZNAČNOU shodu platby a faktury. '
  'Vrací false (nic nezapíše), když částka nesedí na haléř nebo je platba či '
  'faktura už jakkoli spárovaná. O jednoznačnosti rozhoduje volající '
  '(vybratAutomatickaParovani) — tahle funkce hlídá, co z databáze vidět jde.';

revoke all on function app.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function app.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer) to service_role;

create function public.automaticky_sparovat_platbu(
  p_tenant                 uuid,
  p_transakce              uuid,
  p_faktura                text,
  p_castka_haleru          integer,
  p_castka_faktury_celkem  integer
)
returns boolean
language sql security invoker set search_path = ''
as $$
  select app.automaticky_sparovat_platbu(p_tenant, p_transakce, p_faktura, p_castka_haleru, p_castka_faktury_celkem);
$$;

revoke all on function public.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.automaticky_sparovat_platbu(uuid, uuid, text, integer, integer) to service_role;


-- Platbu „z banky přes API" (fio_api, bankovni_agregator) smí zapsat jen
-- úloha synchronizace (service_role). Přihlášený uživatel (finance.manage
-- smí do `transakce` zapisovat) by si jinak napsal řádek se zdrojem
-- „fio_api" a automatika by podle něj fakturu „zaplatila". Ruční zápis
-- a import CSV mají své vlastní zdroje (rucni, csv_banka, csv_pokladna).
create function app.hlida_zdroj_transakce()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and new.zdroj in ('fio_api', 'bankovni_agregator') then
    raise exception 'Platbu ze zdroje „%" zapisuje jen synchronizace banky.', new.zdroj
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function app.hlida_zdroj_transakce() from public, anon, authenticated;

create trigger trg_hlida_zdroj_transakce
  before insert on public.transakce
  for each row execute function app.hlida_zdroj_transakce();


-- Zrušení AUTOMATICKÉHO párování (jen server po ověření práv, service_role):
--   * „Vrátit mezi neuhrazené" ve Fakturách — člověk tím říká, že platba
--     k faktuře nepatří.
-- (Pozdě vrácenou platbu úloha sama NEruší — Platby ji ukážou k ruční
-- kontrole; automatické rušení by mohlo zasáhnout nesouvisející párování.)
-- Jen řádky se `zpusob = 'automaticky'`; ruční párování ruší člověk
-- v Platbách (app.zrusit_alokaci_platby, chce finance.manage). Stav
-- 'zamitnuto' zároveň brání tomu, aby automatika dvojici spárovala znovu.
create function app.zrusit_automaticke_parovani(p_tenant uuid, p_alokace uuid, p_duvod text)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_faktura text;
begin
  update public.platby_faktury
     set stav = 'zamitnuto'
   where id = p_alokace and tenant_id = p_tenant and zpusob = 'automaticky' and stav = 'potvrzeno'
  returning faktura_id into v_faktura;

  if v_faktura is null then
    return false;
  end if;

  perform app.audit(p_tenant, 'finance.automaticke_parovani_zruseno', 'platby_faktury', v_faktura, null,
                    null, jsonb_build_object('alokace_id', p_alokace, 'duvod', left(coalesce(p_duvod, ''), 300)));
  return true;
end $$;

revoke all on function app.zrusit_automaticke_parovani(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.zrusit_automaticke_parovani(uuid, uuid, text) to service_role;

create function public.zrusit_automaticke_parovani(p_tenant uuid, p_alokace uuid, p_duvod text)
returns boolean
language sql security invoker set search_path = ''
as $$
  select app.zrusit_automaticke_parovani(p_tenant, p_alokace, p_duvod);
$$;

revoke all on function public.zrusit_automaticke_parovani(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.zrusit_automaticke_parovani(uuid, uuid, text) to service_role;
