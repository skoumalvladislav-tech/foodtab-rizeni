-- =====================================================================
-- Foodtab — zápis do auditu o nahrání dat z tabulky
--
-- Zadání docs/nahravani-dat-zadani.md, oddíl B: „Do auditu jde, kdo co
-- kdy nahrál a kolik řádků to změnilo.“
--
-- Jednotlivé řádky se do auditu dostanou samy — spouští na employees
-- z migrace 20260831020000. Chybí ale zápis o nahrání jako celku: bez
-- něj je v auditu dvacet nesouvisejících změn a nikde nestojí, že patří
-- k jednomu souboru a kdo ho poslal.
--
-- Proč průzor a ne zápis přímo z aplikace: app.audit je `authenticated`
-- odepřená (revoke), a to je záměr — kdyby ji směla volat, dal by se
-- audit podvrhnout. Funkce je proto security definer, ale úzká: nebere
-- žádný text, který by se dal vydávat za jinou akci, a firmu si ověří.
--
-- Právo: kdo nesmí zakládat lidi, nesmí ani zapsat, že je nahrál.
-- Kontrola je tady druhá obranná linie — první je kontrola na obrazovce
-- a RLS na employees, které zápis stejně nepustí.
-- =====================================================================

create or replace function public.audit_import(
  p_tenant        uuid,
  p_co            text,
  p_soubor        text,
  p_zalozeno      integer,
  p_aktualizovano integer,
  p_preskoceno    integer
)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_pravo text;
begin
  -- Co se nahrává, určuje potřebné právo. Seznam je schválně krátký:
  -- nová položka se přidá až s nahráváním, které ji umí.
  v_pravo := case p_co
    when 'lide' then 'people.manage'
    else null
  end;

  if v_pravo is null then
    raise exception 'Neznámý druh nahrávání: %', p_co using errcode = 'check_violation';
  end if;

  if not app.has_access(p_tenant, v_pravo) then
    raise exception 'Na nahrávání nemáte právo' using errcode = 'insufficient_privilege';
  end if;

  perform app.audit(
    p_tenant,
    'import.' || p_co,
    'import',
    -- Typované NULLy: app.audit má sedm parametrů a netypovaný null by
    -- se musel dohadovat.
    null::text,
    null::uuid,
    null::jsonb,
    jsonb_build_object(
      -- Název souboru je text od zákazníka. Ukládá se jako data
      -- (jsonb), nikdy se odsud nikam nevykonává. Delší jméno by
      -- v auditu jen překáželo.
      'soubor',        left(coalesce(p_soubor, ''), 200),
      'zalozeno',      greatest(coalesce(p_zalozeno, 0), 0),
      'aktualizovano', greatest(coalesce(p_aktualizovano, 0), 0),
      'preskoceno',    greatest(coalesce(p_preskoceno, 0), 0)
    )
  );
end;
$$;

comment on function public.audit_import(uuid, text, text, integer, integer, integer) is
  'Zápis do auditu o nahrání dat z tabulky: kdo, co, kdy a kolik řádků. '
  'Jednotlivé řádky zapisují spouště na dotčených tabulkách.';

revoke all on function public.audit_import(uuid, text, text, integer, integer, integer)
  from public, anon;
grant execute on function public.audit_import(uuid, text, text, integer, integer, integer)
  to authenticated;
