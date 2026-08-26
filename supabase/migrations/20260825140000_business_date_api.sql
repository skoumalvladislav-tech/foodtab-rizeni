-- =====================================================================
-- Foodtab — provozní den pro aplikaci
--
-- `app.business_date` zná hodinu, kdy pobočce začíná nový provozní den,
-- i její časové pásmo. Aplikace se na ni ale dosud nemohla zeptat:
-- schéma `app` je zvenčí zavřené a průzor v `public` obsahoval jen
-- autorizaci.
--
-- Bez toho zbývaly dvě špatné možnosti: přepsat pravidlo do JavaScriptu
-- (a mít `day_starts_at` na dvou místech), nebo počítat s časovou zónou
-- serveru (a rozejít se s pobočkou v jiné zóně). Otevíráme proto i tuhle
-- funkci — čtecí, jako zbytek průzoru.
--
-- Odpovídá jen na pobočky firmy, do které volající patří. Cizímu vrátí
-- prázdno, ne otevírací hodinu.
-- =====================================================================

create or replace function public.business_date(
  p_branch uuid,
  p_at     timestamptz default now()
)
returns date
language sql stable security definer set search_path = ''
as $$
  select app.business_date(p_branch, p_at)
  from public.branches b
  where b.id = p_branch
    and app.is_member(b.tenant_id);
$$;

comment on function public.business_date(uuid, timestamptz) is
  'Provozní den pobočky pro aplikaci. Nikdy nepočítat datum v kódu '
  'aplikace — hodina začátku dne i časové pásmo patří pobočce.';

revoke all on function public.business_date(uuid, timestamptz) from public, anon;
grant execute on function public.business_date(uuid, timestamptz) to authenticated;
