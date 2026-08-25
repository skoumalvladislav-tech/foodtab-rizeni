-- =====================================================================
-- Foodtab — odškrtnutí úkolu tím, komu je zadaný
--
-- Politika `tasks_write` žádá `tasks.manage` na jakoukoli změnu úkolu.
-- Důsledek, na který se přišlo až při stavbě obrazovky: kuchař vidí úkol,
-- který je zadaný jemu, ale odškrtnout si ho nemůže. Musel by u něj stát
-- vedoucí a klikat za něj. To je proti smyslu celého modulu — a proti
-- checklistům, kde odškrtávat smí běžná směna.
--
-- Politiku ale nejde jen rozšířit: `for all` s volnějším `with check` by
-- adresátovi dovolila přepsat i název, termín a prioritu. Zavření úkolu
-- proto dostává vlastní funkci, která mění výhradně tři sloupce.
--
-- Kdo smí zavřít úkol (podle toho, komu je adresovaný — viz komentář
-- u sloupců `role_id` a `employee_id`):
--   • kdo má `tasks.manage` v jeho rozsahu — vždy
--   • komu je zadaný jmenovitě (`employee_id`)
--   • kdo má roli, které je zadaný (`role_id`)
--   • kdokoli, kdo na něj vidí, když není adresovaný nikomu
-- =====================================================================

create or replace function public.complete_task(p_task uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_task    public.tasks%rowtype;
  v_emp     uuid;
  v_role    uuid;
  v_smi     boolean;
begin
  select * into v_task from public.tasks t where t.id = p_task;

  -- Neexistuje a nepatří vám splývá schválně: jinak by šlo zkoušením
  -- adres zjistit, jaké úkoly má cizí firma.
  if not found or not app.is_member(v_task.tenant_id) then
    raise exception 'Úkol nenalezen.' using errcode = 'no_data_found';
  end if;

  select e.id into v_emp
  from public.employees e
  where e.tenant_id = v_task.tenant_id
    and e.user_id = (select auth.uid())
    and e.deleted_at is null;

  select m.role_id into v_role
  from public.memberships m
  where m.tenant_id = v_task.tenant_id
    and m.user_id = (select auth.uid())
    and m.status = 'active';

  -- coalesce tu není kosmetika. Úkol bez adresáta má role_id prázdné,
  -- takže porovnání nevrátí ani true, ani false, ale NULL — a `if not NULL`
  -- se neprovede. Bez toho by se povolení propadlo místo odmítnutí.
  v_smi := coalesce(
       app.has_access(v_task.tenant_id, 'tasks.manage', v_task.branch_id)
    or (v_emp is not null and v_task.employee_id = v_emp)
    or (v_role is not null and v_task.role_id = v_role)
    or (v_task.employee_id is null and v_task.role_id is null
        and app.has_access(v_task.tenant_id, 'tasks.read', v_task.branch_id)),
    false);

  if not v_smi then
    raise exception 'Tenhle úkol není váš.' using errcode = 'insufficient_privilege';
  end if;

  -- Druhé kliknutí nic nepokazí a nic nepřepíše. Kdo úkol zavřel jako
  -- první, tím zůstane.
  if v_task.status <> 'open' then
    return;
  end if;

  update public.tasks
     set status  = 'done',
         done_at = now(),
         done_by = v_emp
   where id = p_task;

  perform app.audit(v_task.tenant_id, 'task.done', 'task', p_task::text,
                    v_task.branch_id);
end;
$$;

comment on function public.complete_task(uuid) is
  'Zavře úkol. Mění jen status, done_at a done_by — proto funkce a ne '
  'rozšíření politiky tasks_write.';

revoke all on function public.complete_task(uuid) from public, anon;
grant execute on function public.complete_task(uuid) to authenticated;
