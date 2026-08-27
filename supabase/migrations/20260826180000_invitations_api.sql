-- =====================================================================
-- Foodtab — pozvánky pro aplikaci
--
-- Zvát lidi umí databáze od začátku, ale obě funkce leží ve schématu
-- `app`, které je zvenčí zavřené. Aplikace se na ně proto nemá jak
-- dostat. Otevíráme je stejným úzkým průzorem jako autorizaci.
--
-- Seznam pozvánek a jejich zrušení průzor nepotřebují — na tabulce
-- `invitations` platí politika pro `people.manage`, takže si je aplikace
-- přečte i zruší přímo.
-- =====================================================================


-- ---------------------------------------------------------------------
-- VYSTAVENÍ POZVÁNKY
--
-- Token se vrací volajícímu právě jednou; v databázi zůstane jen otisk.
-- Kdo pozvánku nemá komu ukázat, musí vystavit novou — přečíst starou
-- už nejde ani z databáze, ani ze zálohy.
--
-- Všechny kontroly (oprávnění, tvar adresy i telefonu, zákaz SMS
-- u citlivých rolí, pobočky cizí firmy) zůstávají v app.create_invitation.
-- Tady se nic nepřidává.
-- ---------------------------------------------------------------------

create or replace function public.create_invitation(
  p_tenant     uuid,
  p_role       uuid,
  p_channel    text,
  p_contact    text,
  p_scope      text default 'branch',
  p_branches   uuid[] default '{}',
  p_employee   uuid default null,
  p_valid_days int default 7
)
returns table (invitation_id uuid, token text)
language sql volatile security invoker set search_path = ''
as $$
  select * from app.create_invitation(
    p_tenant, p_role, p_channel, p_contact,
    p_scope, p_branches, p_employee, p_valid_days
  );
$$;

comment on function public.create_invitation(uuid, uuid, text, text, text, uuid[], uuid, int) is
  'Průzor pro aplikaci. Rozhoduje app.create_invitation, tady se jen přeposílá.';

revoke all on function public.create_invitation(uuid, uuid, text, text, text, uuid[], uuid, int)
  from public, anon;
grant execute on function public.create_invitation(uuid, uuid, text, text, text, uuid[], uuid, int)
  to authenticated;


-- ---------------------------------------------------------------------
-- PŘIJETÍ POZVÁNKY
--
-- Volá ji pozvaný po přihlášení. V tu chvíli do firmy ještě nepatří,
-- takže se musí obejít politiky — proto je pod tím SECURITY DEFINER.
-- ---------------------------------------------------------------------

create or replace function public.accept_invitation(p_token text)
returns uuid
language sql volatile security invoker set search_path = ''
as $$
  select app.accept_invitation(p_token);
$$;

comment on function public.accept_invitation(text) is
  'Průzor pro aplikaci. Rozhoduje app.accept_invitation.';

revoke all on function public.accept_invitation(text) from public, anon;
grant execute on function public.accept_invitation(text) to authenticated;


-- ---------------------------------------------------------------------
-- OTISK TOKENU SE PŘES API NEČTE
--
-- Politika na `invitations` pouští správce lidí na celý řádek, tedy
-- i na `token_hash`. Otisk sám o sobě zneužít nejde, ale posílat ho do
-- prohlížeče nemá důvod — a co se do prohlížeče nedostane, to nemůže
-- skončit v protokolu, v mezipaměti ani na cizí obrazovce.
--
-- Aplikace proto musí sloupce vyjmenovávat. `select *` nad pozvánkami
-- od téhle chvíle skončí chybou, a je to tak správně.
--
-- Pozor na pořadí: dokud platí právo na CELOU tabulku, odebrání jednoho
-- sloupce se neprojeví — Postgres širší právo nepřebije. Nejdřív se tedy
-- sebere čtení celé tabulky a teprve pak vrátí po sloupcích.
--
-- A pozor podruhé: každá budoucí migrace s `grant select on all tables
-- in schema public to authenticated` tuhle výjimku zase smaže. Když
-- takový řádek budete psát, přidejte za něj znovu tenhle blok.
-- ---------------------------------------------------------------------

revoke select on public.invitations from authenticated;

grant select (
  id, tenant_id, role_id, employee_id, channel, email, phone,
  scope, branch_ids, expires_at, accepted_at, accepted_by,
  revoked_at, invited_by, created_at
) on public.invitations to authenticated;
