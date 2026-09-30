-- =====================================================================
-- Foodtab — vlastní směnu vidí i ten, kdo nemá shifts.read
--
-- Otevřená otázka 2 (docs/hlaseni/otazky.md, 7. 9. 2026, při psaní
-- „Dnes"):
--
--   „Politika na `shifts` pouští jen `can_read_scoped(tenant,
--   shifts.read, branch)`. Nemá výjimku na vlastní řádek, na rozdíl
--   od docházky, kde `attendance_read` výslovně pouští `employee_id
--   in (moje)`.
--
--   Šablony rolí `shifts.read` mají všechny (Kuchyně, Servis, Bar,
--   Vedoucí směny), takže dnes to nikomu nevadí. Ale firma si role
--   upravuje sama — komu ho odebere, přestane vidět i svoji vlastní
--   směnu a „Dnes" mu ukáže „Dnes nemáte směnu", i když ji má.
--
--   Co jsem vybral: nesahal jsem na to. Je to změna politiky na
--   tabulce, kterou čte půlka aplikace, a v noci se do toho pouštět
--   nechci.
--
--   Když to má být jinak: přidat do `shifts_read` druhou větev `or
--   employee_id in (select id from employees where user_id =
--   auth.uid())` — přesně jako u docházky."
--
-- Tahle migrace dělá přesně tu navrženou opravu, ve dne, s ověřením
-- napříč appkou (viz hlášení).
--
-- PROČ TEĎ: dřív to „nikomu nevadilo" jen náhodou — protože všechny
-- šablony mají `shifts.read`. Je to shoda okolností, ne záruka (stejná
-- past jako „Pojistka nesmí záviset na nenastavení"): jakmile firma
-- sama upraví zařazení, díra se projeví bez jediného řádku kódu okolo.
--
-- VZOR: `attendance_read` (20260823130000_provoz.sql, poslední tvar
-- v 20260902060000_prechod_mezi_pobockami.sql) — vlastní řádek vidí
-- každý bez ohledu na oprávnění a bez ohledu na branch scope:
--
--   employee_id in (
--     select e.id from public.employees e
--     where e.user_id = (select auth.uid())
--   )
--
-- Přebírá se JEN tahle větev (vlastní řádek). `attendance_read` má
-- navíc třetí větev pro „protějšek dvojice mezi pobočkami"
-- (`app.dochazka_protejsek`) — ta řeší specifickou situaci párování
-- příchodu/odchodu přes dvě pobočky a pro směny nedává smysl (směna
-- nemá protějšek na jiné pobočce). Schválně se nekopíruje.
--
-- CO SE NEMĚNÍ: `app.can_read_scoped` ani nic, co na `shifts.read`
-- spoléhá mimo tuhle politiku (`shift_templates_read`, `sablony_smen_read`,
-- `employees_select`, `rozpis_stav`, `sablony_pro_smenu`, app-level brány
-- `zkusPristup`/`canSee` v app/[rozsah]/smeny, dnes, dochazka) — všechny
-- volají `app.can_read_scoped`/`app.has_access` přímo, ne tuhle RLS
-- politiku, takže rozšíření větve na `shifts` je nezasáhne. Podrobný
-- rozbor míst, která na `shifts.read` spoléhají, je v hlášení k téhle
-- migraci.
--
-- ROZSAH ZÁMĚRNĚ ÚZKÝ: přibývá jen VLASTNÍ řádek, nic jinýho. Kdo dnes
-- neviděl nic, uvidí od téhle migrace jen svoje vlastní směny —
-- směny kolegů (na jeho pobočce i jinde) zůstávají zamčené za
-- `shifts.read` úplně stejně jako dřív.
-- =====================================================================

drop policy if exists shifts_read on public.shifts;

create policy shifts_read on public.shifts for select to authenticated
  using (
    app.can_read_scoped(tenant_id, 'shifts.read', branch_id)
    or employee_id in (
      select e.id from public.employees e
      where e.user_id = (select auth.uid())
    )
  );
