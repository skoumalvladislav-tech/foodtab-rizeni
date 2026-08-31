-- =====================================================================
-- Foodtab — obsah oprávnění mění settings.manage, ne people.manage
--
-- Obrazovka Nastavení → Oprávnění je zavřená na `settings.manage`,
-- ale politika pod ní pouštěla zápis každému s `people.manage`. Dvě
-- obranné linie si tím odporovaly a ta slabší platila:
--
--   Kdo zakládá lidi, nesmí rozhodovat, kdo vidí mzdy. S people.manage
--   si dnes jde přidat payroll.read k vlastní roli přímým dotazem —
--   obrazovka ho nepustí dovnitř, databáze ano.
--
-- Čtení zůstává, jak bylo: `app.is_member`. Kdo je ve firmě, smí vidět,
-- co která sada obsahuje; skrývat to nedává smysl, když se podle toho
-- lidem vysvětluje, proč něco nemůžou.
--
-- `roles_write` se NEMĚNÍ. Založit nebo přejmenovat sadu je správa lidí;
-- co je uvnitř, je nastavení. Prázdná sada nikomu nic nedává.
-- =====================================================================

drop policy if exists role_permissions_write on public.role_permissions;

create policy role_permissions_write on public.role_permissions for all to authenticated
  using (exists (select 1 from public.roles r
                 where r.id = role_id and app.has_access(r.tenant_id, 'settings.manage')))
  with check (exists (select 1 from public.roles r
                      where r.id = role_id and app.has_access(r.tenant_id, 'settings.manage')));

comment on table public.role_permissions is
  'Co která pojmenovaná sada obsahuje. Mění jen settings.manage — '
  'people.manage lidi zakládá, ale nerozhoduje, kdo uvidí mzdy.';
