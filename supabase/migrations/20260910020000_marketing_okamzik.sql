-- =====================================================================
-- Foodtab — modul Marketing: hodina na zdi → okamžik
--
-- Zadání: docs/marketing-je-modul.md, oddíl 4, krok 3 (obrazovky).
--
-- ---------------------------------------------------------------------
-- PROČ TO NEPOČÍTÁ APLIKACE
--
-- CLAUDE.md, pravidlo 11. Co člověk napíše do políčka
-- („10. 9. v 18:00") nemá časové pásmo. Pásmo k tomu dodá POBOČKA
-- a převod musí udělat databáze přes `at time zone` — ta zná pravidla
-- letního času pro to konkrétní datum.
--
-- `new Date('2026-09-10T18:00')` v Node by se přečetlo v pásmu serveru,
-- a ten je na Vercelu v UTC. Příspěvek naplánovaný na šestou večer by
-- odešel ve dvě odpoledne — a v zimě jinak než v létě.
--
-- Je to totéž, co dělá `public.zapsat_rucni_dochazku` u docházky;
-- pásmo se bere stejnou funkcí `app.zona_pobocky`, aby existovalo
-- jedno místo, kde je řečeno, kde pobočka stojí.
-- =====================================================================

create or replace function public.marketing_okamzik(p_branch uuid, p_kdy timestamp)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_zona   text;
  v_tenant uuid;
begin
  select b.tenant_id into v_tenant from public.branches b where b.id = p_branch;

  -- Uvnitř `security definer` se RLS neuplatní (skill `migrace`,
  -- oddíl 5), takže si právo musíme ověřit sami. Bez toho by kdokoli
  -- zjistil, v jakém pásmu stojí cizí pobočka — drobnost, ale je to
  -- únik přes funkci, která se tváří jako počítadlo.
  if v_tenant is null or not app.has_access(v_tenant, 'marketing.read', p_branch) then
    raise exception 'Nemáte přístup k té provozovně.' using errcode = 'insufficient_privilege';
  end if;

  v_zona := app.zona_pobocky(p_branch);
  if v_zona is null then
    raise exception 'Pobočka neexistuje.' using errcode = 'no_data_found';
  end if;

  return p_kdy at time zone v_zona;
end $$;

comment on function public.marketing_okamzik(uuid, timestamp) is
  'Hodina na zdi → okamžik, v pásmu pobočky. Nikdy to nepočítá '
  'prohlížeč ani server aplikace — ani jeden neví, kde pobočka stojí, '
  'a server je na Vercelu v UTC.';

revoke all on function public.marketing_okamzik(uuid, timestamp) from public, anon;
grant execute on function public.marketing_okamzik(uuid, timestamp) to authenticated, service_role;
