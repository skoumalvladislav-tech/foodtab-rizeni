-- =====================================================================
-- Foodtab — ruční odchod, ke kterému není co zavřít, se odmítne
--
-- Nález: docs/nesedi-hodiny-po-rucnim-odchodu.md, bod B.
--
-- ---------------------------------------------------------------------
-- CO SE DĚLO
--
-- Šéfík se pětkrát pokusil doplnit chybějící odchod. Pokaždé aplikace
-- odpověděla „Zapsáno jako ruční záznam.“ a pokaždé se nestalo nic:
-- v tu chvíli nebyla otevřená žádná směna, takže `app.worked_minutes`
-- ten odchod přeskočila. Zůstalo po nich pět mrtvých řádků, které
-- nikomu nic neřekly — a hlášení o nedokončené docházce nezmizelo,
-- takže to vypadalo, že zápis selhal.
--
-- „Zapsáno“ u zápisu, který nic neudělal, je horší než chyba. Chyba se
-- přečte a něco se s ní udělá; falešné potvrzení se zopakuje pětkrát.
--
-- ---------------------------------------------------------------------
-- CO SE ODMÍTÁ
--
-- Odchod, ke kterému v ten čas není otevřený příchod. A stejně tak
-- konec přestávky, ke kterému není začátek — je to týž případ a mlčet
-- u něj by bylo stejně matoucí. (Zadání mluví jen o odchodu; tohle je
-- vědomé rozšíření o jeden druh, protože jinak by se lišily bez
-- důvodu.)
--
-- Rozhoduje stav K ZADANÉMU ČASU, ne k „teď“: ruční záznam se zapisuje
-- zpětně a otevřenost směny se posuzuje tam, kam se zapisuje.
--
-- ---------------------------------------------------------------------
-- CO SE NEODMÍTÁ
--
-- Příchod nikdy. Kdo si zapomněl píchnout příchod, ho musí doplnit —
-- a to, že za ním už leží odchod, je právě ten případ, kvůli kterému
-- ruční zápis existuje.
-- =====================================================================

create or replace function public.zapsat_rucni_dochazku(
  p_tenant   uuid,
  p_branch   uuid,
  p_employee uuid,
  p_druh     text,
  p_kdy      timestamp,
  p_duvod    text
)
returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_id       uuid;
  v_zona     text;
  v_kdy      timestamptz;
  v_posledni record;
begin
  if not app.has_access(p_tenant, 'attendance.manage', p_branch) then
    raise exception 'Zapisovat docházku ručně smí jen ten, kdo na to má oprávnění.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_druh not in ('in', 'out', 'break_start', 'break_end') then
    raise exception 'Neznámý druh záznamu: %', p_druh using errcode = 'check_violation';
  end if;

  if p_kdy is null then
    raise exception 'Vyplňte, kdy se to stalo.' using errcode = 'check_violation';
  end if;

  if length(btrim(coalesce(p_duvod, ''))) < 3 then
    raise exception 'Napište prosím, proč se záznam zadává ručně. Aspoň tři znaky.'
      using errcode = 'check_violation';
  end if;

  v_zona := app.zona_pobocky(p_branch);
  if v_zona is null then
    raise exception 'Pobočka neexistuje.' using errcode = 'no_data_found';
  end if;

  v_kdy := p_kdy at time zone v_zona;

  /*
    Je k tomu čemu zavřít? Poslední platná událost člověka PŘED zadaným
    časem — pobočka se neřeší, protože příchod na jedné a odchod na
    druhé je normální stav (migrace 20260902060000).
  */
  if p_druh in ('out', 'break_end') then
    select a.kind, a.occurred_at, b.name as pobocka
      into v_posledni
    from public.attendance_events a
    join public.branches b on b.id = a.branch_id
    where a.tenant_id   = p_tenant
      and a.employee_id = p_employee
      and a.occurred_at <= v_kdy
      and a.stornovano_kdy is null
    order by a.occurred_at desc, a.created_at desc
    limit 1;

    if p_druh = 'out' and (v_posledni.kind is null or v_posledni.kind = 'out') then
      /*
        Věta říká, CO se stalo a CO S TÍM — ne „nepovedlo se“. Když
        poslední záznam existuje, je v hlášce i s časem: nejčastější
        příčina je, že chybí spíš příchod.
      */
      if v_posledni.kind is null then
        raise exception
          'K tomuhle času není co uzavřít — před ním nemá tenhle člověk žádný záznam. Chybí nejspíš příchod, ne odchod.'
          using errcode = 'invalid_parameter_value';
      else
        raise exception
          'K tomuhle času není co uzavřít — poslední záznam je taky odchod (% v %). Zkontrolujte, jestli nechybí spíš příchod.',
          to_char(v_posledni.occurred_at at time zone v_zona, 'DD.MM.'),
          to_char(v_posledni.occurred_at at time zone v_zona, 'HH24:MI')
          using errcode = 'invalid_parameter_value';
      end if;
    end if;

    if p_druh = 'break_end' and (v_posledni.kind is null or v_posledni.kind <> 'break_start') then
      raise exception
        'K tomuhle času není co uzavřít — před ním nezačala žádná přestávka.'
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  insert into public.attendance_events
    (tenant_id, branch_id, employee_id, kind, source, occurred_at, note)
  values (p_tenant, p_branch, p_employee, p_druh, 'manual', v_kdy, btrim(p_duvod))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text) is
  'Ruční záznam docházky. `p_kdy` je hodina na zdi; pásmo dodá pobočka. '
  'Odchod bez otevřené směny se ODMÍTNE — „Zapsáno“ u zápisu, který nic '
  'neudělal, je horší než chyba.';

revoke all on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text)
  from public, anon;
grant execute on function public.zapsat_rucni_dochazku(uuid, uuid, uuid, text, timestamp, text)
  to authenticated;
