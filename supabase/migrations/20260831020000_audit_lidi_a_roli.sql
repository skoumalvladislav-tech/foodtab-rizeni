-- =====================================================================
-- Foodtab — audit změn u lidí, rolí a oprávnění
--
-- Do auditu dosud chodilo jen to, co prochází funkcí v `app`: založení
-- firmy, pozvánky, odškrtnutí úkolu, nově sazba. Úprava zaměstnance,
-- přidělení role a změna oprávnění se ale dělají obyčejným update přímo
-- z aplikace, takže po nich nezůstávala žádná stopa.
--
-- Proč to řeší spoušť a ne volání z akce:
--
--   1. app.audit je aplikaci odepřená (revoke ... from authenticated),
--      a to je záměr — kdyby ji směla volat, dal by se audit podvrhnout.
--   2. Spoušť platí na KAŽDOU cestu: aplikaci, chystaný import z tabulky,
--      ruční SQL v editoru i budoucí konektor na pokladnu. Zápis přes
--      akci by hlídal jen tu jednu cestu, kterou dnes vidíme.
--
-- Do employees za pár dní přibude vazba na mzdy. „Kdo to změnil“ je
-- otázka, která u mezd přijde dřív nebo později vždycky.
-- =====================================================================


-- ---------------------------------------------------------------------
-- CO SE ZMĚNILO Z ČEHO NA CO
--
-- U úpravy se ukládají jen sloupce, které se opravdu změnily. Celý řádek
-- dvakrát by odpověď na otázku „co se změnilo“ spíš schoval — u záznamu
-- o patnácti sloupcích se hledá ten jeden.
--
-- Firma se u role_permissions dohledává přes roli; ta tabulka tenant_id
-- nemá, protože visí na roli, která ho má.
-- ---------------------------------------------------------------------

create or replace function app.audit_zmenu()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_radek   jsonb := to_jsonb(coalesce(new, old));
  v_stary   jsonb := case when old is null then null else to_jsonb(old) end;
  v_tenant  uuid;
  v_branch  uuid;
  v_entita  text := tg_argv[0];
  v_klic    text;
  v_pred    jsonb;
  v_po      jsonb;
begin
  -- Firma. U role_permissions se na ni musíme doptat role.
  if v_radek ? 'tenant_id' then
    v_tenant := (v_radek ->> 'tenant_id')::uuid;
  else
    select r.tenant_id into v_tenant
    from public.roles r where r.id = (v_radek ->> 'role_id')::uuid;
  end if;

  if v_radek ? 'branch_id' then
    v_branch := nullif(v_radek ->> 'branch_id', '')::uuid;
  end if;

  -- Když se ruší celá firma, chodí sem mazání jejích řádků kaskádou.
  -- Zapisovat audit k firmě, která v tu chvíli už neexistuje, nejde —
  -- spadlo by to na cizím klíči a shodilo by to celé rušení.
  if v_tenant is null or not exists (
    select 1 from public.tenants t where t.id = v_tenant
  ) then
    return null;
  end if;

  -- Čím se ten řádek pojmenuje v auditu. Složený klíč u oprávnění, ať
  -- je z výpisu poznat, o které šlo.
  if v_radek ? 'id' then
    v_klic := v_radek ->> 'id';
  else
    v_klic := (v_radek ->> 'role_id') || ':' || (v_radek ->> 'permission_key');
  end if;

  if tg_op = 'UPDATE' then
    -- Jen doopravdy změněné sloupce. Když se nezměnilo nic (například
    -- uložení formuláře beze změny), do auditu se nepíše vůbec.
    select jsonb_object_agg(s.key, s.value) into v_pred
    from jsonb_each(v_stary) s
    where to_jsonb(new) -> s.key is distinct from s.value;

    if v_pred is null then
      return null;
    end if;

    select jsonb_object_agg(n.key, n.value) into v_po
    from jsonb_each(to_jsonb(new)) n
    where v_stary -> n.key is distinct from n.value;
  elsif tg_op = 'INSERT' then
    v_po := v_radek;
  else
    v_pred := v_stary;
  end if;

  perform app.audit(
    v_tenant,
    v_entita || '.' || lower(tg_op),
    v_entita,
    v_klic,
    v_branch,
    v_pred,
    v_po
  );

  return null;
end;
$$;

comment on function app.audit_zmenu() is
  'Spoušť do auditu. Zapisuje jen změněné sloupce. Název entity si bere '
  'z argumentu spouště, aby se dala pověsit na víc tabulek.';

-- Volat se má jen jako spoušť. Postgres přímé volání odmítne sám,
-- ale odepření je ve stejném duchu jako u app.audit — na audit se
-- z aplikace nesahá.
revoke all on function app.audit_zmenu() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- KDE VISÍ
--
-- AFTER, protože zapisovat záznam o změně, která nakonec neprojde
-- (porušené omezení, odmítnutá politika), by byl audit o něčem, co se
-- nestalo.
--
-- Mazání zaměstnance je podle pravidla 9 označení, tedy UPDATE sloupce
-- deleted_at — chytí se to samo, žádná zvláštní větev na to není.
-- ---------------------------------------------------------------------

create trigger trg_audit_employees
  after insert or update or delete on public.employees
  for each row execute function app.audit_zmenu('employee');

create trigger trg_audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function app.audit_zmenu('membership');

create trigger trg_audit_roles
  after insert or update or delete on public.roles
  for each row execute function app.audit_zmenu('role');

create trigger trg_audit_role_permissions
  after insert or update or delete on public.role_permissions
  for each row execute function app.audit_zmenu('permission');
