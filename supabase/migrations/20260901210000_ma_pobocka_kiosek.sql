-- =====================================================================
-- Foodtab — má pobočka kiosek?
--
-- Zadání: docs/ukoly-codea-2026-09-01-vecer.md, oddíl 4 bod d.
--
-- Píchnout se od 1. 9. dá jedině kódem z tabletu nebo PINem na tabletu.
-- Když na pobočce žádný tablet zaregistrovaný není, nedá se píchnout
-- vůbec — a obrazovka o tom mlčí. Člověk vidí políčko na kód, který
-- nemá kde vzít, a nedozví se, že cesta ven je požádat vedoucího
-- o ruční zápis.
--
-- Seznam zařízení je zavřený na `settings.manage` a to je správně:
-- číšníkovi do soupisu tabletů nic není. Ven proto jde JEDINÁ
-- informace, a to ano/ne. Nic o tom, kolik jich je, jak se jmenují
-- ani kdy byly naposledy vidět.
-- =====================================================================

create or replace function public.pobocka_ma_kiosek(p_tenant uuid, p_branch uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.branch_devices d
    where d.tenant_id = p_tenant
      and d.branch_id = p_branch
      and d.stav = 'active'
  ) and app.is_member(p_tenant);
$$;

comment on function public.pobocka_ma_kiosek(uuid, uuid) is
  'Má pobočka aspoň jeden nezrušený tablet? Jen ano/ne — soupis zařízení '
  'zůstává zavřený na settings.manage.';

revoke all on function public.pobocka_ma_kiosek(uuid, uuid) from public, anon;
grant execute on function public.pobocka_ma_kiosek(uuid, uuid) to authenticated;
