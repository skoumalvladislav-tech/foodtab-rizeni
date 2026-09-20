-- =====================================================================
-- Foodtab — stav potvrzení směn pro celý rozpis (puntík u času směny)
--
-- Zadání: Šéfík 20. 9. 2026 — puntík u času směny je červený (nevydáno),
-- žlutý (vydáno, nepotvrzeno) nebo zelený (vydáno a potvrzeno).
--
-- ---------------------------------------------------------------------
-- 1. PROČ NOVÁ FUNKCE
--
-- Jestli člověk směnu potvrdil, je v `notifications` (acknowledged_at,
-- read_at), která je soukromá: každý čte jen svoje. Vedoucí proto dosud
-- viděl potvrzení jen po jedné směně (`stav_potvrzeni_smeny`, panel ke
-- směně). Mřížka ho potřebuje u každé karty najednou — sto volání funkce
-- na jednu obrazovku by nedávalo smysl.
--
-- Tahle funkce vrací totéž co ta stávající, jen za všechny směny okna a
-- bez jména: id směny, druh posledního upozornění, kdy ho člověk přečetl
-- a kdy potvrdil. Obsah upozornění se nevrací, `notifications` zůstává
-- soukromá.
--
-- ---------------------------------------------------------------------
-- 2. CO SE SCHVÁLNĚ DĚLÁ JINAK NEŽ `stav_potvrzeni_smeny`
--
--  * Pobočky, na kterých volající neplánuje (`shifts.manage`), se tiše
--    VYNECHAJÍ, ne odmítnou chybou: okno rozpisu smí obsahovat směny
--    víc poboček a vedoucí jedné z nich má dostat aspoň svoje. Kód, který
--    funkci volá, si pamatuje, za které pobočky odpověď platí, a u ostatních
--    „nepotvrzeno“ nevymýšlí.
--  * Okno je omezené na 93 dní. Bez toho by šlo jednou funkcí vytáhnout
--    stav upozornění za celou historii firmy.
--
-- ---------------------------------------------------------------------
-- 3. DEFINER NEMÁ DRUHOU LINII
--
-- Uvnitř SECURITY DEFINER žádné RLS neplatí, takže tenant a právo si
-- funkce hlídá sama: firma se filtruje na upozornění i na směně a
-- pobočky se berou jen ty, kde má volající `shifts.manage`. Ověřuje se
-- jednou za pobočku, ne za každý řádek. Firma se tak hlídá na třech místech
-- (pobočky, upozornění, směna) a žádné z nich nemá být jediné — proto se
-- žádná z těch podmínek nesmí „uklidit“ jako nadbytečná.
--
-- Nasazuje Šéfík. Přidává jen funkci; na data nesahá. Závisí na
-- migraci 20260919120000 (sloupec `notifications.shift_id`) — před ní
-- se nedá nasadit.
-- =====================================================================

create or replace function public.stav_potvrzeni_smen(
  p_tenant uuid,
  p_od     date,
  p_do     date
)
returns table (
  smena_id     uuid,
  druh         text,
  precteno_at  timestamptz,
  potvrzeno_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_tenant is null or p_od is null or p_do is null or p_do < p_od then
    return;
  end if;

  if p_do - p_od > 92 then
    raise exception 'Okno je moc velké (nejvýš 93 dní).'
      using errcode = 'invalid_parameter_value';
  end if;

  return query
    with pobocky as (
      select b.id
        from public.branches b
       where b.tenant_id = p_tenant
         and app.has_access(p_tenant, 'shifts.manage', b.id)
    )
    select distinct on (n.shift_id)
           n.shift_id, n.druh, n.read_at, n.acknowledged_at
      from public.notifications n
      join public.shifts s
        on s.id = n.shift_id
       and s.tenant_id = p_tenant
     where n.tenant_id = p_tenant
       and n.druh in ('smena.nova', 'smena.zmenena')
       and s.shift_date between p_od and p_do
       and s.status <> 'cancelled'
       and s.branch_id in (select p.id from pobocky p)
     order by n.shift_id, n.created_at desc;
end;
$$;

comment on function public.stav_potvrzeni_smen(uuid, date, date) is
  'Pro vedoucího: poslední upozornění na každou směnu okna a kdy ho člověk '
  'přečetl a potvrdil. Jen druh a časy, nikdy obsah upozornění. Pobočky, '
  'kde volající neplánuje (shifts.manage), se vynechají.';

revoke all on function public.stav_potvrzeni_smen(uuid, date, date) from public, anon;
grant execute on function public.stav_potvrzeni_smen(uuid, date, date) to authenticated;
